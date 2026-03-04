import { describe, it, expect } from "vitest";
import { formatRow, formatHexDump, buildRegionMap, offsetToVmaAddr, extractStrings, formatRowSegments, buildDiffRows, findDiffIndex, regionSeparatorRows } from "./views/HexView";

describe("HexView formatRow", () => {
  it("formats a full 16-byte row", () => {
    const data = new Uint8Array([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x2c, 0x20, 0x57,
      0x6f, 0x72, 0x6c, 0x64, 0x21, 0x0a, 0x00, 0xff,
    ]);
    const row = formatRow(data, 0, data.length);
    expect(row).toBe("00000000  48 65 6c 6c 6f 2c 20 57  6f 72 6c 64 21 0a 00 ff  |Hello, World!...|");
  });

  it("formats a partial last row", () => {
    const data = new Uint8Array([0x41, 0x42, 0x43]);
    const row = formatRow(data, 0, data.length);
    // Verify structure: offset, hex section, ascii section
    expect(row).toMatch(/^00000000\s+41 42 43/);
    expect(row).toContain("|ABC");
  });

  it("formats with non-zero offset", () => {
    const data = new Uint8Array(32);
    data[16] = 0xde;
    data[17] = 0xad;
    data[18] = 0xbe;
    data[19] = 0xef;
    const row = formatRow(data, 16, data.length);
    expect(row).toContain("00000010");
    expect(row).toContain("de ad be ef");
  });

  it("replaces non-printable bytes with dot in ASCII column", () => {
    const data = new Uint8Array([0x00, 0x01, 0x1f, 0x20, 0x7e, 0x7f]);
    const row = formatRow(data, 0, data.length);
    // 0x00, 0x01, 0x1f → dots; 0x20 → space; 0x7e → ~; 0x7f → dot
    expect(row).toContain("|... ~.          |");
  });

  it("pads offset to 8 hex chars", () => {
    const data = new Uint8Array(0x100010);
    const row = formatRow(data, 0x100000, data.length);
    expect(row).toMatch(/^00100000/);
  });

  it("includes VMA address when provided (32-bit)", () => {
    const data = new Uint8Array([0x41, 0x42, 0x43, 0x44]);
    const row = formatRow(data, 0, data.length, 0x7f000000, 8);
    expect(row).toMatch(/^7f000000\s+00000000\s+41 42 43 44/);
    expect(row).toContain("|ABCD");
  });

  it("includes VMA address when provided (48-bit)", () => {
    const data = new Uint8Array(16);
    data[0] = 0xff;
    const row = formatRow(data, 0, data.length, 0x7f0000000000, 12);
    expect(row).toMatch(/^7f0000000000\s+00000000\s+ff 00/);
  });

  it("VMA address does not affect row without it", () => {
    const data = new Uint8Array([0x41]);
    const withoutVma = formatRow(data, 0, data.length);
    const withVma = formatRow(data, 0, data.length, 0x1000, 8);
    expect(withoutVma).toMatch(/^00000000/);
    expect(withVma).toMatch(/^00001000\s+00000000/);
    // Without VMA: one address column. With VMA: two address columns.
    expect(withVma.length).toBeGreaterThan(withoutVma.length);
  });
});

