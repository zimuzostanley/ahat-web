import type { StringListRow } from "../hprof.worker";

export interface DuplicateGroup {
  value: string;
  count: number;
  wastedBytes: number;
  ids: number[];
}

/** Groups strings by value and identifies duplicates with wasted memory. */
export function computeDuplicates(rows: StringListRow[]): DuplicateGroup[] {
  const groups = new Map<string, { count: number; totalRetained: number; minRetained: number; ids: number[] }>();
  for (const r of rows) {
    const existing = groups.get(r.value);
    if (existing) {
      existing.count++;
      existing.totalRetained += r.retainedSize;
      existing.minRetained = Math.min(existing.minRetained, r.retainedSize);
      existing.ids.push(r.id);
    } else {
      groups.set(r.value, { count: 1, totalRetained: r.retainedSize, minRetained: r.retainedSize, ids: [r.id] });
    }
  }
  const result: DuplicateGroup[] = [];
  for (const [value, g] of groups) {
    if (g.count < 2) continue;
    result.push({
      value,
      count: g.count,
      wastedBytes: g.totalRetained - g.minRetained,
      ids: g.ids,
    });
  }
  result.sort((a, b) => b.wastedBytes - a.wastedBytes);
  return result;
}
