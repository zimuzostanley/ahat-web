import { describe, it, expect } from "vitest";
import { fmtSize, fmtHex, deltaBgClass, fmtDelta, fmtSizeDelta, deltaBgClassBytes } from "./format";

describe("fmtSize", () => {
  it("zero", () => expect(fmtSize(0)).toBe("0"));
  it("small bytes", () => expect(fmtSize(1)).toBe("1"));
  it("999 bytes", () => expect(fmtSize(999)).toBe("999"));
  it("1023 bytes (just below KiB)", () => expect(fmtSize(1023)).toBe("1,023"));
  it("1024 bytes = 1.0 KiB", () => expect(fmtSize(1024)).toBe("1.0 KiB"));
  it("1025 bytes", () => expect(fmtSize(1025)).toBe("1.0 KiB"));
  it("10240 bytes = 10.0 KiB", () => expect(fmtSize(10240)).toBe("10.0 KiB"));
  it("1_048_575 bytes (just below MiB)", () => expect(fmtSize(1_048_575)).toBe("1024.0 KiB"));
  it("1_048_576 bytes = 1.0 MiB", () => expect(fmtSize(1_048_576)).toBe("1.0 MiB"));
  it("10_485_760 bytes = 10.0 MiB", () => expect(fmtSize(10_485_760)).toBe("10.0 MiB"));
  it("1_073_741_823 bytes (just below GiB)", () => expect(fmtSize(1_073_741_823)).toBe("1024.0 MiB"));
  it("1_073_741_824 bytes = 1.0 GiB", () => expect(fmtSize(1_073_741_824)).toBe("1.0 GiB"));
  it("5 GiB", () => expect(fmtSize(5 * 1_073_741_824)).toBe("5.0 GiB"));
  it("large value (100 GiB)", () => expect(fmtSize(100 * 1_073_741_824)).toBe("100.0 GiB"));
});

describe("fmtHex", () => {
  it("zero", () => expect(fmtHex(0)).toBe("0x00000000"));
  it("one", () => expect(fmtHex(1)).toBe("0x00000001"));
  it("0xFF", () => expect(fmtHex(0xFF)).toBe("0x000000ff"));
  it("0xDEADBEEF", () => expect(fmtHex(0xDEADBEEF)).toBe("0xdeadbeef"));
  it("max 32-bit", () => expect(fmtHex(0xFFFFFFFF)).toBe("0xffffffff"));
  it("small number pads to 8 chars", () => {
    const result = fmtHex(16);
    expect(result).toBe("0x00000010");
    expect(result.length).toBe(10); // "0x" + 8 hex chars
  });
});

describe("deltaBgClass", () => {
  // Zero
  it("zero returns empty", () => expect(deltaBgClass(0)).toBe(""));

  // Positive (increases = red)
  it("+999 KiB returns empty (below threshold)", () => expect(deltaBgClass(999)).toBe(""));
  it("+1000 KiB = bg-red-50", () => expect(deltaBgClass(1_000)).toBe("bg-red-50 dark:bg-red-950"));
  it("+9999 KiB = bg-red-50", () => expect(deltaBgClass(9_999)).toBe("bg-red-50 dark:bg-red-950"));
  it("+10000 KiB = bg-red-100", () => expect(deltaBgClass(10_000)).toBe("bg-red-100 dark:bg-red-900/50"));
  it("+49999 KiB = bg-red-100", () => expect(deltaBgClass(49_999)).toBe("bg-red-100 dark:bg-red-900/50"));
  it("+50000 KiB = bg-red-200", () => expect(deltaBgClass(50_000)).toBe("bg-red-200 dark:bg-red-900"));
  it("+100000 KiB = bg-red-200", () => expect(deltaBgClass(100_000)).toBe("bg-red-200 dark:bg-red-900"));

  // Negative (decreases = green)
  it("-999 KiB returns empty", () => expect(deltaBgClass(-999)).toBe(""));
  it("-1000 KiB = bg-green-50", () => expect(deltaBgClass(-1_000)).toBe("bg-green-50 dark:bg-green-950"));
  it("-9999 KiB = bg-green-50", () => expect(deltaBgClass(-9_999)).toBe("bg-green-50 dark:bg-green-950"));
  it("-10000 KiB = bg-green-100", () => expect(deltaBgClass(-10_000)).toBe("bg-green-100 dark:bg-green-900/50"));
  it("-49999 KiB = bg-green-100", () => expect(deltaBgClass(-49_999)).toBe("bg-green-100 dark:bg-green-900/50"));
  it("-50000 KiB = bg-green-200", () => expect(deltaBgClass(-50_000)).toBe("bg-green-200 dark:bg-green-900"));
  it("-100000 KiB = bg-green-200", () => expect(deltaBgClass(-100_000)).toBe("bg-green-200 dark:bg-green-900"));
});

