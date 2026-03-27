/**
 * Cross-process Zygote candidate detection.
 *
 * Given fingerprints from multiple process heap dumps, finds objects with
 * identical content that exist independently in each process. These are
 * candidates for Zygote preloading — initializing them once in Zygote
 * would let all app processes share the same physical pages.
 */

import type { ObjectFingerprint } from "./hprof";

export interface ZygoteCandidate {
  className: string;
  hash: number;
  processCount: number;           // how many processes have this object
  totalInstances: number;         // sum of instances across all processes
  perInstanceRetained: number;    // avg retained size of one instance
  totalWasted: number;            // (totalInstances - processCount) × perInstanceRetained
  processes: string[];            // process names that have this
}

/**
 * Find objects that are duplicated across multiple process dumps.
 *
 * @param dumps - Map from process name to its fingerprints
 * @returns Candidates sorted by totalWasted descending
 */
export function findZygoteCandidates(
  dumps: Map<string, ObjectFingerprint[]>,
): ZygoteCandidate[] {
  // Group fingerprints by (hash, className) across all dumps
  const groups = new Map<string, {
    className: string;
    hash: number;
    processes: Map<string, { count: number; totalRetained: number }>;
  }>();

  for (const [processName, fingerprints] of dumps) {
    for (const fp of fingerprints) {
      // Key by hash + className to handle hash collisions across classes
      const key = `${fp.hash}:${fp.className}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = { className: fp.className, hash: fp.hash, processes: new Map() };
        groups.set(key, group);
      }
      const existing = group.processes.get(processName);
      if (existing !== undefined) {
        existing.count++;
        existing.totalRetained += fp.retainedSize;
      } else {
        group.processes.set(processName, { count: 1, totalRetained: fp.retainedSize });
      }
    }
  }

  // Keep only groups present in 2+ processes
  const results: ZygoteCandidate[] = [];
  for (const group of groups.values()) {
    if (group.processes.size < 2) continue;

    let totalInstances = 0;
    let totalRetained = 0;
    const processNames: string[] = [];
    for (const [name, data] of group.processes) {
      totalInstances += data.count;
      totalRetained += data.totalRetained;
      processNames.push(name);
    }

    const perInstanceRetained = totalInstances > 0
      ? Math.round(totalRetained / totalInstances)
      : 0;

    // Wasted = all instances beyond one per process × per-instance size
    // (if Zygote had one copy, each process would share it)
    const totalWasted = (totalInstances - group.processes.size) * perInstanceRetained;

    results.push({
      className: group.className,
      hash: group.hash,
      processCount: group.processes.size,
      totalInstances,
      perInstanceRetained,
      totalWasted,
      processes: processNames,
    });
  }

  results.sort((a, b) => b.totalWasted - a.totalWasted);
  return results;
}
