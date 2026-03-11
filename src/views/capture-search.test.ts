import { describe, it, expect } from "vitest";
import {
  searchProcesses,
  searchSharedMappings,
  filterProcesses,
  filterSmapsGroups,
  filterVmaEntries,
  filterSharedMappings,
  highlightText,
  type SearchMatch,
  type SearchResults,
} from "./capture-search";
import type { ProcessInfo, SmapsAggregated, SmapsEntry, SharedMapping, SmapsRollup } from "../adb/capture";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProc(pid: number, name: string, opts?: Partial<ProcessInfo>): ProcessInfo {
  return { pid, name, oomLabel: "", pssKb: 0, rssKb: 0, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0, ...opts };
}

function makeEntry(name: string, addrStart: string, opts?: Partial<SmapsEntry>): SmapsEntry {
  return {
    name, addrStart, addrEnd: "ffffffff", perms: "r--p", dev: "00:00", inode: 0,
    sizeKb: 0, rssKb: 0, pssKb: 0, sharedCleanKb: 0, sharedDirtyKb: 0,
    privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0, swapPssKb: 0, ...opts,
  };
}

function makeGroup(name: string, entries: SmapsEntry[], opts?: Partial<SmapsAggregated>): SmapsAggregated {
  return {
    name, count: entries.length, entries, sizeKb: 0, rssKb: 0, pssKb: 0,
    sharedCleanKb: 0, sharedDirtyKb: 0, privateCleanKb: 0, privateDirtyKb: 0,
    swapKb: 0, swapPssKb: 0, ...opts,
  };
}

function makeSharedMapping(name: string, opts?: Partial<SharedMapping>): SharedMapping {
  return {
    name, processCount: 1, pssKb: 0, rssKb: 0, sizeKb: 0,
    sharedCleanKb: 0, sharedDirtyKb: 0, privateCleanKb: 0, privateDirtyKb: 0,
    swapKb: 0, processes: [], ...opts,
  };
}

const noRollups = new Map<number, SmapsRollup>();
const noSmaps = new Map<number, SmapsAggregated[]>();

// ── searchProcesses ──────────────────────────────────────────────────────────

describe("searchProcesses", () => {
  it("matches process name", () => {
    const procs = [makeProc(1, "system_server"), makeProc(2, "zygote")];
    const r = searchProcesses(procs, "system", noSmaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.process).toBe(true);
  });

  it("matches PID", () => {
    const procs = [makeProc(123, "app")];
    const r = searchProcesses(procs, "123", noSmaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(123)!.process).toBe(true);
  });

  it("matches oomLabel", () => {
    const procs = [makeProc(1, "app", { oomLabel: "Foreground" })];
    const r = searchProcesses(procs, "foreground", noSmaps, noRollups);
    expect(r.size).toBe(1);
  });

  it("is case insensitive", () => {
    const procs = [makeProc(1, "SystemServer")];
    const r = searchProcesses(procs, "SYSTEMSERVER", noSmaps, noRollups);
    expect(r.size).toBe(1);
  });

  it("matches smaps group name → path-to-root", () => {
    const procs = [makeProc(1, "app")];
    const smaps = new Map([[1, [makeGroup("/system/lib/libc.so", [makeEntry("libc.so", "1000")])]]]);
    const r = searchProcesses(procs, "libc", smaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.process).toBe(false);
    expect(r.get(1)!.smapsGroups.has("/system/lib/libc.so")).toBe(true);
  });

  it("matches VMA entry name → path-to-root through group and process", () => {
    const procs = [makeProc(1, "app")];
    const smaps = new Map([[1, [makeGroup("[heap]", [
      makeEntry("dalvik-main", "1000"),
      makeEntry("dalvik-alloc", "2000"),
    ])]]]);
    const r = searchProcesses(procs, "dalvik-main", smaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.smapsGroups.has("[heap]")).toBe(true);
    expect(r.get(1)!.vmaEntries.get("[heap]")?.has("1000")).toBe(true);
    expect(r.get(1)!.vmaEntries.get("[heap]")?.has("2000")).toBeUndefined;
  });

  it("matches VMA address", () => {
    const procs = [makeProc(1, "app")];
    const smaps = new Map([[1, [makeGroup("lib", [makeEntry("libc.so", "7f000000")])]]]);
    const r = searchProcesses(procs, "7f000000", smaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.vmaEntries.get("lib")?.has("7f000000")).toBe(true);
  });

  it("returns empty for no matches", () => {
    const procs = [makeProc(1, "foo"), makeProc(2, "bar")];
    const r = searchProcesses(procs, "zzzzz", noSmaps, noRollups);
    expect(r.size).toBe(0);
  });

  it("returns empty for empty query", () => {
    const procs = [makeProc(1, "foo")];
    expect(searchProcesses(procs, "", noSmaps, noRollups).size).toBe(0);
    expect(searchProcesses(procs, "   ", noSmaps, noRollups).size).toBe(0);
  });

  it("process match + smaps match on same process", () => {
    const procs = [makeProc(1, "chrome")];
    const smaps = new Map([[1, [makeGroup("/system/lib/libchrome.so", [makeEntry("libchrome.so", "1000")])]]]);
    const r = searchProcesses(procs, "chrome", smaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.process).toBe(true);
    expect(r.get(1)!.smapsGroups.size).toBeGreaterThan(0);
  });

  it("group name match also records matching VMA entries for sub-filtering", () => {
    const procs = [makeProc(1, "app")];
    const smaps = new Map([[1, [makeGroup("/memfd:jit-cache (deleted)", [
      makeEntry("jit-cache", "1000"),  // name contains "jit-cache"
      makeEntry("other-stuff", "2000"),
    ])]]]);
    const r = searchProcesses(procs, "jit-cache", smaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.smapsGroups.has("/memfd:jit-cache (deleted)")).toBe(true);
    // VMA "jit-cache" also matched by name
    expect(r.get(1)!.vmaEntries.get("/memfd:jit-cache (deleted)")?.has("1000")).toBe(true);
    // VMA "other-stuff" did NOT match
    expect(r.get(1)!.vmaEntries.get("/memfd:jit-cache (deleted)")?.has("2000")).toBeFalsy();
  });
});

