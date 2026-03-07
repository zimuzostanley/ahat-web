import { describe, it, expect } from "vitest";
import { diffProcesses, diffGlobalMemInfo, diffSmaps, diffSmapsEntries, type ProcessInfo, type GlobalMemInfo, type SmapsAggregated, type SmapsEntry } from "./capture";
import { deltaBgClass, fmtDelta } from "../format";

function makeProc(pid: number, name: string, pssKb: number, overrides?: Partial<ProcessInfo>): ProcessInfo {
  return {
    pid, name, oomLabel: "", pssKb, rssKb: 0,
    javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0,
    ...overrides,
  };
}

// ─── diffProcesses ──────────────────────────────────────────────────────────

describe("diffProcesses", () => {
  it("matches processes by PID and name", () => {
    const prev = [makeProc(100, "com.example.app", 50000)];
    const curr = [makeProc(100, "com.example.app", 60000)];
    const diffs = diffProcesses(prev, curr);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("matched");
    expect(diffs[0].deltaPssKb).toBe(10000);
    expect(diffs[0].prev).not.toBeNull();
  });

  it("marks new processes as added", () => {
    const prev = [makeProc(100, "app1", 50000)];
    const curr = [makeProc(100, "app1", 50000), makeProc(200, "app2", 30000)];
    const diffs = diffProcesses(prev, curr);
    const added = diffs.find(d => d.current.pid === 200);
    expect(added?.status).toBe("added");
    expect(added?.deltaPssKb).toBe(30000);
    expect(added?.prev).toBeNull();
  });

  it("marks disappeared processes as removed", () => {
    const prev = [makeProc(100, "app1", 50000), makeProc(200, "app2", 30000)];
    const curr = [makeProc(100, "app1", 50000)];
    const diffs = diffProcesses(prev, curr);
    const removed = diffs.find(d => d.current.pid === 200);
    expect(removed?.status).toBe("removed");
    expect(removed?.deltaPssKb).toBe(-30000);
  });

  it("treats PID reuse with different name as remove + add", () => {
    const prev = [makeProc(100, "old_app", 50000)];
    const curr = [makeProc(100, "new_app", 30000)];
    const diffs = diffProcesses(prev, curr);
    expect(diffs).toHaveLength(2);
    expect(diffs.find(d => d.status === "added")?.current.name).toBe("new_app");
    expect(diffs.find(d => d.status === "removed")?.current.name).toBe("old_app");
  });

  it("computes deltas for all memory fields", () => {
    const prev = [makeProc(1, "a", 100, { rssKb: 200, javaHeapKb: 30, nativeHeapKb: 40, graphicsKb: 50, codeKb: 60 })];
    const curr = [makeProc(1, "a", 150, { rssKb: 250, javaHeapKb: 35, nativeHeapKb: 45, graphicsKb: 55, codeKb: 65 })];
    const d = diffProcesses(prev, curr)[0];
    expect(d.deltaPssKb).toBe(50);
    expect(d.deltaRssKb).toBe(50);
    expect(d.deltaJavaHeapKb).toBe(5);
    expect(d.deltaNativeHeapKb).toBe(5);
    expect(d.deltaGraphicsKb).toBe(5);
    expect(d.deltaCodeKb).toBe(5);
  });

  it("returns zero deltas for unchanged processes", () => {
    const p = makeProc(1, "a", 100, { javaHeapKb: 50 });
    const diffs = diffProcesses([p], [{ ...p }]);
    expect(diffs[0].status).toBe("matched");
    expect(diffs[0].deltaPssKb).toBe(0);
    expect(diffs[0].deltaJavaHeapKb).toBe(0);
  });

  it("handles empty lists", () => {
    expect(diffProcesses([], [])).toHaveLength(0);
  });

  it("handles all-new processes", () => {
    const curr = [makeProc(1, "a", 100), makeProc(2, "b", 200)];
    const diffs = diffProcesses([], curr);
    expect(diffs).toHaveLength(2);
    expect(diffs.every(d => d.status === "added")).toBe(true);
  });

  it("handles all-removed processes", () => {
    const prev = [makeProc(1, "a", 100), makeProc(2, "b", 200)];
    const diffs = diffProcesses(prev, []);
    expect(diffs).toHaveLength(2);
    expect(diffs.every(d => d.status === "removed")).toBe(true);
  });

  it("handles large mixed diff", () => {
    const prev = [makeProc(1, "a", 100), makeProc(2, "b", 200), makeProc(3, "c", 300)];
    const curr = [makeProc(1, "a", 150), makeProc(3, "c", 250), makeProc(4, "d", 400)];
    const diffs = diffProcesses(prev, curr);
    expect(diffs).toHaveLength(4);
    expect(diffs.filter(d => d.status === "matched")).toHaveLength(2);
    expect(diffs.filter(d => d.status === "added")).toHaveLength(1);
    expect(diffs.filter(d => d.status === "removed")).toHaveLength(1);
    expect(diffs.find(d => d.current.pid === 2)?.status).toBe("removed");
    expect(diffs.find(d => d.current.pid === 4)?.status).toBe("added");
  });
});

