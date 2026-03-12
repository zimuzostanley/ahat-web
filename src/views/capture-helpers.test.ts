import { describe, it, expect } from "vitest";
import { sortWithDiffPinning, computeSmapsTotals, SMAPS_COLUMNS, SMAPS_DELTA_KEY, timelineClick, deleteSnapshotState, type SmapsNumericField, type TimelineState } from "./capture-helpers";

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
    const fields: SmapsNumericField[] = ["pssKb", "rssKb", "sharedCleanKb", "sharedDirtyKb", "privateCleanKb", "privateDirtyKb", "swapKb", "sizeKb"];
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
  return { pssKb: pss, rssKb: rss, sharedCleanKb: 0, sharedDirtyKb: 0, privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0, sizeKb: 0 };
}

function makeDiff(status: string, pss: number, deltaPss: number) {
  return {
    status,
    current: makeItem(pss),
    deltaPssKb: deltaPss, deltaRssKb: 0, deltaSharedCleanKb: 0, deltaSharedDirtyKb: 0,
    deltaPrivateCleanKb: 0, deltaPrivateDirtyKb: 0, deltaSwapKb: 0, deltaSizeKb: 0,
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

  it("accumulates all 8 numeric fields", () => {
    const item: Record<SmapsNumericField, number> = {
      pssKb: 1, rssKb: 2, sharedCleanKb: 3, sharedDirtyKb: 4,
      privateCleanKb: 5, privateDirtyKb: 6, swapKb: 7, sizeKb: 8,
    };
    const totals = computeSmapsTotals([item, item], null);
    expect(totals.pssKb).toBe(2);
    expect(totals.rssKb).toBe(4);
    expect(totals.sharedCleanKb).toBe(6);
    expect(totals.sharedDirtyKb).toBe(8);
    expect(totals.privateCleanKb).toBe(10);
    expect(totals.privateDirtyKb).toBe(12);
    expect(totals.swapKb).toBe(14);
    expect(totals.sizeKb).toBe(16);
  });

  it("accumulates all 8 delta fields from diffs", () => {
    const diff = {
      status: "matched",
      current: makeItem(0),
      deltaPssKb: 1, deltaRssKb: 2, deltaSharedCleanKb: 3, deltaSharedDirtyKb: 4,
      deltaPrivateCleanKb: 5, deltaPrivateDirtyKb: 6, deltaSwapKb: 7, deltaSizeKb: 8,
    };
    const totals = computeSmapsTotals([], [diff, diff]);
    expect(totals.deltaPssKb).toBe(2);
    expect(totals.deltaRssKb).toBe(4);
    expect(totals.deltaSharedCleanKb).toBe(6);
    expect(totals.deltaSharedDirtyKb).toBe(8);
    expect(totals.deltaPrivateCleanKb).toBe(10);
    expect(totals.deltaPrivateDirtyKb).toBe(12);
    expect(totals.deltaSwapKb).toBe(14);
    expect(totals.deltaSizeKb).toBe(16);
  });
});

// ─── timelineClick ──────────────────────────────────────────────────────────

