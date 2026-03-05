// High-level ADB capture orchestration: process list, heap dump, file pull.

import { AdbDevice, ADB_DEVICE_FILTER } from "./device";
import { AdbKeyManager } from "./key-manager";
import { pullFile } from "./pull";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProcessInfo {
  pid: number;
  name: string;
  oomLabel: string;
  pssKb: number;
  rssKb: number;
  javaHeapKb: number;
  nativeHeapKb: number;
  graphicsKb: number;
  codeKb: number;
  debuggable?: boolean;
}

export interface GlobalMemInfo {
  totalRamKb: number;
  freeRamKb: number;
  usedPssKb: number;
  lostRamKb: number;
  zramPhysicalKb: number;
  swapTotalKb: number;
  swapFreeKb: number;
  memAvailableKb: number;
  buffersKb: number;
  cachedKb: number;
}

/** A single VMA entry from /proc/<pid>/smaps. */
export interface SmapsEntry {
  addrStart: string;
  addrEnd: string;
  perms: string;
  name: string;
  dev: string;
  inode: number;
  sizeKb: number;
  rssKb: number;
  pssKb: number;
  sharedCleanKb: number;
  sharedDirtyKb: number;
  privateCleanKb: number;
  privateDirtyKb: number;
  swapKb: number;
  swapPssKb: number;
}

/** VMAs aggregated by mapped file/region name. */
export interface SmapsAggregated {
  name: string;
  count: number;
  sizeKb: number;
  rssKb: number;
  pssKb: number;
  sharedCleanKb: number;
  sharedDirtyKb: number;
  privateCleanKb: number;
  privateDirtyKb: number;
  swapKb: number;
  swapPssKb: number;
  entries: SmapsEntry[];
}

/** Per-process smaps rollup summary from /proc/<pid>/smaps_rollup. */
export interface SmapsRollup {
  sizeKb: number;
  rssKb: number;
  pssKb: number;
  sharedCleanKb: number;
  sharedDirtyKb: number;
  privateCleanKb: number;
  privateDirtyKb: number;
  swapKb: number;
  swapPssKb: number;
}

/** Per-process contribution to a cross-process shared mapping. */
export interface SharedMappingProcess {
  pid: number;
  name: string;
  pssKb: number;
  rssKb: number;
  sizeKb: number;
  sharedCleanKb: number;
  sharedDirtyKb: number;
  privateCleanKb: number;
  privateDirtyKb: number;
  swapKb: number;
}

/** A mapping name aggregated across all processes. */
export interface SharedMapping {
  name: string;
  processCount: number;
  pssKb: number;
  rssKb: number;
  sizeKb: number;
  sharedCleanKb: number;
  sharedDirtyKb: number;
  privateCleanKb: number;
  privateDirtyKb: number;
  swapKb: number;
  processes: SharedMappingProcess[];
}

// Map compact-format OOM adj labels to human-readable AOSP process states.
// Labels from dumpsys meminfo -c: native, sys, pers, fore, vis, percep,
// backup, heavy, svcb, svcrst, home, prev, lstact, bfgs, fgs, btop, top,
// cch (with numeric suffix)
const OOM_LABEL_MAP: Record<string, string> = {
  // Current AOSP STATE_NAMES_CSV (ProcessStats)
  pers: "Persistent",
  top: "Top",
  bfgs: "Bound FG Service",
  btop: "Bound Top",
  fgs: "FG Service",
  fg: "Foreground",
  impfg: "Important Foreground",
  impbg: "Important Background",
  backup: "Backup",
  service: "Service",
  "service-rs": "Service Restarting",
  receiver: "Receiver",
  heavy: "Heavy Weight",
  home: "Home",
  lastact: "Last Activity",
  cached: "Cached",
  cch: "Cached",
  frzn: "Frozen",
  // Older Android versions / alternative labels
  native: "Native",
  sys: "System",
  fore: "Foreground",
  foreground: "Foreground",
  vis: "Visible",
  visible: "Visible",
  percep: "Perceptible",
  perceptible: "Perceptible",
  svcb: "Service B",
  svcrst: "Service Restarting",
  prev: "Previous",
  lstact: "Last Activity",
};

function mapOomLabel(raw: string): string {
  // Labels like "cch1", "cch2" → strip trailing digits
  const base = raw.replace(/\d+$/, "");
  return OOM_LABEL_MAP[base] ?? raw;
}

export type CapturePhase =
  | { step: "dumping"; pid: number }
  | { step: "waiting"; pid: number; elapsed: number }
  | { step: "pulling"; received: number; total: number }
  | { step: "cleaning" }
  | { step: "done"; buffer: ArrayBuffer };

// ─── Parse `dumpsys activity lru` ────────────────────────────────────────────