// ─── diffGlobalMemInfo ──────────────────────────────────────────────────────

describe("diffGlobalMemInfo", () => {
  const base: GlobalMemInfo = {
    totalRamKb: 8000000, freeRamKb: 4000000, usedPssKb: 3000000,
    lostRamKb: 100000, zramPhysicalKb: 50000, swapTotalKb: 200000,
    swapFreeKb: 150000, memAvailableKb: 5000000, buffersKb: 100000, cachedKb: 500000,
  };

  it("computes deltas for all fields", () => {
    const current = { ...base, freeRamKb: 3500000, usedPssKb: 3500000 };
    const d = diffGlobalMemInfo(base, current);
    expect(d.deltaFreeRamKb).toBe(-500000);
    expect(d.deltaUsedPssKb).toBe(500000);
    expect(d.deltaTotalRamKb).toBe(0);
  });

  it("preserves both current and prev snapshots", () => {
    const current = { ...base, freeRamKb: 1 };
    const d = diffGlobalMemInfo(base, current);
    expect(d.prev.freeRamKb).toBe(4000000);
    expect(d.current.freeRamKb).toBe(1);
  });

  it("handles identical snapshots", () => {
    const d = diffGlobalMemInfo(base, { ...base });
    expect(d.deltaFreeRamKb).toBe(0);
    expect(d.deltaUsedPssKb).toBe(0);
    expect(d.deltaLostRamKb).toBe(0);
  });
});

// ─── deltaBgClass ────────────────────────────────────────────────────────────

describe("deltaBgClass", () => {
  it("returns empty for zero", () => {
    expect(deltaBgClass(0)).toBe("");
  });

  it("returns empty for small changes below 1 MB", () => {
    expect(deltaBgClass(500)).toBe("");
    expect(deltaBgClass(-999)).toBe("");
  });

  it("returns pos-light at 1 MB threshold (increase = bad)", () => {
    expect(deltaBgClass(1000)).toBe("ah-delta-bg-pos-light");
    expect(deltaBgClass(9999)).toBe("ah-delta-bg-pos-light");
  });

  it("returns pos-medium at 10 MB threshold", () => {
    expect(deltaBgClass(10_000)).toBe("ah-delta-bg-pos-medium");
    expect(deltaBgClass(49_999)).toBe("ah-delta-bg-pos-medium");
  });

  it("returns pos-heavy at 50 MB threshold", () => {
    expect(deltaBgClass(50_000)).toBe("ah-delta-bg-pos-heavy");
    expect(deltaBgClass(500_000)).toBe("ah-delta-bg-pos-heavy");
  });

  it("returns neg classes for negative deltas (decrease = good)", () => {
    expect(deltaBgClass(-1000)).toBe("ah-delta-bg-neg-light");
    expect(deltaBgClass(-10_000)).toBe("ah-delta-bg-neg-medium");
    expect(deltaBgClass(-50_000)).toBe("ah-delta-bg-neg-heavy");
  });
});