describe("HexView formatHexDump", () => {
  it("formats complete dump for small data", () => {
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    const dump = formatHexDump(data);
    expect(dump).toMatch(/^00000000\s+01 02 03/);
    expect(dump).toContain("|...");
  });

  it("formats multiple rows", () => {
    const data = new Uint8Array(32);
    for (let i = 0; i < 32; i++) data[i] = i;
    const dump = formatHexDump(data);
    const lines = dump.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^00000000/);
    expect(lines[1]).toMatch(/^00000010/);
  });

  it("truncates at maxRows", () => {
    const data = new Uint8Array(256);
    const dump = formatHexDump(data, 4);
    const lines = dump.split("\n");
    // 256 bytes = 16 rows, but capped at 4 + truncation message
    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain("truncated at 4 rows");
  });

  it("empty data produces empty string", () => {
    const data = new Uint8Array(0);
    const dump = formatHexDump(data);
    expect(dump).toBe("");
  });

  it("includes VMA addresses when regionMap is provided", () => {
    const data = new Uint8Array(32);
    const regionMap = [{ offsetStart: 0, offsetEnd: 32, vmaBase: 0x40000000 }];
    const dump = formatHexDump(data, undefined, regionMap, 8);
    const lines = dump.split("\n");
    expect(lines[0]).toMatch(/^40000000\s+00000000/);
    expect(lines[1]).toMatch(/^40000010\s+00000010/);
  });
});

describe("buildRegionMap", () => {
  it("builds single region", () => {
    const map = buildRegionMap([{ addrStart: "7f000000", addrEnd: "7f001000" }]);
    expect(map).toHaveLength(1);
    expect(map[0]).toEqual({ offsetStart: 0, offsetEnd: 0x1000, vmaBase: 0x7f000000 });
  });

  it("builds multiple contiguous regions", () => {
    const map = buildRegionMap([
      { addrStart: "10000000", addrEnd: "10001000" },
      { addrStart: "20000000", addrEnd: "20002000" },
    ]);
    expect(map).toHaveLength(2);
    expect(map[0]).toEqual({ offsetStart: 0, offsetEnd: 0x1000, vmaBase: 0x10000000 });
    expect(map[1]).toEqual({ offsetStart: 0x1000, offsetEnd: 0x3000, vmaBase: 0x20000000 });
  });

  it("handles 48-bit addresses", () => {
    const map = buildRegionMap([{ addrStart: "700000000000", addrEnd: "700000001000" }]);
    expect(map[0].vmaBase).toBe(0x700000000000);
    expect(map[0].offsetEnd).toBe(0x1000);
  });
});

describe("offsetToVmaAddr", () => {
  const map = buildRegionMap([
    { addrStart: "10000000", addrEnd: "10001000" },
    { addrStart: "20000000", addrEnd: "20002000" },
  ]);

  it("maps offset in first region", () => {
    expect(offsetToVmaAddr(0, map)).toBe(0x10000000);
    expect(offsetToVmaAddr(0x100, map)).toBe(0x10000100);
    expect(offsetToVmaAddr(0xfff, map)).toBe(0x10000fff);
  });

  it("maps offset in second region", () => {
    expect(offsetToVmaAddr(0x1000, map)).toBe(0x20000000);
    expect(offsetToVmaAddr(0x1500, map)).toBe(0x20000500);
  });

  it("returns undefined for offset beyond all regions", () => {
    expect(offsetToVmaAddr(0x3000, map)).toBeUndefined();
  });

  it("returns undefined for empty region map", () => {
    expect(offsetToVmaAddr(0, [])).toBeUndefined();
  });
});

