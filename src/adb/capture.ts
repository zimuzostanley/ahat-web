// High-level ADB capture orchestration: process list, heap dump, file pull.

import { AdbDevice, ADB_DEVICE_FILTER } from "./device";
import { AdbKeyManager } from "./key-manager";
import { pullFile } from "./pull";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  name: string;
  pssKb: number;
  rssKb: number;
  javaHeapKb: number;
  nativeHeapKb: number;
  graphicsKb: number;
}

export type CapturePhase =
  | { step: "dumping"; pid: number }
  | { step: "waiting"; pid: number; elapsed: number }
  | { step: "pulling"; received: number; total: number }
  | { step: "cleaning" }
  | { step: "done"; buffer: ArrayBuffer };

// ─── Parse `dumpsys meminfo` output ──────────────────────────────────────────

/**
 * Parse `dumpsys meminfo` output. Tries detailed per-process sections first
 * (** MEMINFO in pid N [name] **), falling back to the summary "Total PSS by
 * process:" section when detailed sections aren't present.
 */
export function parseMemInfo(output: string): ProcessInfo[] {
  const detailed = parseDetailedSections(output);
  if (detailed.length > 0) return detailed;
  return parsePssSummary(output);
}

// ─── Detailed per-process section parser ─────────────────────────────────────

function parseDetailedSections(output: string): ProcessInfo[] {
  const results: ProcessInfo[] = [];
  let cur: ProcessInfo | null = null;

  for (const line of output.split("\n")) {
    // New process section header
    const hdr = line.match(/^\*\* MEMINFO in pid (\d+) \[(.+?)\]/);
    if (hdr) {
      if (cur && cur.pssKb > 0) results.push(cur);
      cur = { pid: parseInt(hdr[1], 10), name: hdr[2], pssKb: 0, rssKb: 0, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0 };
      continue;
    }

    // End of per-process sections
    if (line.includes("Total PSS by process:") || line.includes("Total PSS by OOM")) {
      if (cur && cur.pssKb > 0) results.push(cur);
      cur = null;
      break;
    }

    if (!cur) continue;
    const trimmed = line.trim();

    // Category PSS values (first number is PSS Total)
    if (trimmed.startsWith("Native Heap")) {
      const m = trimmed.match(/^Native Heap\s+(\d+)/);
      if (m) cur.nativeHeapKb = parseInt(m[1], 10);
    } else if (trimmed.startsWith("Dalvik Heap")) {
      const m = trimmed.match(/^Dalvik Heap\s+(\d+)/);
      if (m) cur.javaHeapKb = parseInt(m[1], 10);
    } else if (/^(Gfx dev|EGL mtrack|GL mtrack)\s/.test(trimmed)) {
      const m = trimmed.match(/^(?:Gfx dev|EGL mtrack|GL mtrack)\s+(\d+)/);
      if (m) cur.graphicsKb += parseInt(m[1], 10);
    } else if (/^TOTAL\s+\d/.test(trimmed) && !trimmed.startsWith("TOTAL PSS") && !trimmed.startsWith("TOTAL SWAP")) {
      // TOTAL row: columns are PSS, PrivDirty, PrivClean, SwapPss, RSS, ...
      const nums = trimmed.replace(/^TOTAL\s+/, "").split(/\s+/).filter(s => /^\d+$/.test(s)).map(Number);
      if (nums.length >= 1) cur.pssKb = nums[0];
      if (nums.length >= 5) cur.rssKb = nums[4];
    }
  }

  // Handle trailing section (no summary after it)
  if (cur && cur.pssKb > 0) results.push(cur);

  results.sort((a, b) => b.pssKb - a.pssKb);
  return results;
}

// ─── Fallback: summary-only parser ───────────────────────────────────────────

const SUMMARY_LINE = /^\s*([\d,]+)K:\s+(.+?)\s+\(pid\s+(\d+)\)/;

function parsePssSummary(output: string): ProcessInfo[] {
  const results: ProcessInfo[] = [];
  let inSection = false;

  for (const line of output.split("\n")) {
    if (line.includes("Total PSS by process:") || line.includes("Total PSS by OOM adjustment:")) {
      inSection = line.includes("Total PSS by process:");
      continue;
    }
    if (!inSection) continue;
    if (line.trim() === "" && results.length > 0) break;

    const m = SUMMARY_LINE.exec(line);
    if (m) {
      results.push({
        pssKb: parseInt(m[1].replace(/,/g, ""), 10),
        name: m[2],
        pid: parseInt(m[3], 10),
        rssKb: 0,
        javaHeapKb: 0,
        nativeHeapKb: 0,
        graphicsKb: 0,
      });
    }
  }

  results.sort((a, b) => b.pssKb - a.pssKb);
  return results;
}

