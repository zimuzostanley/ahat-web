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
  it("returns empty map for empty query", () => {
    const procs = [makeProc(1, "com.test.app")];
    expect(searchProcesses(procs, "", noSmaps, noRollups).size).toBe(0);
    expect(searchProcesses(procs, "  ", noSmaps, noRollups).size).toBe(0);
  });

  it("matches process name (case-insensitive)", () => {
    const procs = [makeProc(1, "com.google.SystemUI"), makeProc(2, "com.facebook.app")];
    const r = searchProcesses(procs, "systemui", noSmaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
    expect(r.get(1)!.process).toBe(true);
  });

  it("matches PID as string", () => {
    const procs = [makeProc(1234, "foo"), makeProc(5678, "bar")];
    const r = searchProcesses(procs, "1234", noSmaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.has(1234)).toBe(true);
  });

  it("matches oomLabel", () => {
    const procs = [makeProc(1, "foo", { oomLabel: "Foreground" })];
    const r = searchProcesses(procs, "foreground", noSmaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.process).toBe(true);
  });

  it("matches smaps group name → path-to-root", () => {
    const procs = [makeProc(1, "app")];
    const entry = makeEntry("libfoo.so", "10000");
    const smaps = new Map([[1, [makeGroup("libfoo.so", [entry])]]]);
    const r = searchProcesses(procs, "libfoo", smaps, noRollups);
    expect(r.size).toBe(1);
    const m = r.get(1)!;
    expect(m.process).toBe(false); // process itself didn't match
    expect(m.smapsGroups.has("libfoo.so")).toBe(true);
  });

  it("matches VMA entry address → path-to-root through group and process", () => {
    const entry = makeEntry("libc.so", "7f000000");
    const procs = [makeProc(1, "app")];
    const smaps = new Map([[1, [makeGroup("libc.so", [entry])]]]);
    const r = searchProcesses(procs, "7f000000", smaps, noRollups);
    expect(r.size).toBe(1);
    const m = r.get(1)!;
    expect(m.process).toBe(false);
    expect(m.smapsGroups.has("libc.so")).toBe(true);
    expect(m.vmaEntries.get("libc.so")?.has("7f000000")).toBe(true);
  });

  it("matches VMA permissions", () => {
    const entry = makeEntry("heap", "1000", { perms: "rw-p" });
    const procs = [makeProc(1, "app")];
    const smaps = new Map([[1, [makeGroup("[heap]", [entry])]]]);
    const r = searchProcesses(procs, "rw-p", smaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.vmaEntries.get("[heap]")?.has("1000")).toBe(true);
  });

  it("does not include processes with no matches", () => {
    const procs = [makeProc(1, "foo"), makeProc(2, "bar")];
    const r = searchProcesses(procs, "foo", noSmaps, noRollups);
    expect(r.has(2)).toBe(false);
  });

  it("combines process-level and sub-level matches", () => {
    const procs = [makeProc(1, "libfoo")]; // name matches "libfoo"
    const entry = makeEntry("libfoo.so", "1000");
    const smaps = new Map([[1, [makeGroup("libfoo.so", [entry])]]]);
    const r = searchProcesses(procs, "libfoo", smaps, noRollups);
    const m = r.get(1)!;
    expect(m.process).toBe(true);
    expect(m.smapsGroups.has("libfoo.so")).toBe(true);
  });

  it("handles size query '>100kb'", () => {
    const procs = [
      makeProc(1, "big", { pssKb: 200 }),
      makeProc(2, "small", { pssKb: 50 }),
    ];
    const r = searchProcesses(procs, ">100kb", noSmaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
  });

  it("handles size query with rollup data", () => {
    const procs = [makeProc(1, "app")];
    const rollups = new Map([[1, {
      sizeKb: 0, rssKb: 500, pssKb: 0, sharedCleanKb: 0, sharedDirtyKb: 0,
      privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0, swapPssKb: 0,
    }]]);
    const r = searchProcesses(procs, ">400kb", noSmaps, rollups);
    expect(r.size).toBe(1);
  });

  it("handles size query matching VMA entries", () => {
    const procs = [makeProc(1, "app")];
    const entry = makeEntry("libc.so", "1000", { pssKb: 2048 });
    const smaps = new Map([[1, [makeGroup("libc.so", [entry])]]]);
    const r = searchProcesses(procs, ">1mb", smaps, noRollups);
    expect(r.size).toBe(1);
    expect(r.get(1)!.vmaEntries.get("libc.so")?.has("1000")).toBe(true);
  });

  it("handles size query with MB suffix", () => {
    const procs = [makeProc(1, "app", { pssKb: 2048 })];
    const r = searchProcesses(procs, ">1mb", noSmaps, noRollups);
    expect(r.size).toBe(1);
  });
});

// ── searchSharedMappings ─────────────────────────────────────────────────────

