import { describe, it, expect } from "vitest";
import { formatRow, formatHexDump } from "./views/HexView";

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
});
