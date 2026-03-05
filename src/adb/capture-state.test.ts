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


// ─── Tests: getLruProcesses ──────────────────────────────────────────────────

describe("AdbConnection.getLruProcesses", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed LRU process list", async () => {
    const { conn, mockDevice } = setupConnected();
    mockDevice.shell.mockResolvedValueOnce(
      "  #0: fg     TOP  LCM 1234:com.android.systemui/u0a45\n" +
      "  #1: cch    CEM 5678:com.example.app/u0a67\n"
    );

    const result = await conn.getLruProcesses();
    expect(result.length).toBe(2);
    expect(result[0]).toMatchObject({ pid: 1234, name: "com.android.systemui", oomLabel: "Foreground" });
    expect(result[1]).toMatchObject({ pid: 5678, name: "com.example.app", oomLabel: "Cached" });
    expect(mockDevice.shell).toHaveBeenCalledWith("dumpsys activity lru", undefined);
  });

  it("throws AbortError when signal is pre-aborted", async () => {
    const { conn, mockDevice } = setupConnected();
    const ac = new AbortController();
    ac.abort();

    await expect(conn.getLruProcesses(ac.signal)).rejects.toThrow("Aborted");
    expect(mockDevice.shell).not.toHaveBeenCalled();
  });

  it("throws when device is null", async () => {
    const conn = new AdbConnection();
    await expect(conn.getLruProcesses()).rejects.toThrow("Not connected");
  });
});

// ─── Test data factory ───────────────────────────────────────────────────────

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
    codeKb: 0,
  }));
}


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

// ─── Fixture: smaps output ───────────────────────────────────────────────────

const SMAPS_OUTPUT = `7f1234000-7f1235000 r-xp 00000000 fd:01 100  /system/lib64/libart.so
Size:                  4 kB
Rss:                   4 kB
Pss:                   2 kB
Shared_Clean:          4 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:         0 kB
Swap:                  0 kB
SwapPss:               0 kB
7f2000000-7f2100000 rw-p 00000000 00:00 0      [anon:libc_malloc]
Size:               1024 kB
Rss:                 512 kB
Pss:                 512 kB
Shared_Clean:          0 kB
Shared_Dirty:          0 kB
Private_Clean:         0 kB
Private_Dirty:       512 kB
Swap:                  0 kB
SwapPss:               0 kB
`;

// ─── Tests: getSmapsForPid ───────────────────────────────────────────────────

describe("AdbConnection.getSmapsForPid", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed smaps entries for a valid pid", async () => {
    const { conn, mockDevice } = setupConnected();
    (conn as any)._isRoot = true;      // eslint-disable-line @typescript-eslint/no-explicit-any
    (conn as any)._suPrefix = "su 0";  // eslint-disable-line @typescript-eslint/no-explicit-any
    mockDevice.shell.mockResolvedValueOnce(SMAPS_OUTPUT);

    const entries = await conn.getSmapsForPid(1234);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe("/system/lib64/libart.so");
    expect(entries[0].pssKb).toBe(2);
    expect(entries[1].name).toBe("[anon:libc_malloc]");
    expect(entries[1].pssKb).toBe(512);
    expect(mockDevice.shell).toHaveBeenCalledWith("su 0 cat /proc/1234/smaps", undefined);
  });

  it("uses su -c variant when that prefix was detected", async () => {
    const { conn, mockDevice } = setupConnected();
    (conn as any)._isRoot = true;       // eslint-disable-line @typescript-eslint/no-explicit-any
    (conn as any)._suPrefix = "su -c";  // eslint-disable-line @typescript-eslint/no-explicit-any
    mockDevice.shell.mockResolvedValueOnce("");

    await conn.getSmapsForPid(999);
    expect(mockDevice.shell).toHaveBeenCalledWith("su -c 'cat /proc/999/smaps'", undefined);
  });

  it("throws AbortError when signal is pre-aborted", async () => {
    const { conn } = setupConnected();
    (conn as any)._isRoot = true;  // eslint-disable-line @typescript-eslint/no-explicit-any
    const ac = new AbortController();
    ac.abort();

    await expect(conn.getSmapsForPid(1234, ac.signal)).rejects.toThrow("Aborted");
  });

  it("throws when device is null", async () => {
    const conn = new AdbConnection();
    await expect(conn.getSmapsForPid(1234)).rejects.toThrow("Not connected");
  });
});

