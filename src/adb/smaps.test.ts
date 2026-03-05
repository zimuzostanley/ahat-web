import { describe, it, expect } from "vitest";
import { parseSmaps, aggregateSmaps, parseSmapsRollups } from "./capture";

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

// ─── parseSmapsRollups ────────────────────────────────────────────────────────

const ROLLUP_SINGLE = `===PID:1234===
Rss:               12000 kB
Pss:                8000 kB
Shared_Clean:       4000 kB
Shared_Dirty:        500 kB
Private_Clean:      2000 kB
Private_Dirty:      1500 kB
Swap:                100 kB
SwapPss:              50 kB
`;

const ROLLUP_MULTI = `===PID:100===
Rss:               50000 kB
Pss:               30000 kB
Shared_Clean:      20000 kB
Shared_Dirty:       1000 kB
Private_Clean:      5000 kB
Private_Dirty:      4000 kB
Swap:                200 kB
SwapPss:             100 kB
===PID:200===
Rss:                8000 kB
Pss:                6000 kB
Shared_Clean:       2000 kB
Shared_Dirty:          0 kB
Private_Clean:      3000 kB
Private_Dirty:      1000 kB
Swap:                  0 kB
SwapPss:               0 kB
===PID:300===
Rss:                1024 kB
Pss:                 512 kB
Shared_Clean:        256 kB
Shared_Dirty:        128 kB
Private_Clean:        64 kB
Private_Dirty:        64 kB
Swap:                 32 kB
SwapPss:              16 kB
`;

describe("parseSmapsRollups", () => {
  it("parses a single PID rollup", () => {
    const result = parseSmapsRollups(ROLLUP_SINGLE);
    expect(result.size).toBe(1);
    const r = result.get(1234)!;
    expect(r).toBeDefined();
    expect(r.rssKb).toBe(12000);
    expect(r.pssKb).toBe(8000);
    expect(r.sharedCleanKb).toBe(4000);
    expect(r.sharedDirtyKb).toBe(500);
    expect(r.privateCleanKb).toBe(2000);
    expect(r.privateDirtyKb).toBe(1500);
    expect(r.swapKb).toBe(100);
    expect(r.swapPssKb).toBe(50);
  });

  it("parses multiple PID rollups", () => {
    const result = parseSmapsRollups(ROLLUP_MULTI);
    expect(result.size).toBe(3);
    expect(result.get(100)!.pssKb).toBe(30000);
    expect(result.get(200)!.pssKb).toBe(6000);
    expect(result.get(300)!.pssKb).toBe(512);
  });

  it("skips PIDs with no data (e.g. process exited)", () => {
    const output = `===PID:100===
Rss:  1000 kB
Pss:   500 kB
Shared_Clean: 200 kB
Shared_Dirty: 0 kB
Private_Clean: 100 kB
Private_Dirty: 200 kB
Swap: 0 kB
SwapPss: 0 kB
===PID:999===
===PID:200===
Rss:  2000 kB
Pss:  1000 kB
Shared_Clean: 500 kB
Shared_Dirty: 100 kB
Private_Clean: 200 kB
Private_Dirty: 200 kB
Swap: 0 kB
SwapPss: 0 kB
`;
    const result = parseSmapsRollups(output);
    expect(result.size).toBe(2);
    expect(result.has(100)).toBe(true);
    expect(result.has(200)).toBe(true);
    expect(result.has(999)).toBe(false);
  });

  it("returns empty map for empty input", () => {
    expect(parseSmapsRollups("").size).toBe(0);
  });

  it("returns empty map for garbage input", () => {
    expect(parseSmapsRollups("hello\nworld\n").size).toBe(0);
  });

  it("handles output without trailing newline", () => {
    const output = `===PID:42===
Rss:  100 kB
Pss:   80 kB
Shared_Clean: 20 kB
Shared_Dirty: 0 kB
Private_Clean: 30 kB
Private_Dirty: 30 kB
Swap: 0 kB
SwapPss: 0 kB`;
    const result = parseSmapsRollups(output);
    expect(result.size).toBe(1);
    expect(result.get(42)!.pssKb).toBe(80);
  });

  it("ignores lines before first PID marker", () => {
    const output = `Rss: 9999 kB
Pss: 9999 kB
===PID:1===
Rss:  100 kB
Pss:   50 kB
Shared_Clean: 0 kB
Shared_Dirty: 0 kB
Private_Clean: 0 kB
Private_Dirty: 50 kB
Swap: 0 kB
SwapPss: 0 kB
`;
    const result = parseSmapsRollups(output);
    expect(result.size).toBe(1);
    expect(result.get(1)!.pssKb).toBe(50);
  });

  it("ignores extra fields like Size and KernelPageSize", () => {
    const output = `===PID:10===
Size:              100000 kB
KernelPageSize:         4 kB
Rss:                 5000 kB
Pss:                 3000 kB
Shared_Clean:        1000 kB
Shared_Dirty:         500 kB
Private_Clean:        800 kB
Private_Dirty:        700 kB
Referenced:          5000 kB
Anonymous:           1200 kB
Swap:                  50 kB
SwapPss:               25 kB
Locked:                 0 kB
`;
    const result = parseSmapsRollups(output);
    expect(result.size).toBe(1);
    const r = result.get(10)!;
    expect(r.rssKb).toBe(5000);
    expect(r.pssKb).toBe(3000);
    expect(r.swapPssKb).toBe(25);
  });

  it("handles header line from smaps_rollup (address range)", () => {
    const output = `===PID:555===
00400000-7fff0000 ---p 00000000 00:00 0                          [rollup]
Rss:                 2048 kB
Pss:                 1024 kB
Shared_Clean:         512 kB
Shared_Dirty:         256 kB
Private_Clean:        128 kB
Private_Dirty:        128 kB
Swap:                   0 kB
SwapPss:                0 kB
`;
    const result = parseSmapsRollups(output);
    expect(result.size).toBe(1);
    expect(result.get(555)!.pssKb).toBe(1024);
  });

  it("extracts process name from marker line", () => {
    const output = `===PID:1234===com.android.systemui
Rss:  5000 kB
Pss:  3000 kB
Shared_Clean: 1000 kB
Shared_Dirty: 200 kB
Private_Clean: 800 kB
Private_Dirty: 1000 kB
Swap: 0 kB
SwapPss: 0 kB
===PID:5===init
Rss:  100 kB
Pss:  100 kB
Shared_Clean: 0 kB
Shared_Dirty: 0 kB
Private_Clean: 0 kB
Private_Dirty: 100 kB
Swap: 0 kB
SwapPss: 0 kB
`;
    const result = parseSmapsRollups(output);
    expect(result.size).toBe(2);
    expect(result.get(1234)!.name).toBe("com.android.systemui");
    expect(result.get(1234)!.pssKb).toBe(3000);
    expect(result.get(5)!.name).toBe("init");
    expect(result.get(5)!.pssKb).toBe(100);
  });

  it("name is undefined when marker has no name", () => {
    const result = parseSmapsRollups(ROLLUP_SINGLE);
    expect(result.get(1234)!.name).toBeUndefined();
  });
});

