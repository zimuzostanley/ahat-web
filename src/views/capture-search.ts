// Pure search/filter helpers for CaptureView.
// All functions are side-effect-free and testable in isolation.

import type { ProcessInfo, SmapsAggregated, SmapsEntry, SharedMapping } from "../adb/capture";
import type { SmapsNumericField } from "./capture-helpers";
import type { SmapsRollup } from "../adb/capture";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SearchMatch {
  /** Whether the process row itself matched. */
  process: boolean;
  /** Names of smaps groups that matched (empty if none). */
  smapsGroups: Set<string>;
  /** Per smaps-group, set of VMA addrStart keys that matched (empty if none). */
  vmaEntries: Map<string, Set<string>>;
}

/** Map from pid → SearchMatch. Only pids with at least one match are included. */
export type SearchResults = Map<number, SearchMatch>;

// ── Qualifier parsing ─────────────────────────────────────────────────────────

/** Scoped search qualifier, e.g. "pss:>5mb" → { scope: "pss", value: ">5mb" } */
/** All numeric fields searchable by column qualifier (SmapsNumericField + sizeKb). */
type SizeField = SmapsNumericField | "sizeKb";

interface ParsedQuery {
  scope: "all" | "process" | "vma" | "mapping" | SizeField;
  value: string;
}

const SCOPE_ALIASES: Record<string, ParsedQuery["scope"]> = {
  process: "process", proc: "process", p: "process",
  vma: "vma", v: "vma",
  mapping: "mapping", group: "mapping", map: "mapping", m: "mapping",
  pss: "pssKb", rss: "rssKb",
  pd: "privateDirtyKb", "private-dirty": "privateDirtyKb", privatedirty: "privateDirtyKb",
  pc: "privateCleanKb", "private-clean": "privateCleanKb", privateclean: "privateCleanKb",
  sd: "sharedDirtyKb", "shared-dirty": "sharedDirtyKb", shareddirty: "sharedDirtyKb",
  sc: "sharedCleanKb", "shared-clean": "sharedCleanKb", sharedclean: "sharedCleanKb",
  swap: "swapKb",
  size: "sizeKb",
};

/** Strip matching surrounding quotes (single or double). */
function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseQualifiedQuery(raw: string): ParsedQuery {
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const prefix = raw.slice(0, colon).toLowerCase().trim();
    const scope = SCOPE_ALIASES[prefix];
    if (scope) {
      return { scope, value: stripQuotes(raw.slice(colon + 1).trim()).toLowerCase() };
    }
  }
  return { scope: "all", value: stripQuotes(raw.toLowerCase().trim()) };
}

// ── Core search ──────────────────────────────────────────────────────────────

const SIZE_SUFFIXES: [string, number][] = [
  ["gb", 1024 * 1024], ["mb", 1024], ["kb", 1],
];

/**
 * Check if a search query looks like a size query (e.g. "100mb", ">50kb").
 * Returns null if not a size query, or { op, valueKb } if it is.
 */
function parseSizeQuery(query: string): { op: ">" | "<" | ">=" | "<=" | "="; valueKb: number } | null {
  // Require either a comparison operator or a size suffix (or both) to distinguish from plain text/PID searches.
  const m = query.match(/^([><]=?|=)?\s*(\d+(?:\.\d+)?)\s*(gb|mb|kb)?$/i);
  if (!m) return null;
  const hasOp = !!m[1];
  const hasSuffix = !!m[3];
  if (!hasOp && !hasSuffix) return null; // plain number, not a size query
  const op = (m[1] || ">=") as ">" | "<" | ">=" | "<=" | "=";
  const num = parseFloat(m[2]);
  const suffix = m[3]?.toLowerCase();
  const multiplier = suffix ? SIZE_SUFFIXES.find(([s]) => s === suffix)?.[1] ?? 1 : 1;
  return { op, valueKb: num * multiplier };
}

