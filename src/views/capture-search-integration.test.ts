/**
 * Integration tests for capture search using a real saved session file.
 * Tests search/filter functions against actual device data, replicating the
 * exact render-time logic from CaptureView.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "fs";
import {
  searchProcesses,
  searchSharedMappings,
  filterProcesses,
  filterSmapsGroups,
  filterVmaEntries,
  filterSharedMappings,
  highlightText,
  type SearchResults,
} from "./capture-search";
import type { ProcessInfo, SmapsAggregated, SmapsRollup, SharedMapping } from "../adb/capture";
import { aggregateSharedMappings, diffProcesses } from "../adb/capture";

interface SessionFile {
  version: 1;
  snapshots: {
    id: number;
    ts: number;
    processes: ProcessInfo[];
    smapsRollups: [number, SmapsRollup][];
    smapsData: [number, SmapsAggregated[]][];
  }[];
  live: {
    processes: ProcessInfo[] | null;
    smapsRollups: [number, SmapsRollup][];
    smapsData: [number, SmapsAggregated[]][];
    javaPids: number[];
  };
}

const SESSION_PATH = "/home/zimvm/projects/ahat-session-2026-03-07T21-58-36.json";
const hasSession = existsSync(SESSION_PATH);

let session: SessionFile;
let liveProcs: ProcessInfo[];
let liveRollups: Map<number, SmapsRollup>;
let liveSmaps: Map<number, SmapsAggregated[]>;
let snapProcs: ProcessInfo[];
let snapRollups: Map<number, SmapsRollup>;
let snapSmaps: Map<number, SmapsAggregated[]>;

// Shared mappings computed from snapshot smaps (the only view that has smaps data)
let snapSharedMappings: SharedMapping[];

beforeAll(() => {
  if (!hasSession) return;
  const raw = readFileSync(SESSION_PATH, "utf8");
  session = JSON.parse(raw);

  liveProcs = session.live.processes!;
  liveRollups = new Map(session.live.smapsRollups);
  liveSmaps = new Map(session.live.smapsData);

  const snap = session.snapshots[0];
  snapProcs = snap.processes;
  snapRollups = new Map(snap.smapsRollups);
  snapSmaps = new Map(snap.smapsData);

  // Compute shared mappings like CaptureView does
  snapSharedMappings = aggregateSharedMappings(snapSmaps, snapProcs);
});

// ── Helper: replicate CaptureView's exact render-time search logic ──────────

/**
 * Simulates the exact search/filter pipeline from CaptureView.view().
 * This is the source of truth for what the browser would show.
 */
function simulateRenderSearch(
  query: string,
  procs: ProcessInfo[],
  smaps: Map<number, SmapsAggregated[]>,
  rollups: Map<number, SmapsRollup>,
  sharedMappings: SharedMapping[] | null,
) {
  const isSearching = query.trim() !== "";

  // Step 1: Search processes
  const searchResults: SearchResults = isSearching
    ? searchProcesses(procs, query, smaps, rollups)
    : new Map();

  // Step 2: Search shared mappings by name
  const sharedMappingNameMatches = isSearching && sharedMappings
    ? searchSharedMappings(sharedMappings, query)
    : new Set<string>();

  // Step 3: Cross-filter (process → mapping only)
  const sharedMappingMatches = new Set(sharedMappingNameMatches);
  if (isSearching && sharedMappings) {
    for (const mp of sharedMappings) {
      if (!sharedMappingMatches.has(mp.name) && mp.processes.some(p => searchResults.has(p.pid))) {
        sharedMappingMatches.add(mp.name);
      }
    }
  }

  const filteredProcesses = isSearching ? filterProcesses(procs, searchResults) : procs;
  const filteredMappings = isSearching && sharedMappings
    ? filterSharedMappings(sharedMappings, sharedMappingMatches)
    : sharedMappings;

  return { searchResults, filteredProcesses, filteredMappings, sharedMappingMatches };
}

const d = hasSession ? describe : describe.skip;