// ─── fmtDelta ────────────────────────────────────────────────────────────────

describe("fmtDelta", () => {
  it("returns empty for zero", () => {
    expect(fmtDelta(0)).toBe("");
  });

  it("formats positive deltas with + sign", () => {
    expect(fmtDelta(1024)).toBe("+1.0 MiB");
    expect(fmtDelta(5120)).toBe("+5.0 MiB");
  });

  it("formats negative deltas with minus sign", () => {
    expect(fmtDelta(-1024)).toBe("\u22121.0 MiB");
    expect(fmtDelta(-5120)).toBe("\u22125.0 MiB");
  });

  it("formats KB-range deltas", () => {
    expect(fmtDelta(1)).toBe("+1.0 KiB");
    expect(fmtDelta(-500)).toBe("\u2212500.0 KiB");
  });

  it("formats GB-range deltas", () => {
    expect(fmtDelta(1_048_576)).toBe("+1.0 GiB");
    expect(fmtDelta(-2_097_152)).toBe("\u22122.0 GiB");
  });
});

// ─── diffSmaps ───────────────────────────────────────────────────────────────

function makeSmaps(name: string, pssKb: number, overrides?: Partial<SmapsAggregated>): SmapsAggregated {
  return {
    name, count: 1, sizeKb: 0, rssKb: 0, pssKb,
    sharedCleanKb: 0, sharedDirtyKb: 0,
    privateCleanKb: 0, privateDirtyKb: 0,
    swapKb: 0, swapPssKb: 0, entries: [],
    ...overrides,
  };
}

