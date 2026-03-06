import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the postMessage API that allows external pages to send hprof
 * buffers to ahat-web via window.postMessage.
 *
 * Protocol:
 *   1. Opener calls window.open() to open ahat-web.
 *   2. ahat-web posts { type: "ahat-ready" } to window.opener on mount.
 *   3. Opener sends { type: "open-hprof", name: string, buffer: ArrayBuffer }.
 *   4. ahat-web receives it and loads the buffer.
 *
 * These tests verify the message handler logic in isolation (no React rendering).
 */

/** Extracts the core handler logic from App's useEffect for testability. */
function makeMessageHandler(loadBuffer: (name: string, buf: ArrayBuffer) => void) {
  return (e: MessageEvent) => {
    const d = e.data;
    if (d && typeof d === "object" && d.type === "open-hprof" && d.buffer instanceof ArrayBuffer) {
      const name = typeof d.name === "string" ? d.name : "untitled";
      loadBuffer(name, d.buffer);
    }
  };
}

describe("postMessage open-hprof protocol", () => {
  let loadBuffer: ReturnType<typeof vi.fn>;
  let handler: (e: MessageEvent) => void;

  beforeEach(() => {
    loadBuffer = vi.fn();
    handler = makeMessageHandler(loadBuffer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a valid open-hprof message", () => {
    const buf = new ArrayBuffer(16);
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", name: "test.hprof", buffer: buf },
    }));
    expect(loadBuffer).toHaveBeenCalledOnce();
    expect(loadBuffer).toHaveBeenCalledWith("test.hprof", buf);
  });

  it("uses 'untitled' when name is missing", () => {
    const buf = new ArrayBuffer(8);
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", buffer: buf },
    }));
    expect(loadBuffer).toHaveBeenCalledWith("untitled", buf);
  });

  it("uses 'untitled' when name is not a string", () => {
    const buf = new ArrayBuffer(8);
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", name: 42, buffer: buf },
    }));
    expect(loadBuffer).toHaveBeenCalledWith("untitled", buf);
  });

  it("ignores messages with wrong type", () => {
    handler(new MessageEvent("message", {
      data: { type: "something-else", buffer: new ArrayBuffer(8) },
    }));
    expect(loadBuffer).not.toHaveBeenCalled();
  });

  it("ignores messages where buffer is not an ArrayBuffer", () => {
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", name: "test", buffer: "not-a-buffer" },
    }));
    expect(loadBuffer).not.toHaveBeenCalled();
  });

  it("ignores messages with buffer as Uint8Array (must be ArrayBuffer)", () => {
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", name: "test", buffer: new Uint8Array(8) },
    }));
    expect(loadBuffer).not.toHaveBeenCalled();
  });

  it("ignores null data", () => {
    handler(new MessageEvent("message", { data: null }));
    expect(loadBuffer).not.toHaveBeenCalled();
  });

  it("ignores primitive data", () => {
    handler(new MessageEvent("message", { data: "hello" }));
    expect(loadBuffer).not.toHaveBeenCalled();
  });

  it("ignores empty object", () => {
    handler(new MessageEvent("message", { data: {} }));
    expect(loadBuffer).not.toHaveBeenCalled();
  });

  it("handles zero-length ArrayBuffer", () => {
    const buf = new ArrayBuffer(0);
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", name: "empty.hprof", buffer: buf },
    }));
    expect(loadBuffer).toHaveBeenCalledWith("empty.hprof", buf);
  });

  it("handles large ArrayBuffer", () => {
    const buf = new ArrayBuffer(100 * 1024 * 1024); // 100MB
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", name: "large.hprof", buffer: buf },
    }));
    expect(loadBuffer).toHaveBeenCalledWith("large.hprof", buf);
  });

  it("processes multiple messages independently", () => {
    const buf1 = new ArrayBuffer(16);
    const buf2 = new ArrayBuffer(32);
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", name: "first.hprof", buffer: buf1 },
    }));
    handler(new MessageEvent("message", {
      data: { type: "open-hprof", name: "second.hprof", buffer: buf2 },
    }));
    expect(loadBuffer).toHaveBeenCalledTimes(2);
    expect(loadBuffer).toHaveBeenNthCalledWith(1, "first.hprof", buf1);
    expect(loadBuffer).toHaveBeenNthCalledWith(2, "second.hprof", buf2);
  });
});