describe("searchSharedMappings", () => {
  it("returns empty set for empty query", () => {
    expect(searchSharedMappings([makeSharedMapping("libc.so")], "").size).toBe(0);
  });

  it("matches mapping name", () => {
    const mappings = [makeSharedMapping("libc.so"), makeSharedMapping("libm.so")];
    const r = searchSharedMappings(mappings, "libc");
    expect(r.size).toBe(1);
    expect(r.has("libc.so")).toBe(true);
  });

  it("matches size query", () => {
    const mappings = [
      makeSharedMapping("big.so", { pssKb: 5000 }),
      makeSharedMapping("small.so", { pssKb: 10 }),
    ];
    const r = searchSharedMappings(mappings, ">1mb");
    expect(r.size).toBe(1);
    expect(r.has("big.so")).toBe(true);
  });
});

// ── filterProcesses ──────────────────────────────────────────────────────────

describe("filterProcesses", () => {
  it("returns empty when search results is empty", () => {
    const procs = [makeProc(1, "a"), makeProc(2, "b")];
    expect(filterProcesses(procs, new Map())).toEqual([]);
  });

  it("filters to matching pids only", () => {
    const procs = [makeProc(1, "a"), makeProc(2, "b"), makeProc(3, "c")];
    const results: Map<number, SearchMatch> = new Map([
      [1, { process: true, smapsGroups: new Set(), vmaEntries: new Map() }],
      [3, { process: false, smapsGroups: new Set(["grp"]), vmaEntries: new Map() }],
    ]);
    const filtered = filterProcesses(procs, results);
    expect(filtered.map(p => p.pid)).toEqual([1, 3]);
  });

  it("preserves original order", () => {
    const procs = [makeProc(3, "c"), makeProc(1, "a"), makeProc(2, "b")];
    const results: Map<number, SearchMatch> = new Map([
      [2, { process: true, smapsGroups: new Set(), vmaEntries: new Map() }],
      [3, { process: true, smapsGroups: new Set(), vmaEntries: new Map() }],
    ]);
    expect(filterProcesses(procs, results).map(p => p.pid)).toEqual([3, 2]);
  });
});

// ── filterSmapsGroups ────────────────────────────────────────────────────────

describe("filterSmapsGroups", () => {
  const groups = [
    makeGroup("libc.so", []),
    makeGroup("libm.so", []),
    makeGroup("libdl.so", []),
  ];

  it("returns all groups when process matched", () => {
    const match: SearchMatch = { process: true, smapsGroups: new Set(["libc.so"]), vmaEntries: new Map() };
    expect(filterSmapsGroups(groups, match)).toEqual(groups);
  });

  it("filters to matching groups when only sub-match", () => {
    const match: SearchMatch = { process: false, smapsGroups: new Set(["libc.so", "libdl.so"]), vmaEntries: new Map() };
    const filtered = filterSmapsGroups(groups, match);
    expect(filtered.map(g => g.name)).toEqual(["libc.so", "libdl.so"]);
  });
});

// ── filterVmaEntries ─────────────────────────────────────────────────────────

