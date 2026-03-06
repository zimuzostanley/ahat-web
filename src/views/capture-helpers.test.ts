import { describe, it, expect } from "vitest";
import { sortWithDiffPinning, computeSmapsTotals, SMAPS_COLUMNS, SMAPS_DELTA_KEY, type SmapsNumericField } from "./capture-helpers";

// ─── sortWithDiffPinning ─────────────────────────────────────────────────────

describe("sortWithDiffPinning", () => {
  const numCmp = (a: number, b: number) => a - b;

  it("sorts items normally when no diffs", () => {
    expect(sortWithDiffPinning([3, 1, 2], null, numCmp)).toEqual([1, 2, 3]);
    expect(sortWithDiffPinning([3, 1, 2], undefined, numCmp)).toEqual([1, 2, 3]);
  });

  it("does not mutate original array", () => {
    const items = [3, 1, 2];
    sortWithDiffPinning(items, null, numCmp);
    expect(items).toEqual([3, 1, 2]);
  });

  it("does not mutate original diffs array", () => {
    const diffs = [
      { status: "matched", current: 3 },
      { status: "added", current: 1 },
    ];
    const copy = [...diffs];
    sortWithDiffPinning([], diffs, numCmp);
    expect(diffs).toEqual(copy);
  });

  it("pins non-matched items at top", () => {
    const diffs = [
      { status: "matched", current: 1 },
      { status: "added", current: 5 },
      { status: "matched", current: 3 },
      { status: "removed", current: 2 },
    ];
    const result = sortWithDiffPinning([], diffs, numCmp);
    // Non-matched (added=5, removed=2) pinned first, then matched (1, 3)
    expect(result).toEqual([2, 5, 1, 3]);
  });

  it("sorts matched items by comparator within their group", () => {
    const diffs = [
      { status: "matched", current: 10 },
      { status: "matched", current: 5 },
      { status: "matched", current: 8 },
    ];
    expect(sortWithDiffPinning([], diffs, numCmp)).toEqual([5, 8, 10]);
  });

  it("sorts non-matched items by comparator within their group", () => {
    const diffs = [
      { status: "added", current: 10 },
      { status: "removed", current: 3 },
      { status: "added", current: 7 },
    ];
    expect(sortWithDiffPinning([], diffs, numCmp)).toEqual([3, 7, 10]);
  });

  it("returns empty array for empty inputs", () => {
    expect(sortWithDiffPinning([], null, numCmp)).toEqual([]);
    expect(sortWithDiffPinning([], [], numCmp)).toEqual([]);
  });

  it("works with object items and custom comparator", () => {
    type Item = { name: string; value: number };
    const items: Item[] = [
      { name: "c", value: 30 },
      { name: "a", value: 10 },
      { name: "b", value: 20 },
    ];
    const cmp = (a: Item, b: Item) => a.value - b.value;
    const result = sortWithDiffPinning(items, null, cmp);
    expect(result.map(i => i.name)).toEqual(["a", "b", "c"]);
  });

  it("prefers diffs over items when diffs provided", () => {
    const items = [99, 98, 97]; // should be ignored
    const diffs = [
      { status: "matched", current: 1 },
      { status: "matched", current: 2 },
    ];
    expect(sortWithDiffPinning(items, diffs, numCmp)).toEqual([1, 2]);
  });
});

// ─── SMAPS_DELTA_KEY ─────────────────────────────────────────────────────────

describe("SMAPS_DELTA_KEY", () => {
  it("maps every SmapsNumericField to a delta key", () => {
    const fields: SmapsNumericField[] = ["pssKb", "rssKb", "sharedCleanKb", "sharedDirtyKb", "privateCleanKb", "privateDirtyKb", "swapKb"];
    for (const f of fields) {
      const dk = SMAPS_DELTA_KEY[f];
      expect(dk).toMatch(/^delta[A-Z]/);
      expect(dk).toContain(f.charAt(0).toUpperCase() + f.slice(1));
    }
  });

  it("has same number of entries as SMAPS_COLUMNS", () => {
    expect(Object.keys(SMAPS_DELTA_KEY).length).toBe(SMAPS_COLUMNS.length);
  });
});

