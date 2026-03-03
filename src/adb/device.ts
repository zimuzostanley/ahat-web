// WebUSB ADB device connection, streams, and shell command execution.
// Adapted from Perfetto's adb_webusb_device.ts + adb_webusb_stream.ts +
// adb_webusb_utils.ts + adb_device.ts (Apache 2.0).

import {
  ADB_MSG_SIZE,
  AdbMsg,
  encodeAdbData,
  encodeAdbMsg,
  parseAdbMsgHdr,
} from "./protocol";
import { AdbKeyManager } from "./key-manager";

// ─── USB interface detection ─────────────────────────────────────────────────

export const ADB_DEVICE_FILTER: USBDeviceFilter = {
  classCode: 255,      // USB vendor specific
  subclassCode: 66,    // Android vendor specific
  protocolCode: 1,     // ADB
};

export interface AdbUsbInterface {
  readonly dev: USBDevice;
  readonly configurationValue: number;
  readonly usbInterfaceNumber: number;
  readonly rx: number;
  readonly tx: number;
  readonly txPacketSize: number;
}

export function getAdbInterface(device: USBDevice): AdbUsbInterface | null {
  if (!device.serialNumber) return null;
  for (const config of device.configurations) {
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        if (
          alt.interfaceClass === 255 &&
          alt.interfaceSubclass === 66 &&
          alt.interfaceProtocol === 1
        ) {
          const rxEp = alt.endpoints.find(e => e.type === "bulk" && e.direction === "in");
          const txEp = alt.endpoints.find(e => e.type === "bulk" && e.direction === "out");
          if (!rxEp || !txEp) continue;
          return {
            dev: device,
            configurationValue: config.configurationValue,
            usbInterfaceNumber: iface.interfaceNumber,
            rx: rxEp.endpointNumber,
            tx: txEp.endpointNumber,
            txPacketSize: txEp.packetSize,
          };
        }
      }
    }
  }
  return null;
}

// ─── ADB Stream ──────────────────────────────────────────────────────────────

export class AdbStream {
  private state: "CONNECTED" | "CLOSING" | "CLOSED" = "CONNECTED";
  onData: (data: Uint8Array) => void = () => {};
  onClose: () => void = () => {};

  constructor(
    private device: AdbDevice,
    readonly localId: number,
    readonly remoteId: number,
  ) {}

  get connected(): boolean { return this.state === "CONNECTED"; }

  write(data: string | Uint8Array): Promise<void> {
    if (this.state !== "CONNECTED") return Promise.resolve();
    return this.device._streamWrite(this, data);
  }

  close(): void {
    if (this.state !== "CONNECTED") return;
    this.state = "CLOSING";
    this.device._streamClose(this);
  }

  /** @internal Called by AdbDevice on CLSE receipt. */
  _notifyClose(): void {
    if (this.state === "CLOSED") return;
    this.state = "CLOSED";
    this.onClose();
  }
}

// ─── Deferred promise ────────────────────────────────────────────────────────

interface Deferred<T> extends Promise<T> {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const p = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return Object.assign(p, { resolve, reject });
}

// ─── ADB Device ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_PAYLOAD = 256 * 1024;
const VERSION_WITH_CHECKSUM = 0x01000000;
const VERSION_NO_CHECKSUM = 0x01000001;

const enum AuthCmd { TOKEN = 1, SIGNATURE = 2, PUBKEY = 3 }

interface PendingStream {
  promise: Deferred<AdbStream>;
  localId: number;
  svc: string;
}

interface TxEntry {
  stream: AdbStream;
  data: Uint8Array;
  promise?: Deferred<void>;
}

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

export class AdbDevice {
  private lastStreamId = 0;
  private _connected = true;
  private streams = new Map<number, AdbStream>();
  private pendingStreams = new Map<number, PendingStream>();
  private txQueue: TxEntry[] = [];
  private txPending = false;

  get connected(): boolean { return this._connected; }
  get serial(): string { return this.usb.dev.serialNumber ?? "unknown"; }
  get productName(): string { return this.usb.dev.productName ?? "Android device"; }

  private constructor(
    private readonly usb: AdbUsbInterface,
    private readonly maxPayload: number,
    private readonly useChecksum: boolean,
  ) {
    // Start background RX loop
    this.rxLoop().catch(err => {
      if (this._connected) console.error("[adb] RX loop error:", err);
      this._connected = false;
    });
  }

