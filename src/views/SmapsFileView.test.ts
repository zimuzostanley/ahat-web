/**
 * Tests for smaps file loading: parsing real smaps/smaps_rollup files
 * and verifying the data structures match what SmapsFileView expects.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { parseSmaps, aggregateSmaps } from "../adb/capture";

const SMAPS_PATH = "/tmp/test-smaps.txt";
const ROLLUP_PATH = "/tmp/test-smaps-rollup.txt";
const hasSmaps = existsSync(SMAPS_PATH);
const hasRollup = existsSync(ROLLUP_PATH);

describe("smaps file parsing", () => {
  // Inline test data (doesn't require real files)
  const SAMPLE_SMAPS = `\
5f8c7a543000-5f8c7a545000 r--p 00000000 fc:00 1049084                    /usr/bin/cat
Size:                  8 kB
Rss:                   8 kB
Pss:                   8 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         8 kB
Private_Dirty:         0 kB
Swap:                  0 kB
SwapPss:               0 kB
5f8c7a545000-5f8c7a54a000 r-xp 00002000 fc:00 1049084                    /usr/bin/cat
Size:                 20 kB
Rss:                  20 kB
Pss:                  20 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:        20 kB
Private_Dirty:         0 kB
Swap:                  0 kB
SwapPss:               0 kB
7f1234000000-7f1234100000 rw-p 00000000 00:00 0                          [heap]
Size:               1024 kB
Rss:                 512 kB
Pss:                 512 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:       512 kB
Swap:                  0 kB
SwapPss:               0 kB
`;

  const SAMPLE_ROLLUP = `\
5945fe601000-7ffd92b76000 ---p 00000000 00:00 0                          [rollup]
Rss:                1920 kB
Pss:                 257 kB
Shared_Clean:       1780 kB
Shared_Dirty:          0 kB
Private_Clean:        36 kB
Private_Dirty:       104 kB
Swap:                  0 kB
SwapPss:               0 kB
`;

  it("parses inline full smaps correctly", () => {
    const entries = parseSmaps(SAMPLE_SMAPS);
    expect(entries.length).toBe(3);
    expect(entries[0].name).toBe("/usr/bin/cat");
    expect(entries[2].name).toBe("[heap]");
  });

  it("aggregates full smaps by name", () => {
    const entries = parseSmaps(SAMPLE_SMAPS);
    const agg = aggregateSmaps(entries);
    // /usr/bin/cat has 2 entries, [heap] has 1
    expect(agg.length).toBe(2);

    const cat = agg.find(g => g.name === "/usr/bin/cat")!;
    expect(cat).toBeDefined();
    expect(cat.count).toBe(2);
    expect(cat.pssKb).toBe(28); // 8 + 20
    expect(cat.rssKb).toBe(28);
    expect(cat.privateCleanKb).toBe(28);

    const heap = agg.find(g => g.name === "[heap]")!;
    expect(heap).toBeDefined();
    expect(heap.count).toBe(1);
    expect(heap.pssKb).toBe(512);
    expect(heap.privateDirtyKb).toBe(512);
  });

  it("parses inline smaps_rollup correctly", () => {
    const entries = parseSmaps(SAMPLE_ROLLUP);
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("[rollup]");
    expect(entries[0].rssKb).toBe(1920);
    expect(entries[0].pssKb).toBe(257);
  });

  it("aggregates rollup as single group", () => {
    const entries = parseSmaps(SAMPLE_ROLLUP);
    const agg = aggregateSmaps(entries);
    expect(agg.length).toBe(1);
    expect(agg[0].name).toBe("[rollup]");
    expect(agg[0].count).toBe(1);
  });

  it("returns empty for garbage input", () => {
    const entries = parseSmaps("this is not smaps data\nfoo bar\n");
    expect(entries.length).toBe(0);
  });

  it("returns empty for empty input", () => {
    const entries = parseSmaps("");
    expect(entries.length).toBe(0);
  });
});

// Tests with real captured files
const d = hasSmaps ? describe : describe.skip;

d("real smaps file from /proc/self/smaps", () => {
  it("parses all entries", () => {
    const text = readFileSync(SMAPS_PATH, "utf8");
    const entries = parseSmaps(text);
    expect(entries.length).toBeGreaterThan(5);

    for (const e of entries) {
      expect(e.addrStart).toBeTruthy();
      expect(e.addrEnd).toBeTruthy();
      expect(e.perms).toBeTruthy();
    }
  });

  it("aggregates into groups sorted by PSS", () => {
    const text = readFileSync(SMAPS_PATH, "utf8");
    const agg = aggregateSmaps(parseSmaps(text));
    expect(agg.length).toBeGreaterThan(1);

    // Should be sorted by PSS descending
    for (let i = 1; i < agg.length; i++) {
      expect(agg[i - 1].pssKb).toBeGreaterThanOrEqual(agg[i].pssKb);
    }
  });
});

const dr = hasRollup ? describe : describe.skip;

dr("real smaps_rollup from /proc/self/smaps_rollup", () => {
  it("parses as single entry", () => {
    const text = readFileSync(ROLLUP_PATH, "utf8");
    const entries = parseSmaps(text);
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe("[rollup]");
    expect(entries[0].rssKb).toBeGreaterThan(0);
    expect(entries[0].pssKb).toBeGreaterThan(0);
  });
});