describe("extractStrings", () => {
  it("extracts printable ASCII strings", () => {
    // "Hello" + null + "World" + null
    const data = new Uint8Array([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00,
      0x57, 0x6f, 0x72, 0x6c, 0x64, 0x00,
    ]);
    const strings = extractStrings(data, 4);
    expect(strings).toHaveLength(2);
    expect(strings[0]).toEqual({ offset: 0, str: "Hello" });
    expect(strings[1]).toEqual({ offset: 6, str: "World" });
  });

  it("skips strings shorter than minLen", () => {
    const data = new Uint8Array([0x41, 0x42, 0x00, 0x43, 0x44, 0x45, 0x46, 0x00]);
    const strings = extractStrings(data, 4);
    expect(strings).toHaveLength(1);
    expect(strings[0].str).toBe("CDEF");
  });

  it("handles string at end of data (no null terminator)", () => {
    const data = new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x45]);
    const strings = extractStrings(data, 4);
    expect(strings).toHaveLength(1);
    expect(strings[0]).toEqual({ offset: 0, str: "ABCDE" });
  });

  it("treats non-printable bytes as separators", () => {
    // "Test" + \x01 + \x7f + "Data"
    const data = new Uint8Array([
      0x54, 0x65, 0x73, 0x74, 0x01, 0x7f,
      0x44, 0x61, 0x74, 0x61,
    ]);
    const strings = extractStrings(data, 4);
    expect(strings).toHaveLength(2);
    expect(strings[0].str).toBe("Test");
    expect(strings[1].str).toBe("Data");
  });

  it("includes space (0x20) and tilde (0x7e) as printable", () => {
    const data = new Uint8Array([0x20, 0x7e, 0x20, 0x7e, 0x00]);
    const strings = extractStrings(data, 4);
    expect(strings).toHaveLength(1);
    expect(strings[0].str).toBe(" ~ ~");
  });

  it("returns empty array for empty data", () => {
    expect(extractStrings(new Uint8Array(0))).toEqual([]);
  });

  it("returns empty array when all strings are too short", () => {
    const data = new Uint8Array([0x41, 0x00, 0x42, 0x00, 0x43, 0x00]);
    expect(extractStrings(data, 4)).toEqual([]);
  });
});

