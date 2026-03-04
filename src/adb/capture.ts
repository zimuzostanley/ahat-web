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

// ─── Parse `dumpsys meminfo` output ──────────────────────────────────────────

/**
 * Parse `dumpsys meminfo` output. Tries detailed per-process sections first
 * (** MEMINFO in pid N [name] **), falling back to the summary "Total PSS by
 * process:" section when detailed sections aren't present.
 */
export function parseMemInfo(output: string): ProcessInfo[] {
  const compact = parseCompactFormat(output);
  if (compact.length > 0) return compact;
  const detailed = parseDetailedSections(output);
  if (detailed.length > 0) return detailed;
  return parseSummarySections(output);
}

// ─── Compact format parser (`dumpsys meminfo -c`) ────────────────────────────
//
// Compact output has comma-separated lines per process:
//   proc,<oom_label>,<name>,<pid>,<pss>,<uss>,<rss>,<swap_pss>
// Followed by category lines:
//   <category>,<pss>,<shared_clean>,<shared_dirty>,<private_clean>,<private_dirty>,<swap_dirty>
// Or on newer Android:
//   cat,<category>,<pss>,...

function parseCompactFormat(output: string): ProcessInfo[] {
  // Quick check: compact format starts with "time," or has "proc," lines
  if (!output.includes("proc,") && !output.includes(",proc,")) return [];

  const byPid = new Map<number, ProcessInfo>();
  let cur: ProcessInfo | null = null;

  for (const line of output.split("\n")) {
    const parts = line.split(",");

    // Process header: proc,<oom>,<name>,<pid>,<pss>,...
    if (parts[0] === "proc") {
      if (cur && cur.pssKb > 0) byPid.set(cur.pid, cur);
      const pid = parseInt(parts[3], 10);
      if (!isFinite(pid)) { cur = null; continue; }
      const name = parts[2] ?? "";
      const oomLabel = mapOomLabel(parts[1] ?? "");
      const pssKb = parseInt(parts[4], 10) || 0;
      const rssKb = parts.length >= 7 ? (parseInt(parts[6], 10) || 0) : 0;
      cur = { pid, name, oomLabel, pssKb, rssKb, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0 };
      continue;
    }

    if (!cur) continue;

    // Skip known non-category lines
    const tag = parts[0];
    if (tag === "oom" || tag === "time" || tag === "version" ||
        tag === "total" || tag === "ram" || tag === "zram" ||
        tag === "lostram" || tag === "") continue;

    // Category lines vary by Android version. Common patterns:
    //   <category>,<pss>,...
    //   cat,<category>,<pss>,...
    const catName = tag === "cat" ? parts[1] : tag;
    const pssIdx = tag === "cat" ? 2 : 1;
    const catPss = parseInt(parts[pssIdx], 10) || 0;

    if (!catName || catPss === 0) continue;

    const cat = catName.toLowerCase().replace(/[_\s]/g, "");
    if (cat === "nativeheap" || cat === "native") {
      cur.nativeHeapKb = catPss;
    } else if (cat === "dalvikheap" || cat === "dalvik") {
      cur.javaHeapKb = catPss;
    } else if (cat === "gfxdev" || cat === "eglmtrack" || cat === "glmtrack" || cat === "graphics") {
      cur.graphicsKb += catPss;
    } else if (cat === "code" || cat === ".dexmmap" || cat === ".oatmmap" || cat === ".artmmap" || cat === ".sommap") {
      cur.codeKb += catPss;
    }
  }

  if (cur && cur.pssKb > 0) byPid.set(cur.pid, cur);

  const results = [...byPid.values()];
  results.sort((a, b) => b.pssKb - a.pssKb);
  return results;
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
      const pid = parseInt(hdr[1], 10);
      cur = isFinite(pid)
        ? { pid, name: hdr[2], oomLabel: "", pssKb: 0, rssKb: 0, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0 }
        : null;
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
    } else if (/^(\.dex mmap|\.oat mmap|\.art mmap|\.so mmap)\s/.test(trimmed)) {
      const m = trimmed.match(/^(?:\.dex mmap|\.oat mmap|\.art mmap|\.so mmap)\s+(\d+)/);
      if (m) cur.codeKb += parseInt(m[1], 10);
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

// ─── Summary section parser ──────────────────────────────────────────────────
//
// Parses "Total <X> by process:" sections from `dumpsys meminfo` output.
// Multiple sections (PSS, RSS, Swap, etc.) are merged by PID.

// Matches: "  442,628K: com.android.systemui (pid 1234 / activities) (user 10)"
const SUMMARY_LINE = /^\s*([\d,]+)K:\s+(.+?)\s+\(pid\s+(\d+)[^)]*\)/;
const SECTION_HEADER = /^(Total .+?) by (process|OOM)/;