// Matches: "  #0: fg     TOP  LCM 1234:com.android.systemui/u0a45 act:activities"
// Also:    "  #15: cch+75 CEM 9012:com.google.android.gms/u0a67"
const LRU_LINE = /^\s*#\d+:\s+(\S+)\s+.*?\s(\d+):([^\s/]+)/;

/** Parse `dumpsys activity lru` output into Java process list with OOM labels. */
export function parseLruProcesses(output: string): ProcessInfo[] {
  const results: ProcessInfo[] = [];
  const seen = new Set<number>();

  for (const line of output.split("\n")) {
    const m = LRU_LINE.exec(line);
    if (!m) continue;
    const pid = parseInt(m[2], 10);
    if (!isFinite(pid) || seen.has(pid)) continue;
    seen.add(pid);
    const oomRaw = m[1].replace(/\+\d+$/, ""); // strip "+75" suffix from "cch+75"
    results.push({
      pid,
      name: m[3],
      oomLabel: mapOomLabel(oomRaw),
      pssKb: 0, rssKb: 0,
      javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0,
    });
  }
  return results;
}

/** Key system processes to pin at the top of the process list. */
export const PINNED_PROCESSES = new Set(["system_server", "com.android.systemui"]);

// ─── AdbConnection ───────────────────────────────────────────────────────────

export class AdbConnection {
  private device: AdbDevice | null = null;
  private keyMgr = new AdbKeyManager();
  private _isRoot = false;
  private _suPrefix = "";

  get connected(): boolean { return this.device?.connected ?? false; }
  get serial(): string { return this.device?.serial ?? ""; }
  get productName(): string { return this.device?.productName ?? ""; }
  get isRoot(): boolean { return this._isRoot; }

  /** Must be called from a user gesture (click handler). */
  async requestAndConnect(onStatus?: (msg: string) => void): Promise<void> {
    if (!navigator.usb) throw new Error("WebUSB not supported in this browser");
    const usbDev = await navigator.usb.requestDevice({ filters: [ADB_DEVICE_FILTER] });
    onStatus?.("Authorize on device\u2026");
    this.device = await AdbDevice.connect(usbDev, this.keyMgr);
    // Try to get root — best-effort, ignore failures (device may not be rooted)
    // Android su variants: "su 0 id" (toybox), "su -c id" (Magisk/SuperSU)
    this._isRoot = false;
    this._suPrefix = "";
    for (const prefix of ["su 0", "su -c"]) {
      try {
        const result = await this.device.shell(`${prefix} id`);
        if (result.includes("uid=0")) {
          this._isRoot = true;
          this._suPrefix = prefix;
          break;
        }
      } catch {
        // Not rooted or wrong su variant
      }
    }
  }

