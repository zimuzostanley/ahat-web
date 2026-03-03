import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdbConnection, type ProcessInfo, type CapturePhase } from "./capture";

// ─── Mock pullFile ────────────────────────────────────────────────────────────

vi.mock("./pull", () => ({
  pullFile: vi.fn(),
  encodeSyncCmd: vi.fn(),
  decodeSyncResponse: vi.fn(),
}));

import { pullFile } from "./pull";
const mockPullFile = vi.mocked(pullFile);

// ─── Mock device factory ──────────────────────────────────────────────────────

function createMockDevice(overrides: Record<string, unknown> = {}) {
  return {
    connected: true,
    serial: "MOCK123",
    productName: "Mock Device",
    shell: vi.fn().mockResolvedValue(""),
    shellRaw: vi.fn(),
    createStream: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function setupConnected(
  deviceOverrides: Record<string, unknown> = {},
): { conn: AdbConnection; mockDevice: ReturnType<typeof createMockDevice> } {
  const conn = new AdbConnection();
  const mockDevice = createMockDevice(deviceOverrides);
  (conn as any).device = mockDevice;  // eslint-disable-line @typescript-eslint/no-explicit-any
  return { conn, mockDevice };
}

// ─── Fixture data ─────────────────────────────────────────────────────────────

const COMPACT_WITH_CATEGORIES = `time,12345,67890
proc,fore,com.android.systemui,1234,305477,N/A,e
Native Heap,50000,0,0,0,0,0
Dalvik Heap,30000,0,0,0,0,0
proc,pers,system,987,180234,N/A,e
Native Heap,40000,0,0,0,0,0
`;

const COMPACT_NO_CATEGORIES = `time,12345,67890
proc,fore,com.android.systemui,1234,305477,N/A,e
proc,pers,system,987,180234,N/A,e
`;

const REGULAR_FORMAT = `Applications Memory Usage (in Kilobytes):
Uptime: 1234567 Realtime: 1234567

Total PSS by process:
    305,477K: com.android.systemui (pid 1234)
    180,234K: system (pid 987)

Total PSS by OOM adjustment:
    305,477K: Foreground
`;

const DETAILED_SINGLE = `** MEMINFO in pid 1234 [com.android.systemui] **
                   Pss  Private  Private  SwapPss     Rss      Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    12000    11000      500        0    15000    20000    18000     2000
  Dalvik Heap     8000     7000      300        0    12000    16000    14000     2000
        Gfx dev     5000     5000        0        0     5000
     EGL mtrack     3000     3000        0        0     3000
         TOTAL    35000    30000     1000        0    40000    36000    32000     4000
`;

// ─── Tests: getProcessList ────────────────────────────────────────────────────

describe("AdbConnection.getProcessList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns compact format results when categories present", async () => {
    const { conn, mockDevice } = setupConnected();
    mockDevice.shell.mockResolvedValueOnce(COMPACT_WITH_CATEGORIES);

    const result = await conn.getProcessList();
    expect(result.length).toBe(2);
    expect(result[0].name).toBe("com.android.systemui");
    expect(result[0].nativeHeapKb).toBe(50000);
    expect(result[0].javaHeapKb).toBe(30000);
    // Only one shell call — compact had categories, no fallback
    expect(mockDevice.shell).toHaveBeenCalledTimes(1);
    expect(mockDevice.shell).toHaveBeenCalledWith("dumpsys -t 60 meminfo -c", undefined);
  });

  it("falls back to regular format when compact lacks categories", async () => {
    const { conn, mockDevice } = setupConnected();
    mockDevice.shell
      .mockResolvedValueOnce(COMPACT_NO_CATEGORIES)  // compact — no category lines
      .mockResolvedValueOnce(REGULAR_FORMAT);          // regular

    const result = await conn.getProcessList();
    expect(result.length).toBe(2);
    expect(mockDevice.shell).toHaveBeenCalledTimes(2);
  });

  it("merges OOM labels from compact into regular results", async () => {
    const { conn, mockDevice } = setupConnected();
    mockDevice.shell
      .mockResolvedValueOnce(COMPACT_NO_CATEGORIES)
      .mockResolvedValueOnce(REGULAR_FORMAT);

    const result = await conn.getProcessList();
    const sysui = result.find(p => p.pid === 1234);
    expect(sysui?.oomLabel).toBe("Foreground");
    const system = result.find(p => p.pid === 987);
    expect(system?.oomLabel).toBe("Persistent");
  });

  it("throws AbortError when signal is pre-aborted", async () => {
    const { conn, mockDevice } = setupConnected();
    const ac = new AbortController();
    ac.abort();

    await expect(conn.getProcessList(ac.signal)).rejects.toThrow("Aborted");
    expect(mockDevice.shell).not.toHaveBeenCalled();
  });

  it("throws AbortError when signal fires during shell call", async () => {
    const { conn, mockDevice } = setupConnected();
    const ac = new AbortController();
    mockDevice.shell.mockImplementation(async () => {
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    await expect(conn.getProcessList(ac.signal)).rejects.toThrow("Aborted");
  });

  it("throws when device is null", async () => {
    const conn = new AdbConnection();
    await expect(conn.getProcessList()).rejects.toThrow("Not connected");
  });
});

// ─── Tests: enrichProcessDetails ──────────────────────────────────────────────

describe("AdbConnection.enrichProcessDetails", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeProcesses(count: number): ProcessInfo[] {
    return Array.from({ length: count }, (_, i) => ({
      pid: 1000 + i,
      name: `proc${i}`,
      oomLabel: "",
      pssKb: (count - i) * 100,
      rssKb: 0,
      javaHeapKb: 0,
      nativeHeapKb: 0,
      graphicsKb: 0,
    }));
  }

  it("enriches processes with per-pid meminfo data", async () => {
    const { conn, mockDevice } = setupConnected();
    const processes = makeProcesses(1);
    mockDevice.shell.mockResolvedValueOnce(DETAILED_SINGLE);

    await conn.enrichProcessDetails(processes);

    expect(processes[0].nativeHeapKb).toBe(12000);
    expect(processes[0].javaHeapKb).toBe(8000);
    expect(processes[0].graphicsKb).toBe(8000);  // 5000 Gfx + 3000 EGL
    expect(processes[0].pssKb).toBe(35000);
    expect(processes[0].rssKb).toBe(40000);
  });

  it("reports progress for each process", async () => {
    const { conn, mockDevice } = setupConnected();
    const processes = makeProcesses(3);
    mockDevice.shell.mockResolvedValue("");

    const onProgress = vi.fn();
    await conn.enrichProcessDetails(processes, onProgress);

    // Called before each process (0/3, 1/3, 2/3) + final (3/3)
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 3, "proc0");
    expect(onProgress).toHaveBeenNthCalledWith(2, 1, 3, "proc1");
    expect(onProgress).toHaveBeenNthCalledWith(3, 2, 3, "proc2");
    expect(onProgress).toHaveBeenNthCalledWith(4, 3, 3, "");
  });

  it("stops when signal.aborted is true before iteration", async () => {
    const { conn, mockDevice } = setupConnected();
    const processes = makeProcesses(5);
    const ac = new AbortController();
    let callCount = 0;

    mockDevice.shell.mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) ac.abort();
      return "";
    });

    await conn.enrichProcessDetails(processes, undefined, ac.signal);

    // Should stop after abort — at most 2-3 shell calls (check is at loop top)
    expect(callCount).toBeLessThanOrEqual(3);
    expect(callCount).toBeLessThan(5);
  });

  it("stops when AbortError is thrown by shell", async () => {
    const { conn, mockDevice } = setupConnected();
    const processes = makeProcesses(5);
    const ac = new AbortController();

    mockDevice.shell
      .mockResolvedValueOnce("")  // first succeeds
      .mockImplementation(async () => {
        throw new DOMException("Aborted", "AbortError");
      });

    await conn.enrichProcessDetails(processes, undefined, ac.signal);

    // Should have stopped after the AbortError on the second call
    expect(mockDevice.shell).toHaveBeenCalledTimes(2);
  });

  it("skips processes that throw non-abort errors", async () => {
    const { conn, mockDevice } = setupConnected();
    const processes = makeProcesses(3);

    mockDevice.shell
      .mockResolvedValueOnce(DETAILED_SINGLE)   // proc0 succeeds
      .mockRejectedValueOnce(new Error("died")) // proc1 fails
      .mockResolvedValueOnce("");                // proc2 succeeds

    await conn.enrichProcessDetails(processes);

    // All 3 attempted despite proc1 failing
    expect(mockDevice.shell).toHaveBeenCalledTimes(3);
    expect(processes[0].nativeHeapKb).toBe(12000);
    expect(processes[1].nativeHeapKb).toBe(0);  // unchanged
  });

  it("does nothing when device is null", async () => {
    const conn = new AdbConnection();
    const processes = makeProcesses(2);
    await conn.enrichProcessDetails(processes);
    // Should not throw, processes unchanged
    expect(processes[0].nativeHeapKb).toBe(0);
  });
});

