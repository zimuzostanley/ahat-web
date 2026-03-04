import { useState, useCallback, useRef, useMemo, useEffect, Fragment } from "react";
import { AdbConnection, type ProcessInfo, type CapturePhase, type SmapsAggregated, type SmapsEntry, type GlobalMemInfo, type ProcessDiff, type GlobalMemInfoDiff, type SmapsDiff, type SmapsEntryDiff, diffProcesses, diffGlobalMemInfo, diffSmaps, diffSmapsEntries } from "../adb/capture";
import { fmtSize, fmtDelta, deltaBgClass } from "../format";

type SmapsSortFieldType = "pssKb" | "rssKb" | "sizeKb" | "sharedCleanKb" | "sharedDirtyKb" | "privateCleanKb" | "privateDirtyKb" | "swapKb";
type VmaSortFieldType = SmapsSortFieldType | "addrStart";

const SMAPS_COLUMNS: [SmapsSortFieldType, string][] = [
  ["rssKb", "RSS"], ["pssKb", "PSS"],
  ["privateCleanKb", "Priv Clean"], ["privateDirtyKb", "Priv Dirty"],
  ["sharedCleanKb", "Shared Clean"], ["sharedDirtyKb", "Shared Dirty"],
  ["swapKb", "Swap"], ["sizeKb", "VSize"],
];

