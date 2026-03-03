import { describe, it, expect } from "vitest";
import { parseMemInfo } from "./capture";

// Real output from `dumpsys meminfo --sort-by-pss` on a Pixel device
const MEMINFO_OUTPUT = `Applications Memory Usage (in Kilobytes):
Uptime: 1234567 Realtime: 1234567

Total PSS by process:
    305,477K: com.android.systemui (pid 1234)
    204,891K: com.google.android.gms (pid 5678)
    180,234K: system (pid 987)
    95,123K: com.google.android.apps.nexuslauncher (pid 2345)
    72,456K: com.android.phone (pid 3456)
    45,678K: com.google.android.inputmethod.latin (pid 4567)
    12,345K: com.android.providers.media (pid 6789)
    8,901K: com.android.bluetooth (pid 7890)
    5,432K: com.android.nfc (pid 8901)
    1,234K: logd (pid 100)

Total PSS by OOM adjustment:
    305,477K: Foreground
    204,891K: Visible
`;

const MEMINFO_SIMPLE = `Total PSS by process:
    100K: simple_app (pid 42)
    50K: another (pid 43)
`;

describe("parseMemInfo", () => {
  it("parses process list from dumpsys meminfo output", () => {
    const result = parseMemInfo(MEMINFO_OUTPUT);
    expect(result.length).toBe(10);
    expect(result[0]).toEqual({ pid: 1234, name: "com.android.systemui", pssKb: 305477 });
    expect(result[1]).toEqual({ pid: 5678, name: "com.google.android.gms", pssKb: 204891 });
    expect(result[2]).toEqual({ pid: 987, name: "system", pssKb: 180234 });
  });

  it("returns results sorted by PSS descending", () => {
    const result = parseMemInfo(MEMINFO_OUTPUT);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].pssKb).toBeGreaterThanOrEqual(result[i].pssKb);
    }
  });

  it("handles comma-separated numbers correctly", () => {
    const result = parseMemInfo(MEMINFO_OUTPUT);
    const systemui = result.find(p => p.name === "com.android.systemui");
    expect(systemui?.pssKb).toBe(305477);
  });

  it("handles simple output", () => {
    const result = parseMemInfo(MEMINFO_SIMPLE);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ pid: 42, name: "simple_app", pssKb: 100 });
    expect(result[1]).toEqual({ pid: 43, name: "another", pssKb: 50 });
  });

  it("returns empty array for empty output", () => {
    expect(parseMemInfo("")).toEqual([]);
    expect(parseMemInfo("No processes found")).toEqual([]);
  });

  it("stops at empty line after process section", () => {
    const result = parseMemInfo(MEMINFO_OUTPUT);
    // Should not include entries from "Total PSS by OOM adjustment"
    expect(result.every(p => typeof p.pid === "number" && p.pid > 0)).toBe(true);
    expect(result.length).toBe(10);
  });

  it("parses processes without dots in name (like logd)", () => {
    const result = parseMemInfo(MEMINFO_OUTPUT);
    const logd = result.find(p => p.name === "logd");
    expect(logd).toBeDefined();
    expect(logd?.pid).toBe(100);
    expect(logd?.pssKb).toBe(1234);
  });
});
