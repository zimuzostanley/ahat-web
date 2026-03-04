import { describe, it, expect } from "vitest";

// Test the address computation logic that dumpVmaMemory uses
describe("VMA address computation", () => {
  function computeDdArgs(addrStart: string, addrEnd: string) {
    const startByte = parseInt(addrStart, 16);
    const endByte = parseInt(addrEnd, 16);
    const startPage = Math.floor(startByte / 4096);
    const numPages = Math.ceil((endByte - startByte) / 4096);
    return { startPage, numPages, sizeBytes: endByte - startByte };
  }

  it("computes page-aligned single VMA", () => {
    // 0x7f000000 to 0x7f001000 = exactly 1 page (4096 bytes)
    const { startPage, numPages, sizeBytes } = computeDdArgs("7f000000", "7f001000");
    expect(sizeBytes).toBe(4096);
    expect(startPage).toBe(0x7f000000 / 4096);
    expect(numPages).toBe(1);
  });

  it("computes multi-page VMA", () => {
    // 0x10000 to 0x20000 = 16 pages
    const { startPage, numPages, sizeBytes } = computeDdArgs("00010000", "00020000");
    expect(sizeBytes).toBe(0x10000);
    expect(startPage).toBe(16);
    expect(numPages).toBe(16);
  });

  it("handles large addresses", () => {
    // 64-bit safe address (up to ~256TB which is within JS safe integer)
    const { startPage, numPages } = computeDdArgs("0000700000000000", "0000700000010000");
    expect(startPage).toBe(parseInt("700000000000", 16) / 4096);
    expect(numPages).toBe(16);
  });

  it("builds single dd command correctly", () => {
    const regions = [{ addrStart: "00010000", addrEnd: "00020000" }];
    const tmpPath = "/data/local/tmp/test.bin";
    const cmds = regions.map((r, i) => {
      const startByte = parseInt(r.addrStart, 16);
      const endByte = parseInt(r.addrEnd, 16);
      const startPage = Math.floor(startByte / 4096);
      const numPages = Math.ceil((endByte - startByte) / 4096);
      const redir = i === 0 ? ">" : ">>";
      return `dd if=/proc/123/mem bs=4096 skip=${startPage} count=${numPages} ${redir} ${tmpPath} 2>/dev/null`;
    });
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toBe("dd if=/proc/123/mem bs=4096 skip=16 count=16 > /data/local/tmp/test.bin 2>/dev/null");
  });

  it("builds multiple dd commands with append", () => {
    const regions = [
      { addrStart: "00010000", addrEnd: "00020000" },
      { addrStart: "00030000", addrEnd: "00040000" },
    ];
    const tmpPath = "/tmp/out.bin";
    const cmds = regions.map((r, i) => {
      const startByte = parseInt(r.addrStart, 16);
      const endByte = parseInt(r.addrEnd, 16);
      const startPage = Math.floor(startByte / 4096);
      const numPages = Math.ceil((endByte - startByte) / 4096);
      const redir = i === 0 ? ">" : ">>";
      return `dd if=/proc/1/mem bs=4096 skip=${startPage} count=${numPages} ${redir} ${tmpPath} 2>/dev/null`;
    });
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toContain(">");
    expect(cmds[0]).not.toContain(">>");
    expect(cmds[1]).toContain(">>");
  });
});
