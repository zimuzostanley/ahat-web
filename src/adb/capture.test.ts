import { describe, it, expect } from "vitest";
import { parseLruProcesses, parseSystemUidPs, parseProcMeminfo } from "./capture";

// ─── parseLruProcesses ──────────────────────────────────────────────────────

describe("parseLruProcesses", () => {
  const LRU_OUTPUT = `  ACTIVITY MANAGER LRU PROCESSES (dumpsys activity lru)
    Activities:
  #0: fg     TOP  LCM 1234:com.android.systemui/u0a45 act:activities
  #1: fg     TOP  LCM 5678:com.google.android.apps.nexuslauncher/u0a67 act:activities
  #2: vis    VIS  ---  987:system/1000
  #3: vis    VIS  CEM 2345:com.android.phone/1001
  #4: fgs    FGS  --- 3456:com.google.android.gms/u0a89
  #5: fgs    FGS  CEM 4567:com.android.bluetooth/1002
  #6: pers   PER  --- 6789:com.android.nfc/1027
  #7: cch+75 CEM 7890:com.example.app1/u0a90
  #8: cch+80 CEM 8901:com.example.app2/u0a91
  #9: cch    CRE 9012:com.example.app3/u0a92
  #10: bfgs   BFGS LCM 1100:com.example.bfgs/u0a93
  #11: btop   BTOP CEM 1200:com.example.btop/u0a94
  #12: prev   PRV  --- 1300:com.example.prev/u0a95
`;

  it("parses all processes from LRU output", () => {
    const result = parseLruProcesses(LRU_OUTPUT);
    expect(result.length).toBe(13);
  });

  it("extracts PID and name correctly", () => {
    const result = parseLruProcesses(LRU_OUTPUT);
    expect(result[0]).toMatchObject({ pid: 1234, name: "com.android.systemui" });
    expect(result[1]).toMatchObject({ pid: 5678, name: "com.google.android.apps.nexuslauncher" });
    expect(result[2]).toMatchObject({ pid: 987, name: "system" });
  });

  it("maps OOM labels to human-readable names", () => {
    const result = parseLruProcesses(LRU_OUTPUT);
    const byPid = new Map(result.map(p => [p.pid, p]));
    expect(byPid.get(1234)!.oomLabel).toBe("Foreground"); // fg
    expect(byPid.get(987)!.oomLabel).toBe("Visible"); // vis
    expect(byPid.get(3456)!.oomLabel).toBe("FG Service"); // fgs
    expect(byPid.get(6789)!.oomLabel).toBe("Persistent"); // pers
    expect(byPid.get(7890)!.oomLabel).toBe("Cached"); // cch+75
    expect(byPid.get(8901)!.oomLabel).toBe("Cached"); // cch+80
    expect(byPid.get(9012)!.oomLabel).toBe("Cached"); // cch
    expect(byPid.get(1100)!.oomLabel).toBe("Bound FG Service"); // bfgs
    expect(byPid.get(1200)!.oomLabel).toBe("Bound Top"); // btop
    expect(byPid.get(1300)!.oomLabel).toBe("Previous"); // prev
  });

  it("strips +N suffix from OOM labels", () => {
    const result = parseLruProcesses(LRU_OUTPUT);
    const app1 = result.find(p => p.pid === 7890);
    expect(app1!.oomLabel).toBe("Cached"); // cch+75 → cch → Cached
  });

  it("deduplicates by PID", () => {
    const dupeOutput = `  #0: fg     TOP  LCM 1234:com.android.systemui/u0a45
  #1: cch    CEM 1234:com.android.systemui/u0a45
`;
    const result = parseLruProcesses(dupeOutput);
    expect(result.length).toBe(1);
  });

  it("sets memory fields to zero", () => {
    const result = parseLruProcesses(LRU_OUTPUT);
    for (const p of result) {
      expect(p.pssKb).toBe(0);
      expect(p.rssKb).toBe(0);
      expect(p.javaHeapKb).toBe(0);
      expect(p.nativeHeapKb).toBe(0);
      expect(p.graphicsKb).toBe(0);
      expect(p.codeKb).toBe(0);
    }
  });

  it("returns empty array for empty output", () => {
    expect(parseLruProcesses("")).toEqual([]);
    expect(parseLruProcesses("No processes found")).toEqual([]);
  });

  it("skips header lines", () => {
    const result = parseLruProcesses(LRU_OUTPUT);
    // Should not include "ACTIVITY MANAGER" or "Activities:" lines
    expect(result.every(p => p.pid > 0 && p.name.length > 0)).toBe(true);
  });

  it("handles single process", () => {
    const single = "  #0: top    TOP  LCM 42:com.example.app/u0a10";
    const result = parseLruProcesses(single);
    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({ pid: 42, name: "com.example.app", oomLabel: "Top" });
  });
});