// ── Process name search ──────────────────────────────────────────────────────

d("process name search on real data", () => {
  it("finds system_server by name", () => {
    const r = searchProcesses(liveProcs, "system_server", liveSmaps, liveRollups);
    expect(r.size).toBeGreaterThanOrEqual(1);
    const systemServer = liveProcs.find(p => p.name === "system_server");
    expect(systemServer).toBeDefined();
    expect(r.has(systemServer!.pid)).toBe(true);
    expect(r.get(systemServer!.pid)!.process).toBe(true);
  });

  it("finds systemui by partial name", () => {
    const r = searchProcesses(liveProcs, "systemui", liveSmaps, liveRollups);
    expect(r.size).toBeGreaterThanOrEqual(1);
    const match = liveProcs.find(p => p.name.toLowerCase().includes("systemui"));
    expect(match).toBeDefined();
    expect(r.has(match!.pid)).toBe(true);
  });

  it("finds google processes by partial name", () => {
    const r = searchProcesses(liveProcs, "google", liveSmaps, liveRollups);
    expect(r.size).toBeGreaterThan(1);
    for (const [pid, m] of r) {
      if (m.process) {
        const p = liveProcs.find(pr => pr.pid === pid);
        expect(p!.name.toLowerCase()).toContain("google");
      }
    }
  });

  it("is case insensitive", () => {
    const r1 = searchProcesses(liveProcs, "SYSTEM", liveSmaps, liveRollups);
    const r2 = searchProcesses(liveProcs, "system", liveSmaps, liveRollups);
    expect(r1.size).toBe(r2.size);
  });

  it("finds no results for nonsense query", () => {
    const r = searchProcesses(liveProcs, "xyzzy_no_such_process_999", liveSmaps, liveRollups);
    expect(r.size).toBe(0);
  });
});

// ── PID search ───────────────────────────────────────────────────────────────

d("PID search on real data", () => {
  it("finds process by exact PID", () => {
    const pid = liveProcs[0].pid;
    const r = searchProcesses(liveProcs, String(pid), liveSmaps, liveRollups);
    expect(r.has(pid)).toBe(true);
  });

  it("finds multiple processes when PID is a substring of others", () => {
    const r = searchProcesses(liveProcs, "59", liveSmaps, liveRollups);
    expect(r.size).toBeGreaterThanOrEqual(1);
  });
});

// ── OomLabel search ──────────────────────────────────────────────────────────

d("oomLabel search on real data", () => {
  it("finds processes by oomLabel 'System'", () => {
    const sysProcs = liveProcs.filter(p => p.oomLabel.toLowerCase().includes("system"));
    if (sysProcs.length === 0) return;
    const r = searchProcesses(liveProcs, "system", liveSmaps, liveRollups);
    for (const p of sysProcs) {
      expect(r.has(p.pid)).toBe(true);
    }
  });
});

// ── Smaps group search (path-to-root) ────────────────────────────────────────

d("smaps group search on real data", () => {
  it("finds processes with matching smaps groups", () => {
    if (snapSmaps.size === 0) return;
    const firstEntry = snapSmaps.entries().next().value;
    if (!firstEntry) return;
    const [pid, groups] = firstEntry;
    const groupName = groups[0]?.name;
    if (!groupName) return;

    const query = groupName.length > 10 ? groupName.slice(0, 10) : groupName;
    const r = searchProcesses(snapProcs, query, snapSmaps, snapRollups);
    expect(r.size).toBeGreaterThanOrEqual(1);
    expect(r.has(pid)).toBe(true);
    expect(r.get(pid)!.smapsGroups.size).toBeGreaterThanOrEqual(1);
  });
});

// ── Full render pipeline on live data ────────────────────────────────────────