describe("diffSmaps", () => {
  it("matches aggregations by name", () => {
    const prev = [makeSmaps("[anon:libc_malloc]", 5000)];
    const curr = [makeSmaps("[anon:libc_malloc]", 7000)];
    const diffs = diffSmaps(prev, curr);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("matched");
    expect(diffs[0].deltaPssKb).toBe(2000);
  });

  it("marks new mappings as added", () => {
    const diffs = diffSmaps([], [makeSmaps("/lib/foo.so", 3000)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("added");
    expect(diffs[0].deltaPssKb).toBe(3000);
    expect(diffs[0].prev).toBeNull();
  });

  it("marks disappeared mappings as removed", () => {
    const diffs = diffSmaps([makeSmaps("/lib/bar.so", 2000)], []);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("removed");
    expect(diffs[0].deltaPssKb).toBe(-2000);
  });

  it("computes deltas for all fields", () => {
    const prev = [makeSmaps("a", 100, { rssKb: 200, sizeKb: 300, sharedCleanKb: 10, sharedDirtyKb: 20, privateCleanKb: 30, privateDirtyKb: 40, swapKb: 5 })];
    const curr = [makeSmaps("a", 150, { rssKb: 250, sizeKb: 350, sharedCleanKb: 15, sharedDirtyKb: 25, privateCleanKb: 35, privateDirtyKb: 45, swapKb: 10 })];
    const d = diffSmaps(prev, curr)[0];
    expect(d.deltaPssKb).toBe(50);
    expect(d.deltaRssKb).toBe(50);
    expect(d.deltaSizeKb).toBe(50);
    expect(d.deltaSharedCleanKb).toBe(5);
    expect(d.deltaSharedDirtyKb).toBe(5);
    expect(d.deltaPrivateCleanKb).toBe(5);
    expect(d.deltaPrivateDirtyKb).toBe(5);
    expect(d.deltaSwapKb).toBe(5);
  });

  it("handles mixed add/remove/match", () => {
    const prev = [makeSmaps("a", 100), makeSmaps("b", 200)];
    const curr = [makeSmaps("a", 150), makeSmaps("c", 300)];
    const diffs = diffSmaps(prev, curr);
    expect(diffs).toHaveLength(3);
    expect(diffs.find(d => d.current.name === "a")?.status).toBe("matched");
    expect(diffs.find(d => d.current.name === "c")?.status).toBe("added");
    expect(diffs.find(d => d.current.name === "b")?.status).toBe("removed");
  });

  it("handles empty lists", () => {
    expect(diffSmaps([], [])).toHaveLength(0);
  });

  it("returns zero deltas for unchanged mappings", () => {
    const s = makeSmaps("x", 500, { rssKb: 1000 });
    const diffs = diffSmaps([s], [{ ...s, entries: [] }]);
    expect(diffs[0].deltaPssKb).toBe(0);
    expect(diffs[0].deltaRssKb).toBe(0);
  });
});

// ─── diffSmapsEntries ────────────────────────────────────────────────────────

function makeEntry(addrStart: string, pssKb: number, overrides?: Partial<SmapsEntry>): SmapsEntry {
  return {
    addrStart, addrEnd: addrStart.replace(/0$/, "f"), perms: "r--p", name: "/lib/test.so",
    dev: "fd:01", inode: 12345,
    sizeKb: 0, rssKb: 0, pssKb,
    sharedCleanKb: 0, sharedDirtyKb: 0,
    privateCleanKb: 0, privateDirtyKb: 0,
    swapKb: 0, swapPssKb: 0,
    ...overrides,
  };
}

describe("diffSmapsEntries", () => {
  it("matches VMAs by address start", () => {
    const prev = [makeEntry("7f000000", 100)];
    const curr = [makeEntry("7f000000", 150)];
    const diffs = diffSmapsEntries(prev, curr);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("matched");
    expect(diffs[0].deltaPssKb).toBe(50);
  });

  it("marks new VMAs as added", () => {
    const diffs = diffSmapsEntries([], [makeEntry("7f100000", 200)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("added");
    expect(diffs[0].deltaPssKb).toBe(200);
    expect(diffs[0].prev).toBeNull();
  });

  it("marks disappeared VMAs as removed", () => {
    const diffs = diffSmapsEntries([makeEntry("7f200000", 300)], []);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("removed");
    expect(diffs[0].deltaPssKb).toBe(-300);
  });

  it("computes deltas for all fields", () => {
    const prev = [makeEntry("a0", 100, { rssKb: 200, sizeKb: 300, sharedCleanKb: 10, sharedDirtyKb: 20, privateCleanKb: 30, privateDirtyKb: 40, swapKb: 5 })];
    const curr = [makeEntry("a0", 150, { rssKb: 250, sizeKb: 350, sharedCleanKb: 15, sharedDirtyKb: 25, privateCleanKb: 35, privateDirtyKb: 45, swapKb: 10 })];
    const d = diffSmapsEntries(prev, curr)[0];
    expect(d.deltaPssKb).toBe(50);
    expect(d.deltaRssKb).toBe(50);
    expect(d.deltaSizeKb).toBe(50);
    expect(d.deltaSharedCleanKb).toBe(5);
    expect(d.deltaSharedDirtyKb).toBe(5);
    expect(d.deltaPrivateCleanKb).toBe(5);
    expect(d.deltaPrivateDirtyKb).toBe(5);
    expect(d.deltaSwapKb).toBe(5);
  });

  it("handles mixed add/remove/match", () => {
    const prev = [makeEntry("a0", 100), makeEntry("b0", 200)];
    const curr = [makeEntry("a0", 150), makeEntry("c0", 300)];
    const diffs = diffSmapsEntries(prev, curr);
    expect(diffs).toHaveLength(3);
    expect(diffs.find(d => d.current.addrStart === "a0")?.status).toBe("matched");
    expect(diffs.find(d => d.current.addrStart === "c0")?.status).toBe("added");
    expect(diffs.find(d => d.current.addrStart === "b0")?.status).toBe("removed");
  });

  it("handles empty lists", () => {
    expect(diffSmapsEntries([], [])).toHaveLength(0);
  });

  it("returns zero deltas for unchanged VMAs", () => {
    const e = makeEntry("ff", 500, { rssKb: 1000 });
    const diffs = diffSmapsEntries([e], [{ ...e }]);
    expect(diffs[0].deltaPssKb).toBe(0);
    expect(diffs[0].deltaRssKb).toBe(0);
  });
});
