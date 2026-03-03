// ADB sync protocol for pulling files from device.
// Reference: https://android.googlesource.com/platform/system/core/+/main/adb/SYNC.TXT

import { AdbDevice } from "./device";

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function encodeSyncCmd(cmd: string, length: number): Uint8Array {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 4; i++) dv.setUint8(i, cmd.charCodeAt(i));
  dv.setUint32(4, length, true);
  return buf;
}

function decodeSyncResponse(data: Uint8Array): { cmd: string; length: number } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const cmd = textDec.decode(data.subarray(0, 4));
  const length = dv.getUint32(4, true);
  return { cmd, length };
}

/**
 * Pull a file from the device using ADB sync protocol.
 * Returns the file contents as a Uint8Array.
 *
 * @param onProgress - callback with (bytesReceived, totalBytes). totalBytes
 *   is the file size from STAT, or -1 if unknown.
 */
export async function pullFile(
  device: AdbDevice,
  remotePath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<Uint8Array> {
  // First, get file size via STAT
  let fileSize = -1;
  try {
    const statOut = await device.shell(`stat -c %s '${remotePath}'`);
    const parsed = parseInt(statOut.trim(), 10);
    if (isFinite(parsed) && parsed > 0) fileSize = parsed;
  } catch {
    // stat failed — we'll still try to pull
  }

  // Open sync: stream
  const stream = await device.createStream("sync:");

  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let received = 0;
    let headerBuf = new Uint8Array(0); // For buffering partial sync headers

    // Incoming data handler — ADB sync protocol is a sequence of:
    //   DATA <length> <data>   (file chunks)
    //   DONE <ignored>         (end of file)
    //   FAIL <length> <message> (error)
    stream.onData = (raw: Uint8Array) => {
      // Concatenate with any leftover from previous chunk
      let buf: Uint8Array;
      if (headerBuf.length > 0) {
        buf = new Uint8Array(headerBuf.length + raw.length);
        buf.set(headerBuf, 0);
        buf.set(raw, headerBuf.length);
        headerBuf = new Uint8Array(0);
      } else {
        buf = raw;
      }

      let offset = 0;
      while (offset < buf.length) {
        // Need at least 8 bytes for sync header
        if (buf.length - offset < 8) {
          headerBuf = buf.slice(offset);
          return;
        }

        const resp = decodeSyncResponse(buf.subarray(offset, offset + 8));

        if (resp.cmd === "DATA") {
          offset += 8;
          const dataEnd = offset + resp.length;
          if (dataEnd > buf.length) {
            // Partial data chunk — save what we have and wait for more
            // Put the header back too so we reprocess next time
            headerBuf = buf.slice(offset - 8);
            return;
          }
          const chunk = buf.slice(offset, dataEnd);
          chunks.push(chunk);
          received += chunk.length;
          onProgress?.(received, fileSize);
          offset = dataEnd;
        } else if (resp.cmd === "DONE") {
          // All done
          stream.close();
          const total = chunks.reduce((s, c) => s + c.length, 0);
          const result = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { result.set(c, off); off += c.length; }
          resolve(result);
          return;
        } else if (resp.cmd === "FAIL") {
          offset += 8;
          const msgEnd = offset + resp.length;
          const msg = textDec.decode(buf.subarray(offset, Math.min(msgEnd, buf.length)));
          stream.close();
          reject(new Error(`ADB sync FAIL: ${msg}`));
          return;
        } else {
          stream.close();
          reject(new Error(`Unexpected sync response: ${resp.cmd}`));
          return;
        }
      }
    };

    stream.onClose = () => {
      // If we get here without resolving, assemble whatever we have
      if (chunks.length > 0) {
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const result = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { result.set(c, off); off += c.length; }
        resolve(result);
      } else {
        reject(new Error("Sync stream closed before receiving data"));
      }
    };

    // Send RECV command: "RECV" + path_length + path_bytes
    const pathBytes = textEnc.encode(remotePath);
    const recvCmd = encodeSyncCmd("RECV", pathBytes.length);
    const sendBuf = new Uint8Array(recvCmd.length + pathBytes.length);
    sendBuf.set(recvCmd, 0);
    sendBuf.set(pathBytes, recvCmd.length);
    stream.write(sendBuf).catch(reject);
  });
}