describe("timelineClick", () => {
  function s(view: number | null, base: number | null, diff: boolean, count = 3): TimelineState {
    return { viewSnapIdx: view, diffBaseIdx: base, diffMode: diff, count };
  }

  // ── Click grey → becomes blue ─────────────────────────────────────────

  it("click grey from Live → becomes blue, Live stays green", () => {
    const result = timelineClick(s(null, 0, false), 1);
    expect(result.viewSnapIdx).toBeNull(); // Live still green
    expect(result.diffBaseIdx).toBe(1);    // clicked → blue
    expect(result.diffMode).toBe(true);
  });

  it("click grey from snapshot green → becomes blue, green stays", () => {
    const result = timelineClick(s(0, 0, false), 2);
    expect(result.viewSnapIdx).toBe(0);    // green unchanged
    expect(result.diffBaseIdx).toBe(2);    // clicked → blue
    expect(result.diffMode).toBe(true);
  });

  it("click grey replaces existing blue", () => {
    // snap 0 blue, Live green. Click snap 2 (grey) → snap 2 blue, snap 0 grey
    const result = timelineClick(s(null, 0, true), 2);
    expect(result.diffBaseIdx).toBe(2);    // new blue
    expect(result.viewSnapIdx).toBeNull(); // Live still green
    expect(result.diffMode).toBe(true);
  });

  it("blue can appear before or after green", () => {
    // snap 1 green, click snap 2 (grey, after green) → blue after green
    let result = timelineClick(s(1, 0, false), 2);
    expect(result).toMatchObject({ viewSnapIdx: 1, diffBaseIdx: 2, diffMode: true });

    // snap 1 green, click snap 0 (grey, before green) → blue before green
    result = timelineClick(s(1, 0, false), 0);
    expect(result).toMatchObject({ viewSnapIdx: 1, diffBaseIdx: 0, diffMode: true });
  });

  // ── Click blue → becomes green ────────────────────────────────────────

  it("click blue → becomes green, diff cleared", () => {
    const result = timelineClick(s(null, 1, true), 1);
    expect(result.viewSnapIdx).toBe(1);
    expect(result.diffMode).toBe(false);
  });

  it("click blue with snapshot green → blue becomes green, diff cleared", () => {
    const result = timelineClick(s(2, 0, true), 0);
    expect(result.viewSnapIdx).toBe(0);
    expect(result.diffMode).toBe(false);
  });

  // ── Click green → deselect ────────────────────────────────────────────

  it("click green → back to Live, diff cleared", () => {
    const result = timelineClick(s(1, 0, true), 1);
    expect(result.viewSnapIdx).toBeNull();
    expect(result.diffMode).toBe(false);
  });

  it("click green (no diff) → back to Live", () => {
    const result = timelineClick(s(2, 0, false), 2);
    expect(result.viewSnapIdx).toBeNull();
    expect(result.diffMode).toBe(false);
  });

  // ── Live follows the same rules ─────────────────────────────────────

  it("click Live (green) → no-op", () => {
    const state = s(null, 0, false);
    const result = timelineClick(state, null);
    expect(result).toBe(state);
  });

  it("click Live (grey, snapshot is green) → Live becomes blue", () => {
    // snap 2 green, Live grey. Click Live → Live blue, snap 2 stays green.
    const result = timelineClick(s(2, 0, false), null);
    expect(result.viewSnapIdx).toBe(2);    // green unchanged
    expect(result.diffBaseIdx).toBeNull(); // Live is blue
    expect(result.diffMode).toBe(true);
  });

  it("click Live (blue) → Live becomes green", () => {
    // snap 1 green, Live blue. Click Live → Live green, diff cleared.
    const result = timelineClick(s(1, null, true), null);
    expect(result.viewSnapIdx).toBeNull(); // Live green
    expect(result.diffMode).toBe(false);
  });

  // ── Invariants ────────────────────────────────────────────────────────

  it("never two greens — only viewSnapIdx or Live", () => {
    let state = s(null, 0, false);
    state = timelineClick(state, 0);
    expect(state.viewSnapIdx).toBeNull(); // Live is still green
    expect(state.diffBaseIdx).toBe(0);    // snap 0 is blue
    expect(state.diffMode).toBe(true);
  });

  it("never two blues — clicking grey replaces blue", () => {
    let state = s(null, 0, true); // snap 0 blue
    state = timelineClick(state, 1); // click snap 1 (grey)
    expect(state.diffBaseIdx).toBe(1); // new blue, old blue gone
  });

  // ── User scenarios ────────────────────────────────────────────────────

  it("user scenario: A B(Live). Click A (blue), click B (stays green)", () => {
    let state = s(null, 0, false, 1);

    // Click A (grey) → A blue, Live green
    state = timelineClick(state, 0);
    expect(state).toMatchObject({ viewSnapIdx: null, diffBaseIdx: 0, diffMode: true });

    // Click A (blue) → A green, diff cleared
    state = timelineClick(state, 0);
    expect(state).toMatchObject({ viewSnapIdx: 0, diffMode: false });
  });

  it("user scenario: A(green) B(Live). Click B → B blue, diff A vs B", () => {
    // A is green (viewSnapIdx=0), Live is grey
    let state = s(0, 0, false, 1);

    // Click Live (grey) → Live blue, A stays green
    state = timelineClick(state, null);
    expect(state.viewSnapIdx).toBe(0);     // A still green
    expect(state.diffBaseIdx).toBeNull();  // Live is blue
    expect(state.diffMode).toBe(true);
  });

  // ── Full workflows ────────────────────────────────────────────────────

  it("diff in either direction", () => {
    // Live green. Click snap 0 → snap 0 blue. Diff: snap0(base) → Live(view)
    let state = timelineClick(s(null, 0, false, 2), 0);
    expect(state).toMatchObject({ viewSnapIdx: null, diffBaseIdx: 0, diffMode: true });

    // Click snap 0 (blue) → snap 0 green. Click snap 1 → snap 1 blue.
    // Diff: snap1(base) → snap0(view). Blue follows green.
    state = timelineClick(state, 0); // snap 0 green
    state = timelineClick(state, 1); // snap 1 blue
    expect(state).toMatchObject({ viewSnapIdx: 0, diffBaseIdx: 1, diffMode: true });
  });

  it("Live can be blue (diff base)", () => {
    // snap 0 green. Click Live (grey) → Live blue.
    let state = timelineClick(s(0, 0, false, 2), null);
    expect(state).toMatchObject({ viewSnapIdx: 0, diffBaseIdx: null, diffMode: true });

    // Click Live (blue) → Live green, diff cleared
    state = timelineClick(state, null);
    expect(state).toMatchObject({ viewSnapIdx: null, diffMode: false });
  });

  it("swap blue and green via click blue", () => {
    // snap 0 green, snap 1 blue
    let state = s(0, 1, true);

    // Click blue (snap 1) → snap 1 green, diff cleared
    state = timelineClick(state, 1);
    expect(state).toMatchObject({ viewSnapIdx: 1, diffMode: false });

    // Click snap 0 (grey) → snap 0 blue, snap 1 green
    state = timelineClick(state, 0);
    expect(state).toMatchObject({ viewSnapIdx: 1, diffBaseIdx: 0, diffMode: true });
  });
});