describe("formatRowSegments", () => {
  it("identical data produces no diff segments", () => {
    const data = new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
      0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50]);
    const base = new Uint8Array(data);
    const segments = formatRowSegments(data, 0, data.length, base, base.length);
    expect(segments.every(s => !s.diff)).toBe(true);
  });

  it("text content matches formatRow for identical data", () => {
    const data = new Uint8Array(16);
    for (let i = 0; i < 16; i++) data[i] = i + 0x30;
    const base = new Uint8Array(data);
    const segments = formatRowSegments(data, 0, data.length, base, base.length);
    const segmentText = segments.map(s => s.text).join("");
    const rowText = formatRow(data, 0, data.length);
    expect(segmentText).toBe(rowText);
  });

  it("single byte difference marks only that byte in hex and ASCII", () => {
    const data = new Uint8Array([0x41, 0x42, 0x43, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const base = new Uint8Array(data);
    base[1] = 0xFF; // byte at index 1 differs
    const segments = formatRowSegments(data, 0, data.length, base, base.length);
    const diffSegments = segments.filter(s => s.diff);
    // Should have exactly 2 diff segments: one for hex "42", one for ASCII "B"
    expect(diffSegments).toHaveLength(2);
    expect(diffSegments[0].text).toBe("42");
    expect(diffSegments[1].text).toBe("B");
  });

  it("multiple adjacent differing bytes merge into one segment", () => {
    const data = new Uint8Array(16);
    const base = new Uint8Array(16);
    data[0] = 0xAA; data[1] = 0xBB; data[2] = 0xCC;
    // base bytes 0-2 differ
    const segments = formatRowSegments(data, 0, data.length, base, base.length);
    // In hex section, adjacent diff bytes separated by spaces (non-diff) won't merge.
    // But in ASCII section, adjacent diff chars merge.
    const diffSegs = segments.filter(s => s.diff);
    // hex: "aa", "bb", "cc" = 3 separate (separated by " " non-diff)
    // ascii: "..." = 3 merged into 1
    expect(diffSegs.length).toBe(4); // 3 hex + 1 ascii block
    // ASCII segment contains 3 chars
    const asciiDiff = diffSegs[3];
    expect(asciiDiff.text).toHaveLength(3);
  });

  it("includes VMA address column when provided", () => {
    const data = new Uint8Array(16);
    const base = new Uint8Array(16);
    const segments = formatRowSegments(data, 0, data.length, base, base.length, 0x7f000000, 8);
    const text = segments.map(s => s.text).join("");
    expect(text).toMatch(/^7f000000\s+00000000/);
  });

  it("text matches formatRow when VMA address is provided", () => {
    const data = new Uint8Array(16);
    for (let i = 0; i < 16; i++) data[i] = i;
    const base = new Uint8Array(data);
    const segs = formatRowSegments(data, 0, data.length, base, base.length, 0x40000000, 8);
    const segText = segs.map(s => s.text).join("");
    const rowText = formatRow(data, 0, data.length, 0x40000000, 8);
    expect(segText).toBe(rowText);
  });

  it("handles partial last row", () => {
    const data = new Uint8Array([0x41, 0x42, 0x43]);
    const base = new Uint8Array([0x41, 0x00, 0x43]);
    const segments = formatRowSegments(data, 0, data.length, base, base.length);
    const diffSegs = segments.filter(s => s.diff);
    // byte 1 differs: hex "42" and ascii "B"
    expect(diffSegs).toHaveLength(2);
    expect(diffSegs[0].text).toBe("42");
    expect(diffSegs[1].text).toBe("B");
  });

  it("baseline shorter than current does not mark extra bytes as diff", () => {
    const data = new Uint8Array([0x41, 0x42, 0x43, 0x44]);
    const base = new Uint8Array([0x41, 0x42]); // shorter
    const segments = formatRowSegments(data, 0, data.length, base, base.length);
    // Bytes 0-1 match, bytes 2-3 are beyond baseline → isDiff = false (pos < baseTotalLen check)
    expect(segments.every(s => !s.diff)).toBe(true);
  });

  it("non-zero offset works correctly", () => {
    const data = new Uint8Array(32);
    data[16] = 0xDE; data[17] = 0xAD;
    const base = new Uint8Array(32);
    base[16] = 0x00; base[17] = 0x00;
    const segments = formatRowSegments(data, 16, data.length, base, base.length);
    const text = segments.map(s => s.text).join("");
    expect(text).toMatch(/^00000010/);
    const diffSegs = segments.filter(s => s.diff);
    expect(diffSegs).toHaveLength(3); // hex "de", hex "ad", ascii ".." merged
  });

  it("all bytes different marks all hex and ascii as diff", () => {
    const data = new Uint8Array(16);
    const base = new Uint8Array(16);
    for (let i = 0; i < 16; i++) { data[i] = i + 0x41; base[i] = i + 0x61; }
    const segments = formatRowSegments(data, 0, data.length, base, base.length);
    const diffSegs = segments.filter(s => s.diff);
    // 16 hex segments (separated by spaces) + 1 merged ASCII block = 17
    expect(diffSegs).toHaveLength(17);
  });
});

describe("buildDiffRows", () => {
  it("identical data returns empty", () => {
    const data = new Uint8Array(32);
    expect(buildDiffRows(data, new Uint8Array(data))).toEqual([]);
  });

  it("single diff in first row", () => {
    const data = new Uint8Array(32);
    const base = new Uint8Array(32);
    data[3] = 0xFF;
    expect(buildDiffRows(data, base)).toEqual([0]);
  });

  it("single diff in second row", () => {
    const data = new Uint8Array(32);
    const base = new Uint8Array(32);
    data[17] = 0xFF;
    expect(buildDiffRows(data, base)).toEqual([1]);
  });

  it("multiple rows with diffs", () => {
    const data = new Uint8Array(48);
    const base = new Uint8Array(48);
    data[0] = 1; data[20] = 1; data[32] = 1;
    expect(buildDiffRows(data, base)).toEqual([0, 1, 2]);
  });

  it("all bytes different returns all rows", () => {
    const data = new Uint8Array(32);
    const base = new Uint8Array(32);
    for (let i = 0; i < 32; i++) data[i] = i + 1;
    expect(buildDiffRows(data, base)).toEqual([0, 1]);
  });

  it("data longer than baseline: extra bytes not counted", () => {
    const data = new Uint8Array(48);
    const base = new Uint8Array(32);
    // Diff in first 32 bytes
    data[5] = 1;
    // Byte 40 differs from base but base is only 32 long → not counted
    data[40] = 0xFF;
    expect(buildDiffRows(data, base)).toEqual([0]);
  });

  it("empty data returns empty", () => {
    expect(buildDiffRows(new Uint8Array(0), new Uint8Array(0))).toEqual([]);
  });

  it("diff at last byte of row", () => {
    const data = new Uint8Array(16);
    const base = new Uint8Array(16);
    data[15] = 0xFF;
    expect(buildDiffRows(data, base)).toEqual([0]);
  });

  it("partial last row", () => {
    const data = new Uint8Array(20);
    const base = new Uint8Array(20);
    data[18] = 0xFF;
    expect(buildDiffRows(data, base)).toEqual([1]);
  });
});