  /** Connect to a USB device and perform ADB handshake. */
  static async connect(usbdev: USBDevice, keyMgr: AdbKeyManager): Promise<AdbDevice> {
    const usb = getAdbInterface(usbdev);
    if (!usb) throw new Error("No ADB interface found on device");

    if (usbdev.opened) await usbdev.close();
    await usbdev.open();

    try {
      await usbdev.selectConfiguration(usb.configurationValue);
      await usbdev.claimInterface(usb.usbInterfaceNumber);
    } catch (e) {
      await usbdev.close();
      throw new Error(
        "Failed to claim USB interface. Try `adb kill-server` or close other " +
        "ADB clients and try again. " + (e instanceof Error ? e.message : String(e)),
      );
    }

    const key = await keyMgr.getOrCreateKey();

    // Send CNXN
    await AdbDevice.sendRaw(usb, "CNXN", VERSION_NO_CHECKSUM, DEFAULT_MAX_PAYLOAD, "host:1:ahat.web");

    // Auth handshake with tolerance for queued messages from previous sessions
    let authAttempts = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const msg = await AdbDevice.recvMsg(usb);

      if (msg.cmd === "CNXN") {
        // Authenticated
        const maxPayload = msg.arg1;
        const ver = msg.arg0;
        if (ver !== VERSION_WITH_CHECKSUM && ver !== VERSION_NO_CHECKSUM) {
          await usbdev.close();
          throw new Error(`Unsupported ADB version: 0x${ver.toString(16)}`);
        }
        return new AdbDevice(usb, maxPayload, ver === VERSION_WITH_CHECKSUM);
      }

      if (msg.cmd !== "AUTH") {
        // Spurious message from previous session, skip
        continue;
      }

      if (msg.arg0 !== AuthCmd.TOKEN) continue;

      if (authAttempts === 0) {
        // Sign the nonce with our private key
        const signed = key.sign(msg.data);
        await AdbDevice.sendRaw(usb, "AUTH", AuthCmd.SIGNATURE, 0, signed);
        authAttempts++;
        continue;
      }

      if (authAttempts === 1) {
        // Present public key — device will show "Allow USB debugging?" dialog
        await AdbDevice.sendRaw(usb, "AUTH", AuthCmd.PUBKEY, 0, key.getPublicKey());
        authAttempts++;
        continue;
      }

      break;
    }