  /** Find debuggable packages on the device. */
  async getDebuggablePackages(signal?: AbortSignal): Promise<Set<string>> {
    if (!this.device) return new Set();
    try {
      const out = await this.device.shell(
        "dumpsys package | grep -E 'Package \\[|pkgFlags='", signal,
      );
      const result = new Set<string>();
      let currentPkg = "";
      for (const line of out.split("\n")) {
        const pkgMatch = line.match(/Package \[([^\]]+)\]/);
        if (pkgMatch) { currentPkg = pkgMatch[1]; continue; }
        if (currentPkg && /pkgFlags=.*DEBUGGABLE/.test(line)) {
          result.add(currentPkg);
          currentPkg = "";
        }
      }
      return result;
    } catch {
      return new Set();
    }
  }

  /** Fast Java process list from `dumpsys activity lru`. */
  async getLruProcesses(signal?: AbortSignal): Promise<ProcessInfo[]> {
    if (!this.device) throw new Error("Not connected");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const output = await this.device.shell("dumpsys activity lru", signal);
    return parseLruProcesses(output);
  }

  /** Get PIDs for pinned system processes not already in the list. */
  async getPinnedProcesses(excludePids: Set<number>, signal?: AbortSignal): Promise<ProcessInfo[]> {
    if (!this.device) throw new Error("Not connected");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const results: ProcessInfo[] = [];
    for (const name of PINNED_PROCESSES) {
      const output = (await this.device.shell(`pidof ${name}`, signal)).trim();
      const pid = parseInt(output, 10);
      if (!isFinite(pid) || excludePids.has(pid)) continue;
      results.push({
        pid, name, oomLabel: "System",
        pssKb: 0, rssKb: 0,
        javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0,
      });
    }
    return results;
  }

  /**
   * Capture a heap dump from the given process.
   * @param pid - process ID
   * @param withBitmaps - if true, uses `-b png` flag to include bitmap pixel data
   * @param onProgress - progress callback
   * @param signal - abort signal to cancel the operation
   * @returns the .hprof file contents as an ArrayBuffer
   */
  async captureHeapDump(
    pid: number,
    withBitmaps: boolean,
    onProgress?: (phase: CapturePhase) => void,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    if (!this.device) throw new Error("Not connected");

    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const remotePath = `/data/local/tmp/ahat_${pid}_${ts}.hprof`;

    const cleanup = async () => {
      try { await this.device?.shell(`rm '${remotePath}'`); } catch { /* best-effort */ }
    };

    // 1. Trigger heap dump
    const bmpFlag = withBitmaps ? "-b png " : "";
    const dumpCmd = `am dumpheap ${bmpFlag}${pid} ${remotePath}`;
    onProgress?.({ step: "dumping", pid });
    try {
      await this.device.shell(dumpCmd, signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") { await cleanup(); throw e; }
      throw e;
    }

    // 2. Wait for dump to complete (file size stabilizes)
    onProgress?.({ step: "waiting", pid, elapsed: 0 });
    let lastSize = -1;
    let stableCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < 120; i++) { // Max 60 seconds
      try {
        await abortableSleep(500, signal);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") { await cleanup(); throw e; }
        throw e;
      }
      onProgress?.({ step: "waiting", pid, elapsed: Date.now() - startTime });

      let size: number;
      try {
        const out = await this.device.shell(`stat -c %s '${remotePath}' 2>/dev/null || echo -1`, signal);
        size = parseInt(out.trim(), 10) || -1;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") { await cleanup(); throw e; }
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
    let data: Uint8Array;
    try {
      data = await pullFile(this.device, remotePath, (received, total) => {
        onProgress?.({ step: "pulling", received, total });
      }, signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") { await cleanup(); throw e; }
      throw e;
    }

    // 4. Clean up remote file
    onProgress?.({ step: "cleaning" });
    await cleanup();

    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    onProgress?.({ step: "done", buffer });
    return buffer;
  }

  /** Fetch parsed smaps data for a single process (requires root). */
  async getSmapsForPid(pid: number, signal?: AbortSignal): Promise<SmapsEntry[]> {
    if (!this.device) throw new Error("Not connected");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const cmd = this._suPrefix === "su -c"
      ? `su -c 'cat /proc/${pid}/smaps'`
      : `su 0 cat /proc/${pid}/smaps`;
    const output = await this.device.shell(cmd, signal);
    return parseSmaps(output);
  }

  /**
   * Root fast path: single shell command iterates /proc, reads cmdline + smaps_rollup.
   * Java detection: cmdline not starting with "/" or "[" is a Java/ART process.
   */
  async getProcessesFromProc(signal?: AbortSignal): Promise<{
    list: ProcessInfo[];
    rollups: Map<number, SmapsRollup>;
    javaPids: Set<number>;
  }> {
    if (!this.device || !this._isRoot) return { list: [], rollups: new Map(), javaPids: new Set() };
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // Shell vars can't hold nulls, so $(cat cmdline) yields just argv[0] — the process name.
    // Fallback to comm (16-char truncated) if cmdline is empty (kernel threads).
    const inner = 'for p in /proc/[0-9]*/smaps_rollup;do d=${p%/smaps_rollup};pid=${d##*/};name=$(cat /proc/$pid/cmdline 2>/dev/null);[ -z "$name" ]&&name=$(cat /proc/$pid/comm 2>/dev/null);echo "===PID:$pid===$name";cat $p 2>/dev/null;done';
    const cmd = this._suPrefix === "su -c"
      ? `su -c '${inner}'`
      : `su 0 sh -c '${inner}'`;

    const output = await this.device.shell(cmd, signal);
    const parsed = parseSmapsRollups(output);

    const javaPids = new Set<number>();
    const rollups = new Map<number, SmapsRollup>();
    const list: ProcessInfo[] = [];

    for (const [pid, data] of parsed) {
      const name = (data.name ?? "").trim();
      if (!name) continue;
      rollups.set(pid, data);
      if (!name.startsWith("/") && !name.startsWith("[")) {
        javaPids.add(pid);
      }
      list.push({
        pid, name, oomLabel: "",
        pssKb: data.pssKb, rssKb: data.rssKb,
        javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0,
      });
    }
    list.sort((a, b) => b.pssKb - a.pssKb);
    return { list, rollups, javaPids };
  }

  /** Fetch /proc/meminfo for extra global memory details (root-only). */
  async getProcMeminfo(signal?: AbortSignal): Promise<Partial<GlobalMemInfo>> {
    if (!this.device || !this._isRoot) return {};
    try {
      const cmd = this._suPrefix === "su -c"
        ? "su -c 'cat /proc/meminfo'"
        : "su 0 cat /proc/meminfo";
      const output = await this.device.shell(cmd, signal);
      return parseProcMeminfo(output);
    } catch {
      return {};
    }
  }

  /**
   * Progressively fetch smaps for all processes (biggest PSS first).
   * Fires onData per process as results arrive. Respects abort signal.
   */
  async fetchAllSmaps(
    processes: ProcessInfo[],
    onData?: (pid: number, data: SmapsAggregated[]) => void,
    onProgress?: (completed: number, total: number, current: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.device || !this._isRoot) return;
    const sorted = [...processes].sort((a, b) => b.pssKb - a.pssKb);

    for (let i = 0; i < sorted.length; i++) {
      if (signal?.aborted || !this.device?.connected) break;
      const proc = sorted[i];
      onProgress?.(i, sorted.length, proc.name);

      try {
        const entries = await this.getSmapsForPid(proc.pid, signal);
        if (entries.length > 0) {
          const aggregated = aggregateSmaps(entries);
          onData?.(proc.pid, aggregated);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") break;
        // Process may have died — skip
      }
    }

    onProgress?.(sorted.length, sorted.length, "");
  }

  /** Dump raw memory from /proc/<pid>/mem for one or more VMA regions. */
  async dumpVmaMemory(
    pid: number,
    regions: { addrStart: string; addrEnd: string }[],
    onProgress: (status: string) => void,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (!this.device) throw new Error("Not connected");
    if (!this._isRoot) throw new Error("Root required");
    if (regions.length === 0) throw new Error("No regions");

    const tmpPath = `/data/local/tmp/vma_${pid}_${Date.now()}.bin`;
    const ddCmds = regions.map((r, i) => {
      const startByte = parseInt(r.addrStart, 16);
      const endByte = parseInt(r.addrEnd, 16);
      const startPage = Math.floor(startByte / 4096);
      const numPages = Math.ceil((endByte - startByte) / 4096);
      const redir = i === 0 ? ">" : ">>";
      return `dd if=/proc/${pid}/mem bs=4096 skip=${startPage} count=${numPages} ${redir} ${tmpPath} 2>/dev/null`;
    });

    try {
      onProgress("Reading memory\u2026");
      const shellCmd = this._suPrefix === "su -c"
        ? `su -c '${ddCmds.join(" && ")}'`
        : `su 0 sh -c '${ddCmds.join(" && ")}'`;
      await this.device.shell(shellCmd, signal);

      onProgress("Pulling\u2026");
      const data = await pullFile(this.device, tmpPath,
        (received, total) => {
          const mb = (received / 1_048_576).toFixed(1);
          const pct = total > 0 ? Math.round(100 * received / total) : 0;
          onProgress(`Pulling: ${mb} MiB (${pct}%)`);
        },
        signal,
      );
      return data;
    } finally {
      try { await this.device?.shell(`rm -f ${tmpPath}`); } catch { /* ignore */ }
    }
  }

  disconnect(): void {
    this.device?.close();
    this.device = null;
    this._isRoot = false;
    this._suPrefix = "";
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ─── Smaps parsing ──────────────────────────────────────────────────────────

const SMAPS_HEADER_RE = /^([0-9a-f]+)-([0-9a-f]+)\s+([\w-]{4})\s+[0-9a-f]+\s+([0-9a-f]+:[0-9a-f]+)\s+(\d+)\s*(.*)?$/i;
const SMAPS_KV_RE = /^(\w[\w_]*):\s+(\d+)\s+kB$/i;

/** Parse raw /proc/<pid>/smaps output into individual VMA entries. */
export function parseSmaps(output: string): SmapsEntry[] {
  const entries: SmapsEntry[] = [];
  let cur: SmapsEntry | null = null;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const hdr = SMAPS_HEADER_RE.exec(trimmed);
    if (hdr) {
      if (cur) entries.push(cur);
      cur = {
        addrStart: hdr[1], addrEnd: hdr[2], perms: hdr[3],
        dev: hdr[4], inode: parseInt(hdr[5], 10) || 0,
        name: (hdr[6] ?? "").trim(),
        sizeKb: 0, rssKb: 0, pssKb: 0,
        sharedCleanKb: 0, sharedDirtyKb: 0,
        privateCleanKb: 0, privateDirtyKb: 0,
        swapKb: 0, swapPssKb: 0,
      };
      continue;
    }

    if (!cur) continue;
    const kv = SMAPS_KV_RE.exec(trimmed);
    if (kv) {
      const val = parseInt(kv[2], 10) || 0;
      switch (kv[1]) {
        case "Size": cur.sizeKb = val; break;
        case "Rss": cur.rssKb = val; break;
        case "Pss": cur.pssKb = val; break;
        case "Shared_Clean": cur.sharedCleanKb = val; break;
        case "Shared_Dirty": cur.sharedDirtyKb = val; break;
        case "Private_Clean": cur.privateCleanKb = val; break;
        case "Private_Dirty": cur.privateDirtyKb = val; break;
        case "Swap": cur.swapKb = val; break;
        case "SwapPss": cur.swapPssKb = val; break;
      }
    }
  }

  if (cur) entries.push(cur);
  return entries;
}

/** Group SmapsEntry[] by name, summing all numeric fields. Sorted by PSS desc. */
export function aggregateSmaps(entries: SmapsEntry[]): SmapsAggregated[] {
  const groups = new Map<string, SmapsAggregated>();

  for (const e of entries) {
    const key = e.name || "[anonymous]";
    let g = groups.get(key);
    if (!g) {
      g = {
        name: key, count: 0,
        sizeKb: 0, rssKb: 0, pssKb: 0,
        sharedCleanKb: 0, sharedDirtyKb: 0,
        privateCleanKb: 0, privateDirtyKb: 0,
        swapKb: 0, swapPssKb: 0,
        entries: [],
      };
      groups.set(key, g);
    }
    g.count++;
    g.sizeKb += e.sizeKb;
    g.rssKb += e.rssKb;
    g.pssKb += e.pssKb;
    g.sharedCleanKb += e.sharedCleanKb;
    g.sharedDirtyKb += e.sharedDirtyKb;
    g.privateCleanKb += e.privateCleanKb;
    g.privateDirtyKb += e.privateDirtyKb;
    g.swapKb += e.swapKb;
    g.swapPssKb += e.swapPssKb;
    g.entries.push(e);
  }

  const result = [...groups.values()];
  result.sort((a, b) => b.pssKb - a.pssKb);
  return result;
}

/** Parse batch smaps_rollup output delimited by ===PID:N===name markers.
 *  Supports both `===PID:123===` (no name) and `===PID:123===com.foo` formats. */
export function parseSmapsRollups(output: string): Map<number, SmapsRollup & { name?: string }> {
  const result = new Map<number, SmapsRollup & { name?: string }>();
  let pid = -1;
  let name: string | undefined;
  let r: SmapsRollup = { sizeKb: 0, rssKb: 0, pssKb: 0, sharedCleanKb: 0, sharedDirtyKb: 0, privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0, swapPssKb: 0 };
  let hasData = false;

  for (const line of output.split("\n")) {
    const m = line.match(/^===PID:(\d+)===(.*)$/);
    if (m) {
      if (pid >= 0 && hasData) result.set(pid, name ? { ...r, name } : r);
      pid = parseInt(m[1], 10);
      name = m[2] || undefined;
      r = { sizeKb: 0, rssKb: 0, pssKb: 0, sharedCleanKb: 0, sharedDirtyKb: 0, privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0, swapPssKb: 0 };
      hasData = false;
      continue;
    }
    if (pid < 0) continue;
    const kv = SMAPS_KV_RE.exec(line.trim());
    if (kv) {
      const val = parseInt(kv[2], 10) || 0;
      switch (kv[1]) {
        case "Size": r.sizeKb = val; hasData = true; break;
        case "Rss": r.rssKb = val; hasData = true; break;
        case "Pss": r.pssKb = val; hasData = true; break;
        case "Shared_Clean": r.sharedCleanKb = val; hasData = true; break;
        case "Shared_Dirty": r.sharedDirtyKb = val; hasData = true; break;
        case "Private_Clean": r.privateCleanKb = val; hasData = true; break;
        case "Private_Dirty": r.privateDirtyKb = val; hasData = true; break;
        case "Swap": r.swapKb = val; hasData = true; break;
        case "SwapPss": r.swapPssKb = val; hasData = true; break;
      }
    }
  }
  if (pid >= 0 && hasData) result.set(pid, name ? { ...r, name } : r);
  return result;
}

/** Aggregate smaps data across all processes, grouping by mapping identity.
 *  File-backed mappings (inode > 0) are keyed by dev:inode to avoid pathname collisions.
 *  Anonymous mappings (inode == 0) are keyed by name. Sorted by total PSS descending. */
export function aggregateSharedMappings(
  smapsData: Map<number, SmapsAggregated[]>,
  processes: ProcessInfo[],
): SharedMapping[] {
  const procByPid = new Map(processes.map(p => [p.pid, p]));
  const byKey = new Map<string, SharedMapping>();

  for (const [pid, aggregated] of smapsData) {
    const proc = procByPid.get(pid);
    if (!proc) continue;

    for (const agg of aggregated) {
      // Use dev:inode for file-backed, name for anonymous
      const firstEntry = agg.entries[0];
      const key = firstEntry && firstEntry.inode > 0
        ? `${firstEntry.dev}:${firstEntry.inode}`
        : agg.name;

      let mapping = byKey.get(key);
      if (!mapping) {
        mapping = {
          name: agg.name, processCount: 0,
          pssKb: 0, rssKb: 0, sizeKb: 0,
          sharedCleanKb: 0, sharedDirtyKb: 0,
          privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0,
          processes: [],
        };
        byKey.set(key, mapping);
      }
      mapping.processCount++;
      mapping.pssKb += agg.pssKb;
      mapping.rssKb += agg.rssKb;
      mapping.sizeKb += agg.sizeKb;
      mapping.sharedCleanKb += agg.sharedCleanKb;
      mapping.sharedDirtyKb += agg.sharedDirtyKb;
      mapping.privateCleanKb += agg.privateCleanKb;
      mapping.privateDirtyKb += agg.privateDirtyKb;
      mapping.swapKb += agg.swapKb;
      mapping.processes.push({
        pid, name: proc.name,
        pssKb: agg.pssKb, rssKb: agg.rssKb, sizeKb: agg.sizeKb,
        sharedCleanKb: agg.sharedCleanKb, sharedDirtyKb: agg.sharedDirtyKb,
        privateCleanKb: agg.privateCleanKb, privateDirtyKb: agg.privateDirtyKb,
        swapKb: agg.swapKb,
      });
    }
  }

  const result = [...byKey.values()];
  result.sort((a, b) => b.pssKb - a.pssKb);
  for (const m of result) m.processes.sort((a, b) => b.pssKb - a.pssKb);
  return result;
}

export interface SharedMappingDiff {
  status: DiffStatus;
  current: SharedMapping;
  prev: SharedMapping | null;
  deltaPssKb: number;
  deltaRssKb: number;
  deltaSizeKb: number;
  deltaSharedCleanKb: number;
  deltaSharedDirtyKb: number;
  deltaPrivateCleanKb: number;
  deltaPrivateDirtyKb: number;
  deltaSwapKb: number;
  deltaProcessCount: number;
}

/** Diff two SharedMapping arrays by name. */
export function diffSharedMappings(prev: SharedMapping[], current: SharedMapping[]): SharedMappingDiff[] {
  const prevByName = new Map(prev.map(m => [m.name, m]));
  const result: SharedMappingDiff[] = [];
  const matchedNames = new Set<string>();

  for (const cur of current) {
    const old = prevByName.get(cur.name);
    if (old) {
      matchedNames.add(cur.name);
      result.push({
        status: "matched", current: cur, prev: old,
        deltaSizeKb: cur.sizeKb - old.sizeKb, deltaRssKb: cur.rssKb - old.rssKb,
        deltaPssKb: cur.pssKb - old.pssKb,
        deltaSharedCleanKb: cur.sharedCleanKb - old.sharedCleanKb,
        deltaSharedDirtyKb: cur.sharedDirtyKb - old.sharedDirtyKb,
        deltaPrivateCleanKb: cur.privateCleanKb - old.privateCleanKb,
        deltaPrivateDirtyKb: cur.privateDirtyKb - old.privateDirtyKb,
        deltaSwapKb: cur.swapKb - old.swapKb,
        deltaProcessCount: cur.processCount - old.processCount,
      });
    } else {
      result.push({
        status: "added", current: cur, prev: null,
        deltaSizeKb: cur.sizeKb, deltaRssKb: cur.rssKb, deltaPssKb: cur.pssKb,
        deltaSharedCleanKb: cur.sharedCleanKb, deltaSharedDirtyKb: cur.sharedDirtyKb,
        deltaPrivateCleanKb: cur.privateCleanKb, deltaPrivateDirtyKb: cur.privateDirtyKb,
        deltaSwapKb: cur.swapKb, deltaProcessCount: cur.processCount,
      });
    }
  }

  for (const old of prev) {
    if (!matchedNames.has(old.name)) {
      result.push({
        status: "removed", current: old, prev: old,
        deltaSizeKb: -old.sizeKb, deltaRssKb: -old.rssKb, deltaPssKb: -old.pssKb,
        deltaSharedCleanKb: -old.sharedCleanKb, deltaSharedDirtyKb: -old.sharedDirtyKb,
        deltaPrivateCleanKb: -old.privateCleanKb, deltaPrivateDirtyKb: -old.privateDirtyKb,
        deltaSwapKb: -old.swapKb, deltaProcessCount: -old.processCount,
      });
    }
  }

  return result;
}

// ─── Global memory info parsers ─────────────────────────────────────────────

/** Parse /proc/meminfo kernel output. */
export function parseProcMeminfo(output: string): Partial<GlobalMemInfo> {
  const result: Partial<GlobalMemInfo> = {};
  for (const line of output.split("\n")) {
    const m = line.match(/^(\w+):\s+(\d+)\s+kB/);
    if (!m) continue;
    const val = parseInt(m[2], 10);
    switch (m[1]) {
      case "MemTotal": result.totalRamKb = val; break;
      case "MemFree": result.freeRamKb = val; break;
      case "MemAvailable": result.memAvailableKb = val; break;
      case "Buffers": result.buffersKb = val; break;
      case "Cached": result.cachedKb = val; break;
      case "SwapTotal": result.swapTotalKb = val; break;
      case "SwapFree": result.swapFreeKb = val; break;
    }
  }
  return result;
}

// ─── Diff functions ─────────────────────────────────────────────────────────

export type DiffStatus = "matched" | "added" | "removed";

export interface ProcessDiff {
  status: DiffStatus;
  current: ProcessInfo;
  prev: ProcessInfo | null;
  deltaPssKb: number;
  deltaRssKb: number;
  deltaJavaHeapKb: number;
  deltaNativeHeapKb: number;
  deltaGraphicsKb: number;
  deltaCodeKb: number;
}

export interface GlobalMemInfoDiff {
  current: GlobalMemInfo;
  prev: GlobalMemInfo;
  deltaTotalRamKb: number;
  deltaFreeRamKb: number;
  deltaUsedPssKb: number;
  deltaLostRamKb: number;
  deltaZramPhysicalKb: number;
  deltaSwapFreeKb: number;
  deltaMemAvailableKb: number;
  deltaBuffersKb: number;
  deltaCachedKb: number;
}

/** Diff two process lists by PID + name. */
export function diffProcesses(prev: ProcessInfo[], current: ProcessInfo[]): ProcessDiff[] {
  const prevByPid = new Map(prev.map(p => [p.pid, p]));
  const result: ProcessDiff[] = [];
  const matchedPids = new Set<number>();

  for (const cur of current) {
    const old = prevByPid.get(cur.pid);
    if (old && old.name === cur.name) {
      matchedPids.add(cur.pid);
      result.push({
        status: "matched", current: cur, prev: old,
        deltaPssKb: cur.pssKb - old.pssKb,
        deltaRssKb: cur.rssKb - old.rssKb,
        deltaJavaHeapKb: cur.javaHeapKb - old.javaHeapKb,
        deltaNativeHeapKb: cur.nativeHeapKb - old.nativeHeapKb,
        deltaGraphicsKb: cur.graphicsKb - old.graphicsKb,
        deltaCodeKb: cur.codeKb - old.codeKb,
      });
    } else {
      result.push({
        status: "added", current: cur, prev: null,
        deltaPssKb: cur.pssKb, deltaRssKb: cur.rssKb,
        deltaJavaHeapKb: cur.javaHeapKb, deltaNativeHeapKb: cur.nativeHeapKb,
        deltaGraphicsKb: cur.graphicsKb, deltaCodeKb: cur.codeKb,
      });
    }
  }

  for (const old of prev) {
    if (!matchedPids.has(old.pid)) {
      result.push({
        status: "removed", current: old, prev: old,
        deltaPssKb: -old.pssKb, deltaRssKb: -old.rssKb,
        deltaJavaHeapKb: -old.javaHeapKb, deltaNativeHeapKb: -old.nativeHeapKb,
        deltaGraphicsKb: -old.graphicsKb, deltaCodeKb: -old.codeKb,
      });
    }
  }

  return result;
}

/** Diff two GlobalMemInfo snapshots. */
export function diffGlobalMemInfo(prev: GlobalMemInfo, current: GlobalMemInfo): GlobalMemInfoDiff {
  return {
    current, prev,
    deltaTotalRamKb: current.totalRamKb - prev.totalRamKb,
    deltaFreeRamKb: current.freeRamKb - prev.freeRamKb,
    deltaUsedPssKb: current.usedPssKb - prev.usedPssKb,
    deltaLostRamKb: current.lostRamKb - prev.lostRamKb,
    deltaZramPhysicalKb: current.zramPhysicalKb - prev.zramPhysicalKb,
    deltaSwapFreeKb: current.swapFreeKb - prev.swapFreeKb,
    deltaMemAvailableKb: current.memAvailableKb - prev.memAvailableKb,
    deltaBuffersKb: current.buffersKb - prev.buffersKb,
    deltaCachedKb: current.cachedKb - prev.cachedKb,
  };
}

export interface SmapsDiff {
  status: DiffStatus;
  current: SmapsAggregated;
  prev: SmapsAggregated | null;
  deltaSizeKb: number;
  deltaRssKb: number;
  deltaPssKb: number;
  deltaSharedCleanKb: number;
  deltaSharedDirtyKb: number;
  deltaPrivateCleanKb: number;
  deltaPrivateDirtyKb: number;
  deltaSwapKb: number;
}

export interface SmapsEntryDiff {
  status: DiffStatus;
  current: SmapsEntry;
  prev: SmapsEntry | null;
  deltaSizeKb: number;
  deltaRssKb: number;
  deltaPssKb: number;
  deltaSharedCleanKb: number;
  deltaSharedDirtyKb: number;
  deltaPrivateCleanKb: number;
  deltaPrivateDirtyKb: number;
  deltaSwapKb: number;
}

/** Diff two SmapsEntry arrays by address start. */
export function diffSmapsEntries(prev: SmapsEntry[], current: SmapsEntry[]): SmapsEntryDiff[] {
  const prevByAddr = new Map(prev.map(e => [e.addrStart, e]));
  const result: SmapsEntryDiff[] = [];
  const matchedAddrs = new Set<string>();

  for (const cur of current) {
    const old = prevByAddr.get(cur.addrStart);
    if (old) {
      matchedAddrs.add(cur.addrStart);
      result.push({
        status: "matched", current: cur, prev: old,
        deltaSizeKb: cur.sizeKb - old.sizeKb, deltaRssKb: cur.rssKb - old.rssKb,
        deltaPssKb: cur.pssKb - old.pssKb,
        deltaSharedCleanKb: cur.sharedCleanKb - old.sharedCleanKb,
        deltaSharedDirtyKb: cur.sharedDirtyKb - old.sharedDirtyKb,
        deltaPrivateCleanKb: cur.privateCleanKb - old.privateCleanKb,
        deltaPrivateDirtyKb: cur.privateDirtyKb - old.privateDirtyKb,
        deltaSwapKb: cur.swapKb - old.swapKb,
      });
    } else {
      result.push({
        status: "added", current: cur, prev: null,
        deltaSizeKb: cur.sizeKb, deltaRssKb: cur.rssKb, deltaPssKb: cur.pssKb,
        deltaSharedCleanKb: cur.sharedCleanKb, deltaSharedDirtyKb: cur.sharedDirtyKb,
        deltaPrivateCleanKb: cur.privateCleanKb, deltaPrivateDirtyKb: cur.privateDirtyKb,
        deltaSwapKb: cur.swapKb,
      });
    }
  }

  for (const old of prev) {
    if (!matchedAddrs.has(old.addrStart)) {
      result.push({
        status: "removed", current: old, prev: old,
        deltaSizeKb: -old.sizeKb, deltaRssKb: -old.rssKb, deltaPssKb: -old.pssKb,
        deltaSharedCleanKb: -old.sharedCleanKb, deltaSharedDirtyKb: -old.sharedDirtyKb,
        deltaPrivateCleanKb: -old.privateCleanKb, deltaPrivateDirtyKb: -old.privateDirtyKb,
        deltaSwapKb: -old.swapKb,
      });
    }
  }

  return result;
}

/** Diff two SmapsAggregated arrays by mapping name. */
export function diffSmaps(prev: SmapsAggregated[], current: SmapsAggregated[]): SmapsDiff[] {
  const prevByName = new Map(prev.map(s => [s.name, s]));
  const result: SmapsDiff[] = [];
  const matchedNames = new Set<string>();

  for (const cur of current) {
    const old = prevByName.get(cur.name);
    if (old) {
      matchedNames.add(cur.name);
      result.push({
        status: "matched", current: cur, prev: old,
        deltaSizeKb: cur.sizeKb - old.sizeKb, deltaRssKb: cur.rssKb - old.rssKb,
        deltaPssKb: cur.pssKb - old.pssKb,
        deltaSharedCleanKb: cur.sharedCleanKb - old.sharedCleanKb,
        deltaSharedDirtyKb: cur.sharedDirtyKb - old.sharedDirtyKb,
        deltaPrivateCleanKb: cur.privateCleanKb - old.privateCleanKb,
        deltaPrivateDirtyKb: cur.privateDirtyKb - old.privateDirtyKb,
        deltaSwapKb: cur.swapKb - old.swapKb,
      });
    } else {
      result.push({
        status: "added", current: cur, prev: null,
        deltaSizeKb: cur.sizeKb, deltaRssKb: cur.rssKb, deltaPssKb: cur.pssKb,
        deltaSharedCleanKb: cur.sharedCleanKb, deltaSharedDirtyKb: cur.sharedDirtyKb,
        deltaPrivateCleanKb: cur.privateCleanKb, deltaPrivateDirtyKb: cur.privateDirtyKb,
        deltaSwapKb: cur.swapKb,
      });
    }
  }

  for (const old of prev) {
    if (!matchedNames.has(old.name)) {
      result.push({
        status: "removed", current: old, prev: old,
        deltaSizeKb: -old.sizeKb, deltaRssKb: -old.rssKb, deltaPssKb: -old.pssKb,
        deltaSharedCleanKb: -old.sharedCleanKb, deltaSharedDirtyKb: -old.sharedDirtyKb,
        deltaPrivateCleanKb: -old.privateCleanKb, deltaPrivateDirtyKb: -old.privateDirtyKb,
        deltaSwapKb: -old.swapKb,
      });
    }
  }

  return result;
}
