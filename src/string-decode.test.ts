import { describe, it, expect } from "vitest";
import { AhatArrayInstance, Type } from "./hprof";

/** Helper to create a byte array instance with given values. */
function makeByteArray(bytes: number[]): AhatArrayInstance {
  const arr = new AhatArrayInstance(0x1000, 4);
  arr.elemType = Type.BYTE;
  arr.values = bytes;
  return arr;
}

/** Helper to create a char array instance with given chars. */
function makeCharArray(chars: string[]): AhatArrayInstance {
  const arr = new AhatArrayInstance(0x2000, 4);
  arr.elemType = Type.CHAR;
  arr.values = chars;
  return arr;
}

describe("AhatArrayInstance.asUtf16LeString", () => {
  it("decodes ASCII encoded as UTF-16LE", () => {
    // "Hi" in UTF-16LE: H=0x48,0x00  i=0x69,0x00
    const arr = makeByteArray([0x48, 0x00, 0x69, 0x00]);
    expect(arr.asUtf16LeString(0, -1)).toBe("Hi");
  });

  it("decodes non-ASCII BMP characters", () => {
    // "日本" in UTF-16LE: 日=0xE5,0x65  本=0x2C,0x67
    const arr = makeByteArray([0xE5, 0x65, 0x2C, 0x67]);
    expect(arr.asUtf16LeString(0, -1)).toBe("\u65E5\u672C");
  });

  it("decodes emoji (surrogate pair)", () => {
    // U+1F600 (grinning face) = D83D DE00 in UTF-16
    const arr = makeByteArray([0x3D, 0xD8, 0x00, 0xDE]);
    const result = arr.asUtf16LeString(0, -1)!;
    expect(result).toBe("\uD83D\uDE00");
    expect(result.codePointAt(0)).toBe(0x1F600);
  });

  it("respects charOffset", () => {
    // "ABCD" in UTF-16LE
    const arr = makeByteArray([0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x44, 0x00]);
    expect(arr.asUtf16LeString(2, -1)).toBe("CD");
  });

  it("respects maxChars", () => {
    // "Hello" in UTF-16LE
    const arr = makeByteArray([0x48, 0x00, 0x65, 0x00, 0x6C, 0x00, 0x6C, 0x00, 0x6F, 0x00]);
    expect(arr.asUtf16LeString(0, 3)).toBe("Hel");
  });

  it("returns empty string for zero-length array", () => {
    const arr = makeByteArray([]);
    expect(arr.asUtf16LeString(0, -1)).toBe("");
  });

  it("returns empty string when offset past end", () => {
    const arr = makeByteArray([0x41, 0x00]);
    expect(arr.asUtf16LeString(5, -1)).toBe("");
  });

  it("returns null for non-byte array", () => {
    const arr = makeCharArray(["A", "B"]);
    expect(arr.asUtf16LeString(0, -1)).toBeNull();
  });

  it("handles mixed ASCII and non-ASCII", () => {
    // "A日B" in UTF-16LE
    const arr = makeByteArray([0x41, 0x00, 0xE5, 0x65, 0x42, 0x00]);
    expect(arr.asUtf16LeString(0, -1)).toBe("A\u65E5B");
  });

  it("handles odd byte count gracefully (truncates last incomplete char)", () => {
    // 3 bytes — only 1 complete char
    const arr = makeByteArray([0x41, 0x00, 0x42]);
    expect(arr.asUtf16LeString(0, -1)).toBe("A");
  });
});