    await usbdev.close();
    throw new Error("ADB authorization failed. Please allow USB debugging on the device and try again.");
  }

  /** Open an ADB stream to a service. */
  async createStream(svc: string): Promise<AdbStream> {
    const ps: PendingStream = {
      promise: defer<AdbStream>(),
      localId: ++this.lastStreamId,
      svc,
    };
    this.pendingStreams.set(ps.localId, ps);
    this.send("OPEN", ps.localId, 0, svc);
    return ps.promise;
  }

  /** Run a shell command, collect all output, return as string. */
  async shell(cmd: string): Promise<string> {
    const stream = await this.createStream(`shell:${cmd}`);
    const chunks: Uint8Array[] = [];
    const done = defer<string>();
    stream.onData = (data: Uint8Array) => chunks.push(data.slice());
    stream.onClose = () => {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      done.resolve(textDec.decode(buf).trimEnd());
    };
    return done;
  }

  /** Run a shell command and stream binary output. */
  async shellRaw(cmd: string): Promise<{ stream: AdbStream; data: Promise<Uint8Array> }> {
    const stream = await this.createStream(`shell:${cmd}`);
    const chunks: Uint8Array[] = [];
    const done = defer<Uint8Array>();
    stream.onData = (data: Uint8Array) => chunks.push(data.slice());
    stream.onClose = () => {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.length; }
      done.resolve(buf);
    };
    return { stream, data: done };
  }

  close(): void {
    this._connected = false;
    for (const stream of this.streams.values()) {
      this._streamClose(stream);
    }
    if (this.usb.dev.opened) {
      this.usb.dev.close().catch(() => {});
    }
  }

  // ── Internal stream operations (called by AdbStream) ────────────────────

  /** @internal */
  _streamWrite(stream: AdbStream, data: string | Uint8Array): Promise<void> {
    const promise = defer<void>();
    const raw = typeof data === "string" ? textEnc.encode(data) : data;
    let sent = 0;
    while (sent < raw.byteLength) {
      const chunkLen = Math.min(this.maxPayload, raw.byteLength - sent);
      const chunk = raw.subarray(sent, sent + chunkLen);
      sent += chunkLen;
      const entry: TxEntry = {
        stream,
        data: chunk,
        promise: sent === raw.byteLength ? promise : undefined,
      };
      this.txQueue.push(entry);
      if (!this.txPending && this.txQueue.length === 1) {
        this.drainTx(entry);
      }
    }
    return promise;
  }

  /** @internal */
  _streamClose(stream: AdbStream): void {
    this.txQueue = this.txQueue.filter(tx => tx.stream !== stream);
    this.send("CLSE", stream.localId, stream.remoteId);
    this.streams.delete(stream.localId);
    stream._notifyClose();
  }

  // ── TX/RX internals ─────────────────────────────────────────────────────

  private drainTx(entry: TxEntry): void {
    this.txPending = true;
    this.send("WRTE", entry.stream.localId, entry.stream.remoteId, entry.data);
  }

  private async rxLoop(): Promise<void> {
    while (this._connected) {
      const msg = await AdbDevice.recvMsg(this.usb);
      this.handleMsg(msg);
    }
  }

  private handleMsg(msg: AdbMsg): void {
    if (msg.cmd === "OKAY") {
      const localId = msg.arg1;
      const remoteId = msg.arg0;

      // Check if this is an ACK for a pending stream open
      const ps = this.pendingStreams.get(localId);
      if (ps) {
        this.pendingStreams.delete(localId);
        const stream = new AdbStream(this, localId, remoteId);
        this.streams.set(localId, stream);
        ps.promise.resolve(stream);
        return;
      }

      // Otherwise it's an ACK for a WRTE — pop from tx queue and send next
      const idx = this.txQueue.findIndex(
        tx => tx.stream.localId === localId && tx.stream.remoteId === remoteId,
      );
      if (idx >= 0) {
        const [entry] = this.txQueue.splice(idx, 1);
        this.txPending = false;
        entry.promise?.resolve();
        const next = this.txQueue[0];
        if (next) this.drainTx(next);
      }
    } else if (msg.cmd === "WRTE") {
      const localId = msg.arg1;
      const stream = this.streams.get(localId);
      if (!stream) return;
      // ACK the write
      this.send("OKAY", stream.localId, stream.remoteId);
      stream.onData(msg.data);
    } else if (msg.cmd === "CLSE") {
      const localId = msg.arg1;
      // Check pending stream failure
      const ps = this.pendingStreams.get(localId);
      if (ps) {
        this.pendingStreams.delete(localId);
        ps.promise.reject(new Error(`Stream '${ps.svc}' failed to open`));
        return;
      }
      const stream = this.streams.get(localId);
      if (stream) {
        this.streams.delete(localId);
        stream._notifyClose();
      }
    }
  }

  private send(cmd: string, arg0: number, arg1: number, data?: Uint8Array | string): void {
    if (!this._connected) return;
    AdbDevice.sendRaw(this.usb, cmd, arg0, arg1, data, this.useChecksum).catch(err => {
      console.error("[adb] send error:", err);
      this._connected = false;
    });
  }

  private static async recvMsg(usb: AdbUsbInterface): Promise<AdbMsg> {
    const hdrResult = await usb.dev.transferIn(usb.rx, ADB_MSG_SIZE);
    if (!hdrResult.data || hdrResult.status !== "ok") {
      throw new Error(`USB transfer failed: ${hdrResult.status}`);
    }
    const hdr = parseAdbMsgHdr(hdrResult.data);
    let payload = new Uint8Array(0);
    if (hdr.dataLen > 0) {
      const payResult = await usb.dev.transferIn(usb.rx, hdr.dataLen);
      if (!payResult.data || payResult.status !== "ok") {
        throw new Error(`USB data transfer failed: ${payResult.status}`);
      }
      payload = new Uint8Array(
        payResult.data.buffer,
        payResult.data.byteOffset,
        payResult.data.byteLength,
      ).slice();
    }
    return { ...hdr, data: payload };
  }

  private static async sendRaw(
    usb: AdbUsbInterface,
    cmd: string,
    arg0: number,
    arg1: number,
    data?: Uint8Array | string,
    useChecksum = false,
  ): Promise<void> {
    const payload = encodeAdbData(data);
    const header = encodeAdbMsg(cmd, arg0, arg1, payload, useChecksum);
    await usb.dev.transferOut(usb.tx, header as BufferSource);
    if (payload.length > 0) {
      await usb.dev.transferOut(usb.tx, payload as BufferSource);
      // Zero-length packet if data fits exactly into USB packets
      if (payload.length % usb.txPacketSize === 0) {
        await usb.dev.transferOut(usb.tx, new Uint8Array(0));
      }
    }
  }
}