describe("findDiffIndex", () => {
  it("next: finds first diff row after target", () => {
    expect(findDiffIndex([5, 10, 20], 7, "next")).toBe(1);
  });

  it("next: target before all diffs", () => {
    expect(findDiffIndex([5, 10], 2, "next")).toBe(0);
  });

  it("next: target at a diff row returns next one (strictly after)", () => {
    expect(findDiffIndex([5, 10], 5, "next")).toBe(1);
  });

  it("next: target after all diffs returns -1", () => {
    expect(findDiffIndex([5, 10], 15, "next")).toBe(-1);
  });

  it("prev: finds last diff row before target", () => {
    expect(findDiffIndex([5, 10, 20], 15, "prev")).toBe(1);
  });

  it("prev: target after all diffs", () => {
    expect(findDiffIndex([5, 10], 20, "prev")).toBe(1);
  });

  it("prev: target at a diff row returns previous one (strictly before)", () => {
    expect(findDiffIndex([5, 10], 10, "prev")).toBe(0);
  });

  it("prev: target before all diffs returns -1", () => {
    expect(findDiffIndex([5, 10], 3, "prev")).toBe(-1);
  });

  it("empty diffRows returns -1 for both", () => {
    expect(findDiffIndex([], 5, "next")).toBe(-1);
    expect(findDiffIndex([], 5, "prev")).toBe(-1);
  });

  it("single-element: next from before, prev from after", () => {
    expect(findDiffIndex([10], 5, "next")).toBe(0);
    expect(findDiffIndex([10], 15, "prev")).toBe(0);
    expect(findDiffIndex([10], 10, "next")).toBe(-1);
    expect(findDiffIndex([10], 10, "prev")).toBe(-1);
  });
});

describe("regionSeparatorRows", () => {
  it("single region returns empty", () => {
    expect(regionSeparatorRows([
      { offsetStart: 0, offsetEnd: 0x1000, vmaBase: 0x10000000 },
    ])).toEqual([]);
  });

  it("two regions: separator at boundary", () => {
    const map = buildRegionMap([
      { addrStart: "10000000", addrEnd: "10001000" },
      { addrStart: "20000000", addrEnd: "20002000" },
    ]);
    const seps = regionSeparatorRows(map);
    expect(seps).toHaveLength(1);
    expect(seps[0].row).toBe(0x1000 / 16); // 256
    expect(seps[0].vmaBase).toBe(0x20000000);
  });

  it("three regions: two separators", () => {
    const map = buildRegionMap([
      { addrStart: "10000000", addrEnd: "10001000" },
      { addrStart: "20000000", addrEnd: "20001000" },
      { addrStart: "30000000", addrEnd: "30001000" },
    ]);
    const seps = regionSeparatorRows(map);
    expect(seps).toHaveLength(2);
    expect(seps[0].row).toBe(0x1000 / 16);
    expect(seps[1].row).toBe(0x2000 / 16);
  });

  it("empty returns empty", () => {
    expect(regionSeparatorRows([])).toEqual([]);
  });
});
