import { describe, it, expect, vi } from "vitest";
import { pullFile, encodeSyncCmd } from "./pull";

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const textEnc = new TextEncoder();

/** Build a DATA sync response: "DATA" + u32le(length) + payload */
function buildDataResponse(payload: Uint8Array): Uint8Array {
  const hdr = encodeSyncCmd("DATA", payload.length);
  const buf = new Uint8Array(hdr.length + payload.length);
  buf.set(hdr, 0);
  buf.set(payload, hdr.length);
  return buf;
}

/** Build a DONE sync response. */
function buildDoneResponse(): Uint8Array {
  return encodeSyncCmd("DONE", 0);
}

/** Build a FAIL sync response: "FAIL" + u32le(msgLen) + message */
function buildFailResponse(message: string): Uint8Array {
  const msgBytes = textEnc.encode(message);
  const hdr = encodeSyncCmd("FAIL", msgBytes.length);
  const buf = new Uint8Array(hdr.length + msgBytes.length);
  buf.set(hdr, 0);
  buf.set(msgBytes, hdr.length);
  return buf;
}

interface MockStream {
  onData: (data: Uint8Array) => void;
  onClose: () => void;
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  connected: boolean;
  localId: number;
  remoteId: number;
  pushData(data: Uint8Array): void;
  pushClose(): void;
}

function createMockStream(): MockStream {
  let onDataFn: (data: Uint8Array) => void = () => {};
  let onCloseFn: () => void = () => {};
  return {
    get onData() { return onDataFn; },
    set onData(fn: (data: Uint8Array) => void) { onDataFn = fn; },
    get onClose() { return onCloseFn; },
    set onClose(fn: () => void) { onCloseFn = fn; },
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    connected: true,
    localId: 1,
    remoteId: 1,
    pushData(data: Uint8Array) { onDataFn(data); },
    pushClose() { onCloseFn(); },
  };
}

function createMockDevice(shellReturn = "1000") {
  const stream = createMockStream();
  return {
    device: {
      connected: true,
      serial: "TEST123",
      productName: "Test Device",
      shell: vi.fn().mockResolvedValue(shellReturn),
      shellRaw: vi.fn(),
      createStream: vi.fn().mockResolvedValue(stream),
      close: vi.fn(),
    } as any,  // eslint-disable-line @typescript-eslint/no-explicit-any
    stream,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("pullFile", () => {
  it("rejects immediately if signal already aborted", async () => {
    const { device } = createMockDevice();
    const ac = new AbortController();
    ac.abort();
    await expect(pullFile(device, "/data/test.hprof", undefined, ac.signal))
      .rejects.toThrow("Aborted");
    expect(device.shell).not.toHaveBeenCalled();
  });

  it("happy path: stat → RECV → single DATA → DONE", async () => {
    const { device, stream } = createMockDevice("4096");

    const resultPromise = pullFile(device, "/data/test.hprof");

    // Wait for stat + createStream to complete
    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalled();
    });

    // Verify stat was called
    expect(device.shell).toHaveBeenCalledWith(
      "stat -c %s '/data/test.hprof'",
      undefined,
    );

    // Simulate device response: DATA(4 bytes) + DONE
    const payload = new Uint8Array([0xCA, 0xFE, 0xBA, 0xBE]);
    stream.pushData(buildDataResponse(payload));
    stream.pushData(buildDoneResponse());

    const result = await resultPromise;
    expect(result).toEqual(payload);
    expect(stream.close).toHaveBeenCalled();
  });

  it("calls onProgress with received bytes and total from stat", async () => {
    const { device, stream } = createMockDevice("100");
    const onProgress = vi.fn();

    const resultPromise = pullFile(device, "/data/test.hprof", onProgress);

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalled();
    });

    // Two DATA chunks then DONE
    const chunk1 = new Uint8Array(50).fill(0x01);
    const chunk2 = new Uint8Array(50).fill(0x02);
    stream.pushData(buildDataResponse(chunk1));
    stream.pushData(buildDataResponse(chunk2));
    stream.pushData(buildDoneResponse());

    await resultPromise;
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 50, 100);
    expect(onProgress).toHaveBeenNthCalledWith(2, 100, 100);
  });

  it("handles FAIL response with error message", async () => {
    const { device, stream } = createMockDevice("0");

    const resultPromise = pullFile(device, "/data/nonexistent");

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalled();
    });

    stream.pushData(buildFailResponse("No such file or directory"));

    await expect(resultPromise).rejects.toThrow("ADB sync FAIL: No such file or directory");
  });

  it("resolves with partial data on stream close before DONE", async () => {
    const { device, stream } = createMockDevice("-1");

    const resultPromise = pullFile(device, "/data/test.hprof");

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalled();
    });

    const payload = new Uint8Array([1, 2, 3, 4]);
    stream.pushData(buildDataResponse(payload));
    stream.pushClose();

    const result = await resultPromise;
    expect(result).toEqual(payload);
  });

  it("aborts mid-transfer when signal fires", async () => {
    const { device, stream } = createMockDevice("1000");
    const ac = new AbortController();

    const resultPromise = pullFile(device, "/data/test.hprof", undefined, ac.signal);

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalled();
    });

    // First data chunk arrives fine
    stream.pushData(buildDataResponse(new Uint8Array(500).fill(0x01)));

    // Abort before transfer completes
    ac.abort();

    await expect(resultPromise).rejects.toThrow("Aborted");
    expect(stream.close).toHaveBeenCalled();
  });

  it("works when stat fails (fileSize = -1)", async () => {
    const { device, stream } = createMockDevice();
    device.shell.mockRejectedValueOnce(new Error("stat failed"));

    const onProgress = vi.fn();
    const resultPromise = pullFile(device, "/data/test.hprof", onProgress);

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalled();
    });

    const payload = new Uint8Array([0xDE, 0xAD]);
    stream.pushData(buildDataResponse(payload));
    stream.pushData(buildDoneResponse());

    const result = await resultPromise;
    expect(result).toEqual(payload);
    // Progress reports -1 as total since stat failed
    expect(onProgress).toHaveBeenCalledWith(2, -1);
  });

  it("assembles multiple DATA chunks before DONE", async () => {
    const { device, stream } = createMockDevice("300");

    const resultPromise = pullFile(device, "/data/test.hprof");

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalled();
    });

    const chunk1 = new Uint8Array(100).fill(0xAA);
    const chunk2 = new Uint8Array(100).fill(0xBB);
    const chunk3 = new Uint8Array(100).fill(0xCC);
    stream.pushData(buildDataResponse(chunk1));
    stream.pushData(buildDataResponse(chunk2));
    stream.pushData(buildDataResponse(chunk3));
    stream.pushData(buildDoneResponse());

    const result = await resultPromise;
    expect(result.length).toBe(300);
    expect(result.slice(0, 100)).toEqual(chunk1);
    expect(result.slice(100, 200)).toEqual(chunk2);
    expect(result.slice(200, 300)).toEqual(chunk3);
  });

  it("aborts during stat when signal fires", async () => {
    const ac = new AbortController();
    const { device } = createMockDevice();
    device.shell.mockImplementation(async () => {
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    await expect(pullFile(device, "/data/test.hprof", undefined, ac.signal))
      .rejects.toThrow("Aborted");
    expect(device.createStream).not.toHaveBeenCalled();
  });
});
