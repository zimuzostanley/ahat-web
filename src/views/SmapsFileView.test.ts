/**
 * Tests for smaps file loading: parsing real smaps/smaps_rollup files
 * and verifying the data structures match what SmapsFileView expects.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { parseSmaps, aggregateSmaps, parseBatchSmaps, parseSmapsRollups } from "../adb/capture";

const SMAPS_PATH = "/tmp/test-smaps.txt";
const ROLLUP_PATH = "/tmp/test-smaps-rollup.txt";
const BATCH_SMAPS_PATH = "/tmp/test-batch-smaps.txt";
const BATCH_ROLLUP_PATH = "/tmp/test-batch-rollup.txt";
const hasSmaps = existsSync(SMAPS_PATH);
const hasRollup = existsSync(ROLLUP_PATH);
const hasBatchSmaps = existsSync(BATCH_SMAPS_PATH);
const hasBatchRollup = existsSync(BATCH_ROLLUP_PATH);

// ── Single-process parsing ──────────────────────────────────────────────────

describe("smaps file parsing", () => {
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
    expect(agg.length).toBe(2);

    const cat = agg.find(g => g.name === "/usr/bin/cat")!;
    expect(cat).toBeDefined();
    expect(cat.count).toBe(2);
    expect(cat.pssKb).toBe(28);
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
    expect(parseSmaps("this is not smaps data\nfoo bar\n").length).toBe(0);
  });

  it("returns empty for empty input", () => {
    expect(parseSmaps("").length).toBe(0);
  });
});

// ── Batch format parsing ────────────────────────────────────────────────────

describe("batch smaps parsing", () => {
  const BATCH_FULL = `\
===PID:100===init
5f000000-5f001000 r--p 00000000 fc:00 100                    /sbin/init
Size:                  4 kB
Rss:                   4 kB
Pss:                   4 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         4 kB
Private_Dirty:         0 kB
Swap:                  0 kB
SwapPss:               0 kB
===PID:200===systemd
7f000000-7f002000 r-xp 00000000 fc:00 200                    /lib/systemd/systemd
Size:                  8 kB
Rss:                   8 kB
Pss:                   8 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         8 kB
Private_Dirty:         0 kB
Swap:                  0 kB
SwapPss:               0 kB
7f002000-7f003000 rw-p 00002000 00:00 0                      [heap]
Size:                 16 kB
Rss:                  16 kB
Pss:                  16 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:        16 kB
Swap:                  0 kB
SwapPss:               0 kB
`;

  const BATCH_ROLLUP = `\
===PID:100===init
Rss:                  500 kB
Pss:                  300 kB
Shared_Clean:         100 kB
Shared_Dirty:          50 kB
Private_Clean:        100 kB
Private_Dirty:        200 kB
Swap:                   0 kB
===PID:200===systemd
Rss:                 2000 kB
Pss:                 1500 kB
Shared_Clean:         400 kB
Shared_Dirty:         100 kB
Private_Clean:        500 kB
Private_Dirty:        800 kB
Swap:                  50 kB
`;

  it("parses batch full smaps into per-process aggregated data", () => {
    const result = parseBatchSmaps(BATCH_FULL);
    expect(result.size).toBe(2);

    const init = result.get(100)!;
    expect(init).toBeDefined();
    expect(init.name).toBe("init");
    expect(init.aggregated.length).toBe(1);
    expect(init.aggregated[0].name).toBe("/sbin/init");
    expect(init.aggregated[0].pssKb).toBe(4);

    const systemd = result.get(200)!;
    expect(systemd).toBeDefined();
    expect(systemd.name).toBe("systemd");
    expect(systemd.aggregated.length).toBe(2);
    // Sorted by PSS desc
    expect(systemd.aggregated[0].pssKb).toBeGreaterThanOrEqual(systemd.aggregated[1].pssKb);
  });

  it("parses batch rollup into per-process rollups", () => {
    const result = parseSmapsRollups(BATCH_ROLLUP);
    expect(result.size).toBe(2);

    const init = result.get(100)!;
    expect(init).toBeDefined();
    expect(init.name).toBe("init");
    expect(init.pssKb).toBe(300);
    expect(init.rssKb).toBe(500);

    const systemd = result.get(200)!;
    expect(systemd).toBeDefined();
    expect(systemd.name).toBe("systemd");
    expect(systemd.pssKb).toBe(1500);
    expect(systemd.swapKb).toBe(50);
  });

  it("format detection: batch has ===PID: prefix", () => {
    expect(/^===PID:\d+===/m.test(BATCH_FULL)).toBe(true);
    expect(/^===PID:\d+===/m.test(BATCH_ROLLUP)).toBe(true);
  });

  it("format detection: single smaps has no ===PID: prefix", () => {
    const single = "5f000000-5f001000 r--p 00000000 fc:00 100 /foo\nPss: 4 kB\n";
    expect(/^===PID:\d+===/m.test(single)).toBe(false);
  });

  it("parseBatchSmaps returns empty for rollup-only batch", () => {
    // Batch rollup has no VMA headers, so parseBatchSmaps returns empty
    const result = parseBatchSmaps(BATCH_ROLLUP);
    expect(result.size).toBe(0);
  });

  it("empty batch returns empty map", () => {
    expect(parseBatchSmaps("").size).toBe(0);
    expect(parseBatchSmaps("===PID:1===foo\n").size).toBe(0);
  });
});

// ── Real file tests ─────────────────────────────────────────────────────────

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

const db = hasBatchSmaps ? describe : describe.skip;

db("real batch full smaps file", () => {
  it("parses multiple processes", () => {
    const text = readFileSync(BATCH_SMAPS_PATH, "utf8");
    const result = parseBatchSmaps(text);
    expect(result.size).toBe(2);
    for (const [pid, d] of result) {
      expect(pid).toBeGreaterThan(0);
      expect(d.name).toBeTruthy();
      expect(d.aggregated.length).toBeGreaterThan(0);
      // Each group has entries with valid addresses
      for (const g of d.aggregated) {
        expect(g.count).toBeGreaterThan(0);
        for (const e of g.entries) {
          expect(e.addrStart).toBeTruthy();
        }
      }
    }
  });
});

const dbr = hasBatchRollup ? describe : describe.skip;

dbr("real batch rollup file", () => {
  it("parses multiple process rollups", () => {
    const text = readFileSync(BATCH_ROLLUP_PATH, "utf8");
    const result = parseSmapsRollups(text);
    expect(result.size).toBe(2);
    for (const [pid, r] of result) {
      expect(pid).toBeGreaterThan(0);
      expect(r.name).toBeTruthy();
      expect(r.rssKb).toBeGreaterThan(0);
      expect(r.pssKb).toBeGreaterThan(0);
    }
  });
});
