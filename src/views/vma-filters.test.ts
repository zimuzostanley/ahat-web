import { describe, it, expect } from "vitest";
import type { SmapsEntry, SmapsAggregated } from "../adb/capture";
import { classifyVma, matchesEntryFilters, filterSmapsByFilters, type VmaFilters } from "./CaptureView";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<SmapsEntry> = {}): SmapsEntry {
  return {
    addrStart: "7f000000", addrEnd: "7f001000", perms: "r--p",
    name: "", dev: "00:00", inode: 0,
    sizeKb: 4, rssKb: 4, pssKb: 4,
    sharedCleanKb: 0, sharedDirtyKb: 0,
    privateCleanKb: 4, privateDirtyKb: 0,
    swapKb: 0, swapPssKb: 0,
    ...overrides,
  };
}

function makeAgg(name: string, entries: SmapsEntry[]): SmapsAggregated {
  const agg: SmapsAggregated = {
    name, count: entries.length, entries,
    sizeKb: 0, rssKb: 0, pssKb: 0,
    sharedCleanKb: 0, sharedDirtyKb: 0,
    privateCleanKb: 0, privateDirtyKb: 0,
    swapKb: 0, swapPssKb: 0,
  };
  for (const e of entries) {
    agg.sizeKb += e.sizeKb; agg.rssKb += e.rssKb; agg.pssKb += e.pssKb;
    agg.sharedCleanKb += e.sharedCleanKb; agg.sharedDirtyKb += e.sharedDirtyKb;
    agg.privateCleanKb += e.privateCleanKb; agg.privateDirtyKb += e.privateDirtyKb;
    agg.swapKb += e.swapKb; agg.swapPssKb += e.swapPssKb;
  }
  return agg;
}

const NO_FILTER: VmaFilters = { type: "all", r: null, w: null, x: null };

// ── classifyVma ──────────────────────────────────────────────────────────────

describe("classifyVma", () => {
  it("classifies file-backed: non-zero dev and inode", () => {
    expect(classifyVma(makeEntry({ name: "/system/lib/libc.so", dev: "fc:00", inode: 12345 }))).toBe("file");
  });

  it("classifies file with different device", () => {
    expect(classifyVma(makeEntry({ name: "/data/app/base.apk", dev: "fd:10", inode: 99 }))).toBe("file");
  });

  it("classifies path with dev=00:00 as anon (not file-backed)", () => {
    expect(classifyVma(makeEntry({ name: "/dev/ashmem/dalvik-main", dev: "00:00", inode: 0 }))).toBe("anon");
    expect(classifyVma(makeEntry({ name: "/memfd:jit-cache", dev: "00:00", inode: 42 }))).toBe("anon");
    expect(classifyVma(makeEntry({ name: "/dev/zero", dev: "00:00", inode: 5 }))).toBe("anon");
  });

  it("classifies anon: bracketed names", () => {
    expect(classifyVma(makeEntry({ name: "[anon:libc_malloc]" }))).toBe("anon");
    expect(classifyVma(makeEntry({ name: "[heap]" }))).toBe("anon");
    expect(classifyVma(makeEntry({ name: "[stack]" }))).toBe("anon");
    expect(classifyVma(makeEntry({ name: "[vdso]" }))).toBe("anon");
  });

  it("classifies anon: empty name", () => {
    expect(classifyVma(makeEntry({ name: "" }))).toBe("anon");
  });

  it("classifies anon: non-zero dev but zero inode is anon (unusual)", () => {
    // dev != 00:00 but inode = 0 → not a real file
    expect(classifyVma(makeEntry({ name: "", dev: "fc:00", inode: 0 }))).toBe("anon");
  });
});

// ── matchesEntryFilters ──────────────────────────────────────────────────────