// ─── deleteSnapshotState ────────────────────────────────────────────────────

describe("deleteSnapshotState", () => {
  function s(view: number | null, base: number | null, diff: boolean, count: number): TimelineState {
    return { viewSnapIdx: view, diffBaseIdx: base, diffMode: diff, count };
  }

  it("deleting last snapshot resets everything", () => {
    const result = deleteSnapshotState(s(0, 0, true, 1), 0);
    expect(result).toEqual({ viewSnapIdx: null, diffBaseIdx: null, diffMode: false, count: 0 });
  });

  it("deleting viewed snapshot → back to live", () => {
    const result = deleteSnapshotState(s(1, 0, true, 3), 1);
    expect(result.viewSnapIdx).toBeNull();
    expect(result.diffBaseIdx).toBe(0);
    expect(result.diffMode).toBe(true);
  });

  it("deleting diff base → diff cleared", () => {
    const result = deleteSnapshotState(s(null, 1, true, 3), 1);
    expect(result.diffMode).toBe(false);
  });

  it("deleting a grey snapshot before view → index adjusted", () => {
    const result = deleteSnapshotState(s(2, 0, false, 3), 0);
    expect(result.viewSnapIdx).toBe(1); // shifted down
    expect(result.count).toBe(2);
  });

  it("deleting a grey snapshot after view → no adjustment needed", () => {
    const result = deleteSnapshotState(s(0, 0, false, 3), 2);
    expect(result.viewSnapIdx).toBe(0); // unchanged
    expect(result.count).toBe(2);
  });

  it("deleting before diff base → base adjusted", () => {
    const result = deleteSnapshotState(s(null, 2, true, 4), 0);
    expect(result.diffBaseIdx).toBe(1); // shifted down
    expect(result.diffMode).toBe(true);
  });

  it("deleting at end when base is last → base clamped", () => {
    const result = deleteSnapshotState(s(null, 2, true, 3), 2);
    // base was pointing to deleted item → diff cleared
    expect(result.diffMode).toBe(false);
  });

  it("adjusts both view and base when both are after deleted", () => {
    const result = deleteSnapshotState(s(3, 2, true, 5), 0);
    expect(result.viewSnapIdx).toBe(2);
    expect(result.diffBaseIdx).toBe(1);
    expect(result.diffMode).toBe(true);
    expect(result.count).toBe(4);
  });

  it("preserves Live as diff base (null) when deleting a snapshot", () => {
    // snap 0 green, Live blue (diffBaseIdx=null)
    const result = deleteSnapshotState(s(0, null, true, 2), 1);
    expect(result.viewSnapIdx).toBe(0);
    expect(result.diffBaseIdx).toBeNull(); // Live still blue
    expect(result.diffMode).toBe(true);
  });

  it("deleting viewed snap with Live base → back to Live, diff cleared", () => {
    const result = deleteSnapshotState(s(0, null, true, 1), 0);
    expect(result).toEqual({ viewSnapIdx: null, diffBaseIdx: null, diffMode: false, count: 0 });
  });
});
