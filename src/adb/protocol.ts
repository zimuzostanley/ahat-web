// ADB protocol message encoding/decoding.
// Adapted from Perfetto's adb_msg.ts (Apache 2.0).

const ADB_MSG_SIZE = 6 * 4; // 6 x uint32 = 24 bytes

export interface AdbMsgHdr {
  readonly cmd: string;
  readonly arg0: number;
  readonly arg1: number;
  readonly dataLen: number;
  readonly dataChecksum: number;
}

export interface AdbMsg extends AdbMsgHdr {
  data: Uint8Array;
}

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

export function parseAdbMsgHdr(dv: DataView): AdbMsgHdr {
  if (dv.byteLength !== ADB_MSG_SIZE) {
    throw new Error(`Expected ${ADB_MSG_SIZE} bytes, got ${dv.byteLength}`);
  }
  const cmdBytes = new Uint8Array(dv.buffer, dv.byteOffset, 4);
  const cmd = textDec.decode(cmdBytes);
  const cmdNum = dv.getUint32(0, true);
  const arg0 = dv.getUint32(4, true);
  const arg1 = dv.getUint32(8, true);
  const dataLen = dv.getUint32(12, true);
  const dataChecksum = dv.getUint32(16, true);
  const magic = dv.getUint32(20, true);
  if (magic !== (cmdNum ^ 0xffffffff) >>> 0) {
    throw new Error(`ADB magic mismatch: ${magic} vs ${(cmdNum ^ 0xffffffff) >>> 0}`);
  }
  return { cmd, arg0, arg1, dataLen, dataChecksum };
}

export function encodeAdbMsg(
  cmd: string,
  arg0: number,
  arg1: number,
  data: Uint8Array,
  useChecksum = false,
): Uint8Array {
  const checksum = useChecksum ? generateChecksum(data) : 0;
  const buf = new Uint8Array(ADB_MSG_SIZE);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 4; i++) {
    dv.setUint8(i, cmd.charCodeAt(i));
  }
  dv.setUint32(4, arg0, true);
  dv.setUint32(8, arg1, true);
  dv.setUint32(12, data.byteLength, true);
  dv.setUint32(16, checksum, true);
  dv.setUint32(20, dv.getUint32(0, true) ^ 0xffffffff, true);
  return buf;
}

export function encodeAdbData(data?: Uint8Array | string): Uint8Array {
  if (data === undefined) return new Uint8Array(0);
  if (typeof data === "string") return textEnc.encode(data + "\0");
  return data;
}

function generateChecksum(data: Uint8Array): number {
  let res = 0;
  for (let i = 0; i < data.byteLength; i++) res += data[i];
  return res & 0xffffffff;
}

export { ADB_MSG_SIZE };