describe("matchesEntryFilters", () => {
  const fileEntry = makeEntry({ name: "/system/lib/libc.so", dev: "fc:00", inode: 1, perms: "r-xp" });
  const anonEntry = makeEntry({ name: "[anon:libc_malloc]", dev: "00:00", inode: 0, perms: "rw-p" });
  const pathAnonEntry = makeEntry({ name: "/dev/ashmem/test", dev: "00:00", inode: 0, perms: "rw-p" });

  it("all filter matches everything", () => {
    expect(matchesEntryFilters(fileEntry, NO_FILTER)).toBe(true);
    expect(matchesEntryFilters(anonEntry, NO_FILTER)).toBe(true);
    expect(matchesEntryFilters(pathAnonEntry, NO_FILTER)).toBe(true);
  });

  it("file filter matches only file-backed (non-zero dev and inode)", () => {
    const f: VmaFilters = { type: "file", r: null, w: null, x: null };
    expect(matchesEntryFilters(fileEntry, f)).toBe(true);
    expect(matchesEntryFilters(anonEntry, f)).toBe(false);
    expect(matchesEntryFilters(pathAnonEntry, f)).toBe(false);
  });

  it("anon filter matches everything that isn't file-backed", () => {
    const f: VmaFilters = { type: "anon", r: null, w: null, x: null };
    expect(matchesEntryFilters(fileEntry, f)).toBe(false);
    expect(matchesEntryFilters(anonEntry, f)).toBe(true);
    expect(matchesEntryFilters(pathAnonEntry, f)).toBe(true);
  });

  it("perm filter r=true requires readable", () => {
    const f: VmaFilters = { type: "all", r: true, w: null, x: null };
    expect(matchesEntryFilters(makeEntry({ perms: "r--p" }), f)).toBe(true);
    expect(matchesEntryFilters(makeEntry({ perms: "---p" }), f)).toBe(false);
  });

  it("perm filter r=false excludes readable", () => {
    const f: VmaFilters = { type: "all", r: false, w: null, x: null };
    expect(matchesEntryFilters(makeEntry({ perms: "r--p" }), f)).toBe(false);
    expect(matchesEntryFilters(makeEntry({ perms: "---p" }), f)).toBe(true);
  });

  it("perm filter w=true requires writable", () => {
    const f: VmaFilters = { type: "all", r: null, w: true, x: null };
    expect(matchesEntryFilters(makeEntry({ perms: "rw-p" }), f)).toBe(true);
    expect(matchesEntryFilters(makeEntry({ perms: "r--p" }), f)).toBe(false);
  });

  it("perm filter x=true requires executable", () => {
    const f: VmaFilters = { type: "all", r: null, w: null, x: true };
    expect(matchesEntryFilters(makeEntry({ perms: "r-xp" }), f)).toBe(true);
    expect(matchesEntryFilters(makeEntry({ perms: "rw-p" }), f)).toBe(false);
  });

  it("combined type + perm filter", () => {
    const f: VmaFilters = { type: "file", r: null, w: null, x: true };
    // File + executable
    expect(matchesEntryFilters(makeEntry({ name: "/a.so", dev: "fc:00", inode: 1, perms: "r-xp" }), f)).toBe(true);
    // File + not executable
    expect(matchesEntryFilters(makeEntry({ name: "/a.so", dev: "fc:00", inode: 1, perms: "r--p" }), f)).toBe(false);
    // Anon + executable
    expect(matchesEntryFilters(makeEntry({ name: "[anon:jit]", perms: "r-xp" }), f)).toBe(false);
  });
});

// ── filterSmapsByFilters ─────────────────────────────────────────────────────

describe("filterSmapsByFilters", () => {
  it("returns original when no filters active", () => {
    const agg = [makeAgg("test", [makeEntry()])];
    expect(filterSmapsByFilters(agg, NO_FILTER)).toBe(agg);
  });

  it("removes groups with no matching entries", () => {
    const agg = [
      makeAgg("[anon:malloc]", [makeEntry({ name: "[anon:malloc]" })]),
      makeAgg("/system/lib/libc.so", [makeEntry({ name: "/system/lib/libc.so", dev: "fc:00", inode: 1 })]),
    ];
    const filtered = filterSmapsByFilters(agg, { type: "file", r: null, w: null, x: null });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("/system/lib/libc.so");
  });

  it("recomputes aggregated values from filtered entries", () => {
    const entries = [
      makeEntry({ perms: "r--p", pssKb: 10 }),
      makeEntry({ perms: "rw-p", pssKb: 20 }),
      makeEntry({ perms: "r-xp", pssKb: 30 }),
    ];
    const agg = [makeAgg("test", entries)];
    expect(agg[0].pssKb).toBe(60);
    expect(agg[0].count).toBe(3);

    // Filter to writable only
    const filtered = filterSmapsByFilters(agg, { type: "all", r: null, w: true, x: null });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].pssKb).toBe(20);
    expect(filtered[0].count).toBe(1);
  });

  it("returns original group when all entries match", () => {
    const entries = [
      makeEntry({ perms: "r--p", pssKb: 10 }),
      makeEntry({ perms: "r--p", pssKb: 20 }),
    ];
    const agg = [makeAgg("test", entries)];
    const filtered = filterSmapsByFilters(agg, { type: "all", r: true, w: null, x: null });
    // Same reference since all entries matched
    expect(filtered[0]).toBe(agg[0]);
  });

  it("handles multiple groups with partial matches", () => {
    const agg = [
      makeAgg("lib.so", [
        makeEntry({ perms: "r--p", pssKb: 10, name: "lib.so", dev: "fc:00", inode: 1 }),
        makeEntry({ perms: "r-xp", pssKb: 20, name: "lib.so", dev: "fc:00", inode: 1 }),
      ]),
      makeAgg("[heap]", [
        makeEntry({ perms: "rw-p", pssKb: 50, name: "[heap]" }),
      ]),
    ];

    // Executable only
    const filtered = filterSmapsByFilters(agg, { type: "all", r: null, w: null, x: true });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("lib.so");
    expect(filtered[0].pssKb).toBe(20);
    expect(filtered[0].count).toBe(1);
  });
});
