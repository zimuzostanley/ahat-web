import { describe, it, expect } from "vitest";
import { parseSmaps, aggregateSmaps } from "./capture";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SINGLE_VMA = `7f1234000-7f1235000 r-xp 00000000 fd:01 12345  /system/lib64/libart.so
Size:                  4 kB
KernelPageSize:        4 kB
MMUPageSize:           4 kB
Rss:                   4 kB
Pss:                   2 kB
Shared_Clean:          4 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:         0 kB
Referenced:            4 kB
Anonymous:             0 kB
LazyFree:              0 kB
AnonHugePages:         0 kB
ShmemPmdMapped:        0 kB
Swap:                  0 kB
SwapPss:               0 kB
Locked:                0 kB
VmFlags: rd ex mr mw me
`;

const MULTI_VMA = `7f1234000-7f1235000 r-xp 00000000 fd:01 12345  /system/lib64/libart.so
Size:                  4 kB
Rss:                   4 kB
Pss:                   2 kB
Shared_Clean:          4 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:         0 kB
Swap:                  0 kB
SwapPss:               0 kB
7f1235000-7f1236000 rw-p 00001000 fd:01 12345  /system/lib64/libart.so
Size:                  4 kB
Rss:                   4 kB
Pss:                   4 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:         4 kB
Swap:                  0 kB
SwapPss:               0 kB
7f2000000-7f2100000 rw-p 00000000 00:00 0      [anon:libc_malloc]
Size:               1024 kB
Rss:                 512 kB
Pss:                 512 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:       512 kB
Swap:                 64 kB
SwapPss:              32 kB
`;

const ANONYMOUS_VMA = `7f3000000-7f3001000 rw-p 00000000 00:00 0
Size:                  4 kB
Rss:                   4 kB
Pss:                   4 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:         4 kB
Swap:                  0 kB
SwapPss:               0 kB
`;

// ─── parseSmaps ──────────────────────────────────────────────────────────────

describe("parseSmaps", () => {
  it("parses a single VMA entry with all fields", () => {
    const entries = parseSmaps(SINGLE_VMA);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.addrStart).toBe("7f1234000");
    expect(e.addrEnd).toBe("7f1235000");
    expect(e.perms).toBe("r-xp");
    expect(e.name).toBe("/system/lib64/libart.so");
    expect(e.dev).toBe("fd:01");
    expect(e.inode).toBe(12345);
    expect(e.sizeKb).toBe(4);
    expect(e.rssKb).toBe(4);
    expect(e.pssKb).toBe(2);
    expect(e.sharedCleanKb).toBe(4);
    expect(e.sharedDirtyKb).toBe(0);
    expect(e.privateCleanKb).toBe(0);
    expect(e.privateDirtyKb).toBe(0);
    expect(e.swapKb).toBe(0);
    expect(e.swapPssKb).toBe(0);
  });

  it("parses multiple VMA entries", () => {
    const entries = parseSmaps(MULTI_VMA);
    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("/system/lib64/libart.so");
    expect(entries[0].perms).toBe("r-xp");
    expect(entries[1].name).toBe("/system/lib64/libart.so");
    expect(entries[1].perms).toBe("rw-p");
    expect(entries[1].privateDirtyKb).toBe(4);
    expect(entries[2].name).toBe("[anon:libc_malloc]");
    expect(entries[2].sizeKb).toBe(1024);
    expect(entries[2].rssKb).toBe(512);
    expect(entries[2].pssKb).toBe(512);
    expect(entries[2].swapKb).toBe(64);
    expect(entries[2].swapPssKb).toBe(32);
  });

  it("handles VMA with no name (anonymous mapping)", () => {
    const entries = parseSmaps(ANONYMOUS_VMA);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("");
    expect(entries[0].dev).toBe("00:00");
    expect(entries[0].inode).toBe(0);
    expect(entries[0].pssKb).toBe(4);
    expect(entries[0].privateDirtyKb).toBe(4);
  });

  it("ignores unknown key-value lines", () => {
    const entries = parseSmaps(SINGLE_VMA);
    // LazyFree, AnonHugePages, ShmemPmdMapped, Locked, VmFlags are all present
    // but should be ignored — only our tracked fields should be set
    expect(entries).toHaveLength(1);
    expect(entries[0].sizeKb).toBe(4);
  });

  it("returns empty array for empty input", () => {
    expect(parseSmaps("")).toEqual([]);
  });

  it("returns empty array for garbage input", () => {
    expect(parseSmaps("hello world\nfoo bar baz\n")).toEqual([]);
  });

  it("handles realistic multi-lib Android fixture", () => {
    const fixture = [
      "70000000-70100000 r--p 00000000 fd:01 100  /system/framework/framework.jar",
      "Size:               1024 kB", "Rss:  800 kB", "Pss:  400 kB",
      "Shared_Clean: 600 kB", "Shared_Dirty: 0 kB",
      "Private_Clean: 200 kB", "Private_Dirty: 0 kB",
      "Swap: 0 kB", "SwapPss: 0 kB",
      "80000000-80010000 r-xp 00000000 fd:01 200  /system/lib64/libandroid.so",
      "Size:                 64 kB", "Rss:   64 kB", "Pss:   32 kB",
      "Shared_Clean: 64 kB", "Shared_Dirty: 0 kB",
      "Private_Clean: 0 kB", "Private_Dirty: 0 kB",
      "Swap: 0 kB", "SwapPss: 0 kB",
      "a0000000-a0001000 rw-p 00000000 00:00 0      [stack]",
      "Size:                  4 kB", "Rss:    4 kB", "Pss:    4 kB",
      "Shared_Clean: 0 kB", "Shared_Dirty: 0 kB",
      "Private_Clean: 0 kB", "Private_Dirty: 4 kB",
      "Swap: 0 kB", "SwapPss: 0 kB",
    ].join("\n");

    const entries = parseSmaps(fixture);
    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("/system/framework/framework.jar");
    expect(entries[0].pssKb).toBe(400);
    expect(entries[0].sharedCleanKb).toBe(600);
    expect(entries[1].name).toBe("/system/lib64/libandroid.so");
    expect(entries[1].pssKb).toBe(32);
    expect(entries[2].name).toBe("[stack]");
    expect(entries[2].privateDirtyKb).toBe(4);
  });

  it("handles entries without trailing newline", () => {
    const input = `7f1234000-7f1235000 r-xp 00000000 fd:01 100  /lib.so
Size:  4 kB
Rss:   4 kB
Pss:   2 kB
Shared_Clean: 0 kB
Shared_Dirty: 0 kB
Private_Clean: 0 kB
Private_Dirty: 0 kB
Swap: 0 kB
SwapPss: 0 kB`;  // no trailing newline
    const entries = parseSmaps(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].pssKb).toBe(2);
  });
});

