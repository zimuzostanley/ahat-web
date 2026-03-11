/**
 * Integration tests for capture search using a real saved session file.
 * Tests search/filter functions against actual device data.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import {
  searchProcesses,
  filterProcesses,
  highlightText,
} from "./capture-search";
import type { ProcessInfo, SmapsAggregated, SmapsRollup } from "../adb/capture";

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

let session: SessionFile;
let liveProcs: ProcessInfo[];
let liveRollups: Map<number, SmapsRollup>;
let liveSmaps: Map<number, SmapsAggregated[]>;
let snapProcs: ProcessInfo[];
let snapRollups: Map<number, SmapsRollup>;
let snapSmaps: Map<number, SmapsAggregated[]>;

beforeAll(() => {
  const raw = readFileSync("/home/zimvm/projects/ahat-session-2026-03-07T21-58-36.json", "utf8");
  session = JSON.parse(raw);

  liveProcs = session.live.processes!;
  liveRollups = new Map(session.live.smapsRollups);
  liveSmaps = new Map(session.live.smapsData);

  const snap = session.snapshots[0];
  snapProcs = snap.processes;
  snapRollups = new Map(snap.smapsRollups);
  snapSmaps = new Map(snap.smapsData);
});

// ── Process name search ──────────────────────────────────────────────────────

describe("process name search on real data", () => {
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
    // Every matched process should have 'google' in name
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

describe("PID search on real data", () => {
  it("finds process by exact PID", () => {
    const pid = liveProcs[0].pid;
    const r = searchProcesses(liveProcs, String(pid), liveSmaps, liveRollups);
    expect(r.has(pid)).toBe(true);
  });

  it("finds multiple processes when PID is a substring of others", () => {
    // Search for a short number that might match multiple PIDs or names
    const r = searchProcesses(liveProcs, "59", liveSmaps, liveRollups);
    expect(r.size).toBeGreaterThanOrEqual(1);
  });
});

// ── OomLabel search ──────────────────────────────────────────────────────────

describe("oomLabel search on real data", () => {
  it("finds processes by oomLabel 'System'", () => {
    const sysProcs = liveProcs.filter(p => p.oomLabel.toLowerCase().includes("system"));
    if (sysProcs.length === 0) return; // skip if no system procs
    const r = searchProcesses(liveProcs, "system", liveSmaps, liveRollups);
    // All system-label processes should be matched
    for (const p of sysProcs) {
      expect(r.has(p.pid)).toBe(true);
    }
  });
});

// ── Smaps group search (path-to-root) ────────────────────────────────────────

describe("smaps group search on real data", () => {
  it("finds processes with matching smaps groups", () => {
    // Use snapshot data which has smaps
    if (snapSmaps.size === 0) return;
    // Get a real group name from the data
    const firstEntry = snapSmaps.entries().next().value;
    if (!firstEntry) return;
    const [pid, groups] = firstEntry;
    const groupName = groups[0]?.name;
    if (!groupName) return;

    // Search for this group name
    const query = groupName.length > 10 ? groupName.slice(0, 10) : groupName;
    const r = searchProcesses(snapProcs, query, snapSmaps, snapRollups);
    expect(r.size).toBeGreaterThanOrEqual(1);
    expect(r.has(pid)).toBe(true);
    const match = r.get(pid)!;
    // Should be a sub-match (smaps group matched, not necessarily the process name)
    expect(match.smapsGroups.size).toBeGreaterThanOrEqual(1);
  });
});

// ── Filter functions on real data ────────────────────────────────────────────

describe("filterProcesses on real data", () => {
  it("returns empty for empty search results", () => {
    const r = searchProcesses(liveProcs, "", liveSmaps, liveRollups);
    // Empty query produces empty searchResults, filtering gives empty
    expect(filterProcesses(liveProcs, r)).toEqual([]);
  });

  it("filters correctly for 'system'", () => {
    const r = searchProcesses(liveProcs, "system", liveSmaps, liveRollups);
    const filtered = filterProcesses(liveProcs, r);
    expect(filtered.length).toBeLessThan(liveProcs.length);
    expect(filtered.length).toBe(r.size);
    for (const p of filtered) {
      expect(r.has(p.pid)).toBe(true);
    }
  });

  it("preserves original order", () => {
    const r = searchProcesses(liveProcs, "com", liveSmaps, liveRollups);
    const filtered = filterProcesses(liveProcs, r);
    // Check order is preserved
    let lastIdx = -1;
    for (const p of filtered) {
      const idx = liveProcs.indexOf(p);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });
});

// ── Size queries on real data ────────────────────────────────────────────────

describe("size queries on real data", () => {
  it("finds large processes with >100mb", () => {
    const r = searchProcesses(liveProcs, ">100mb", liveSmaps, liveRollups);
    // system_server and systemui should be >100MB PSS
    expect(r.size).toBeGreaterThanOrEqual(1);
    for (const [pid] of r) {
      const p = liveProcs.find(pr => pr.pid === pid);
      expect(p).toBeDefined();
      // At least one size field should be >100MB = 102400KB
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
    // "100" should match PIDs/names, not be treated as ">=100kb"
    const r = searchProcesses(liveProcs, "100", liveSmaps, liveRollups);
    // Should match processes with "100" in name or PID, not by size
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

// ── Snapshot data search ─────────────────────────────────────────────────────

describe("search on snapshot data", () => {
  it("works the same as live data", () => {
    const r = searchProcesses(snapProcs, "system_server", snapSmaps, snapRollups);
    const ss = snapProcs.find(p => p.name === "system_server");
    expect(ss).toBeDefined();
    expect(r.has(ss!.pid)).toBe(true);
  });

  it("snapshot process count differs from live", () => {
    // Just verify we have real data with different counts
    expect(snapProcs.length).not.toBe(liveProcs.length);
  });

  it("snapshot search finds smaps groups (not found in live with no smaps)", () => {
    // Live has 0 smaps pids, snapshot has 3 — a smaps-group-only query should
    // find matches in snapshot but not in live
    expect(snapSmaps.size).toBeGreaterThan(0);
    expect(liveSmaps.size).toBe(0);

    // Get a real smaps group name from snapshot data
    const [pid, groups] = snapSmaps.entries().next().value!;
    const groupName = groups[0].name;

    const snapResults = searchProcesses(snapProcs, groupName, snapSmaps, snapRollups);
    const liveResults = searchProcesses(liveProcs, groupName, liveSmaps, liveRollups);

    // Snapshot should find the process via smaps path-to-root
    expect(snapResults.has(pid)).toBe(true);
    const match = snapResults.get(pid)!;
    expect(match.smapsGroups.has(groupName)).toBe(true);

    // Live won't find it via smaps (no smaps data loaded)
    // It might still match if the group name happens to be in a process name/pid
    // but the smapsGroups set should be empty
    if (liveResults.has(pid)) {
      expect(liveResults.get(pid)!.smapsGroups.size).toBe(0);
    }
  });

  it("VMA search finds process via path-to-root in snapshot", () => {
    // Search for a VMA address that exists in snapshot smaps data
    const [pid, groups] = snapSmaps.entries().next().value!;
    const entry = groups[0].entries[0];
    const addr = entry.addrStart;

    const r = searchProcesses(snapProcs, addr, snapSmaps, snapRollups);
    expect(r.has(pid)).toBe(true);
    const match = r.get(pid)!;
    // Process matched via VMA sub-match, not directly
    expect(match.vmaEntries.size).toBeGreaterThan(0);
  });
});

// ── Cross-filter: no matches shows empty ─────────────────────────────────────

describe("no-match produces empty filtered list", () => {
  it("filterProcesses returns empty array for no-match query", () => {
    const r = searchProcesses(liveProcs, "xyzzy_no_such_thing", liveSmaps, liveRollups);
    expect(r.size).toBe(0);
    const filtered = filterProcesses(liveProcs, r);
    expect(filtered).toEqual([]);
  });

  it("filterProcesses returns empty even with many processes", () => {
    expect(liveProcs.length).toBeGreaterThan(100);
    const r = searchProcesses(liveProcs, "zzz_absolutely_nothing_matches_this", liveSmaps, liveRollups);
    const filtered = filterProcesses(liveProcs, r);
    expect(filtered.length).toBe(0);
  });
});

// ── Highlight on real data ───────────────────────────────────────────────────

describe("highlight on real data", () => {
  it("highlights process name match", () => {
    const segments = highlightText("system_server", "system");
    expect(segments).toEqual([
      { text: "system", highlight: true },
      { text: "_server", highlight: false },
    ]);
  });

  it("highlights in com.google.android.gms", () => {
    const segments = highlightText("com.google.android.gms", "google");
    expect(segments).toEqual([
      { text: "com.", highlight: false },
      { text: "google", highlight: true },
      { text: ".android.gms", highlight: false },
    ]);
  });
});

// ── Performance ──────────────────────────────────────────────────────────────

describe("search performance", () => {
  it("searches 386+ processes in under 10ms", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      searchProcesses(liveProcs, "system", liveSmaps, liveRollups);
    }
    const elapsed = performance.now() - start;
    const perCall = elapsed / 100;
    expect(perCall).toBeLessThan(10); // < 10ms per call
  });

  it("filter is even faster", () => {
    const r = searchProcesses(liveProcs, "google", liveSmaps, liveRollups);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      filterProcesses(liveProcs, r);
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 1000).toBeLessThan(1); // < 1ms per call
  });
});
