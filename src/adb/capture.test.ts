import { describe, it, expect } from "vitest";
import { parseMemInfo } from "./capture";

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Summary-only output from `dumpsys meminfo --sort-by-pss`
const SUMMARY_OUTPUT = `Applications Memory Usage (in Kilobytes):
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

const SUMMARY_SIMPLE = `Total PSS by process:
    100K: simple_app (pid 42)
    50K: another (pid 43)
`;

// Detailed per-process output from `dumpsys meminfo` (no --sort-by-pss)
const DETAILED_OUTPUT = `Applications Memory Usage (in Kilobytes):
Uptime: 1234567 Realtime: 1234567

** MEMINFO in pid 1974 [com.android.systemui] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    16840    16804        0     6764    19428    34024    25037     5553
  Dalvik Heap     9110     9032        0      136    13164    36444     9111    27333
 Dalvik Other     2345     2345        0        0     2345
        Stack      456      456        0        0      600
       Ashmem      123      123        0        0      123
      Gfx dev     5502     5502        0        0     5502
    Other dev       12       12        0        0       12
     .so mmap     4321      123     4198        0     8765
    .apk mmap     1234        0     1234        0     2345
    .dex mmap     3456        0     3456        0     3456
    .oat mmap      890        0      890        0      890
    .art mmap     2345     2345        0        0     3456
   Other mmap      234      234        0        0      234
   EGL mtrack      800      800        0        0      800
    GL mtrack     1200     1200        0        0     1200
      Unknown     1234     1234        0        0     1234
        TOTAL    50102    40210    9778     6900    63554    70468    34148    32886

** MEMINFO in pid 5678 [com.google.android.gms] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    25000    24900        0     1234    28000    40000    30000     8000
  Dalvik Heap    15000    14800        0      500    18000    50000    15000    35000
 Dalvik Other     3000     3000        0        0     3000
        Stack      800      800        0        0     1000
      Gfx dev        0        0        0        0        0
   EGL mtrack        0        0        0        0        0
    GL mtrack        0        0        0        0        0
      Unknown     2000     2000        0        0     2000
        TOTAL    45800    45500    0     1734    52000    90000    45000    43000

Total PSS by process:
    305,477K: com.android.systemui (pid 1974)
    204,891K: com.google.android.gms (pid 5678)

Total PSS by OOM adjustment:
    305,477K: Foreground