// ─── parseSystemUidPs ────────────────────────────────────────────────────────

describe("parseSystemUidPs", () => {
  const PS_OUTPUT = `PID NAME
  891 system_server
 1234 com.android.systemui
 2345 surfaceflinger
 3456 servicemanager
`;

  it("parses PID and NAME from ps output", () => {
    const result = parseSystemUidPs(PS_OUTPUT, new Set());
    expect(result.length).toBe(4);
    expect(result[0]).toMatchObject({ pid: 891, name: "system_server", oomLabel: "AID_SYSTEM" });
    expect(result[1]).toMatchObject({ pid: 1234, name: "com.android.systemui" });
  });

  it("excludes PIDs in the exclude set", () => {
    const result = parseSystemUidPs(PS_OUTPUT, new Set([1234, 3456]));
    expect(result.length).toBe(2);
    expect(result.map(p => p.pid)).toEqual([891, 2345]);
  });

  it("sets memory fields to zero", () => {
    const result = parseSystemUidPs(PS_OUTPUT, new Set());
    for (const p of result) {
      expect(p.pssKb).toBe(0);
      expect(p.rssKb).toBe(0);
    }
  });

  it("returns empty array for empty output", () => {
    expect(parseSystemUidPs("", new Set())).toEqual([]);
    expect(parseSystemUidPs("PID NAME\n", new Set())).toEqual([]);
  });

  it("skips header line", () => {
    const result = parseSystemUidPs("PID NAME\n100 init\n", new Set());
    expect(result.length).toBe(1);
    expect(result[0].pid).toBe(100);
  });
});

// ─── parseProcMeminfo ───────────────────────────────────────────────────────

describe("parseProcMeminfo", () => {
  it("parses standard /proc/meminfo format", () => {
    const input = `MemTotal:       16357328 kB
MemFree:        13212984 kB
MemAvailable:   14576056 kB
Buffers:          257216 kB
Cached:          1297452 kB
SwapTotal:       4194300 kB
SwapFree:         731280 kB
`;
    const r = parseProcMeminfo(input);
    expect(r.totalRamKb).toBe(16357328);
    expect(r.freeRamKb).toBe(13212984);
    expect(r.memAvailableKb).toBe(14576056);
    expect(r.buffersKb).toBe(257216);
    expect(r.cachedKb).toBe(1297452);
    expect(r.swapTotalKb).toBe(4194300);
    expect(r.swapFreeKb).toBe(731280);
  });

  it("handles missing fields", () => {
    const input = `MemTotal:       8000000 kB
MemFree:        2000000 kB
`;
    const r = parseProcMeminfo(input);
    expect(r.totalRamKb).toBe(8000000);
    expect(r.freeRamKb).toBe(2000000);
    expect(r.memAvailableKb).toBeUndefined();
    expect(r.buffersKb).toBeUndefined();
  });

  it("returns empty object for garbage input", () => {
    expect(parseProcMeminfo("hello world\nfoo bar\n")).toEqual({});
  });
});
