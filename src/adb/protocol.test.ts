import { describe, it, expect } from "vitest";
import { encodeAdbMsg, parseAdbMsgHdr, encodeAdbData, ADB_MSG_SIZE } from "./protocol";

const textEnc = new TextEncoder();

describe("ADB protocol", () => {
  describe("encodeAdbMsg / parseAdbMsgHdr roundtrip", () => {
    it("encodes and parses CNXN message", () => {
      const data = new Uint8Array(0);
      const msg = encodeAdbMsg("CNXN", 0x01000001, 256 * 1024, data);
      expect(msg.byteLength).toBe(ADB_MSG_SIZE);

      const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
      const parsed = parseAdbMsgHdr(dv);
      expect(parsed.cmd).toBe("CNXN");
      expect(parsed.arg0).toBe(0x01000001);
      expect(parsed.arg1).toBe(256 * 1024);
      expect(parsed.dataLen).toBe(0);
    });

    it("encodes and parses OPEN message with data length", () => {
      const svc = "shell:ls";
      const payload = textEnc.encode(svc + "\0");
      const msg = encodeAdbMsg("OPEN", 1, 0, payload);

      const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
      const parsed = parseAdbMsgHdr(dv);
      expect(parsed.cmd).toBe("OPEN");
      expect(parsed.arg0).toBe(1);
      expect(parsed.arg1).toBe(0);
      expect(parsed.dataLen).toBe(payload.byteLength);
    });

    it("verifies magic field (cmd ^ 0xFFFFFFFF)", () => {
      const msg = encodeAdbMsg("WRTE", 5, 10, new Uint8Array(0));
      const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
      const cmdNum = dv.getUint32(0, true);
      const magic = dv.getUint32(20, true);
      expect(magic).toBe((cmdNum ^ 0xffffffff) >>> 0);
    });

    it("includes checksum when requested", () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const noCheck = encodeAdbMsg("WRTE", 1, 2, data, false);
      const withCheck = encodeAdbMsg("WRTE", 1, 2, data, true);

      const dvNo = new DataView(noCheck.buffer, noCheck.byteOffset, noCheck.byteLength);
      const dvYes = new DataView(withCheck.buffer, withCheck.byteOffset, withCheck.byteLength);
      expect(dvNo.getUint32(16, true)).toBe(0);
      expect(dvYes.getUint32(16, true)).toBe(1 + 2 + 3 + 4 + 5);
    });

    it("rejects invalid magic", () => {
      const msg = encodeAdbMsg("CNXN", 1, 2, new Uint8Array(0));
      // Corrupt the magic field
      const dv = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
      dv.setUint32(20, 0xDEADBEEF, true);
      expect(() => parseAdbMsgHdr(dv)).toThrow(/magic mismatch/);
    });

    it("rejects wrong buffer size", () => {
      const buf = new Uint8Array(10);
      expect(() => parseAdbMsgHdr(new DataView(buf.buffer))).toThrow();
    });
  });

  describe("encodeAdbData", () => {
    it("encodes string with null terminator", () => {
      const result = encodeAdbData("hello");
      const expected = textEnc.encode("hello\0");
      expect(result).toEqual(expected);
    });

    it("passes through Uint8Array unchanged", () => {
      const data = new Uint8Array([1, 2, 3]);
      expect(encodeAdbData(data)).toBe(data);
    });

    it("returns empty array for undefined", () => {
      expect(encodeAdbData(undefined).length).toBe(0);
    });
  });

  describe("ADB_MSG_SIZE", () => {
    it("is 24 bytes", () => {
      expect(ADB_MSG_SIZE).toBe(24);
    });
  });
});