// ─── aggregateSmaps ──────────────────────────────────────────────────────────

describe("aggregateSmaps", () => {
  it("groups entries by name and sums numeric fields", () => {
    const entries = parseSmaps(MULTI_VMA);
    const agg = aggregateSmaps(entries);

    const libart = agg.find(g => g.name === "/system/lib64/libart.so");
    expect(libart).toBeDefined();
    expect(libart!.count).toBe(2);
    expect(libart!.sizeKb).toBe(8);       // 4 + 4
    expect(libart!.rssKb).toBe(8);        // 4 + 4
    expect(libart!.pssKb).toBe(6);        // 2 + 4
    expect(libart!.sharedCleanKb).toBe(4); // 4 + 0
    expect(libart!.privateDirtyKb).toBe(4); // 0 + 4

    const malloc = agg.find(g => g.name === "[anon:libc_malloc]");
    expect(malloc).toBeDefined();
    expect(malloc!.count).toBe(1);
    expect(malloc!.pssKb).toBe(512);
    expect(malloc!.swapKb).toBe(64);
  });

  it("treats empty name as [anonymous]", () => {
    const entries = parseSmaps(ANONYMOUS_VMA);
    const agg = aggregateSmaps(entries);
    expect(agg).toHaveLength(1);
    expect(agg[0].name).toBe("[anonymous]");
    expect(agg[0].pssKb).toBe(4);
  });

  it("returns results sorted by PSS descending", () => {
    const entries = parseSmaps(MULTI_VMA);
    const agg = aggregateSmaps(entries);
    for (let i = 1; i < agg.length; i++) {
      expect(agg[i - 1].pssKb).toBeGreaterThanOrEqual(agg[i].pssKb);
    }
  });

  it("preserves child entries in each group", () => {
    const entries = parseSmaps(MULTI_VMA);
    const agg = aggregateSmaps(entries);
    const libart = agg.find(g => g.name === "/system/lib64/libart.so")!;
    expect(libart.entries).toHaveLength(2);
    expect(libart.entries[0].perms).toBe("r-xp");
    expect(libart.entries[1].perms).toBe("rw-p");
  });

  it("handles single entry (no grouping needed)", () => {
    const entries = parseSmaps(SINGLE_VMA);
    const agg = aggregateSmaps(entries);
    expect(agg).toHaveLength(1);
    expect(agg[0].name).toBe("/system/lib64/libart.so");
    expect(agg[0].count).toBe(1);
    expect(agg[0].entries).toHaveLength(1);
  });

  it("handles all entries with same name", () => {
    // Both libart entries from MULTI_VMA, ignore the malloc one
    const entries = parseSmaps(MULTI_VMA).filter(e => e.name.includes("libart"));
    const agg = aggregateSmaps(entries);
    expect(agg).toHaveLength(1);
    expect(agg[0].count).toBe(2);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateSmaps([])).toEqual([]);
  });
});