describe("fmtDelta", () => {
  it("zero returns empty", () => expect(fmtDelta(0)).toBe(""));
  it("positive: +1 KiB", () => {
    const result = fmtDelta(1);
    expect(result).toMatch(/^\+/);
    expect(result).toContain("1.0 KiB");
  });
  it("positive: +1024 KiB = +1.0 MiB", () => {
    expect(fmtDelta(1024)).toBe("+1.0 MiB");
  });
  it("negative uses minus sign (U+2212)", () => {
    const result = fmtDelta(-1);
    expect(result).toMatch(/^\u2212/);
    expect(result).toContain("1.0 KiB");
  });
  it("negative: -1024 KiB", () => {
    expect(fmtDelta(-1024)).toBe("\u22121.0 MiB");
  });
  it("large positive", () => {
    expect(fmtDelta(1_048_576)).toBe("+1.0 GiB");
  });
  it("large negative", () => {
    expect(fmtDelta(-1_048_576)).toBe("\u22121.0 GiB");
  });
  it("small positive (sub-KiB after conversion)", () => {
    // fmtDelta(1) = fmtSize(1024) = "1.0 KiB"
    expect(fmtDelta(1)).toBe("+1.0 KiB");
  });
});

describe("fmtSizeDelta", () => {
  it("zero returns empty", () => expect(fmtSizeDelta(0)).toBe(""));
  it("positive bytes", () => {
    expect(fmtSizeDelta(1024)).toBe("+1.0 KiB");
  });
  it("negative bytes uses minus sign (U+2212)", () => {
    expect(fmtSizeDelta(-1024)).toBe("\u22121.0 KiB");
  });
  it("small positive (500 bytes)", () => {
    expect(fmtSizeDelta(500)).toBe("+500");
  });
  it("1 MiB", () => {
    expect(fmtSizeDelta(1_048_576)).toBe("+1.0 MiB");
  });
  it("negative 1 MiB", () => {
    expect(fmtSizeDelta(-1_048_576)).toBe("\u22121.0 MiB");
  });
  it("1 byte", () => {
    expect(fmtSizeDelta(1)).toBe("+1");
  });
  it("-1 byte", () => {
    expect(fmtSizeDelta(-1)).toBe("\u22121");
  });
});

describe("deltaBgClassBytes", () => {
  it("zero", () => expect(deltaBgClassBytes(0)).toBe(""));
  it("below threshold (999 KiB in bytes)", () => {
    expect(deltaBgClassBytes(999 * 1024)).toBe("");
  });
  it("at threshold (1000 KiB in bytes)", () => {
    expect(deltaBgClassBytes(1000 * 1024)).toBe("bg-red-50 dark:bg-red-950");
  });
  it("negative at threshold", () => {
    expect(deltaBgClassBytes(-1000 * 1024)).toBe("bg-green-50 dark:bg-green-950");
  });
  it("large positive (50 MiB in bytes)", () => {
    expect(deltaBgClassBytes(50_000 * 1024)).toBe("bg-red-200 dark:bg-red-900");
  });
  it("delegates to deltaBgClass with KiB conversion", () => {
    // 10_000 * 1024 bytes = 10_000 KiB → bg-red-100
    expect(deltaBgClassBytes(10_000 * 1024)).toBe("bg-red-100 dark:bg-red-900/50");
  });
});