describe("filterVmaEntries", () => {
  const entries = [
    makeEntry("libc.so", "1000"),
    makeEntry("libc.so", "2000"),
    makeEntry("libc.so", "3000"),
  ];

  it("returns all entries when process matched", () => {
    const match: SearchMatch = { process: true, smapsGroups: new Set(), vmaEntries: new Map() };
    expect(filterVmaEntries(entries, "libc.so", match)).toEqual(entries);
  });

  it("returns all entries when group matched but no VMA detail", () => {
    const match: SearchMatch = { process: false, smapsGroups: new Set(["libc.so"]), vmaEntries: new Map() };
    expect(filterVmaEntries(entries, "libc.so", match)).toEqual(entries);
  });

  it("filters to matching VMA entries", () => {
    const match: SearchMatch = {
      process: false,
      smapsGroups: new Set(["libc.so"]),
      vmaEntries: new Map([["libc.so", new Set(["1000", "3000"])]]),
    };
    const filtered = filterVmaEntries(entries, "libc.so", match);
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

  it("highlights entire string", () => {
    expect(highlightText("hello", "hello")).toEqual([
      { text: "hello", highlight: true },
    ]);
  });

  it("is case-insensitive", () => {
    expect(highlightText("Hello World", "hello")).toEqual([
      { text: "Hello", highlight: true },
      { text: " World", highlight: false },
    ]);
  });

  it("highlights first occurrence only", () => {
    const result = highlightText("foo bar foo", "foo");
    expect(result).toEqual([
      { text: "foo", highlight: true },
      { text: " bar foo", highlight: false },
    ]);
  });
});

// ── Qualified / scoped search ─────────────────────────────────────────────────

describe("qualified search (scope:value)", () => {
  const procs = [
    makeProc(1, "system_server", { pssKb: 200_000, rssKb: 300_000 }),
    makeProc(2, "com.google.chrome", { pssKb: 50_000, rssKb: 80_000 }),
    makeProc(3, "surfaceflinger", { pssKb: 10_000, rssKb: 15_000 }),
  ];
  const rollups = new Map<number, SmapsRollup>([
    [1, { sizeKb: 400_000, pssKb: 200_000, rssKb: 300_000, privateDirtyKb: 150_000, privateCleanKb: 20_000, sharedDirtyKb: 5_000, sharedCleanKb: 25_000, swapKb: 1_000, swapPssKb: 500 }],
    [2, { sizeKb: 100_000, pssKb: 50_000, rssKb: 80_000, privateDirtyKb: 40_000, privateCleanKb: 5_000, sharedDirtyKb: 2_000, sharedCleanKb: 3_000, swapKb: 0, swapPssKb: 0 }],
    [3, { sizeKb: 20_000, pssKb: 10_000, rssKb: 15_000, privateDirtyKb: 8_000, privateCleanKb: 1_000, sharedDirtyKb: 500, sharedCleanKb: 500, swapKb: 0, swapPssKb: 0 }],
  ]);
  const smaps = new Map([
    [1, [makeGroup("/system/lib64/libc.so", [makeEntry("libc.so", "a000", { pssKb: 5_000, privateDirtyKb: 3_000 })])]],
  ]);

  it("process: scope only matches process name/pid/oomLabel", () => {
    const r = searchProcesses(procs, "process:system", smaps, rollups);
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
    expect(r.get(1)!.process).toBe(true);
  });

  it("process: scope does NOT search smaps groups", () => {
    const r = searchProcesses(procs, "process:libc", smaps, rollups);
    expect(r.size).toBe(0);
  });

  it("vma: scope only matches VMA entries", () => {
    const r = searchProcesses(procs, "vma:libc", smaps, rollups);
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
    expect(r.get(1)!.process).toBe(false);
    expect(r.get(1)!.smapsGroups.size).toBeGreaterThan(0);
  });

  it("vma: scope does NOT match process names", () => {
    const r = searchProcesses(procs, "vma:system", smaps, rollups);
    expect(r.size).toBe(0);
  });

  it("mapping: scope only matches smaps group names", () => {
    const r = searchProcesses(procs, "mapping:libc", smaps, rollups);
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
    expect(r.get(1)!.process).toBe(false);
    expect(r.get(1)!.smapsGroups.has("/system/lib64/libc.so")).toBe(true);
  });

  it("pss: scope matches only PSS column", () => {
    const r = searchProcesses(procs, "pss:>100mb", smaps, rollups);
    // Only system_server has pss > 100mb (200_000kb = ~195mb)
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
  });

  it("pd: scope matches only private dirty", () => {
    const r = searchProcesses(procs, "pd:>100mb", smaps, rollups);
    // Only system_server has privateDirty > 100mb (150_000kb = ~146mb)
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
  });

  it("pd: scope with lower threshold matches more", () => {
    const r = searchProcesses(procs, "pd:>30mb", smaps, rollups);
    // system_server (150mb) and chrome (40mb) match
    expect(r.size).toBe(2);
  });

  it("rss: scope matches only RSS column", () => {
    const r = searchProcesses(procs, "rss:>200mb", smaps, rollups);
    // Only system_server has rss > 200mb
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
  });

  it("swap: scope matches swap column", () => {
    const r = searchProcesses(procs, "swap:>0kb", smaps, rollups);
    // Only system_server has swap > 0
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
  });

  it("column-scoped query without valid size returns empty", () => {
    const r = searchProcesses(procs, "pss:system", smaps, rollups);
    expect(r.size).toBe(0);
  });

  it("pss: scope also matches VMA-level pss", () => {
    const r = searchProcesses(procs, "pss:>4mb", smaps, rollups);
    // system_server matches both at process level (200mb) and VMA level (5mb)
    expect(r.has(1)).toBe(true);
  });

  it("proc: is alias for process:", () => {
    const r = searchProcesses(procs, "proc:chrome", smaps, rollups);
    expect(r.size).toBe(1);
    expect(r.has(2)).toBe(true);
  });

  it("unrecognized prefix is treated as plain text", () => {
    // "foo:bar" — "foo" not a known prefix, so search for literal "foo:bar"
    const r = searchProcesses(procs, "foo:bar", smaps, rollups);
    expect(r.size).toBe(0);
  });

  it("searchSharedMappings respects process: scope (returns empty)", () => {
    const mappings = [makeSharedMapping("libc.so", { pssKb: 5000 })];
    const r = searchSharedMappings(mappings, "process:libc");
    expect(r.size).toBe(0);
  });

  it("process: scope with double quotes groups text", () => {
    const r = searchProcesses(procs, 'process:"system_server"', smaps, rollups);
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
  });

  it("process: scope with single quotes groups text", () => {
    const r = searchProcesses(procs, "process:'system_server'", smaps, rollups);
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
  });

  it("unqualified double quotes work as plain text", () => {
    const r = searchProcesses(procs, '"system"', smaps, rollups);
    expect(r.size).toBe(1);
    expect(r.has(1)).toBe(true);
  });

  it("searchSharedMappings respects pss: scope", () => {
    const mappings = [
      makeSharedMapping("libc.so", { pssKb: 5000 }),
      makeSharedMapping("libm.so", { pssKb: 100 }),
    ];
    const r = searchSharedMappings(mappings, "pss:>3mb");
    expect(r.size).toBe(1);
    expect(r.has("libc.so")).toBe(true);
  });
});