// ─── Tests: fetchAllSmaps ────────────────────────────────────────────────────

describe("AdbConnection.fetchAllSmaps", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function setupRooted(deviceOverrides: Record<string, unknown> = {}) {
    const { conn, mockDevice } = setupConnected(deviceOverrides);
    (conn as any)._isRoot = true;      // eslint-disable-line @typescript-eslint/no-explicit-any
    (conn as any)._suPrefix = "su 0";  // eslint-disable-line @typescript-eslint/no-explicit-any
    return { conn, mockDevice };
  }

  it("fetches smaps in PSS-descending order", async () => {
    const { conn, mockDevice } = setupRooted();
    const processes = makeProcesses(3); // pssKb: 300, 200, 100
    const fetchedPids: number[] = [];

    mockDevice.shell.mockImplementation(async (cmd: string) => {
      const m = cmd.match(/\/proc\/(\d+)\/smaps/);
      if (m) fetchedPids.push(parseInt(m[1], 10));
      return SMAPS_OUTPUT;
    });

    await conn.fetchAllSmaps(processes);

    // Should be fetched in PSS-desc order: pid 1000 (300), 1001 (200), 1002 (100)
    expect(fetchedPids).toEqual([1000, 1001, 1002]);
  });

  it("calls onData for each process with aggregated data", async () => {
    const { conn, mockDevice } = setupRooted();
    const processes = makeProcesses(2);
    mockDevice.shell.mockResolvedValue(SMAPS_OUTPUT);

    const onData = vi.fn();
    await conn.fetchAllSmaps(processes, onData);

    expect(onData).toHaveBeenCalledTimes(2);
    // First call: biggest PSS process (pid 1000)
    expect(onData.mock.calls[0][0]).toBe(1000);
    const agg = onData.mock.calls[0][1];
    expect(agg).toHaveLength(2); // libart + libc_malloc
  });

  it("calls onProgress for each process", async () => {
    const { conn, mockDevice } = setupRooted();
    const processes = makeProcesses(3);
    mockDevice.shell.mockResolvedValue(SMAPS_OUTPUT);

    const onProgress = vi.fn();
    await conn.fetchAllSmaps(processes, undefined, onProgress);

    // 3 progress calls + 1 final
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenNthCalledWith(1, 0, 3, "proc0");
    expect(onProgress).toHaveBeenNthCalledWith(4, 3, 3, "");
  });

  it("stops when signal is aborted", async () => {
    const { conn, mockDevice } = setupRooted();
    const processes = makeProcesses(5);
    const ac = new AbortController();
    let callCount = 0;

    mockDevice.shell.mockImplementation(async () => {
      callCount++;
      if (callCount >= 2) ac.abort();
      return SMAPS_OUTPUT;
    });

    await conn.fetchAllSmaps(processes, undefined, undefined, ac.signal);
    expect(callCount).toBeLessThan(5);
  });

  it("skips processes that throw non-abort errors", async () => {
    const { conn, mockDevice } = setupRooted();
    const processes = makeProcesses(3);

    mockDevice.shell
      .mockResolvedValueOnce(SMAPS_OUTPUT)       // proc0 OK
      .mockRejectedValueOnce(new Error("died"))  // proc1 fails
      .mockResolvedValueOnce(SMAPS_OUTPUT);      // proc2 OK

    const onData = vi.fn();
    await conn.fetchAllSmaps(processes, onData);

    // proc0 and proc2 succeeded, proc1 skipped
    expect(onData).toHaveBeenCalledTimes(2);
    expect(mockDevice.shell).toHaveBeenCalledTimes(3);
  });

  it("returns immediately when not root", async () => {
    const { conn, mockDevice } = setupConnected();
    // _isRoot defaults to false
    const processes = makeProcesses(3);
    const onData = vi.fn();

    await conn.fetchAllSmaps(processes, onData);
    expect(onData).not.toHaveBeenCalled();
    expect(mockDevice.shell).not.toHaveBeenCalled();
  });

  it("returns immediately when device is null", async () => {
    const conn = new AdbConnection();
    const onData = vi.fn();
    await conn.fetchAllSmaps(makeProcesses(1), onData);
    expect(onData).not.toHaveBeenCalled();
  });
});