// ─── AdbConnection ───────────────────────────────────────────────────────────

export class AdbConnection {
  private device: AdbDevice | null = null;
  private keyMgr = new AdbKeyManager();

  get connected(): boolean { return this.device?.connected ?? false; }
  get serial(): string { return this.device?.serial ?? ""; }
  get productName(): string { return this.device?.productName ?? ""; }

  /** Must be called from a user gesture (click handler). */
  async requestAndConnect(): Promise<void> {
    if (!navigator.usb) throw new Error("WebUSB not supported in this browser");
    const usbDev = await navigator.usb.requestDevice({ filters: [ADB_DEVICE_FILTER] });
    this.device = await AdbDevice.connect(usbDev, this.keyMgr);
    // Try to get root — best-effort, ignore failures (device may not be rooted)
    // Android su variants: "su 0 id" (toybox), "su -c id" (Magisk/SuperSU)
    for (const cmd of ["su 0 id", "su -c id"]) {
      try {
        const result = await this.device.shell(cmd);
        if (result.includes("uid=0")) break;
      } catch {
        // Not rooted or wrong su variant
      }
    }
  }

  /** Reconnect to a previously paired device. */
  async reconnect(usbDev: USBDevice): Promise<void> {
    this.device = await AdbDevice.connect(usbDev, this.keyMgr);
  }

  async getProcessList(): Promise<ProcessInfo[]> {
    if (!this.device) throw new Error("Not connected");
    const output = await this.device.shell("dumpsys -t 60 meminfo");
    return parseMemInfo(output);
  }

  /**
   * Capture a heap dump from the given process.
   * @param pid - process ID
   * @param withBitmaps - if true, uses `-b png` flag to include bitmap pixel data
   * @param onProgress - progress callback
   * @returns the .hprof file contents as an ArrayBuffer
   */
  async captureHeapDump(
    pid: number,
    withBitmaps: boolean,
    onProgress?: (phase: CapturePhase) => void,
  ): Promise<ArrayBuffer> {
    if (!this.device) throw new Error("Not connected");

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const remotePath = `/data/local/tmp/ahat_${pid}_${ts}.hprof`;

    // 1. Trigger heap dump
    const bmpFlag = withBitmaps ? "-b png " : "";
    const dumpCmd = `am dumpheap ${bmpFlag}${pid} ${remotePath}`;
    onProgress?.({ step: "dumping", pid });
    await this.device.shell(dumpCmd);

    // 2. Wait for dump to complete (file size stabilizes)
    onProgress?.({ step: "waiting", pid, elapsed: 0 });
    let lastSize = -1;
    let stableCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < 120; i++) { // Max 60 seconds
      await sleep(500);
      onProgress?.({ step: "waiting", pid, elapsed: Date.now() - startTime });

      let size: number;
      try {
        const out = await this.device.shell(`stat -c %s '${remotePath}' 2>/dev/null || echo -1`);
        size = parseInt(out.trim(), 10);
      } catch {
        size = -1;
      }

      if (size <= 0) {
        stableCount = 0;
        lastSize = -1;
        continue;
      }

      if (size === lastSize) {
        stableCount++;
        if (stableCount >= 3) break; // 1.5s of stable size = done
      } else {
        stableCount = 0;
        lastSize = size;
      }
    }

    if (lastSize <= 0) {
      throw new Error(`Heap dump failed: file not created at ${remotePath}`);
    }

    // 3. Pull file
    const data = await pullFile(this.device, remotePath, (received, total) => {
      onProgress?.({ step: "pulling", received, total });
    });

    // 4. Clean up remote file
    onProgress?.({ step: "cleaning" });
    try {
      await this.device.shell(`rm '${remotePath}'`);
    } catch {
      // Best-effort cleanup
    }

    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    onProgress?.({ step: "done", buffer });
    return buffer;
  }

  disconnect(): void {
    this.device?.close();
    this.device = null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