`;

// Edge case: detailed section without trailing summary
const DETAILED_NO_SUMMARY = `** MEMINFO in pid 100 [logd] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap     1000     1000        0        0     1200     2000     1500      500
  Dalvik Heap        0        0        0        0        0        0        0        0
      Gfx dev        0        0        0        0        0
        TOTAL     1234     1000        0        0     1500     2000     1500      500
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseMemInfo", () => {
  describe("summary-only output (--sort-by-pss)", () => {
    it("parses process list from summary output", () => {
      const result = parseMemInfo(SUMMARY_OUTPUT);
      expect(result.length).toBe(10);
      expect(result[0]).toMatchObject({ pid: 1234, name: "com.android.systemui", pssKb: 305477 });
      expect(result[1]).toMatchObject({ pid: 5678, name: "com.google.android.gms", pssKb: 204891 });
    });

    it("returns results sorted by PSS descending", () => {
      const result = parseMemInfo(SUMMARY_OUTPUT);
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].pssKb).toBeGreaterThanOrEqual(result[i].pssKb);
      }
    });

    it("handles comma-separated numbers correctly", () => {
      const result = parseMemInfo(SUMMARY_OUTPUT);
      const systemui = result.find(p => p.name === "com.android.systemui");
      expect(systemui?.pssKb).toBe(305477);
    });

    it("handles simple output", () => {
      const result = parseMemInfo(SUMMARY_SIMPLE);
      expect(result.length).toBe(2);
      expect(result[0]).toMatchObject({ pid: 42, name: "simple_app", pssKb: 100 });
      expect(result[1]).toMatchObject({ pid: 43, name: "another", pssKb: 50 });
    });

    it("returns empty array for empty output", () => {
      expect(parseMemInfo("")).toEqual([]);
      expect(parseMemInfo("No processes found")).toEqual([]);
    });

    it("stops at empty line after process section", () => {
      const result = parseMemInfo(SUMMARY_OUTPUT);
      expect(result.every(p => typeof p.pid === "number" && p.pid > 0)).toBe(true);
      expect(result.length).toBe(10);
    });

    it("parses processes without dots in name (like logd)", () => {
      const result = parseMemInfo(SUMMARY_OUTPUT);
      const logd = result.find(p => p.name === "logd");
      expect(logd).toBeDefined();
      expect(logd?.pid).toBe(100);
      expect(logd?.pssKb).toBe(1234);
    });

    it("sets detailed fields to 0 when only summary is available", () => {
      const result = parseMemInfo(SUMMARY_OUTPUT);
      for (const p of result) {
        expect(p.rssKb).toBe(0);
        expect(p.javaHeapKb).toBe(0);
        expect(p.nativeHeapKb).toBe(0);
        expect(p.graphicsKb).toBe(0);
      }
    });
  });

  describe("detailed per-process output (dumpsys meminfo)", () => {
    it("parses per-process MEMINFO sections", () => {
      const result = parseMemInfo(DETAILED_OUTPUT);
      expect(result.length).toBe(2);
    });

    it("extracts PSS and RSS from TOTAL line", () => {
      const result = parseMemInfo(DETAILED_OUTPUT);
      const systemui = result.find(p => p.name === "com.android.systemui")!;
      expect(systemui.pssKb).toBe(50102);
      expect(systemui.rssKb).toBe(63554);
    });

    it("extracts Java (Dalvik) heap PSS", () => {
      const result = parseMemInfo(DETAILED_OUTPUT);
      const systemui = result.find(p => p.name === "com.android.systemui")!;
      expect(systemui.javaHeapKb).toBe(9110);
    });

    it("extracts Native heap PSS", () => {
      const result = parseMemInfo(DETAILED_OUTPUT);
      const systemui = result.find(p => p.name === "com.android.systemui")!;
      expect(systemui.nativeHeapKb).toBe(16840);
    });

    it("sums graphics PSS from Gfx dev + EGL mtrack + GL mtrack", () => {
      const result = parseMemInfo(DETAILED_OUTPUT);
      const systemui = result.find(p => p.name === "com.android.systemui")!;
      // 5502 (Gfx dev) + 800 (EGL) + 1200 (GL) = 7502
      expect(systemui.graphicsKb).toBe(7502);
    });

    it("handles zero graphics correctly", () => {
      const result = parseMemInfo(DETAILED_OUTPUT);
      const gms = result.find(p => p.name === "com.google.android.gms")!;
      expect(gms.graphicsKb).toBe(0);
    });

    it("sorts results by PSS descending", () => {
      const result = parseMemInfo(DETAILED_OUTPUT);
      expect(result[0].name).toBe("com.android.systemui");
      expect(result[1].name).toBe("com.google.android.gms");
    });

    it("prefers detailed sections over summary when both present", () => {
      const result = parseMemInfo(DETAILED_OUTPUT);
      // Detailed sections have different PSS values than the summary
      // (summary says 305,477K but detailed TOTAL says 50102)
      const systemui = result.find(p => p.name === "com.android.systemui")!;
      expect(systemui.pssKb).toBe(50102);
      expect(systemui.nativeHeapKb).toBe(16840); // detail only
    });

    it("handles trailing section without summary", () => {
      const result = parseMemInfo(DETAILED_NO_SUMMARY);
      expect(result.length).toBe(1);
      expect(result[0]).toMatchObject({
        pid: 100,
        name: "logd",
        pssKb: 1234,
        rssKb: 1500,
        nativeHeapKb: 1000,
        javaHeapKb: 0,
        graphicsKb: 0,
      });
    });
  });
});