// ─── Tests: captureHeapDump ───────────────────────────────────────────────────

describe("AdbConnection.captureHeapDump", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPullFile.mockReset();
  });

  it("reports progress through all phases", async () => {
    const { conn, mockDevice } = setupConnected();
    const phases: string[] = [];

    // Shell calls: dumpheap, then stat calls
    let statCall = 0;
    mockDevice.shell.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("am dumpheap")) return "";
      if (cmd.startsWith("stat")) {
        statCall++;
        // Return stable size after 3 calls
        return statCall >= 1 ? "12345" : "-1";
      }
      if (cmd.startsWith("rm")) return "";
      return "";
    });

    // Mock pullFile to return some data
    const hprofData = new Uint8Array(100).fill(0x42);
    mockPullFile.mockImplementation(async (_dev, _path, onProgress) => {
      onProgress?.(50, 100);
      onProgress?.(100, 100);
      return hprofData;
    });

    const onProgress = vi.fn((phase: CapturePhase) => {
      phases.push(phase.step);
    });

    const result = await conn.captureHeapDump(1234, false, onProgress);

    expect(phases).toContain("dumping");
    expect(phases).toContain("waiting");
    expect(phases).toContain("pulling");
    expect(phases).toContain("cleaning");
    expect(phases).toContain("done");
    expect(new Uint8Array(result)).toEqual(hprofData);
  }, 30_000);

  it("throws AbortError during wait phase and cleans up", async () => {
    const { conn, mockDevice } = setupConnected();
    const ac = new AbortController();

    mockDevice.shell.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("am dumpheap")) return "";
      if (cmd.startsWith("rm")) return "";
      return "-1";  // stat returns -1, keep waiting
    });

    // Abort after a short delay
    setTimeout(() => ac.abort(), 100);

    await expect(conn.captureHeapDump(1234, false, undefined, ac.signal))
      .rejects.toThrow("Aborted");

    // Verify cleanup was attempted (rm command)
    const rmCalls = mockDevice.shell.mock.calls.filter(
      (c: string[]) => c[0].startsWith("rm"),
    );
    expect(rmCalls.length).toBe(1);
  }, 10_000);

  it("passes signal to pullFile", async () => {
    const { conn, mockDevice } = setupConnected();
    const ac = new AbortController();

    let statCall = 0;
    mockDevice.shell.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("am dumpheap")) return "";
      if (cmd.startsWith("stat")) {
        statCall++;
        return "5000";
      }
      if (cmd.startsWith("rm")) return "";
      return "";
    });

    mockPullFile.mockResolvedValue(new Uint8Array(10));

    await conn.captureHeapDump(1234, false, undefined, ac.signal);

    // Verify pullFile was called with signal
    expect(mockPullFile).toHaveBeenCalledTimes(1);
    const pullArgs = mockPullFile.mock.calls[0];
    expect(pullArgs[3]).toBe(ac.signal);  // 4th arg is signal
  }, 30_000);

  it("uses -b png flag when withBitmaps is true", async () => {
    const { conn, mockDevice } = setupConnected();

    let statCall = 0;
    mockDevice.shell.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith("am dumpheap")) return "";
      if (cmd.startsWith("stat")) {
        statCall++;
        return "5000";
      }
      if (cmd.startsWith("rm")) return "";
      return "";
    });

    mockPullFile.mockResolvedValue(new Uint8Array(10));

    await conn.captureHeapDump(1234, true);

    const dumpCall = mockDevice.shell.mock.calls.find(
      (c: string[]) => c[0].startsWith("am dumpheap"),
    );
    expect(dumpCall?.[0]).toContain("-b png");
  }, 30_000);

  it("throws when not connected", async () => {
    const conn = new AdbConnection();
    await expect(conn.captureHeapDump(1234, false)).rejects.toThrow("Not connected");
  });
});