describe("AhatArrayInstance.asStringSlice (Latin-1)", () => {
  it("decodes Latin-1 bytes", () => {
    const arr = makeByteArray([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
    expect(arr.asStringSlice(0, 5, -1)).toBe("Hello");
  });

  it("handles extended Latin-1 characters", () => {
    // é = 0xE9 in Latin-1
    const arr = makeByteArray([0x63, 0x61, 0x66, 0xE9]);
    expect(arr.asStringSlice(0, 4, -1)).toBe("caf\u00E9");
  });

  it("respects offset and count", () => {
    const arr = makeByteArray([0x41, 0x42, 0x43, 0x44, 0x45]);
    expect(arr.asStringSlice(1, 3, -1)).toBe("BCD");
  });

  it("respects maxChars", () => {
    const arr = makeByteArray([0x41, 0x42, 0x43, 0x44, 0x45]);
    expect(arr.asStringSlice(0, 5, 2)).toBe("AB");
  });
});

describe("AhatArrayInstance.asStringSlice (char[])", () => {
  it("decodes char array", () => {
    const arr = makeCharArray(["H", "i"]);
    expect(arr.asStringSlice(0, 2, -1)).toBe("Hi");
  });

  it("handles unicode chars", () => {
    const arr = makeCharArray(["\u65E5", "\u672C"]);
    expect(arr.asStringSlice(0, 2, -1)).toBe("\u65E5\u672C");
  });

  it("handles surrogate pairs in char array", () => {
    // U+1F600 as surrogate pair in char[]
    const arr = makeCharArray(["\uD83D", "\uDE00"]);
    const result = arr.asStringSlice(0, 2, -1)!;
    expect(result.codePointAt(0)).toBe(0x1F600);
  });

  it("returns null for non-string array type", () => {
    const arr = new AhatArrayInstance(0x3000, 4);
    arr.elemType = Type.INT;
    arr.values = [1, 2, 3];
    expect(arr.asStringSlice(0, 3, -1)).toBeNull();
  });
});

describe("AhatArrayInstance.asUtf16LeString edge cases", () => {
  it("handles null byte in the middle (valid UTF-16)", () => {
    // "A\0B" → 0x41,0x00, 0x00,0x00, 0x42,0x00
    const arr = makeByteArray([0x41, 0x00, 0x00, 0x00, 0x42, 0x00]);
    const result = arr.asUtf16LeString(0, -1)!;
    expect(result.length).toBe(3);
    expect(result.charCodeAt(0)).toBe(0x41);
    expect(result.charCodeAt(1)).toBe(0x00);
    expect(result.charCodeAt(2)).toBe(0x42);
  });

  it("handles all-zero bytes", () => {
    const arr = makeByteArray([0x00, 0x00, 0x00, 0x00]);
    const result = arr.asUtf16LeString(0, -1)!;
    expect(result.length).toBe(2);
    expect(result).toBe("\0\0");
  });

  it("handles high byte values (0xFF)", () => {
    const arr = makeByteArray([0xFF, 0xFF, 0xFF, 0xFF]);
    const result = arr.asUtf16LeString(0, -1)!;
    expect(result.length).toBe(2);
    expect(result.charCodeAt(0)).toBe(0xFFFF);
    expect(result.charCodeAt(1)).toBe(0xFFFF);
  });

  it("combined offset and maxChars", () => {
    // "ABCDE" in UTF-16LE
    const arr = makeByteArray([
      0x41, 0x00, 0x42, 0x00, 0x43, 0x00, 0x44, 0x00, 0x45, 0x00,
    ]);
    // offset=1, maxChars=2 → "BC"
    expect(arr.asUtf16LeString(1, 2)).toBe("BC");
  });

  it("maxChars=0 returns empty string", () => {
    const arr = makeByteArray([0x41, 0x00]);
    expect(arr.asUtf16LeString(0, 0)).toBe("");
  });

  it("offset equals total chars returns empty", () => {
    const arr = makeByteArray([0x41, 0x00, 0x42, 0x00]); // 2 chars
    expect(arr.asUtf16LeString(2, -1)).toBe("");
  });

  it("handles CJK Unified Ideographs range", () => {
    // Common Chinese characters: 中文 = U+4E2D, U+6587
    const arr = makeByteArray([0x2D, 0x4E, 0x87, 0x65]);
    expect(arr.asUtf16LeString(0, -1)).toBe("\u4E2D\u6587");
  });

  it("handles Korean Hangul", () => {
    // 한글 = U+D55C, U+AE00
    const arr = makeByteArray([0x5C, 0xD5, 0x00, 0xAE]);
    expect(arr.asUtf16LeString(0, -1)).toBe("\uD55C\uAE00");
  });

  it("handles Arabic script", () => {
    // مرحبا = U+0645, U+0631, U+062D, U+0628, U+0627
    const arr = makeByteArray([0x45, 0x06, 0x31, 0x06, 0x2D, 0x06, 0x28, 0x06, 0x27, 0x06]);
    expect(arr.asUtf16LeString(0, -1)).toBe("\u0645\u0631\u062D\u0628\u0627");
  });

  it("handles multiple surrogate pairs (emoji sequence)", () => {
    // Two emoji: U+1F600 (😀) + U+1F4A9 (💩)
    // D83D DE00 D83D DCA9
    const arr = makeByteArray([0x3D, 0xD8, 0x00, 0xDE, 0x3D, 0xD8, 0xA9, 0xDC]);
    const result = arr.asUtf16LeString(0, -1)!;
    expect(result.length).toBe(4); // 2 surrogate pairs = 4 UTF-16 code units
    expect(result.codePointAt(0)).toBe(0x1F600);
    expect(result.codePointAt(2)).toBe(0x1F4A9);
  });

  it("handles mix of BMP and supplementary plane chars", () => {
    // "A" + U+1F600 + "B" in UTF-16LE
    const arr = makeByteArray([
      0x41, 0x00,             // A
      0x3D, 0xD8, 0x00, 0xDE, // U+1F600
      0x42, 0x00,             // B
    ]);
    const result = arr.asUtf16LeString(0, -1)!;
    expect(result.length).toBe(4); // A(1) + surrogate pair(2) + B(1)
    expect(result[0]).toBe("A");
    expect(result.codePointAt(1)).toBe(0x1F600);
    expect(result[3]).toBe("B");
  });
});