function VmaEntries({ entries, sortField, sortAsc, onToggleSort, entryDiffs }: {
  entries: SmapsEntry[];
  sortField: VmaSortFieldType;
  sortAsc: boolean;
  onToggleSort: (f: VmaSortFieldType) => void;
  entryDiffs?: SmapsEntryDiff[] | null;
}) {
  const diffByAddr = useMemo(() => {
    if (!entryDiffs) return null;
    return new Map(entryDiffs.map(d => [d.current.addrStart, d]));
  }, [entryDiffs]);

  const sorted = useMemo(() => {
    if (entryDiffs) {
      const copy = [...entryDiffs];
      copy.sort((a, b) => {
        const aPin = a.status !== "matched" ? 1 : 0;
        const bPin = b.status !== "matched" ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        if (sortField === "addrStart") {
          return sortAsc ? a.current.addrStart.localeCompare(b.current.addrStart) : b.current.addrStart.localeCompare(a.current.addrStart);
        }
        return sortAsc ? a.current[sortField] - b.current[sortField] : b.current[sortField] - a.current[sortField];
      });
      return copy.map(d => d.current);
    }
    const copy = [...entries];
    if (sortField === "addrStart") {
      copy.sort((a, b) => sortAsc ? a.addrStart.localeCompare(b.addrStart) : b.addrStart.localeCompare(a.addrStart));
    } else {
      copy.sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]);
    }
    return copy;
  }, [entries, entryDiffs, sortField, sortAsc]);

  return (
    <>
      <tr className="bg-stone-100">
        <td className="py-0.5 px-2 pl-6">
          <span className="text-stone-500 text-[10px] font-medium cursor-pointer hover:text-stone-700" onClick={() => onToggleSort("addrStart")}>
            Address {sortField === "addrStart" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
          </span>
          <span className="ml-3 text-stone-400 text-[10px]">Perms</span>
        </td>
        <td />
        {SMAPS_COLUMNS.map(([f, label]) => (
          <td key={f} className="py-0.5 px-2 text-right text-stone-500 text-[10px] font-medium cursor-pointer hover:text-stone-700" onClick={() => onToggleSort(f)}>
            {label} {sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
          </td>
        ))}
      </tr>
      {sorted.map((e, i) => {
        const ed = diffByAddr?.get(e.addrStart);
        return (
        <tr key={i} className={`border-t border-stone-50 ${
          ed?.status === "removed" ? "opacity-60" :
          ed?.status === "added" ? "bg-green-50/50" : ""
        }`}>
          <td className={`py-0.5 px-2 pl-6 font-mono text-[10px] text-stone-500 whitespace-nowrap ${ed?.status === "removed" ? "line-through" : ""}`}>
            {e.addrStart}-{e.addrEnd}
            <span className="ml-2 text-stone-400">{e.perms}</span>
            {ed && ed.status !== "matched" && (
              <span className={`ml-2 font-medium ${ed.status === "added" ? "text-green-600" : "text-red-600"}`}>
                {ed.status === "added" ? "NEW" : "GONE"}
              </span>
            )}
          </td>
          <td />
          {SMAPS_COLUMNS.map(([f]) => {
            const delta = ed ? ed[SMAPS_DELTA_KEY[f]] as number : 0;
            return (
            <td key={f} className={`py-0.5 px-2 text-right font-mono text-[10px] whitespace-nowrap ${ed ? deltaBgClass(delta) : ""}`}>
              {e[f] > 0 ? fmtSize(e[f] * 1024) : "\u2014"}
              {ed && (
                <span className={`ml-1 inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700" : delta < 0 ? "text-green-700" : ""}`}>
                  {delta !== 0 ? fmtDelta(delta) : ""}
                </span>
              )}
            </td>
            );
          })}
        </tr>
        );
      })}
    </>
  );
}

const SMAPS_DELTA_KEY: Record<SmapsSortFieldType, keyof SmapsDiff> = {
  pssKb: "deltaPssKb", rssKb: "deltaRssKb", sizeKb: "deltaSizeKb",
  sharedCleanKb: "deltaSharedCleanKb", sharedDirtyKb: "deltaSharedDirtyKb",
  privateCleanKb: "deltaPrivateCleanKb", privateDirtyKb: "deltaPrivateDirtyKb",
  swapKb: "deltaSwapKb",
};

function SmapsSubTable({ aggregated, expandedGroup, onToggleGroup, sortField, sortAsc, onToggleSort, vmaSortField, vmaSortAsc, onToggleVmaSort, smapsDiffs, prevAggregated }: {
  aggregated: SmapsAggregated[];
  expandedGroup: string | null;
  onToggleGroup: (name: string) => void;
  sortField: SmapsSortFieldType;
  sortAsc: boolean;
  onToggleSort: (f: SmapsSortFieldType) => void;
  vmaSortField: VmaSortFieldType;
  vmaSortAsc: boolean;
  onToggleVmaSort: (f: VmaSortFieldType) => void;
  smapsDiffs?: SmapsDiff[] | null;
  prevAggregated?: SmapsAggregated[] | null;
}) {
  const diffByName = useMemo(() => {
    if (!smapsDiffs) return null;
    return new Map(smapsDiffs.map(d => [d.current.name, d]));
  }, [smapsDiffs]);

  const prevByName = useMemo(() => {
    if (!prevAggregated) return null;
    return new Map(prevAggregated.map(a => [a.name, a]));
  }, [prevAggregated]);

  const sorted = useMemo(() => {
    if (smapsDiffs) {
      const copy = [...smapsDiffs];
      copy.sort((a, b) => {
        const aPin = a.status !== "matched" ? 1 : 0;
        const bPin = b.status !== "matched" ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        return sortAsc ? a.current[sortField] - b.current[sortField] : b.current[sortField] - a.current[sortField];
      });
      return copy.map(d => d.current);
    }
    const copy = [...aggregated];
    copy.sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]);
    return copy;
  }, [aggregated, smapsDiffs, sortField, sortAsc]);

  // Totals row
  const totals = useMemo(() => {
    const t = { rssKb: 0, pssKb: 0, sizeKb: 0, sharedCleanKb: 0, sharedDirtyKb: 0, privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0,
      deltaRssKb: 0, deltaPssKb: 0, deltaSizeKb: 0, deltaSharedCleanKb: 0, deltaSharedDirtyKb: 0, deltaPrivateCleanKb: 0, deltaPrivateDirtyKb: 0, deltaSwapKb: 0 };
    if (smapsDiffs) {
      for (const d of smapsDiffs) {
        if (d.status !== "removed") {
          for (const [f] of SMAPS_COLUMNS) t[f] += d.current[f];
        }
        for (const [f] of SMAPS_COLUMNS) {
          const dk = SMAPS_DELTA_KEY[f];
          (t as Record<string, number>)[dk] += d[dk] as number;
        }
      }
    } else {
      for (const g of aggregated) {
        for (const [f] of SMAPS_COLUMNS) t[f] += g[f];
      }
    }
    return t;
  }, [aggregated, smapsDiffs]);

  return (
    <div className="bg-stone-50 px-4 pb-2 max-h-[400px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-stone-50 z-10">
          <tr className="border-b border-stone-200">
            <th className="text-left py-1 px-2 text-stone-500 font-medium">Mapping</th>
            <th className="text-right py-1 px-1 text-stone-400 font-medium w-8">#</th>
            {SMAPS_COLUMNS.map(([f, label]) => (
              <th
                key={f}
                className="text-right py-1 px-2 text-stone-500 font-medium cursor-pointer select-none hover:text-stone-700 whitespace-nowrap"
                onClick={() => onToggleSort(f)}
              >
                {label} {sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Totals row */}
          <tr className="border-b-2 border-stone-300 font-semibold">
            <td className="py-0.5 px-2 text-stone-600">Total</td>
            <td />
            {SMAPS_COLUMNS.map(([f]) => {
              const dk = SMAPS_DELTA_KEY[f];
              const delta = (totals as Record<string, number>)[dk];
              return (
                <td key={f} className={`py-0.5 px-2 text-right font-mono whitespace-nowrap ${smapsDiffs ? deltaBgClass(delta) : ""}`}>
                  {totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014"}
                  {smapsDiffs && (
                    <span className={`ml-1 text-[10px] font-normal inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700" : delta < 0 ? "text-green-700" : ""}`}>
                      {delta !== 0 ? fmtDelta(delta) : ""}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
          {sorted.map(g => {
            const sd = diffByName?.get(g.name);
            const prevEntries = sd && sd.status === "matched" && prevByName ? prevByName.get(g.name)?.entries ?? null : null;
            return (
            <Fragment key={g.name}>
              <tr
                className={`border-t border-stone-100 cursor-pointer hover:bg-stone-100 ${
                  sd?.status === "removed" ? "opacity-60" :
                  sd?.status === "added" ? "bg-green-50/50" : ""
                }`}
                onClick={() => sd?.status !== "removed" && onToggleGroup(g.name)}
              >
                <td className={`py-0.5 px-2 font-mono text-stone-700 truncate max-w-[300px] ${sd?.status === "removed" ? "line-through" : ""}`} title={g.name}>
                  <span className="text-stone-400 mr-1">{expandedGroup === g.name ? "\u25BC" : "\u25B6"}</span>
                  {g.name}
                  {sd && sd.status !== "matched" && (
                    <span className={`ml-2 text-[10px] font-medium ${sd.status === "added" ? "text-green-600" : "text-red-600"}`}>
                      {sd.status === "added" ? "NEW" : "GONE"}
                    </span>
                  )}
                </td>
                <td className="py-0.5 px-1 text-right font-mono text-stone-400">{g.count}</td>
                {SMAPS_COLUMNS.map(([f]) => {
                  const delta = sd ? sd[SMAPS_DELTA_KEY[f]] as number : 0;
                  return (
                    <td key={f} className={`py-0.5 px-2 text-right font-mono whitespace-nowrap ${sd ? deltaBgClass(delta) : ""}`}>
                      {g[f] > 0 ? fmtSize(g[f] * 1024) : "\u2014"}
                      {sd && (
                        <span className={`ml-1 text-[10px] inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700" : delta < 0 ? "text-green-700" : ""}`}>
                          {delta !== 0 ? fmtDelta(delta) : ""}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
              {expandedGroup === g.name && sd?.status !== "removed" && (
                <VmaEntries
                  entries={g.entries}
                  sortField={vmaSortField}
                  sortAsc={vmaSortAsc}
                  onToggleSort={onToggleVmaSort}
                  entryDiffs={prevEntries ? diffSmapsEntries(prevEntries, g.entries) : null}
                />
              )}
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Capture View ─────────────────────────────────────────────────────────────

type SortField = "pssKb" | "rssKb" | "javaHeapKb" | "nativeHeapKb" | "graphicsKb" | "codeKb"
  | "deltaPssKb" | "deltaRssKb" | "deltaJavaHeapKb" | "deltaNativeHeapKb" | "deltaGraphicsKb" | "deltaCodeKb";

const DELTA_FIELDS: Record<string, keyof ProcessDiff> = {
  deltaPssKb: "deltaPssKb", deltaRssKb: "deltaRssKb",
  deltaJavaHeapKb: "deltaJavaHeapKb", deltaNativeHeapKb: "deltaNativeHeapKb",
  deltaGraphicsKb: "deltaGraphicsKb", deltaCodeKb: "deltaCodeKb",
};

const VALUE_TO_DELTA: Record<string, SortField> = {
  pssKb: "deltaPssKb", rssKb: "deltaRssKb",
  javaHeapKb: "deltaJavaHeapKb", nativeHeapKb: "deltaNativeHeapKb",
  graphicsKb: "deltaGraphicsKb", codeKb: "deltaCodeKb",
};


function CaptureView({ onCaptured, conn }: {
  onCaptured: (name: string, buffer: ArrayBuffer) => void;
  conn: AdbConnection;
}) {
  const [connected, setConnected] = useState(false);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [withBitmaps, setWithBitmaps] = useState(false);
  const [sortField, setSortField] = useState<SortField>("pssKb");
  const [sortAsc, setSortAsc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enrichment runs in the background — doesn't block capture
  const enrichAbortRef = useRef<AbortController | null>(null);
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);

  // Capture is a foreground operation — auto-cancels enrichment since ADB is serial
  const captureAbortRef = useRef<AbortController | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureStatus, setCaptureStatus] = useState("");
  const [captureProgress, setCaptureProgress] = useState<{ done: number; total: number } | null>(null);

  // Smaps — fetched alongside meminfo enrichment (root-only)
  const [smapsData, setSmapsData] = useState<Map<number, SmapsAggregated[]>>(new Map());
  const [globalMemInfo, setGlobalMemInfo] = useState<GlobalMemInfo | null>(null);
  const [expandedSmapsPid, setExpandedSmapsPid] = useState<number | null>(null);
  const [expandedSmapsGroup, setExpandedSmapsGroup] = useState<string | null>(null);
  type SmapsSortField = "pssKb" | "rssKb" | "sizeKb" | "sharedCleanKb" | "sharedDirtyKb" | "privateCleanKb" | "privateDirtyKb" | "swapKb";
  const [smapsSortField, setSmapsSortField] = useState<SmapsSortField>("pssKb");
  const [smapsSortAsc, setSmapsSortAsc] = useState(false);
  type VmaSortField = SmapsSortField | "addrStart";
  const [vmaSortField, setVmaSortField] = useState<VmaSortField>("pssKb");
  const [vmaSortAsc, setVmaSortAsc] = useState(false);

  // Diff state
  const [diffMode, setDiffMode] = useState(false);
  const [prevProcesses, setPrevProcesses] = useState<ProcessInfo[] | null>(null);
  const [prevGlobalMemInfo, setPrevGlobalMemInfo] = useState<GlobalMemInfo | null>(null);
  const [processDiffs, setProcessDiffs] = useState<ProcessDiff[] | null>(null);
  const [globalMemInfoDiff, setGlobalMemInfoDiff] = useState<GlobalMemInfoDiff | null>(null);
  const [prevSmapsData, setPrevSmapsData] = useState<Map<number, SmapsAggregated[]>>(new Map());
  const diffTriggeredRef = useRef(false);

  const clearDiff = useCallback(() => {
    setDiffMode(false);
    setPrevProcesses(null);
    setPrevGlobalMemInfo(null);
    setProcessDiffs(null);
    setGlobalMemInfoDiff(null);
    setPrevSmapsData(new Map());
    diffTriggeredRef.current = false;
  }, []);

  // Progressive diff recomputation — fires on every enrichment update
  useEffect(() => {
    if (!diffMode || !prevProcesses || !processes) return;
    setProcessDiffs(diffProcesses(prevProcesses, processes));
  }, [diffMode, prevProcesses, processes]);

  useEffect(() => {
    if (!diffMode || !prevGlobalMemInfo || !globalMemInfo) return;
    setGlobalMemInfoDiff(diffGlobalMemInfo(prevGlobalMemInfo, globalMemInfo));
  }, [diffMode, prevGlobalMemInfo, globalMemInfo]);

  const cancelEnrichment = useCallback(() => {
    if (!enrichAbortRef.current) return;
    enrichAbortRef.current.abort();
    enrichAbortRef.current = null;
    setEnrichStatus(null);
    setEnrichProgress(null);
  }, []);

  const cancelCapture = useCallback(() => {
    if (!captureAbortRef.current) return;
    captureAbortRef.current.abort();
    captureAbortRef.current = null;
    setCapturing(false);
    setCaptureStatus("");
    setCaptureProgress(null);
  }, []);

  const refreshProcesses = useCallback(async () => {
    if (!conn.connected) return;
    cancelEnrichment();
    // Normal refresh clears diff state; handleDiff sets the flag before calling us
    if (!diffTriggeredRef.current) clearDiff();
    diffTriggeredRef.current = false;
    const ac = new AbortController();
    enrichAbortRef.current = ac;
    setEnrichStatus("Fetching process list\u2026");
    setEnrichProgress(null);
    setSmapsData(new Map());
    setExpandedSmapsPid(null);
    setExpandedSmapsGroup(null);
    setGlobalMemInfo(null);
    setError(null);
    try {
      const result = await conn.getProcessList(ac.signal);
      const list = result.list;
      if (ac.signal.aborted) return;
      // Show process list immediately, then enrich in background
      setProcesses(list);
      if (result.globalMemInfo) setGlobalMemInfo(result.globalMemInfo);
      // Fetch supplementary data in parallel (non-blocking for first render)
      if (!ac.signal.aborted) {
        const supplementary: Promise<void>[] = [];
        if (result.globalMemInfo && conn.isRoot) {
          supplementary.push(conn.getProcMeminfo(ac.signal).then(procInfo => {
            if (ac.signal.aborted) return;
            setGlobalMemInfo(gmi => gmi ? { ...gmi, memAvailableKb: procInfo.memAvailableKb ?? 0, buffersKb: procInfo.buffersKb ?? 0, cachedKb: procInfo.cachedKb ?? 0 } : gmi);
          }).catch(() => {}));
        }
        if (!conn.isRoot) {
          supplementary.push(conn.getDebuggablePackages(ac.signal).then(debuggable => {
            if (ac.signal.aborted) return;
            for (const p of list) p.debuggable = debuggable.has(p.name);
            setProcesses([...list]);
          }).catch(() => {}));
        }
        await Promise.all(supplementary);
      }
      // Single per-process pass: enrich meminfo (if needed) + smaps (if root).
      // Each process is fully ready before moving to the next.
      const needsMeminfo = !result.hasBreakdown;
      const needsSmaps = conn.isRoot;
      if (needsMeminfo || needsSmaps) {
        await conn.enrichPerProcess(
          list,
          { meminfo: needsMeminfo, smaps: needsSmaps },
          (done, total, current) => {
            if (ac.signal.aborted) return;
            setEnrichStatus(current);
            setEnrichProgress({ done, total });
          },
          () => {
            if (ac.signal.aborted) return;
            setProcesses([...list]);
          },
          (pid, data) => {
            if (ac.signal.aborted) return;
            setSmapsData(prev => new Map(prev).set(pid, data));
          },
          ac.signal,
        );
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to get process list");
    } finally {
      if (enrichAbortRef.current === ac) {
        enrichAbortRef.current = null;
        setEnrichStatus(null);
        setEnrichProgress(null);
      }
    }
  }, [cancelEnrichment, clearDiff]);

  const handleDiff = useCallback(() => {
    if (!processes) return;
    // Deep copy current state as baseline (enrichment mutates in place)
    setPrevProcesses(processes.map(p => ({ ...p })));
    if (globalMemInfo) setPrevGlobalMemInfo({ ...globalMemInfo });
    setPrevSmapsData(new Map(smapsData));
    setDiffMode(true);
    diffTriggeredRef.current = true;
    refreshProcesses();
  }, [processes, globalMemInfo, smapsData, refreshProcesses]);

  useEffect(() => {
    if (connected) refreshProcesses();
  }, [connected, refreshProcesses]);

  const handleConnect = useCallback(async () => {
    setConnectStatus("Connecting\u2026");
    setError(null);
    try {
      await conn.requestAndConnect((msg) => setConnectStatus(msg));
      setConnected(true);
    } catch (e) {
      if (e instanceof Error && e.name === "NotFoundError") {
        // User cancelled device picker
      } else {
        setError(e instanceof Error ? e.message : "Connection failed");
      }
    } finally {
      setConnectStatus(null);
    }
  }, []);

  const handleCapture = useCallback(async (overridePid?: number) => {
    const pid = overridePid ?? selectedPid;
    if (pid === null || capturing) return;
    // Cancel enrichment (includes smaps) — ADB device handles one command at a time
    cancelEnrichment();
    if (overridePid !== undefined) setSelectedPid(overridePid);
    const ac = new AbortController();
    captureAbortRef.current = ac;
    setCapturing(true);
    setCaptureStatus("Starting heap dump\u2026");
    setCaptureProgress(null);
    setError(null);
    try {
      const proc = processes?.find(p => p.pid === pid);
      const procName = proc?.name ?? `pid_${pid}`;
      const buffer = await conn.captureHeapDump(
        pid,
        withBitmaps,
        (phase: CapturePhase) => {
          switch (phase.step) {
            case "dumping": setCaptureStatus("Dumping heap\u2026"); break;
            case "waiting": setCaptureStatus(`Waiting for dump\u2026 (${Math.round(phase.elapsed / 1000)}s)`); break;
            case "pulling": {
              const pct = phase.total > 0 ? Math.round(phase.received / phase.total * 100) : 0;
              const mb = (phase.received / 1048576).toFixed(1);
              setCaptureStatus(phase.total > 0 ? `Pulling: ${mb} MiB (${pct}%)` : `Pulling: ${mb} MiB`);
              if (phase.total > 0) setCaptureProgress({ done: phase.received, total: phase.total });
              break;
            }
            case "cleaning": setCaptureStatus("Cleaning up\u2026"); break;
            case "done": break;
          }
        },
        ac.signal,
      );
      const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
      const name = `${procName}_${ts}`;
      onCaptured(name, buffer);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      // Only clear state if we're still the active capture
      if (captureAbortRef.current === ac) {
        captureAbortRef.current = null;
        setCapturing(false);
        setCaptureStatus("");
        setCaptureProgress(null);
      }
    }
  }, [selectedPid, withBitmaps, processes, onCaptured, capturing, cancelEnrichment]);

  const handleDisconnect = useCallback(() => {
    cancelEnrichment();
    cancelCapture();
    conn.disconnect();
    setConnected(false);
    // Keep processes/smaps/diff data visible — user can refresh to reconnect
    setError(null);
    setEnrichStatus(null);
    setEnrichProgress(null);
    setCapturing(false);
    setCaptureStatus("");
    setCaptureProgress(null);
  }, [cancelEnrichment, cancelCapture]);

  // Clean up on unmount
  useEffect(() => {
    return () => { cancelEnrichment(); cancelCapture(); conn.disconnect(); };
  }, [cancelEnrichment, cancelCapture]);

  const sorted = useMemo(() => {
    if (!processes) return null;
    const copy = [...processes];
    // For non-diff mode, delta sort fields fall back to the base field
    const field = (DELTA_FIELDS[sortField] ? sortField.replace("delta", "").replace(/^./, c => c.toLowerCase()) : sortField) as keyof ProcessInfo;
    copy.sort((a, b) => sortAsc ? (a[field] as number) - (b[field] as number) : (b[field] as number) - (a[field] as number));
    return copy;
  }, [processes, sortField, sortAsc]);

  const sortedDiffs = useMemo(() => {
    if (!processDiffs) return null;
    const copy = [...processDiffs];
    const deltaKey = DELTA_FIELDS[sortField];
    copy.sort((a, b) => {
      if (deltaKey) {
        // Sort by delta field
        const aVal = a[deltaKey] as number;
        const bVal = b[deltaKey] as number;
        return sortAsc ? aVal - bVal : bVal - aVal;
      }
      // Sort by current value
      const aVal = a.current[sortField as keyof ProcessInfo] as number;
      const bVal = b.current[sortField as keyof ProcessInfo] as number;
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [processDiffs, sortField, sortAsc]);

  const hasRss = processes ? processes.some(p => p.rssKb > 0) : false;
  // Show breakdown columns as soon as enrichment starts or any data arrives
  const hasBreakdown = enrichStatus !== null || (processes ? processes.some(p => p.javaHeapKb > 0 || p.nativeHeapKb > 0 || p.graphicsKb > 0 || p.codeKb > 0) : false);
  const hasOomLabel = processes ? processes.some(p => p.oomLabel !== "") : false;

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  }, [sortField, sortAsc]);

  const toggleSmapsSort = useCallback((field: SmapsSortField) => {
    if (smapsSortField === field) setSmapsSortAsc(!smapsSortAsc);
    else { setSmapsSortField(field); setSmapsSortAsc(false); }
  }, [smapsSortField, smapsSortAsc]);

  const toggleVmaSort = useCallback((field: VmaSortField) => {
    if (vmaSortField === field) setVmaSortAsc(!vmaSortAsc);
    else { setVmaSortField(field); setVmaSortAsc(false); }
  }, [vmaSortField, vmaSortAsc]);

  const hasWebUsb = typeof navigator !== "undefined" && "usb" in navigator;

  if (!hasWebUsb) {
    return (
      <div className="text-center py-8">
        <p className="text-stone-600 mb-2">WebUSB is not available.</p>
        <p className="text-stone-400 text-sm">Use Chrome or Edge over HTTPS/localhost.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Connection */}
      {!connected && !processes && (
        <div className="text-center py-8">
          <button
            className="px-6 py-3 bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:opacity-50"
            onClick={handleConnect}
            disabled={connectStatus !== null}
          >
            {connectStatus ?? "Connect USB Device"}
          </button>
          <p className="text-stone-400 text-xs mt-3">
            Enable USB debugging on device. If ADB is running, stop it first: <code className="bg-stone-100 px-1">adb kill-server</code>
          </p>
        </div>
      )}
      {(connected || processes) && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            {connected ? (
              <>
                <span className="text-stone-600">{conn.productName}</span>
                <span className="text-stone-400 font-mono text-xs">{conn.serial}</span>
              </>
            ) : (
              <span className="text-amber-600 text-xs">Disconnected</span>
            )}
            <label className="flex items-center gap-1.5 text-stone-500 text-xs ml-auto">
              <input type="checkbox" checked={withBitmaps} onChange={e => setWithBitmaps(e.target.checked)} className="accent-sky-600" />
              Bitmaps (-b)
            </label>
            <button
              className={`px-3 py-0.5 text-xs text-white transition-colors disabled:opacity-50 ${
                capturing ? "bg-amber-600 hover:bg-amber-700" : "bg-sky-600 hover:bg-sky-700"
              }`}
              onClick={() => handleCapture()}
              disabled={!connected || selectedPid === null || capturing}
              title={selectedPid === null ? "Select a process first" : capturing ? "Dump in progress" : "Dump Java heap"}
            >
              {capturing ? (captureStatus || "Dumping\u2026") : "Java dump"}
            </button>
            <button className={`text-xs ${connected ? "text-stone-400 hover:text-stone-600" : "text-stone-300 cursor-not-allowed"}`} onClick={refreshProcesses} disabled={!connected}>
              {enrichStatus && !diffMode ? "Refreshing\u2026" : enrichStatus && diffMode ? "Diffing\u2026" : "Refresh"}
            </button>
            {connected && processes && !enrichStatus && (
              <button
                className="text-sky-600 hover:text-sky-800 text-xs border border-sky-300 px-2 py-0.5"
                onClick={handleDiff}
              >
                Diff
              </button>
            )}
            {diffMode && !enrichStatus && (
              <button
                className="text-amber-600 hover:text-amber-800 text-xs border border-amber-300 px-2 py-0.5"
                onClick={clearDiff}
              >
                Clear Diff
              </button>
            )}
            {connected ? (
              <button className="text-stone-400 hover:text-stone-600 text-xs" onClick={handleDisconnect}>
                Disconnect
              </button>
            ) : (
              <button
                className="px-3 py-0.5 text-xs bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:opacity-50"
                onClick={handleConnect}
                disabled={connectStatus !== null}
              >
                {connectStatus ?? "Reconnect"}
              </button>
            )}
          </div>

          {/* Non-root banner */}
          {connected && !conn.isRoot && processes && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 mb-3">
              Non-rooted device — only debuggable apps can be captured
            </div>
          )}

          {/* Enrichment / smaps progress */}
          {enrichStatus && (
            <div className="mb-2 text-xs text-stone-500">
              <div className="flex items-center gap-2 mb-1">
                <span className="truncate">{diffMode ? `Diffing: ${enrichStatus}` : enrichStatus}</span>
                {enrichProgress && <span className="text-stone-400 whitespace-nowrap">{enrichProgress.done}/{enrichProgress.total}</span>}
                <button className="text-rose-500 hover:text-rose-700 ml-auto" onClick={cancelEnrichment}>Cancel</button>
              </div>
              {enrichProgress && enrichProgress.total > 0 && (
                <div className="h-1 bg-stone-100 rounded overflow-hidden">
                  <div className="h-full bg-sky-500 transition-all" style={{ width: `${(enrichProgress.done / enrichProgress.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Global memory summary */}
          {globalMemInfo && (
            <div className="mb-3 bg-white border border-stone-200 px-3 py-2 overflow-x-auto">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                {([
                  ["Total", globalMemInfo.totalRamKb, globalMemInfoDiff?.deltaTotalRamKb, false],
                  ["Free", globalMemInfo.freeRamKb, globalMemInfoDiff?.deltaFreeRamKb, true],
                  ["Used", globalMemInfo.usedPssKb, globalMemInfoDiff?.deltaUsedPssKb, false],
                  ...(globalMemInfo.memAvailableKb > 0 ? [["Available", globalMemInfo.memAvailableKb, globalMemInfoDiff?.deltaMemAvailableKb, true] as const] : []),
                  ...(globalMemInfo.lostRamKb > 0 ? [["Lost", globalMemInfo.lostRamKb, globalMemInfoDiff?.deltaLostRamKb, false] as const] : []),
                ] as const).map(([label, value, delta, inverted]) => (
                  <span key={label} className="text-stone-500 whitespace-nowrap">
                    {label}{" "}
                    <span className="font-mono text-stone-800">{fmtSize(value * 1024)}</span>
                    {delta != null && delta !== 0 && (
                      <span className={`font-mono ml-1 ${(inverted ? -delta : delta) > 0 ? "text-red-700" : "text-green-700"}`}>
                        {fmtDelta(delta)}
                      </span>
                    )}
                  </span>
                ))}
                {globalMemInfo.swapTotalKb > 0 && (
                  <span className="text-stone-500 whitespace-nowrap">
                    ZRAM{" "}
                    <span className="font-mono text-stone-800">
                      {fmtSize(globalMemInfo.zramPhysicalKb * 1024)}{" / "}{fmtSize(globalMemInfo.swapTotalKb * 1024)}
                    </span>
                    {globalMemInfoDiff && globalMemInfoDiff.deltaZramPhysicalKb !== 0 && (
                      <span className={`font-mono ml-1 ${globalMemInfoDiff.deltaZramPhysicalKb > 0 ? "text-red-700" : "text-green-700"}`}>
                        {fmtDelta(globalMemInfoDiff.deltaZramPhysicalKb)}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Process list */}
          {sorted === null ? (
            <div className="text-stone-400 p-4">Loading processes&hellip;</div>
          ) : sorted.length === 0 ? (
            <div className="text-stone-400 p-4 flex items-center gap-3">
              No processes found.
              <button className="text-sky-700 underline decoration-sky-300" onClick={refreshProcesses}>
                Refresh
              </button>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="py-1.5 px-2 text-stone-500 text-xs font-medium w-16"></th>
                    <th className="text-left py-1.5 px-2 text-stone-500 text-xs font-medium w-14">PID</th>
                    <th className="text-left py-1.5 px-2 text-stone-500 text-xs font-medium">Process</th>
                    {hasOomLabel && <th className="text-left py-1.5 px-2 text-stone-500 text-xs font-medium">State</th>}
                    {(() => {
                      const isDiff = diffMode && sortedDiffs !== null;
                      const fields: [SortField, string][] = [
                        ...(hasRss ? [["rssKb", "RSS"] as [SortField, string]] : []),
                        ["pssKb", "PSS"],
                        ...(hasBreakdown ? [
                          ["javaHeapKb", "Java"] as [SortField, string],
                          ["nativeHeapKb", "Native"] as [SortField, string],
                          ["graphicsKb", "Graphics"] as [SortField, string],
                          ["codeKb", "Code"] as [SortField, string],
                        ] : []),
                      ];
                      return fields.flatMap(([field, label]) => {
                        const th = (
                          <th
                            key={field}
                            className="text-right py-1.5 px-2 text-stone-500 text-xs font-medium w-20 cursor-pointer select-none whitespace-nowrap hover:text-stone-700"
                            onClick={() => toggleSort(field)}
                          >
                            {label} {sortField === field ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                          </th>
                        );
                        if (!isDiff) return [th];
                        const deltaField = VALUE_TO_DELTA[field];
                        return [th, (
                          <th
                            key={`d-${field}`}
                            className="text-right py-1.5 px-2 text-stone-500 text-xs font-medium w-20 cursor-pointer select-none whitespace-nowrap hover:text-stone-700"
                            onClick={() => toggleSort(deltaField)}
                          >
                            {"\u0394"} {sortField === deltaField ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                          </th>
                        )];
                      });
                    })()}
                  </tr>
                </thead>
                <tbody>
                  {/* Totals row */}
                  {(() => {
                    const isDiff = diffMode && sortedDiffs !== null;
                    const rows = isDiff ? sortedDiffs! : (sorted ?? []).map(p => ({ status: "matched" as const, current: p, prev: null, deltaPssKb: 0, deltaRssKb: 0, deltaJavaHeapKb: 0, deltaNativeHeapKb: 0, deltaGraphicsKb: 0, deltaCodeKb: 0 }));
                    const tot = { pssKb: 0, rssKb: 0, javaHeapKb: 0, nativeHeapKb: 0, graphicsKb: 0, codeKb: 0,
                      deltaPssKb: 0, deltaRssKb: 0, deltaJavaHeapKb: 0, deltaNativeHeapKb: 0, deltaGraphicsKb: 0, deltaCodeKb: 0 };
                    for (const d of rows) {
                      if (d.status !== "removed") {
                        tot.pssKb += d.current.pssKb; tot.rssKb += d.current.rssKb;
                        tot.javaHeapKb += d.current.javaHeapKb; tot.nativeHeapKb += d.current.nativeHeapKb;
                        tot.graphicsKb += d.current.graphicsKb; tot.codeKb += d.current.codeKb;
                      }
                      tot.deltaPssKb += d.deltaPssKb; tot.deltaRssKb += d.deltaRssKb;
                      const pu = d.prev != null && d.prev.javaHeapKb === 0 && d.prev.nativeHeapKb === 0 && d.prev.graphicsKb === 0 && d.prev.codeKb === 0;
                      if (!pu) {
                        tot.deltaJavaHeapKb += d.deltaJavaHeapKb; tot.deltaNativeHeapKb += d.deltaNativeHeapKb;
                        tot.deltaGraphicsKb += d.deltaGraphicsKb; tot.deltaCodeKb += d.deltaCodeKb;
                      }
                    }
                    const cols: { value: number; delta: number; key: string }[] = [];
                    if (hasRss) cols.push({ value: tot.rssKb, delta: tot.deltaRssKb, key: "rss" });
                    cols.push({ value: tot.pssKb, delta: tot.deltaPssKb, key: "pss" });
                    if (hasBreakdown) {
                      cols.push({ value: tot.javaHeapKb, delta: tot.deltaJavaHeapKb, key: "java" });
                      cols.push({ value: tot.nativeHeapKb, delta: tot.deltaNativeHeapKb, key: "native" });
                      cols.push({ value: tot.graphicsKb, delta: tot.deltaGraphicsKb, key: "graphics" });
                      cols.push({ value: tot.codeKb, delta: tot.deltaCodeKb, key: "code" });
                    }
                    return (
                      <tr className="border-b-2 border-stone-300 font-semibold bg-stone-50">
                        <td className="py-1 px-2 text-stone-600" colSpan={hasOomLabel ? 4 : 3}>Total ({rows.filter(d => d.status !== "removed").length})</td>
                        {cols.flatMap(({ value, delta, key }) => {
                          const valTd = (
                            <td key={key} className="py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem]">
                              {fmtSize(value * 1024)}
                            </td>
                          );
                          if (!isDiff) return [valTd];
                          return [valTd, (
                            <td key={`d-${key}`} className={`py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem] text-xs font-normal ${deltaBgClass(delta)} ${delta > 0 ? "text-red-700" : delta < 0 ? "text-green-700" : ""}`}>
                              {delta !== 0 ? fmtDelta(delta) : ""}
                            </td>
                          )];
                        })}
                      </tr>
                    );
                  })()}
                  {(diffMode && sortedDiffs ? sortedDiffs : (sorted ?? []).map(p => ({ status: "matched" as const, current: p, prev: null, deltaPssKb: 0, deltaRssKb: 0, deltaJavaHeapKb: 0, deltaNativeHeapKb: 0, deltaGraphicsKb: 0, deltaCodeKb: 0 }))).map(d => {
                    const p = d.current;
                    const canCapture = p.javaHeapKb > 0 && (conn.isRoot || p.debuggable !== false);
                    const isCapturingThis = capturing && selectedPid === p.pid;
                    const hasSmaps = smapsData.has(p.pid);
                    const isSmapsExpanded = expandedSmapsPid === p.pid && hasSmaps;
                    const isDiff = diffMode && sortedDiffs !== null;
                    const numValueCols = 1 + (hasRss ? 1 : 0) + (hasBreakdown ? 4 : 0);
                    const colCount = 3 + (hasOomLabel ? 1 : 0) + numValueCols + (isDiff ? numValueCols : 0);
                    const rowKey = `${d.status}-${p.pid}`;
                    return (
                    <Fragment key={rowKey}>
                    <tr
                      className={`border-t border-stone-100 cursor-pointer ${
                        d.status === "removed" ? "opacity-60" :
                        d.status === "added" ? "bg-green-50/50" :
                        isSmapsExpanded ? "bg-sky-50" : "hover:bg-stone-50"
                      }`}
                      onClick={() => {
                        if (d.status === "removed") return;
                        if (hasSmaps) {
                          if (expandedSmapsPid === p.pid) {
                            setExpandedSmapsPid(null);
                            setExpandedSmapsGroup(null);
                          } else {
                            setExpandedSmapsPid(p.pid);
                            setExpandedSmapsGroup(null);
                          }
                        }
                        setSelectedPid(p.pid);
                      }}
                    >
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        {p.javaHeapKb > 0 && d.status !== "removed" && (
                          canCapture ? (
                            <button
                              className="text-xs text-sky-600 hover:text-sky-800 disabled:text-stone-300 disabled:cursor-not-allowed px-2 py-0.5 border border-sky-200 hover:border-sky-400 disabled:border-stone-200 whitespace-nowrap"
                              disabled={!connected || capturing}
                              title={!connected ? "Disconnected" : capturing ? "Dump in progress" : "Dump Java heap"}
                              onClick={e => { e.stopPropagation(); handleCapture(p.pid); }}
                            >
                              {isCapturingThis ? "\u2026" : "Java dump"}
                            </button>
                          ) : (
                            <span className="text-xs text-stone-400" title="Only debuggable apps can be dumped on non-rooted devices">locked</span>
                          )
                        )}
                      </td>
                      <td className="py-1 px-2 font-mono text-stone-400 whitespace-nowrap">
                        {hasSmaps && d.status !== "removed" ? (
                          <span className="text-stone-400 mr-1">{isSmapsExpanded ? "\u25BC" : "\u25B6"}</span>
                        ) : enrichProgress && d.status !== "removed" ? (
                          <span className="text-stone-300 mr-1 text-[10px]">{"\u2026"}</span>
                        ) : null}
                        {p.pid}
                      </td>
                      <td className={`py-1 px-2 text-stone-800 truncate max-w-[400px] ${d.status === "removed" ? "line-through" : ""}`} title={p.name}>
                        {p.name}
                        {isDiff && d.status !== "matched" && (
                          <span className={`ml-2 text-[10px] font-medium ${d.status === "added" ? "text-green-600" : "text-red-600"}`}>
                            {d.status === "added" ? "NEW" : "GONE"}
                          </span>
                        )}
                      </td>
                      {hasOomLabel && (
                        <td className="py-1 px-2 text-stone-500 text-xs whitespace-nowrap">
                          {p.oomLabel}
                          {isDiff && d.prev && d.prev.oomLabel !== p.oomLabel && (
                            <span className="ml-1 text-amber-600" title={`was: ${d.prev.oomLabel || "(none)"}`}>
                              {"\u2190 "}{d.prev.oomLabel || "\u2014"}
                            </span>
                          )}
                        </td>
                      )}
                      {(() => {
                        // Build the list of numeric columns with their current value and delta
                        // Suppress breakdown deltas if prev wasn't enriched (all breakdown fields zero)
                        const prevUnenriched = isDiff && d.prev != null &&
                          d.prev.javaHeapKb === 0 && d.prev.nativeHeapKb === 0 && d.prev.graphicsKb === 0 && d.prev.codeKb === 0;
                        const cols: { value: number; delta: number; key: string }[] = [];
                        if (hasRss) cols.push({ value: p.rssKb, delta: d.deltaRssKb, key: "rss" });
                        cols.push({ value: p.pssKb, delta: d.deltaPssKb, key: "pss" });
                        if (hasBreakdown) {
                          cols.push({ value: p.javaHeapKb, delta: d.deltaJavaHeapKb, key: "java" });
                          cols.push({ value: p.nativeHeapKb, delta: d.deltaNativeHeapKb, key: "native" });
                          cols.push({ value: p.graphicsKb, delta: d.deltaGraphicsKb, key: "graphics" });
                          cols.push({ value: p.codeKb, delta: d.deltaCodeKb, key: "code" });
                        }
                        return cols.flatMap(({ value, delta, key }) => {
                          const isBreakdownCol = key !== "rss" && key !== "pss";
                          const skipDelta = isBreakdownCol && prevUnenriched;
                          const effectiveDelta = skipDelta ? 0 : delta;
                          const showDash = isBreakdownCol && value === 0 && (!isDiff || effectiveDelta === 0);
                          const valTd = (
                            <td key={key} className="py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem]">
                              {showDash ? "\u2014" : fmtSize(value * 1024)}
                            </td>
                          );
                          if (!isDiff) return [valTd];
                          return [valTd, (
                            <td key={`d-${key}`} className={`py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem] text-xs ${deltaBgClass(effectiveDelta)} ${effectiveDelta > 0 ? "text-red-700" : effectiveDelta < 0 ? "text-green-700" : ""}`}>
                              {effectiveDelta !== 0 ? fmtDelta(effectiveDelta) : ""}
                            </td>
                          )];
                        });
                      })()}
                    </tr>
                    {isSmapsExpanded && d.status !== "removed" && (
                      <tr>
                        <td colSpan={colCount} className="p-0 border-t border-stone-200">
                          <SmapsSubTable
                            aggregated={smapsData.get(p.pid)!}
                            expandedGroup={expandedSmapsGroup}
                            onToggleGroup={name => setExpandedSmapsGroup(expandedSmapsGroup === name ? null : name)}
                            sortField={smapsSortField}
                            sortAsc={smapsSortAsc}
                            onToggleSort={toggleSmapsSort}
                            vmaSortField={vmaSortField}
                            vmaSortAsc={vmaSortAsc}
                            onToggleVmaSort={toggleVmaSort}
                            smapsDiffs={isDiff && prevSmapsData.has(p.pid) ? diffSmaps(prevSmapsData.get(p.pid)!, smapsData.get(p.pid)!) : null}
                            prevAggregated={isDiff && prevSmapsData.has(p.pid) ? prevSmapsData.get(p.pid)! : null}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Capture status */}
          {capturing && (
            <div className="mt-2 text-xs text-stone-600">
              <div className="flex items-center gap-2 mb-1">
                <span className="truncate font-medium">{captureStatus}</span>
                {captureProgress && <span className="text-stone-400 whitespace-nowrap">{(captureProgress.done / 1048576).toFixed(1)}/{(captureProgress.total / 1048576).toFixed(1)} MiB</span>}
                <button className="text-rose-500 hover:text-rose-700 ml-auto" onClick={cancelCapture}>Cancel</button>
              </div>
              {captureProgress && captureProgress.total > 0 && (
                <div className="h-1 bg-stone-100 rounded overflow-hidden">
                  <div className="h-full bg-sky-600 transition-all" style={{ width: `${(captureProgress.done / captureProgress.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>
      )}
    </div>
  );
}

export default CaptureView;