type SummarySection = "pss" | "rss" | "swap" | null;

function classifySection(header: string): SummarySection {
  if (/Total PSS by process/i.test(header)) return "pss";
  if (/Total RSS by process/i.test(header)) return "rss";
  if (/Total Swap/i.test(header) && /by process/i.test(header)) return "swap";
  return null; // OOM adjustment or other grouping — skip
}

function parseSummarySections(output: string): ProcessInfo[] {
  const byPid = new Map<number, ProcessInfo>();
  let section: SummarySection = null;

  for (const line of output.split("\n")) {
    // Detect section transitions
    const hdr = SECTION_HEADER.exec(line.trim());
    if (hdr) {
      section = classifySection(line);
      continue;
    }
    if (!section) continue;

    const m = SUMMARY_LINE.exec(line);
    if (m) {
      const pid = parseInt(m[3], 10);
      if (!isFinite(pid)) continue;
      const val = parseInt(m[1].replace(/,/g, ""), 10) || 0;
      let info = byPid.get(pid);
      if (!info) {
        info = { pid, name: m[2], oomLabel: "", pssKb: 0, rssKb: 0, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0 };
        byPid.set(pid, info);
      }
      if (section === "pss") info.pssKb = val;
      else if (section === "rss") info.rssKb = val;
    }
  }

  const results = [...byPid.values()];
  results.sort((a, b) => b.pssKb - a.pssKb);
  return results;
}

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

  /** Reconnect to a previously paired device. */
  async reconnect(usbDev: USBDevice): Promise<void> {
    this.device = await AdbDevice.connect(usbDev, this.keyMgr);
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

  async getProcessList(signal?: AbortSignal): Promise<{ list: ProcessInfo[]; hasBreakdown: boolean; globalMemInfo: GlobalMemInfo | null }> {
    if (!this.device) throw new Error("Not connected");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // Try compact format first — includes per-process Java/Native/Graphics breakdown
    // on devices that support it, and always has OOM labels per process.
    let compactResults: ProcessInfo[] = [];
    let globalMemInfo: GlobalMemInfo | null = null;
    try {
      const compact = await this.device.shell("dumpsys -t 60 meminfo -c", signal);
      globalMemInfo = parseGlobalMemInfo(compact);
      // Only use compact as primary results if it has category breakdown lines
      const hasCategories = /^(?:cat,)?(?:Native Heap|Dalvik Heap),\d/m.test(compact);
      compactResults = parseMemInfo(compact);
      if (hasCategories && compactResults.length > 0) {
        return { list: compactResults, hasBreakdown: true, globalMemInfo };
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // compact format failed, fall through
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // Fallback: regular format (PSS + RSS summary sections)
    const output = await this.device.shell("dumpsys -t 60 meminfo", signal);
    const results = parseMemInfo(output);
    // Merge OOM labels from compact results into regular results
    if (compactResults.length > 0) {
      const labelByPid = new Map(compactResults.map(p => [p.pid, p.oomLabel]));
      for (const p of results) {
        if (!p.oomLabel && labelByPid.has(p.pid)) {
          p.oomLabel = labelByPid.get(p.pid)!;
        }
      }
    }
    return { list: results, hasBreakdown: false, globalMemInfo };
  }

  /**
   * Fetch detailed memory breakdown (Java/Native/Graphics) per process.
   * Runs `dumpsys meminfo <pid>` for each process and updates in place.
   */
  async enrichProcessDetails(
    processes: ProcessInfo[],
    onProgress?: (completed: number, total: number, current: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.device) return;
    for (let i = 0; i < processes.length; i++) {
      if (signal?.aborted || !this.device?.connected) break;
      onProgress?.(i, processes.length, processes[i].name);
      try {
        const output = await this.device.shell(`dumpsys -t 30 meminfo ${processes[i].pid}`, signal);
        const details = parseDetailedSections(output);
        if (details.length > 0) {
          const d = details[0];
          processes[i].javaHeapKb = d.javaHeapKb;
          processes[i].nativeHeapKb = d.nativeHeapKb;
          processes[i].graphicsKb = d.graphicsKb;
          processes[i].codeKb = d.codeKb;
          if (d.pssKb > 0) processes[i].pssKb = d.pssKb;
          if (d.rssKb > 0) processes[i].rssKb = d.rssKb;
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") break;
        // Process may have died, skip
      }
    }
    onProgress?.(processes.length, processes.length, "");
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

  /**
   * Single per-process pass: enrich meminfo + fetch smaps together.
   * Each process is fully ready (breakdown + memory maps) before moving to the next.
   */
  async enrichPerProcess(
    processes: ProcessInfo[],
    options: { meminfo?: boolean; smaps?: boolean },
    onProgress?: (done: number, total: number, name: string) => void,
    onMeminfo?: () => void,
    onSmaps?: (pid: number, data: SmapsAggregated[]) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.device) return;
    const needsMeminfo = options.meminfo ?? false;
    const needsSmaps = (options.smaps ?? false) && this._isRoot;
    if (!needsMeminfo && !needsSmaps) return;

    // Process in PSS-descending order (biggest first = most interesting)
    const sorted = [...processes].sort((a, b) => b.pssKb - a.pssKb);

    for (let i = 0; i < sorted.length; i++) {
      if (signal?.aborted || !this.device?.connected) break;
      const proc = sorted[i];
      onProgress?.(i, sorted.length, proc.name);

      // 1. Enrich with per-process meminfo breakdown
      if (needsMeminfo) {
        try {
          const output = await this.device.shell(`dumpsys -t 30 meminfo ${proc.pid}`, signal);
          const details = parseDetailedSections(output);
          if (details.length > 0) {
            const d = details[0];
            proc.javaHeapKb = d.javaHeapKb;
            proc.nativeHeapKb = d.nativeHeapKb;
            proc.graphicsKb = d.graphicsKb;
            proc.codeKb = d.codeKb;
            if (d.pssKb > 0) proc.pssKb = d.pssKb;
            if (d.rssKb > 0) proc.rssKb = d.rssKb;
          }
          onMeminfo?.();
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") break;
          // Process may have died — skip
        }
      }

      // 2. Fetch smaps (root-only)
      if (needsSmaps) {
        try {
          const entries = await this.getSmapsForPid(proc.pid, signal);
          if (entries.length > 0) {
            onSmaps?.(proc.pid, aggregateSmaps(entries));
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") break;
          // Process may have died — skip
        }
      }
    }

    onProgress?.(sorted.length, sorted.length, "");
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

const SMAPS_HEADER_RE = /^([0-9a-f]+)-([0-9a-f]+)\s+([\w-]{4})\s+[0-9a-f]+\s+[0-9a-f]+:[0-9a-f]+\s+\d+\s*(.*)?$/i;
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
        name: (hdr[4] ?? "").trim(),
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

// ─── Global memory info parsers ─────────────────────────────────────────────

/** Parse global memory stats from `dumpsys meminfo -c` compact output. */
export function parseGlobalMemInfo(output: string): GlobalMemInfo | null {
  const info: GlobalMemInfo = {
    totalRamKb: 0, freeRamKb: 0, usedPssKb: 0, lostRamKb: 0,
    zramPhysicalKb: 0, swapTotalKb: 0, swapFreeKb: 0,
    memAvailableKb: 0, buffersKb: 0, cachedKb: 0,
  };
  let found = false;
  for (const line of output.split("\n")) {
    const parts = line.split(",");
    if (parts[0] === "ram" && parts.length >= 4) {
      info.totalRamKb = parseInt(parts[1], 10) || 0;
      info.freeRamKb = parseInt(parts[2], 10) || 0;
      info.usedPssKb = parseInt(parts[3], 10) || 0;
      found = true;
    } else if (parts[0] === "lostram" && parts.length >= 2) {
      info.lostRamKb = parseInt(parts[1], 10) || 0;
    } else if (parts[0] === "zram" && parts.length >= 4) {
      info.zramPhysicalKb = parseInt(parts[1], 10) || 0;
      info.swapTotalKb = parseInt(parts[2], 10) || 0;
      info.swapFreeKb = parseInt(parts[3], 10) || 0;
    }
  }
  return found ? info : null;
}

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
