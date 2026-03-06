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

export type SmapsNumericField = "pssKb" | "rssKb" | "sharedCleanKb" | "sharedDirtyKb" | "privateCleanKb" | "privateDirtyKb" | "swapKb";
export type SmapsDeltaKey = "deltaPssKb" | "deltaRssKb" | "deltaSharedCleanKb" | "deltaSharedDirtyKb" | "deltaPrivateCleanKb" | "deltaPrivateDirtyKb" | "deltaSwapKb";
export type SmapsTotals = Record<SmapsNumericField, number> & Record<SmapsDeltaKey, number>;

export const SMAPS_COLUMNS: [SmapsNumericField, string][] = [
  ["rssKb", "RSS"], ["pssKb", "PSS"],
  ["privateDirtyKb", "Priv Dirty"], ["privateCleanKb", "Priv Clean"],
  ["sharedDirtyKb", "Shared Dirty"], ["sharedCleanKb", "Shared Clean"],
  ["swapKb", "Swap"],
];

export const SMAPS_DELTA_KEY: Record<SmapsNumericField, SmapsDeltaKey> = {
  pssKb: "deltaPssKb", rssKb: "deltaRssKb",
  sharedCleanKb: "deltaSharedCleanKb", sharedDirtyKb: "deltaSharedDirtyKb",
  privateCleanKb: "deltaPrivateCleanKb", privateDirtyKb: "deltaPrivateDirtyKb",
  swapKb: "deltaSwapKb",
};

/** Compute column totals with optional diff deltas — type-safe, no casts. */
export function computeSmapsTotals(
  items: Record<SmapsNumericField, number>[],
  diffs: ({ status: string; current: Record<SmapsNumericField, number> } & Record<SmapsDeltaKey, number>)[] | null | undefined,
): SmapsTotals {
  const t: SmapsTotals = {
    pssKb: 0, rssKb: 0, sharedCleanKb: 0, sharedDirtyKb: 0,
    privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0,
    deltaPssKb: 0, deltaRssKb: 0, deltaSharedCleanKb: 0, deltaSharedDirtyKb: 0,
    deltaPrivateCleanKb: 0, deltaPrivateDirtyKb: 0, deltaSwapKb: 0,
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