d("full render pipeline on live data (no smaps)", () => {
  it("system_server search: only system_server in process table", () => {
    const { filteredProcesses } = simulateRenderSearch(
      "system_server", liveProcs, liveSmaps, liveRollups, null,
    );
    expect(filteredProcesses.length).toBe(1);
    expect(filteredProcesses[0].name).toBe("system_server");
  });

  it("empty query returns all processes", () => {
    const { filteredProcesses } = simulateRenderSearch(
      "", liveProcs, liveSmaps, liveRollups, null,
    );
    expect(filteredProcesses.length).toBe(liveProcs.length);
  });

  it("no-match returns empty", () => {
    const { filteredProcesses } = simulateRenderSearch(
      "xyzzy_nothing", liveProcs, liveSmaps, liveRollups, null,
    );
    expect(filteredProcesses.length).toBe(0);
  });
});

// ── Full render pipeline on snapshot data (with smaps) ───────────────────────

d("full render pipeline on snapshot data (with smaps)", () => {
  it("system_server search: ONLY system_server in process table", () => {
    const { filteredProcesses } = simulateRenderSearch(
      "system_server", snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    // Must be exactly system_server — no vending, no chrome
    expect(filteredProcesses.length).toBe(1);
    expect(filteredProcesses[0].name).toBe("system_server");
  });

  it("system_server search: shared mappings include those from matching processes", () => {
    const { filteredProcesses, filteredMappings, searchResults } = simulateRenderSearch(
      "system_server", snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    // system_server matched directly; other processes may match via smaps sub-data
    // (e.g. vending has bitmap allocations named "...com.android.vending" in system_server smaps)
    expect(filteredProcesses.some(p => p.name === "system_server")).toBe(true);
    if (filteredMappings && filteredMappings.length > 0) {
      // Every shown mapping must either:
      // (a) have at least one contributing process in searchResults, OR
      // (b) share a name with another mapping that does (name-based set matching)
      const matchedNames = new Set(
        filteredMappings.filter(mp => mp.processes.some(p => searchResults.has(p.pid))).map(mp => mp.name),
      );
      for (const mp of filteredMappings) {
        expect(mp.processes.some(p => searchResults.has(p.pid)) || matchedNames.has(mp.name)).toBe(true);
      }
    }
  });

  it("vending search: includes vending + processes with vending in smaps", () => {
    const { filteredProcesses, searchResults } = simulateRenderSearch(
      "vending", snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    // Must include com.android.vending
    expect(filteredProcesses.some(p => p.name.includes("vending"))).toBe(true);
    // Other matches are valid if they have "vending" in smaps group names
    // (e.g. system_server has /dev/ashmem/bitmap/...com.android.vending bitmaps)
    for (const p of filteredProcesses) {
      const match = searchResults.get(p.pid)!;
      const hasDirectMatch = match.process || match.smapsGroups.size > 0;
      expect(hasDirectMatch).toBe(true);
    }
  });

  it("chrome search: includes chrome process + processes with libchrome.so", () => {
    const { filteredProcesses, searchResults } = simulateRenderSearch(
      "chrome", snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    expect(filteredProcesses.length).toBeGreaterThanOrEqual(1);
    // Each match must have a valid reason (name, smaps group like libchrome.so, etc.)
    for (const p of filteredProcesses) {
      const match = searchResults.get(p.pid)!;
      expect(match.process || match.smapsGroups.size > 0).toBe(true);
    }
  });

  it("smaps group search: process shown via path-to-root, not other processes", () => {
    // Pick a unique-ish smaps group from system_server
    const ssPid = snapProcs.find(p => p.name === "system_server")!.pid;
    const ssGroups = snapSmaps.get(ssPid)!;
    // Find a group that is NOT shared with other smaps-loaded processes
    const otherPids = [...snapSmaps.keys()].filter(p => p !== ssPid);
    const otherGroupNames = new Set<string>();
    for (const pid of otherPids) {
      for (const g of snapSmaps.get(pid)!) otherGroupNames.add(g.name);
    }
    const uniqueGroup = ssGroups.find(g => !otherGroupNames.has(g.name));
    if (!uniqueGroup) return; // all shared, skip

    const { filteredProcesses, searchResults } = simulateRenderSearch(
      uniqueGroup.name, snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    // Only system_server should appear (the group is unique to it)
    expect(filteredProcesses.length).toBe(1);
    expect(filteredProcesses[0].pid).toBe(ssPid);
    // The match should be a sub-match (smaps group), not process name
    const match = searchResults.get(ssPid)!;
    expect(match.smapsGroups.has(uniqueGroup.name)).toBe(true);
  });

  it("VMA address search: only the process with that VMA", () => {
    const [pid, groups] = snapSmaps.entries().next().value!;
    const entry = groups[0].entries[0];
    const addr = entry.addrStart;

    const { filteredProcesses, searchResults } = simulateRenderSearch(
      addr, snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    // The process with that VMA should be in the results
    expect(filteredProcesses.some(p => p.pid === pid)).toBe(true);
    const match = searchResults.get(pid)!;
    expect(match.vmaEntries.size).toBeGreaterThan(0);
    // No process should be in results that doesn't match
    for (const p of filteredProcesses) {
      expect(searchResults.has(p.pid)).toBe(true);
    }
  });
});

// ── Cross-filter: process → shared mappings ──────────────────────────────────

d("cross-filter: process → shared mappings", () => {
  it("searching process name shows mappings from all matching processes", () => {
    const { filteredMappings, searchResults } = simulateRenderSearch(
      "system_server", snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    if (filteredMappings && filteredMappings.length > 0) {
      // Each mapping must have a matching process, match by name, or share a name
      // with another mapping that has a matching process (name-based set matching)
      const matchedNames = new Set(
        filteredMappings.filter(mp => mp.processes.some(p => searchResults.has(p.pid))).map(mp => mp.name),
      );
      for (const mp of filteredMappings) {
        const hasMatchingProcess = mp.processes.some(p => searchResults.has(p.pid));
        const matchedByName = searchSharedMappings([mp], "system_server").size > 0;
        expect(hasMatchingProcess || matchedByName || matchedNames.has(mp.name)).toBe(true);
      }
    }
  });

  it("mapping name match does NOT inject processes into process table", () => {
    // Find a shared mapping name that matches but whose processes shouldn't all show
    if (!snapSharedMappings || snapSharedMappings.length === 0) return;
    const mp = snapSharedMappings.find(m => m.processCount > 1);
    if (!mp) return;

    const { filteredProcesses, searchResults } = simulateRenderSearch(
      mp.name, snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    // Process table should NOT have processes injected just because they share this mapping.
    // Only processes whose name/pid/oomLabel/smaps actually match should be in results.
    for (const p of filteredProcesses) {
      const match = searchResults.get(p.pid)!;
      // Each process must have a genuine match reason
      const hasDirectMatch = match.process || match.smapsGroups.size > 0;
      expect(hasDirectMatch).toBe(true);
    }
  });
});

// ── Cross-filter: smaps sub-filtering ────────────────────────────────────────

d("smaps sub-table filtering", () => {
  it("process name match shows all smaps groups (no sub-filter)", () => {
    const r = searchProcesses(snapProcs, "system_server", snapSmaps, snapRollups);
    const ssPid = snapProcs.find(p => p.name === "system_server")!.pid;
    const match = r.get(ssPid)!;
    const groups = snapSmaps.get(ssPid)!;

    // process matched directly, so filterSmapsGroups returns all
    const filtered = filterSmapsGroups(groups, match);
    expect(filtered.length).toBe(groups.length);
  });

  it("smaps group match filters to only matching groups", () => {
    const ssPid = snapProcs.find(p => p.name === "system_server")!.pid;
    const ssGroups = snapSmaps.get(ssPid)!;
    // Find a group with a unique substring
    const targetGroup = ssGroups[0];
    const uniqueQuery = targetGroup.name;

    const r = searchProcesses(snapProcs, uniqueQuery, snapSmaps, snapRollups);
    if (!r.has(ssPid)) return; // skip if the group name also matches process name
    const match = r.get(ssPid)!;

    if (!match.process) {
      // Sub-match only — groups should be filtered
      const filtered = filterSmapsGroups(ssGroups, match);
      expect(filtered.length).toBeLessThanOrEqual(ssGroups.length);
      for (const g of filtered) {
        expect(match.smapsGroups.has(g.name)).toBe(true);
      }
    }
  });

  it("VMA entry match filters to only matching entries within group", () => {
    const [pid, groups] = snapSmaps.entries().next().value!;
    const group = groups[0];
    const entry = group.entries[0];

    const r = searchProcesses(snapProcs, entry.addrStart, snapSmaps, snapRollups);
    if (!r.has(pid)) return;
    const match = r.get(pid)!;

    if (!match.process) {
      const filteredEntries = filterVmaEntries(group.entries, group.name, match);
      // Should include the matching entry
      expect(filteredEntries.some(e => e.addrStart === entry.addrStart)).toBe(true);
      // Should be fewer than all entries (unless they all match)
      expect(filteredEntries.length).toBeLessThanOrEqual(group.entries.length);
    }
  });
});

// ── Diff mode with search ────────────────────────────────────────────────────

d("diff mode with search", () => {
  it("search filters diffs correctly", () => {
    // Simulate diff between snapshot and live
    const diffs = diffProcesses(snapProcs, liveProcs);

    // Search for system_server
    const searchResults = searchProcesses(liveProcs, "system_server", liveSmaps, liveRollups);
    const filteredDiffs = diffs.filter(d => searchResults.has(d.current.pid));

    // Only system_server diff should remain
    expect(filteredDiffs.length).toBe(1);
    expect(filteredDiffs[0].current.name).toBe("system_server");
  });

  it("search for process shows its diff status", () => {
    const diffs = diffProcesses(snapProcs, liveProcs);
    const searchResults = searchProcesses(liveProcs, "system_server", liveSmaps, liveRollups);
    const filteredDiffs = diffs.filter(d => searchResults.has(d.current.pid));

    expect(filteredDiffs.length).toBe(1);
    // It should be "matched" since system_server exists in both
    expect(filteredDiffs[0].status).toBe("matched");
  });
});

// ── No-match produces empty ──────────────────────────────────────────────────

d("no-match produces empty filtered list", () => {
  it("filterProcesses returns empty array for no-match query", () => {
    const r = searchProcesses(liveProcs, "xyzzy_no_such_thing", liveSmaps, liveRollups);
    expect(r.size).toBe(0);
    expect(filterProcesses(liveProcs, r)).toEqual([]);
  });

  it("filterProcesses returns empty even with many processes", () => {
    expect(liveProcs.length).toBeGreaterThan(100);
    const r = searchProcesses(liveProcs, "zzz_absolutely_nothing_matches_this", liveSmaps, liveRollups);
    expect(filterProcesses(liveProcs, r).length).toBe(0);
  });

  it("no-match on snapshot also returns empty", () => {
    const { filteredProcesses, filteredMappings } = simulateRenderSearch(
      "zzz_nothing_matches", snapProcs, snapSmaps, snapRollups, snapSharedMappings,
    );
    expect(filteredProcesses.length).toBe(0);
    expect(filteredMappings?.length ?? 0).toBe(0);
  });
});

// ── Snapshot vs live search consistency ───────────────────────────────────────

d("snapshot vs live consistency", () => {
  it("same process name gives same results on both (modulo smaps)", () => {
    const liveR = simulateRenderSearch("system_server", liveProcs, liveSmaps, liveRollups, null);
    const snapR = simulateRenderSearch("system_server", snapProcs, snapSmaps, snapRollups, snapSharedMappings);

    // Both should find exactly 1 process: system_server
    expect(liveR.filteredProcesses.length).toBe(1);
    expect(snapR.filteredProcesses.length).toBe(1);
    expect(liveR.filteredProcesses[0].name).toBe("system_server");
    expect(snapR.filteredProcesses[0].name).toBe("system_server");
  });

  it("snapshot search can find smaps data that live cannot", () => {
    // Get a smaps group name only found in snapshot
    const [, groups] = snapSmaps.entries().next().value!;
    // Use a very specific group name that won't match process names
    const group = groups.find(g => !snapProcs.some(p =>
      p.name.toLowerCase().includes(g.name.toLowerCase()) ||
      g.name.toLowerCase().includes(p.name.toLowerCase())
    ));
    if (!group) return;

    const snapR = simulateRenderSearch(group.name, snapProcs, snapSmaps, snapRollups, snapSharedMappings);
    const liveR = simulateRenderSearch(group.name, liveProcs, liveSmaps, liveRollups, null);

    // Snapshot should find the process via smaps, live won't (no smaps loaded)
    expect(snapR.filteredProcesses.length).toBeGreaterThan(0);
    expect(liveR.filteredProcesses.length).toBe(0);
  });
});

// ── Highlight on real data ───────────────────────────────────────────────────

d("highlight on real data", () => {
  it("highlights process name match", () => {
    expect(highlightText("system_server", "system")).toEqual([
      { text: "system", highlight: true },
      { text: "_server", highlight: false },
    ]);
  });

  it("highlights in com.google.android.gms", () => {
    expect(highlightText("com.google.android.gms", "google")).toEqual([
      { text: "com.", highlight: false },
      { text: "google", highlight: true },
      { text: ".android.gms", highlight: false },
    ]);
  });
});

// ── Size queries on real data ────────────────────────────────────────────────

d("size queries on real data", () => {
  it("finds large processes with >100mb", () => {
    const r = searchProcesses(liveProcs, ">100mb", liveSmaps, liveRollups);
    expect(r.size).toBeGreaterThanOrEqual(1);
    for (const [pid] of r) {
      const p = liveProcs.find(pr => pr.pid === pid);
      expect(p).toBeDefined();
      const rollup = liveRollups.get(pid);
      const hasLargeField = (p!.pssKb > 102400 || p!.rssKb > 102400 ||
        (rollup && (rollup.pssKb > 102400 || rollup.rssKb > 102400 ||
          rollup.privateDirtyKb > 102400 || rollup.privateCleanKb > 102400 ||
          rollup.sharedDirtyKb > 102400 || rollup.sharedCleanKb > 102400)));
      expect(hasLargeField).toBe(true);
    }
  });

  it("finds fewer processes with >500mb than >100mb", () => {
    const r100 = searchProcesses(liveProcs, ">100mb", liveSmaps, liveRollups);
    const r500 = searchProcesses(liveProcs, ">500mb", liveSmaps, liveRollups);
    expect(r500.size).toBeLessThanOrEqual(r100.size);
  });

  it("plain numbers are NOT treated as size queries", () => {
    const r = searchProcesses(liveProcs, "100", liveSmaps, liveRollups);
    for (const [pid, m] of r) {
      if (m.process) {
        const p = liveProcs.find(pr => pr.pid === pid)!;
        expect(
          p.name.includes("100") || String(p.pid).includes("100") || p.oomLabel.includes("100")
        ).toBe(true);
      }
    }
  });
});

// ── Performance ──────────────────────────────────────────────────────────────

d("search performance", () => {
  it("searches 386+ processes in under 10ms", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      searchProcesses(liveProcs, "system", liveSmaps, liveRollups);
    }
    expect((performance.now() - start) / 100).toBeLessThan(10);
  });

  it("full render pipeline under 15ms (with smaps)", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      simulateRenderSearch("system_server", snapProcs, snapSmaps, snapRollups, snapSharedMappings);
    }
    expect((performance.now() - start) / 100).toBeLessThan(15);
  });

  it("filter is even faster", () => {
    const r = searchProcesses(liveProcs, "google", liveSmaps, liveRollups);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      filterProcesses(liveProcs, r);
    }
    expect((performance.now() - start) / 1000).toBeLessThan(1);
  });
});