// ── searchSharedMappings ────────────────────────────────────────────────────

describe("searchSharedMappings", () => {
  it("matches by name", () => {
    const mappings = [makeSharedMapping("libc.so"), makeSharedMapping("libm.so")];
    const r = searchSharedMappings(mappings, "libc");
    expect(r.size).toBe(1);
    expect(r.has("libc.so")).toBe(true);
  });

  it("returns empty for no match", () => {
    const mappings = [makeSharedMapping("libc.so")];
    expect(searchSharedMappings(mappings, "zzz").size).toBe(0);
  });

  it("returns empty for empty query", () => {
    expect(searchSharedMappings([makeSharedMapping("a")], "").size).toBe(0);
  });
});

// ── filterProcesses ──────────────────────────────────────────────────────────

describe("filterProcesses", () => {
  it("returns only matching processes", () => {
    const procs = [makeProc(1, "a"), makeProc(2, "b"), makeProc(3, "c")];
    const results: SearchResults = new Map([[1, { process: true, smapsGroups: new Set(), vmaEntries: new Map() }]]);
    expect(filterProcesses(procs, results).map(p => p.pid)).toEqual([1]);
  });

  it("returns empty when no matches", () => {
    const procs = [makeProc(1, "a"), makeProc(2, "b")];
    expect(filterProcesses(procs, new Map())).toEqual([]);
  });
});

// ── filterSmapsGroups ────────────────────────────────────────────────────────

describe("filterSmapsGroups", () => {
  const groups = [
    makeGroup("libc.so", []),
    makeGroup("libm.so", []),
    makeGroup("jit-cache", []),
  ];

  it("returns all groups when process matched directly", () => {
    const match: SearchMatch = { process: true, smapsGroups: new Set(), vmaEntries: new Map() };
    expect(filterSmapsGroups(groups, match)).toEqual(groups);
  });

  it("filters to only matching groups when sub-match", () => {
    const match: SearchMatch = { process: false, smapsGroups: new Set(["jit-cache"]), vmaEntries: new Map() };
    expect(filterSmapsGroups(groups, match).map(g => g.name)).toEqual(["jit-cache"]);
  });

  it("returns empty when no groups match", () => {
    const match: SearchMatch = { process: false, smapsGroups: new Set(), vmaEntries: new Map() };
    expect(filterSmapsGroups(groups, match)).toEqual([]);
  });
});

// ── filterVmaEntries ─────────────────────────────────────────────────────────

describe("filterVmaEntries", () => {
  const entries = [
    makeEntry("jit-cache", "1000"),
    makeEntry("other", "2000"),
    makeEntry("jit-cache-2", "3000"),
  ];

  it("returns all entries when process matched", () => {
    const match: SearchMatch = { process: true, smapsGroups: new Set(), vmaEntries: new Map() };
    expect(filterVmaEntries(entries, "group", match)).toEqual(entries);
  });

  it("returns all entries when group matched but no VMA detail", () => {
    const match: SearchMatch = { process: false, smapsGroups: new Set(["group"]), vmaEntries: new Map() };
    expect(filterVmaEntries(entries, "group", match)).toEqual(entries);
  });

  it("filters to matching VMA entries", () => {
    const match: SearchMatch = {
      process: false,
      smapsGroups: new Set(["group"]),
      vmaEntries: new Map([["group", new Set(["1000", "3000"])]]),
    };
    const filtered = filterVmaEntries(entries, "group", match);
    expect(filtered.map(e => e.addrStart)).toEqual(["1000", "3000"]);
  });
});

// ── filterSharedMappings ─────────────────────────────────────────────────────

describe("filterSharedMappings", () => {
  it("returns empty when matched set is empty", () => {
    const mappings = [makeSharedMapping("a"), makeSharedMapping("b")];
    expect(filterSharedMappings(mappings, new Set())).toEqual([]);
  });

  it("filters to matching names", () => {
    const mappings = [makeSharedMapping("a"), makeSharedMapping("b"), makeSharedMapping("c")];
    expect(filterSharedMappings(mappings, new Set(["a", "c"])).map(m => m.name)).toEqual(["a", "c"]);
  });
});

// ── highlightText ────────────────────────────────────────────────────────────

describe("highlightText", () => {
  it("returns single non-highlighted segment for empty query", () => {
    expect(highlightText("hello", "")).toEqual([{ text: "hello", highlight: false }]);
  });

  it("returns single non-highlighted segment when no match", () => {
    expect(highlightText("hello", "xyz")).toEqual([{ text: "hello", highlight: false }]);
  });

  it("highlights matching substring", () => {
    expect(highlightText("hello world", "world")).toEqual([
      { text: "hello ", highlight: false },
      { text: "world", highlight: true },
    ]);
  });

  it("highlights at start of string", () => {
    expect(highlightText("hello world", "hello")).toEqual([
      { text: "hello", highlight: true },
      { text: " world", highlight: false },
    ]);
  });

  it("is case-insensitive", () => {
    expect(highlightText("Hello World", "hello")).toEqual([
      { text: "Hello", highlight: true },
      { text: " World", highlight: false },
    ]);
  });
});
