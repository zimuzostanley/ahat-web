import { describe, it, expect } from "vitest";
import type { SmapsAggregated, SmapsEntry, ProcessInfo } from "./capture";
import { aggregateSharedMappings } from "./capture";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeProcess(pid: number, name: string): ProcessInfo {
  return { pid, name, oomLabel: "", pssKb: 0, rssKb: 0, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0 };
}

function makeEntry(overrides: Partial<SmapsEntry> = {}): SmapsEntry {
  return {
    addrStart: "7f0000000", addrEnd: "7f0001000", perms: "r-xp",
    name: "/lib.so", dev: "fd:01", inode: 100,
    sizeKb: 4, rssKb: 4, pssKb: 2,
    sharedCleanKb: 2, sharedDirtyKb: 0,
    privateCleanKb: 0, privateDirtyKb: 2,
    swapKb: 0, swapPssKb: 0,
    ...overrides,
  };
}

function makeAgg(name: string, entries: SmapsEntry[]): SmapsAggregated {
  const sum = (fn: (e: SmapsEntry) => number) => entries.reduce((s, e) => s + fn(e), 0);
  return {
    name, count: entries.length, entries,
    sizeKb: sum(e => e.sizeKb), rssKb: sum(e => e.rssKb), pssKb: sum(e => e.pssKb),
    sharedCleanKb: sum(e => e.sharedCleanKb), sharedDirtyKb: sum(e => e.sharedDirtyKb),
    privateCleanKb: sum(e => e.privateCleanKb), privateDirtyKb: sum(e => e.privateDirtyKb),
    swapKb: sum(e => e.swapKb), swapPssKb: sum(e => e.swapPssKb),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("aggregateSharedMappings", () => {
  it("returns empty array for empty smapsData", () => {
    expect(aggregateSharedMappings(new Map(), [makeProcess(1, "a")])).toEqual([]);
  });

  it("returns empty array when no processes match smapsData pids", () => {
    const smaps = new Map([[999, [makeAgg("/lib.so", [makeEntry()])]]]);
    expect(aggregateSharedMappings(smaps, [makeProcess(1, "a")])).toEqual([]);
  });

  it("single process, single mapping", () => {
    const entry = makeEntry({ pssKb: 10, rssKb: 20, sizeKb: 30 });
    const smaps = new Map([[1, [makeAgg("/lib.so", [entry])]]]);
    const result = aggregateSharedMappings(smaps, [makeProcess(1, "proc1")]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("/lib.so");
    expect(result[0].processCount).toBe(1);
    expect(result[0].pssKb).toBe(10);
    expect(result[0].rssKb).toBe(20);
    expect(result[0].sizeKb).toBe(30);
    expect(result[0].processes).toHaveLength(1);
    expect(result[0].processes[0].pid).toBe(1);
    expect(result[0].processes[0].name).toBe("proc1");
  });

  it("single process, multiple mappings", () => {
    const e1 = makeEntry({ name: "/lib.so", dev: "fd:01", inode: 100, pssKb: 10 });
    const e2 = makeEntry({ name: "[anon:malloc]", dev: "00:00", inode: 0, pssKb: 50 });
    const smaps = new Map([[1, [
      makeAgg("/lib.so", [e1]),
      makeAgg("[anon:malloc]", [e2]),
    ]]]);
    const result = aggregateSharedMappings(smaps, [makeProcess(1, "proc1")]);

    expect(result).toHaveLength(2);
    // Sorted by PSS descending
    expect(result[0].name).toBe("[anon:malloc]");
    expect(result[0].pssKb).toBe(50);
    expect(result[1].name).toBe("/lib.so");
    expect(result[1].pssKb).toBe(10);
  });

  it("two processes sharing same file-backed mapping (same dev:inode)", () => {
    const e1 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 10, rssKb: 20, sizeKb: 40, sharedCleanKb: 5, privateDirtyKb: 3, swapKb: 1 });
    const e2 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 15, rssKb: 25, sizeKb: 40, sharedCleanKb: 8, privateDirtyKb: 7, swapKb: 2 });
    const smaps = new Map([
      [1, [makeAgg("/lib.so", [e1])]],
      [2, [makeAgg("/lib.so", [e2])]],
    ]);
    const procs = [makeProcess(1, "proc1"), makeProcess(2, "proc2")];
    const result = aggregateSharedMappings(smaps, procs);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("/lib.so");
    expect(result[0].processCount).toBe(2);
    expect(result[0].pssKb).toBe(25);      // 10 + 15
    expect(result[0].rssKb).toBe(45);      // 20 + 25
    expect(result[0].sizeKb).toBe(80);     // 40 + 40
    expect(result[0].sharedCleanKb).toBe(13); // 5 + 8
    expect(result[0].privateDirtyKb).toBe(10); // 3 + 7
    expect(result[0].swapKb).toBe(3);      // 1 + 2
    expect(result[0].processes).toHaveLength(2);
  });

  it("two processes with different mappings", () => {
    const e1 = makeEntry({ name: "/libA.so", dev: "fd:01", inode: 100, pssKb: 10 });
    const e2 = makeEntry({ name: "/libB.so", dev: "fd:01", inode: 200, pssKb: 20 });
    const smaps = new Map([
      [1, [makeAgg("/libA.so", [e1])]],
      [2, [makeAgg("/libB.so", [e2])]],
    ]);
    const procs = [makeProcess(1, "proc1"), makeProcess(2, "proc2")];
    const result = aggregateSharedMappings(smaps, procs);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("/libB.so");  // higher PSS first
    expect(result[0].processCount).toBe(1);
    expect(result[1].name).toBe("/libA.so");
    expect(result[1].processCount).toBe(1);
  });

  it("mixed: some shared, some unique", () => {
    // Shared: /lib.so (both processes, same inode)
    // Unique: [anon:malloc] (proc1 only), /libB.so (proc2 only)
    const shared1 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 10 });
    const shared2 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 15 });
    const unique1 = makeEntry({ name: "[anon:malloc]", dev: "00:00", inode: 0, pssKb: 50 });
    const unique2 = makeEntry({ name: "/libB.so", dev: "fd:01", inode: 200, pssKb: 5 });

    const smaps = new Map([
      [1, [makeAgg("/lib.so", [shared1]), makeAgg("[anon:malloc]", [unique1])]],
      [2, [makeAgg("/lib.so", [shared2]), makeAgg("/libB.so", [unique2])]],
    ]);
    const procs = [makeProcess(1, "proc1"), makeProcess(2, "proc2")];
    const result = aggregateSharedMappings(smaps, procs);

    expect(result).toHaveLength(3);
    // Sorted by PSS desc: [anon:malloc]=50, /lib.so=25, /libB.so=5
    expect(result[0].name).toBe("[anon:malloc]");
    expect(result[0].processCount).toBe(1);
    expect(result[1].name).toBe("/lib.so");
    expect(result[1].processCount).toBe(2);
    expect(result[2].name).toBe("/libB.so");
    expect(result[2].processCount).toBe(1);
  });

  it("groups by dev:inode even when names differ (file rename/link)", () => {
    // Same dev:inode but different names — should group together
    const e1 = makeEntry({ name: "/lib.so", dev: "fd:01", inode: 100, pssKb: 10 });
    const e2 = makeEntry({ name: "/lib.so.bak", dev: "fd:01", inode: 100, pssKb: 20 });
    const smaps = new Map([
      [1, [makeAgg("/lib.so", [e1])]],
      [2, [makeAgg("/lib.so.bak", [e2])]],
    ]);
    const procs = [makeProcess(1, "proc1"), makeProcess(2, "proc2")];
    const result = aggregateSharedMappings(smaps, procs);

    expect(result).toHaveLength(1);
    expect(result[0].processCount).toBe(2);
    expect(result[0].pssKb).toBe(30);
  });

  it("anonymous mappings group by name (inode == 0)", () => {
    const e1 = makeEntry({ name: "[anon:malloc]", dev: "00:00", inode: 0, pssKb: 10 });
    const e2 = makeEntry({ name: "[anon:malloc]", dev: "00:00", inode: 0, pssKb: 20 });
    const e3 = makeEntry({ name: "[stack]", dev: "00:00", inode: 0, pssKb: 5 });
    const smaps = new Map([
      [1, [makeAgg("[anon:malloc]", [e1]), makeAgg("[stack]", [e3])]],
      [2, [makeAgg("[anon:malloc]", [e2])]],
    ]);
    const procs = [makeProcess(1, "proc1"), makeProcess(2, "proc2")];
    const result = aggregateSharedMappings(smaps, procs);

    expect(result).toHaveLength(2);
    const malloc = result.find(m => m.name === "[anon:malloc]")!;
    expect(malloc.processCount).toBe(2);
    expect(malloc.pssKb).toBe(30);
    const stack = result.find(m => m.name === "[stack]")!;
    expect(stack.processCount).toBe(1);
    expect(stack.pssKb).toBe(5);
  });

  it("results sorted by total PSS descending", () => {
    const entries = [10, 50, 30, 20, 40].map((pss, i) =>
      makeEntry({ name: `lib${i}`, dev: "fd:01", inode: 100 + i, pssKb: pss })
    );
    const smaps = new Map([[1, entries.map(e => makeAgg(e.name, [e]))]]);
    const result = aggregateSharedMappings(smaps, [makeProcess(1, "proc1")]);

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].pssKb).toBeGreaterThanOrEqual(result[i].pssKb);
    }
  });

  it("processes within each mapping sorted by PSS descending", () => {
    const e1 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 5 });
    const e2 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 30 });
    const e3 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 15 });
    const smaps = new Map([
      [1, [makeAgg("/lib.so", [e1])]],
      [2, [makeAgg("/lib.so", [e2])]],
      [3, [makeAgg("/lib.so", [e3])]],
    ]);
    const procs = [makeProcess(1, "a"), makeProcess(2, "b"), makeProcess(3, "c")];
    const result = aggregateSharedMappings(smaps, procs);

    expect(result[0].processes[0].pssKb).toBe(30);
    expect(result[0].processes[1].pssKb).toBe(15);
    expect(result[0].processes[2].pssKb).toBe(5);
  });

  it("skips processes not in processes array", () => {
    const e1 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 10 });
    const e2 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 20 });
    const smaps = new Map([
      [1, [makeAgg("/lib.so", [e1])]],
      [999, [makeAgg("/lib.so", [e2])]],  // pid 999 not in processes
    ]);
    const result = aggregateSharedMappings(smaps, [makeProcess(1, "proc1")]);

    expect(result).toHaveLength(1);
    expect(result[0].processCount).toBe(1);
    expect(result[0].pssKb).toBe(10);
    expect(result[0].processes).toHaveLength(1);
  });

  it("sums all numeric fields correctly across processes", () => {
    const e1 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 10, rssKb: 20, sizeKb: 30, sharedCleanKb: 1, sharedDirtyKb: 2, privateCleanKb: 3, privateDirtyKb: 4, swapKb: 5 });
    const e2 = makeEntry({ dev: "fd:01", inode: 100, pssKb: 11, rssKb: 21, sizeKb: 31, sharedCleanKb: 6, sharedDirtyKb: 7, privateCleanKb: 8, privateDirtyKb: 9, swapKb: 10 });
    const smaps = new Map([
      [1, [makeAgg("/lib.so", [e1])]],
      [2, [makeAgg("/lib.so", [e2])]],
    ]);
    const procs = [makeProcess(1, "a"), makeProcess(2, "b")];
    const result = aggregateSharedMappings(smaps, procs);

    expect(result[0].pssKb).toBe(21);
    expect(result[0].rssKb).toBe(41);
    expect(result[0].sizeKb).toBe(61);
    expect(result[0].sharedCleanKb).toBe(7);
    expect(result[0].sharedDirtyKb).toBe(9);
    expect(result[0].privateCleanKb).toBe(11);
    expect(result[0].privateDirtyKb).toBe(13);
    expect(result[0].swapKb).toBe(15);
  });

  it("handles aggregated entries with multiple VMAs (uses first entry for dev:inode)", () => {
    // SmapsAggregated has multiple entries — e.g. same lib with r-x and rw- segments
    const rx = makeEntry({ name: "/lib.so", dev: "fd:01", inode: 100, pssKb: 10 });
    const rw = makeEntry({ name: "/lib.so", dev: "fd:01", inode: 100, pssKb: 5 });
    const agg = makeAgg("/lib.so", [rx, rw]); // pssKb = 15 total

    const smaps = new Map([[1, [agg]]]);
    const result = aggregateSharedMappings(smaps, [makeProcess(1, "proc1")]);

    expect(result).toHaveLength(1);
    expect(result[0].pssKb).toBe(15);
  });

  it("handles aggregated entries with no entries array (empty entries)", () => {
    // Edge case: SmapsAggregated with no VMA entries
    const agg: SmapsAggregated = {
      name: "[anonymous]", count: 0, entries: [],
      sizeKb: 4, rssKb: 4, pssKb: 4,
      sharedCleanKb: 0, sharedDirtyKb: 0,
      privateCleanKb: 0, privateDirtyKb: 4,
      swapKb: 0, swapPssKb: 0,
    };
    const smaps = new Map([[1, [agg]]]);
    const result = aggregateSharedMappings(smaps, [makeProcess(1, "proc1")]);

    expect(result).toHaveLength(1);
    // Falls back to name-based grouping since no entries → firstEntry is undefined
    expect(result[0].name).toBe("[anonymous]");
    expect(result[0].pssKb).toBe(4);
  });
});