// ─── Tests: getSmapsRollups ──────────────────────────────────────────────────

describe("AdbConnection.getSmapsRollups", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches rollups for all PIDs in a single batch", async () => {
    const { conn, mockDevice } = setupConnected();
    (conn as any)._isRoot = true;
    (conn as any)._suPrefix = "su 0";
    mockDevice.shell.mockResolvedValueOnce(
      `===PID:100===\nRss: 5000 kB\nPss: 3000 kB\nShared_Clean: 1000 kB\nShared_Dirty: 200 kB\nPrivate_Clean: 800 kB\nPrivate_Dirty: 1000 kB\nSwap: 50 kB\nSwapPss: 25 kB\n` +
      `===PID:200===\nRss: 2000 kB\nPss: 1500 kB\nShared_Clean: 500 kB\nShared_Dirty: 0 kB\nPrivate_Clean: 500 kB\nPrivate_Dirty: 500 kB\nSwap: 0 kB\nSwapPss: 0 kB\n`
    );

    const result = await conn.getSmapsRollups([100, 200]);
    expect(result.size).toBe(2);
    expect(result.get(100)!.pssKb).toBe(3000);
    expect(result.get(200)!.pssKb).toBe(1500);
    expect(mockDevice.shell).toHaveBeenCalledTimes(1);
    expect(mockDevice.shell.mock.calls[0][0]).toContain("for p in 100 200");
  });

  it("returns empty map when not root", async () => {
    const { conn } = setupConnected();
    (conn as any)._isRoot = false;
    const result = await conn.getSmapsRollups([100, 200]);
    expect(result.size).toBe(0);
  });

  it("returns empty map when device is null", async () => {
    const conn = new AdbConnection();
    const result = await conn.getSmapsRollups([100]);
    expect(result.size).toBe(0);
  });

  it("returns empty map for empty pid list", async () => {
    const { conn } = setupConnected();
    (conn as any)._isRoot = true;
    const result = await conn.getSmapsRollups([]);
    expect(result.size).toBe(0);
  });

  it("throws AbortError when signal is pre-aborted", async () => {
    const { conn } = setupConnected();
    (conn as any)._isRoot = true;
    (conn as any)._suPrefix = "su 0";
    const ac = new AbortController();
    ac.abort();
    await expect(conn.getSmapsRollups([100], ac.signal)).rejects.toThrow("Aborted");
  });

  it("uses su -c variant when that prefix was detected", async () => {
    const { conn, mockDevice } = setupConnected();
    (conn as any)._isRoot = true;
    (conn as any)._suPrefix = "su -c";
    mockDevice.shell.mockResolvedValueOnce("===PID:1===\nRss: 100 kB\nPss: 50 kB\nShared_Clean: 0 kB\nShared_Dirty: 0 kB\nPrivate_Clean: 0 kB\nPrivate_Dirty: 50 kB\nSwap: 0 kB\nSwapPss: 0 kB\n");

    await conn.getSmapsRollups([1]);
    expect(mockDevice.shell.mock.calls[0][0]).toMatch(/^su -c '/);
  });
});
