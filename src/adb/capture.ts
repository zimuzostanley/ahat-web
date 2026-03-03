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
  debuggable?: boolean;
}

// Map compact-format OOM adj labels to human-readable AOSP process states.
// Labels from dumpsys meminfo -c: native, sys, pers, fore, vis, percep,
// backup, heavy, svcb, svcrst, home, prev, lstact, bfgs, fgs, btop, top,
// cch (with numeric suffix)
const OOM_LABEL_MAP: Record<string, string> = {
  native: "Native",
  sys: "System",
  pers: "Persistent",
  fore: "Foreground",
  foreground: "Foreground",
  vis: "Visible",
  visible: "Visible",
  percep: "Perceptible",
  perceptible: "Perceptible",
  backup: "Backup",
  heavy: "Heavy Weight",
  svcb: "Service B",
  svcrst: "Service Restarting",
  home: "Home",
  prev: "Previous",
  lstact: "Last Activity",
  bfgs: "Bound FG Service",
  fgs: "FG Service",
  btop: "Bound Top",
  top: "Top",
  cch: "Cached",
  cached: "Cached",
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
      const name = parts[2] ?? "";
      const oomLabel = mapOomLabel(parts[1] ?? "");
      const pssKb = parseInt(parts[4], 10) || 0;
      const rssKb = parts.length >= 7 ? (parseInt(parts[6], 10) || 0) : 0;
      cur = { pid, name, oomLabel, pssKb, rssKb, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0 };
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
      cur = { pid: parseInt(hdr[1], 10), name: hdr[2], oomLabel: "", pssKb: 0, rssKb: 0, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0 };
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
      const val = parseInt(m[1].replace(/,/g, ""), 10);
      let info = byPid.get(pid);
      if (!info) {
        info = { pid, name: m[2], oomLabel: "", pssKb: 0, rssKb: 0, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0 };
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
    for (const cmd of ["su 0 id", "su -c id"]) {
      try {
        const result = await this.device.shell(cmd);
        if (result.includes("uid=0")) { this._isRoot = true; break; }
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

  async getProcessList(signal?: AbortSignal): Promise<{ list: ProcessInfo[]; hasBreakdown: boolean }> {
    if (!this.device) throw new Error("Not connected");
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    // Try compact format first — includes per-process Java/Native/Graphics breakdown
    // on devices that support it, and always has OOM labels per process.
    let compactResults: ProcessInfo[] = [];
    try {
      const compact = await this.device.shell("dumpsys -t 60 meminfo -c", signal);
      // Only use compact as primary results if it has category breakdown lines
      const hasCategories = /^(?:cat,)?(?:Native Heap|Dalvik Heap),\d/m.test(compact);
      compactResults = parseMemInfo(compact);
      if (hasCategories && compactResults.length > 0) {
        return { list: compactResults, hasBreakdown: true };
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
    return { list: results, hasBreakdown: false };
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
        size = parseInt(out.trim(), 10);
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

  disconnect(): void {
    this.device?.close();
    this.device = null;
    this._isRoot = false;
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