// ─── computeSmapsTotals ─────────────────────────────────────────────────────

function makeItem(pss: number, rss = 0): Record<SmapsNumericField, number> {
  return { pssKb: pss, rssKb: rss, sharedCleanKb: 0, sharedDirtyKb: 0, privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0 };
}

function makeDiff(status: string, pss: number, deltaPss: number) {
  return {
    status,
    current: makeItem(pss),
    deltaPssKb: deltaPss, deltaRssKb: 0, deltaSharedCleanKb: 0, deltaSharedDirtyKb: 0,
    deltaPrivateCleanKb: 0, deltaPrivateDirtyKb: 0, deltaSwapKb: 0,
  };
}

describe("computeSmapsTotals", () => {
  it("sums items when no diffs", () => {
    const items = [makeItem(100, 200), makeItem(50, 100)];
    const totals = computeSmapsTotals(items, null);
    expect(totals.pssKb).toBe(150);
    expect(totals.rssKb).toBe(300);
    expect(totals.deltaPssKb).toBe(0);
  });

  it("returns zeros for empty items", () => {
    const totals = computeSmapsTotals([], null);
    expect(totals.pssKb).toBe(0);
    expect(totals.rssKb).toBe(0);
  });

  it("sums diffs, excluding removed from current values", () => {
    const diffs = [
      makeDiff("matched", 100, 10),
      makeDiff("added", 50, 50),
      makeDiff("removed", 30, -30),
    ];
    const totals = computeSmapsTotals([], diffs);
    // Current values: matched(100) + added(50) = 150, removed excluded
    expect(totals.pssKb).toBe(150);
    // Delta values: 10 + 50 + (-30) = 30 (all included)
    expect(totals.deltaPssKb).toBe(30);
  });

  it("includes all delta values even for removed items", () => {
    const diffs = [makeDiff("removed", 200, -200)];
    const totals = computeSmapsTotals([], diffs);
    expect(totals.pssKb).toBe(0); // removed excluded from current
    expect(totals.deltaPssKb).toBe(-200); // delta still counts
  });

  it("handles empty diffs array", () => {
    const totals = computeSmapsTotals([], []);
    expect(totals.pssKb).toBe(0);
    expect(totals.deltaPssKb).toBe(0);
  });

  it("ignores items when diffs are provided", () => {
    const items = [makeItem(999)]; // should be ignored
    const diffs = [makeDiff("matched", 10, 5)];
    const totals = computeSmapsTotals(items, diffs);
    expect(totals.pssKb).toBe(10);
  });

  it("accumulates all 7 numeric fields", () => {
    const item: Record<SmapsNumericField, number> = {
      pssKb: 1, rssKb: 2, sharedCleanKb: 3, sharedDirtyKb: 4,
      privateCleanKb: 5, privateDirtyKb: 6, swapKb: 7,
    };
    const totals = computeSmapsTotals([item, item], null);
    expect(totals.pssKb).toBe(2);
    expect(totals.rssKb).toBe(4);
    expect(totals.sharedCleanKb).toBe(6);
    expect(totals.sharedDirtyKb).toBe(8);
    expect(totals.privateCleanKb).toBe(10);
    expect(totals.privateDirtyKb).toBe(12);
    expect(totals.swapKb).toBe(14);
  });

  it("accumulates all 7 delta fields from diffs", () => {
    const diff = {
      status: "matched",
      current: makeItem(0),
      deltaPssKb: 1, deltaRssKb: 2, deltaSharedCleanKb: 3, deltaSharedDirtyKb: 4,
      deltaPrivateCleanKb: 5, deltaPrivateDirtyKb: 6, deltaSwapKb: 7,
    };
    const totals = computeSmapsTotals([], [diff, diff]);
    expect(totals.deltaPssKb).toBe(2);
    expect(totals.deltaRssKb).toBe(4);
    expect(totals.deltaSharedCleanKb).toBe(6);
    expect(totals.deltaSharedDirtyKb).toBe(8);
    expect(totals.deltaPrivateCleanKb).toBe(10);
    expect(totals.deltaPrivateDirtyKb).toBe(12);
    expect(totals.deltaSwapKb).toBe(14);
  });
});
