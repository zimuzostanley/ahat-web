// Pure helpers extracted from CaptureView for testability and reuse.

/** Sort items, pinning non-matched diff entries at top. */
export function sortWithDiffPinning<T, D extends { status: string; current: T }>(
  items: T[], diffs: D[] | null | undefined, cmp: (a: T, b: T) => number,
): T[] {
  if (diffs) {
    const copy = [...diffs];
    copy.sort((a, b) => {
      const aPin = a.status === "matched" ? 0 : 1;
      const bPin = b.status === "matched" ? 0 : 1;
      return aPin !== bPin ? bPin - aPin : cmp(a.current, b.current);
    });
    return copy.map(d => d.current);
  }
  return [...items].sort(cmp);
}

export type SmapsNumericField = "pssKb" | "rssKb" | "sharedCleanKb" | "sharedDirtyKb" | "privateCleanKb" | "privateDirtyKb" | "swapKb" | "sizeKb";
export type SmapsDeltaKey = "deltaPssKb" | "deltaRssKb" | "deltaSharedCleanKb" | "deltaSharedDirtyKb" | "deltaPrivateCleanKb" | "deltaPrivateDirtyKb" | "deltaSwapKb" | "deltaSizeKb";
export type SmapsTotals = Record<SmapsNumericField, number> & Record<SmapsDeltaKey, number>;

export const SMAPS_COLUMNS: [SmapsNumericField, string][] = [
  ["rssKb", "RSS"], ["pssKb", "PSS"],
  ["privateDirtyKb", "Priv Dirty"], ["privateCleanKb", "Priv Clean"],
  ["sharedDirtyKb", "Shared Dirty"], ["sharedCleanKb", "Shared Clean"],
  ["swapKb", "Swap"], ["sizeKb", "VSS"],
];

export const SMAPS_DELTA_KEY: Record<SmapsNumericField, SmapsDeltaKey> = {
  pssKb: "deltaPssKb", rssKb: "deltaRssKb",
  sharedCleanKb: "deltaSharedCleanKb", sharedDirtyKb: "deltaSharedDirtyKb",
  privateCleanKb: "deltaPrivateCleanKb", privateDirtyKb: "deltaPrivateDirtyKb",
  swapKb: "deltaSwapKb", sizeKb: "deltaSizeKb",
};

// ── Snapshot timeline state machine ──────────────────────────────────────────

export interface TimelineState {
  /** Index of snapshot being viewed (null = live). Green dot. */
  viewSnapIdx: number | null;
  /** Index of snapshot used as diff base (null = live). Blue dot. */
  diffBaseIdx: number | null;
  /** Whether diff mode is active. */
  diffMode: boolean;
  /** Total number of snapshots. */
  count: number;
}

/**
 * Compute next timeline state after clicking a dot.
 *
 * Every dot (including Live) follows the same rules:
 *   green = viewSnapIdx (null = Live)
 *   blue  = diffBaseIdx when diffMode (null = Live)
 *   grey  = everything else
 *
 *   click grey  → becomes blue, green stays, diff enabled
 *   click blue  → becomes green, diff cleared
 *   click green → deselect (back to Live green), diff cleared
 */
export function timelineClick(state: TimelineState, clickedIdx: number | null): TimelineState {
  const isViewing = state.viewSnapIdx === clickedIdx;
  const isBase = state.diffMode && state.diffBaseIdx === clickedIdx;

  if (isViewing) {
    // Click green → deselect. If already Live, no-op.
    if (clickedIdx === null) return state;
    return { ...state, viewSnapIdx: null, diffMode: false };
  }

  if (isBase) {
    // Click blue → becomes green, diff cleared
    return { ...state, viewSnapIdx: clickedIdx, diffMode: false };
  }

  // Click grey → becomes blue, green stays, diff enabled
  return { ...state, diffBaseIdx: clickedIdx, diffMode: true };
}

/**
 * Adjust timeline state after deleting a snapshot at `idx`.
 * Returns updated state. Caller should splice the snapshot array.
 */
export function deleteSnapshotState(state: TimelineState, idx: number): TimelineState {
  const newCount = state.count - 1;
  if (newCount === 0) {
    return { viewSnapIdx: null, diffBaseIdx: null, diffMode: false, count: 0 };
  }

  let { viewSnapIdx, diffBaseIdx, diffMode } = state;

  // Adjust viewSnapIdx
  if (viewSnapIdx !== null) {
    if (viewSnapIdx === idx) viewSnapIdx = null;
    else if (viewSnapIdx > idx) viewSnapIdx--;
  }

  // Adjust diffBaseIdx (null = live, no adjustment needed)
  if (diffBaseIdx !== null) {
    if (diffMode && diffBaseIdx === idx) { diffMode = false; diffBaseIdx = null; }
    else if (diffBaseIdx >= newCount) diffBaseIdx = newCount - 1;
    else if (diffBaseIdx > idx) diffBaseIdx--;
  }

  return { viewSnapIdx, diffBaseIdx, diffMode, count: newCount };
}

/** Compute column totals with optional diff deltas — type-safe, no casts. */
export function computeSmapsTotals(
  items: Record<SmapsNumericField, number>[],
  diffs: ({ status: string; current: Record<SmapsNumericField, number> } & Record<SmapsDeltaKey, number>)[] | null | undefined,
): SmapsTotals {
  const t: SmapsTotals = {
    pssKb: 0, rssKb: 0, sharedCleanKb: 0, sharedDirtyKb: 0,
    privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0, sizeKb: 0,
    deltaPssKb: 0, deltaRssKb: 0, deltaSharedCleanKb: 0, deltaSharedDirtyKb: 0,
    deltaPrivateCleanKb: 0, deltaPrivateDirtyKb: 0, deltaSwapKb: 0, deltaSizeKb: 0,
  };
  if (diffs) {
    for (const d of diffs) {
      if (d.status !== "removed") {
        for (const [f] of SMAPS_COLUMNS) t[f] += d.current[f];
      }
      for (const [f] of SMAPS_COLUMNS) t[SMAPS_DELTA_KEY[f]] += d[SMAPS_DELTA_KEY[f]];
    }
  } else {
    for (const item of items) {
      for (const [f] of SMAPS_COLUMNS) t[f] += item[f];
    }
  }
  return t;
}
