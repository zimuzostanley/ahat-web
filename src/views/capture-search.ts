// Pure search/filter helpers for CaptureView.
// All functions are side-effect-free and testable in isolation.

import type { ProcessInfo, SmapsAggregated, SmapsEntry, SharedMapping } from "../adb/capture";
import type { SmapsRollup } from "../adb/capture";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchMatch {
  /** Whether the process row itself matched (name/pid/oomLabel). */
  process: boolean;
  /** Names of smaps groups that matched. */
  smapsGroups: Set<string>;
  /** Per smaps-group, set of VMA addrStart keys that matched. */
  vmaEntries: Map<string, Set<string>>;
}

/** Map from pid → SearchMatch. Only pids with at least one match are included. */
export type SearchResults = Map<number, SearchMatch>;

// ── Core matching ────────────────────────────────────────────────────────────

function textMatch(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

/**
 * Search all process data for a text query. Case-insensitive substring match
 * across process name, PID, oomLabel, and smaps group (mapping) names.
 */
export function searchProcesses(
  processes: ProcessInfo[],
  query: string,
  smapsData: Map<number, SmapsAggregated[]>,
  _rollups: Map<number, SmapsRollup>,
): SearchResults {
  const results: SearchResults = new Map();
  const q = query.toLowerCase().trim();
  if (!q) return results;

  for (const p of processes) {
    const processMatched = textMatch(p.name, q)
      || textMatch(String(p.pid), q)
      || (!!p.oomLabel && textMatch(`state:${p.oomLabel}`, q));

    const smapsGroups = new Set<string>();
    const vmaEntries = new Map<string, Set<string>>();

    const aggs = smapsData.get(p.pid);
    if (aggs) {
      for (const g of aggs) {
        if (textMatch(g.name, q)) {
          smapsGroups.add(g.name);
        }
      }
    }

    if (processMatched || smapsGroups.size > 0) {
      results.set(p.pid, { process: processMatched, smapsGroups, vmaEntries });
    }
  }

  return results;
}

/**
 * Search shared mappings by name. Returns set of matching mapping names.
 */
export function searchSharedMappings(
  mappings: SharedMapping[],
  query: string,
): Set<string> {
  const result = new Set<string>();
  const q = query.toLowerCase().trim();
  if (!q) return result;
  for (const mp of mappings) {
    if (textMatch(mp.name, q)) result.add(mp.name);
  }
  return result;
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** Filter processes to only those in searchResults. */
export function filterProcesses(
  processes: ProcessInfo[],
  searchResults: SearchResults,
): ProcessInfo[] {
  return processes.filter(p => searchResults.has(p.pid));
}

/** Filter smaps groups. Process-level match shows all; otherwise only matching groups. */
export function filterSmapsGroups(
  groups: SmapsAggregated[],
  match: SearchMatch,
): SmapsAggregated[] {
  if (match.process) return groups;
  return groups.filter(g => match.smapsGroups.has(g.name));
}

/** Filter VMA entries within a group. Process match shows all; VMA matches filter. */
export function filterVmaEntries(
  entries: SmapsEntry[],
  groupName: string,
  match: SearchMatch,
): SmapsEntry[] {
  if (match.process) return entries;
  const matchedVmas = match.vmaEntries.get(groupName);
  if (!matchedVmas || matchedVmas.size === 0) return entries;
  return entries.filter(e => matchedVmas.has(e.addrStart));
}

/** Filter shared mappings to only those in matchedNames. */
export function filterSharedMappings(
  mappings: SharedMapping[],
  matchedNames: Set<string>,
): SharedMapping[] {
  return mappings.filter(mp => matchedNames.has(mp.name));
}

// ── Highlighting ─────────────────────────────────────────────────────────────

export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

export function highlightText(text: string, query: string): HighlightSegment[] {
  if (!query) return [{ text, highlight: false }];
  const q = query.toLowerCase().trim();
  if (!q) return [{ text, highlight: false }];

  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return [{ text, highlight: false }];

  const segments: HighlightSegment[] = [];
  if (idx > 0) segments.push({ text: text.slice(0, idx), highlight: false });
  segments.push({ text: text.slice(idx, idx + q.length), highlight: true });
  if (idx + q.length < text.length) segments.push({ text: text.slice(idx + q.length), highlight: false });
  return segments;
}