function matchesSize(valueKb: number, op: string, targetKb: number): boolean {
  switch (op) {
    case ">": return valueKb > targetKb;
    case "<": return valueKb < targetKb;
    case ">=": return valueKb >= targetKb;
    case "<=": return valueKb <= targetKb;
    case "=": return valueKb === targetKb;
    default: return false;
  }
}

/** Case-insensitive substring match. */
function textMatch(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

const PROCESS_SIZE_FIELDS: SmapsNumericField[] = [
  "pssKb", "rssKb", "privateDirtyKb", "privateCleanKb",
  "sharedDirtyKb", "sharedCleanKb", "swapKb",
];

function processMatchesText(p: ProcessInfo, query: string): boolean {
  return textMatch(p.name, query)
    || textMatch(String(p.pid), query)
    || textMatch(p.oomLabel, query);
}

function processMatchesSize(p: ProcessInfo, sizeQuery: { op: string; valueKb: number }, rollup?: SmapsRollup, field?: SizeField): boolean {
  if (field) {
    // Single-field match — check rollup first (has all smaps fields), fallback to process
    if (rollup && field in rollup) return matchesSize((rollup as any)[field], sizeQuery.op, sizeQuery.valueKb);
    if (field in p) return matchesSize((p as any)[field], sizeQuery.op, sizeQuery.valueKb);
    return false;
  }
  // Check rollup fields first, then basic ProcessInfo fields
  if (rollup) {
    for (const f of PROCESS_SIZE_FIELDS) {
      if (matchesSize(rollup[f], sizeQuery.op, sizeQuery.valueKb)) return true;
    }
  }
  if (matchesSize(p.pssKb, sizeQuery.op, sizeQuery.valueKb)) return true;
  if (matchesSize(p.rssKb, sizeQuery.op, sizeQuery.valueKb)) return true;
  return false;
}

function smapsGroupMatchesText(g: SmapsAggregated, query: string): boolean {
  return textMatch(g.name, query);
}

function vmaEntryMatchesText(e: SmapsEntry, query: string): boolean {
  return textMatch(e.name, query)
    || textMatch(`${e.addrStart}-${e.addrEnd}`, query)
    || textMatch(e.perms, query);
}

function sharedMappingMatchesText(mp: SharedMapping, query: string): boolean {
  return textMatch(mp.name, query);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Search across all process data. Returns a map from pid → match details.
 * Uses path-to-root: if a VMA matches, its parent smaps group and process are kept.
 */
export function searchProcesses(
  processes: ProcessInfo[],
  query: string,
  smapsData: Map<number, SmapsAggregated[]>,
  rollups: Map<number, SmapsRollup>,
): SearchResults {
  const results: SearchResults = new Map();
  const raw = query.trim();
  if (!raw) return results;

  const parsed = parseQualifiedQuery(raw);
  const q = parsed.value;
  if (!q) return results;

  const { scope } = parsed;

  // For column-scoped size queries (pss:>5mb), the value must be a size expression
  const isSizeScope = scope !== "all" && scope !== "process" && scope !== "vma" && scope !== "mapping";
  const sizeQuery = isSizeScope ? parseSizeQuery(q) : (scope === "all" ? parseSizeQuery(q) : null);

  // Column-scoped query requires a valid size expression
  if (isSizeScope && !sizeQuery) return results;

  for (const p of processes) {
    const rollup = rollups.get(p.pid);

    // Process-level match
    let processMatched = false;
    if (scope === "all") {
      processMatched = sizeQuery
        ? processMatchesSize(p, sizeQuery, rollup)
        : processMatchesText(p, q);
    } else if (scope === "process") {
      processMatched = processMatchesText(p, q);
    } else if (isSizeScope) {
      processMatched = processMatchesSize(p, sizeQuery!, rollup, scope as SizeField);
    }
    // vma/mapping scopes skip process-level matching

    const smapsGroups = new Set<string>();
    const vmaEntries = new Map<string, Set<string>>();

    // Search smaps sub-data (skip for process-only scope)
    if (scope !== "process") {
      const aggs = smapsData.get(p.pid);
      if (aggs) {
        for (const g of aggs) {
          const groupMatched = !sizeQuery && (scope === "all" || scope === "mapping") && smapsGroupMatchesText(g, q);
          const matchedVmas = new Set<string>();

          if (scope !== "mapping") {
            for (const e of g.entries) {
              if (sizeQuery) {
                if (isSizeScope) {
                  // Single column
                  const f = scope as SizeField;
                  if (f in e && matchesSize((e as any)[f], sizeQuery.op, sizeQuery.valueKb)) {
                    matchedVmas.add(e.addrStart);
                  }
                } else {
                  // All size fields
                  for (const f of PROCESS_SIZE_FIELDS) {
                    if (matchesSize(e[f], sizeQuery.op, sizeQuery.valueKb)) {
                      matchedVmas.add(e.addrStart);
                      break;
                    }
                  }
                }
              } else if (scope === "all" || scope === "vma") {
                if (vmaEntryMatchesText(e, q)) {
                  matchedVmas.add(e.addrStart);
                }
              }
            }
          }

          if (groupMatched || matchedVmas.size > 0) {
            smapsGroups.add(g.name);
            if (matchedVmas.size > 0) {
              vmaEntries.set(g.name, matchedVmas);
            }
          }
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
 * Filter shared mappings by query. Returns the set of mapping names that match.
 */
export function searchSharedMappings(
  mappings: SharedMapping[],
  query: string,
): Set<string> {
  const result = new Set<string>();
  const raw = query.trim();
  if (!raw) return result;

  const parsed = parseQualifiedQuery(raw);
  const q = parsed.value;
  if (!q) return result;

  const { scope } = parsed;
  // process-only or vma-only scopes don't match shared mappings by name
  if (scope === "process" || scope === "vma") return result;

  const isSizeScope = scope !== "all" && scope !== "mapping";
  const sizeQuery = isSizeScope ? parseSizeQuery(q) : (scope === "all" ? parseSizeQuery(q) : null);
  if (isSizeScope && !sizeQuery) return result;

  for (const mp of mappings) {
    if (sizeQuery) {
      if (isSizeScope) {
        const f = scope as SizeField;
        if (f in mp && matchesSize((mp as any)[f], sizeQuery.op, sizeQuery.valueKb)) {
          result.add(mp.name);
        }
      } else {
        for (const f of PROCESS_SIZE_FIELDS) {
          if (f in mp && matchesSize((mp as any)[f], sizeQuery.op, sizeQuery.valueKb)) {
            result.add(mp.name);
            break;
          }
        }
      }
    } else if (sharedMappingMatchesText(mp, q)) {
      result.add(mp.name);
    }
  }

  return result;
}

/**
 * Filter a process list by search results, preserving original order.
 * Returns only processes present in searchResults (empty results = empty output).
 */
export function filterProcesses(
  processes: ProcessInfo[],
  searchResults: SearchResults,
): ProcessInfo[] {
  return processes.filter(p => searchResults.has(p.pid));
}

/**
 * Filter smaps groups for a process by search results.
 * If the process itself matched (not just sub-matches), all groups are shown.
 */
export function filterSmapsGroups(
  groups: SmapsAggregated[],
  match: SearchMatch,
): SmapsAggregated[] {
  if (match.process) return groups; // process-level match shows everything
  return groups.filter(g => match.smapsGroups.has(g.name));
}

/**
 * Filter VMA entries within a group by search results.
 * If the group itself matched (not just VMA sub-matches), all entries are shown.
 */
export function filterVmaEntries(
  entries: SmapsEntry[],
  groupName: string,
  match: SearchMatch,
): SmapsEntry[] {
  if (match.process) return entries; // process-level match shows everything
  const matchedVmas = match.vmaEntries.get(groupName);
  if (!matchedVmas) return entries; // group-level match shows all entries
  return entries.filter(e => matchedVmas.has(e.addrStart));
}

/**
 * Filter shared mappings list by matched names.
 * Returns only mappings present in matchedNames (empty set = empty output).
 */
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

/**
 * Split text into segments for highlighting the search query.
 * Returns the original text as a single non-highlighted segment if no match.
 */
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
