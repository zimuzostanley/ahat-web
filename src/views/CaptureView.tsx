import { useState, useCallback, useRef, useMemo, useEffect, Fragment } from "react";
import { AdbConnection, PINNED_PROCESSES, type ProcessInfo, type CapturePhase, type SmapsAggregated, type SmapsEntry, type SmapsRollup, type SharedMapping, type SharedMappingDiff, type GlobalMemInfo, type ProcessDiff, type GlobalMemInfoDiff, type SmapsDiff, type SmapsEntryDiff, diffProcesses, diffGlobalMemInfo, diffSmaps, diffSmapsEntries, aggregateSmaps, aggregateSharedMappings, diffSharedMappings } from "../adb/capture";
import { fmtSize, fmtDelta, deltaBgClass } from "../format";
import { sortWithDiffPinning, computeSmapsTotals, SMAPS_COLUMNS, SMAPS_DELTA_KEY, type SmapsNumericField } from "./capture-helpers";

type SmapsSortFieldType = SmapsNumericField | "count";
type VmaSortFieldType = SmapsNumericField | "addrStart";

/** Stable sort toggle hook — callback has no deps, never changes identity. */
function useSort<F extends string>(initial: F): [F, boolean, (f: F) => void] {
  const [state, setState] = useState({ field: initial, asc: false });
  const toggle = useCallback((f: F) => {
    setState(prev => prev.field === f ? { ...prev, asc: !prev.asc } : { field: f, asc: false });
  }, []);
  return [state.field, state.asc, toggle];
}

function VmaEntries({ entries, groupName, pid, processName, sortField, sortAsc, onToggleSort, onDump, dumpDisabled, entryDiffs, leadingColCount }: {
  entries: SmapsEntry[];
  groupName: string;
  pid: number;
  processName: string;
  sortField: VmaSortFieldType;
  sortAsc: boolean;
  onToggleSort: (f: VmaSortFieldType) => void;
  onDump: (pid: number, processName: string, label: string, regions: { addrStart: string; addrEnd: string }[]) => void;
  dumpDisabled: boolean;
  entryDiffs?: SmapsEntryDiff[] | null;
  leadingColCount: number;
}) {
  const diffByAddr = useMemo(() => {
    if (!entryDiffs) return null;
    return new Map(entryDiffs.map(d => [d.current.addrStart, d]));
  }, [entryDiffs]);

  const sorted = useMemo(() => {
    const cmp = (a: SmapsEntry, b: SmapsEntry) => {
      if (sortField === "addrStart") {
        return sortAsc ? a.addrStart.localeCompare(b.addrStart) : b.addrStart.localeCompare(a.addrStart);
      }
      return sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
    };
    return sortWithDiffPinning(entries, entryDiffs, cmp);
  }, [entries, entryDiffs, sortField, sortAsc]);

  return (
    <>
      <tr className="bg-stone-100 dark:bg-stone-700">
        <td colSpan={leadingColCount} className="py-0.5 px-2 pl-8">
          <span className="text-stone-500 dark:text-stone-400 text-[10px] font-medium cursor-pointer hover:text-stone-700 dark:hover:text-stone-200" onClick={() => onToggleSort("addrStart")}>
            Address {sortField === "addrStart" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
          </span>
          <span className="ml-3 text-stone-400 dark:text-stone-500 text-[10px]">Perms</span>
          <button
            className="ml-3 text-[10px] text-stone-400 dark:text-stone-500 hover:text-sky-600 dark:hover:text-sky-400 disabled:text-stone-300 dark:disabled:text-stone-600"
            disabled={dumpDisabled}
            title="Dump all VMA memory in this group"
            onClick={() => onDump(pid, processName, groupName, entries.map(e => ({ addrStart: e.addrStart, addrEnd: e.addrEnd })))}
          >dump all</button>
        </td>
        {SMAPS_COLUMNS.map(([f, label]) => (
          <td key={f} className="py-0.5 px-2 text-right text-stone-500 dark:text-stone-400 text-[10px] font-medium cursor-pointer hover:text-stone-700 dark:hover:text-stone-200" onClick={() => onToggleSort(f)}>
            {label} {sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
          </td>
        ))}
      </tr>
      {sorted.map((e, i) => {
        const ed = diffByAddr?.get(e.addrStart);
        return (
        <tr key={i} className={`border-t border-stone-50 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 ${
          ed?.status === "removed" ? "opacity-60" :
          ed?.status === "added" ? "bg-green-50/50 dark:bg-green-900/30" : ""
        }`}>
          <td colSpan={leadingColCount} className={`py-0.5 px-2 pl-8 font-mono text-[10px] text-stone-500 dark:text-stone-400 whitespace-nowrap ${ed?.status === "removed" ? "line-through" : ""}`}>
            {e.addrStart}-{e.addrEnd}
            <span className="ml-2 text-stone-400 dark:text-stone-500">{e.perms}</span>
            {ed && ed.status !== "matched" && (
              <span className={`ml-2 font-medium ${ed.status === "added" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {ed.status === "added" ? "NEW" : "GONE"}
              </span>
            )}
            <button
              className="ml-2 text-stone-400 dark:text-stone-500 hover:text-sky-600 dark:hover:text-sky-400 disabled:text-stone-300 dark:disabled:text-stone-600"
              disabled={dumpDisabled || ed?.status === "removed"}
              title="Dump this VMA"
              onClick={() => onDump(pid, processName, `${groupName}_${e.addrStart}-${e.addrEnd}`, [{ addrStart: e.addrStart, addrEnd: e.addrEnd }])}
            >dump</button>
          </td>
          {SMAPS_COLUMNS.map(([f]) => {
            const delta = ed ? ed[SMAPS_DELTA_KEY[f]] : 0;
            return (
            <td key={f} className={`py-0.5 px-2 text-right font-mono text-[10px] whitespace-nowrap ${ed ? deltaBgClass(delta) : ""}`}>
              {e[f] > 0 ? fmtSize(e[f] * 1024) : "\u2014"}
              {ed && (
                <span className={`ml-1 inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`}>
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

function SmapsSubTable({ pid, processName, aggregated, expandedGroup, onToggleGroup, sortField, sortAsc, onToggleSort, vmaSortField, vmaSortAsc, onToggleVmaSort, onDump, dumpDisabled, smapsDiffs, prevAggregated, leadingColCount }: {
  pid: number;
  processName: string;
  aggregated: SmapsAggregated[];
  expandedGroup: string | null;
  onToggleGroup: (name: string) => void;
  sortField: SmapsSortFieldType;
  sortAsc: boolean;
  onToggleSort: (f: SmapsSortFieldType) => void;
  vmaSortField: VmaSortFieldType;
  vmaSortAsc: boolean;
  onToggleVmaSort: (f: VmaSortFieldType) => void;
  onDump: (pid: number, processName: string, label: string, regions: { addrStart: string; addrEnd: string }[]) => void;
  dumpDisabled: boolean;
  smapsDiffs?: SmapsDiff[] | null;
  prevAggregated?: SmapsAggregated[] | null;
  leadingColCount: number;
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
    const cmp = (a: SmapsAggregated, b: SmapsAggregated) => {
      return sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
    };
    return sortWithDiffPinning(aggregated, smapsDiffs, cmp);
  }, [aggregated, smapsDiffs, sortField, sortAsc]);

  const totals = useMemo(
    () => computeSmapsTotals(aggregated, smapsDiffs),
    [aggregated, smapsDiffs],
  );

  return (
    <>
      {/* Sub-table header */}
      <tr className="bg-stone-50 dark:bg-stone-800 border-t border-stone-200 dark:border-stone-700">
        <td colSpan={leadingColCount - 1} className="text-left py-1 px-2 pl-6 text-stone-500 dark:text-stone-400 text-xs font-medium">
          Mapping
        </td>
        <td
          className="text-right py-1 px-1 text-stone-400 dark:text-stone-500 text-xs font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200"
          onClick={() => onToggleSort("count")}
        >
          # {sortField === "count" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
        </td>
        {SMAPS_COLUMNS.map(([f, label]) => (
          <td
            key={f}
            className="text-right py-1 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200 whitespace-nowrap"
            onClick={() => onToggleSort(f)}
          >
            {label} {sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
          </td>
        ))}
      </tr>
      {/* Totals row */}
      <tr className="border-b-2 border-stone-300 dark:border-stone-600 font-semibold bg-stone-50 dark:bg-stone-800">
        <td colSpan={leadingColCount} className="py-0.5 px-2 pl-6 text-stone-600 dark:text-stone-300 text-xs">Total</td>
        {SMAPS_COLUMNS.map(([f]) => {
          const delta = totals[SMAPS_DELTA_KEY[f]];
          return (
            <td key={f} className={`py-0.5 px-2 text-right font-mono text-xs whitespace-nowrap ${smapsDiffs ? deltaBgClass(delta) : ""}`}>
              {totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014"}
              {smapsDiffs && (
                <span className={`ml-1 text-[10px] font-normal inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`}>
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
            className={`border-t border-stone-100 dark:border-stone-800 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-700 bg-stone-50 dark:bg-stone-800 text-xs ${
              sd?.status === "removed" ? "opacity-60" :
              sd?.status === "added" ? "bg-green-50/50 dark:bg-green-900/30" : ""
            }`}
            onClick={() => sd?.status !== "removed" && onToggleGroup(g.name)}
          >
            <td colSpan={leadingColCount - 1} className={`py-0.5 px-2 pl-6 font-mono text-stone-700 dark:text-stone-200 ${sd?.status === "removed" ? "line-through" : ""}`} title={g.name}>
              <div className="flex items-center gap-1">
                <span className="text-stone-400 dark:text-stone-500 shrink-0">{expandedGroup === g.name ? "\u25BC" : "\u25B6"}</span>
                <span className="truncate max-w-[280px]">{g.name}</span>
                {sd && sd.status !== "matched" && (
                  <span className={`text-[10px] font-medium shrink-0 ${sd.status === "added" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {sd.status === "added" ? "NEW" : "GONE"}
                  </span>
                )}
                <button
                  className="text-[10px] text-stone-400 dark:text-stone-500 hover:text-sky-600 dark:hover:text-sky-400 disabled:text-stone-300 dark:disabled:text-stone-600 shrink-0"
                  disabled={dumpDisabled || sd?.status === "removed"}
                  title={`Dump ${g.name} memory`}
                  onClick={e => { e.stopPropagation(); onDump(pid, processName, g.name, g.entries.map(en => ({ addrStart: en.addrStart, addrEnd: en.addrEnd }))); }}
                >dump</button>
              </div>
            </td>
            <td className="py-0.5 px-1 text-right font-mono text-stone-400 dark:text-stone-500">{g.count}</td>
            {SMAPS_COLUMNS.map(([f]) => {
              const delta = sd ? sd[SMAPS_DELTA_KEY[f]] : 0;
              return (
                <td key={f} className={`py-0.5 px-2 text-right font-mono whitespace-nowrap ${sd ? deltaBgClass(delta) : ""}`}>
                  {g[f] > 0 ? fmtSize(g[f] * 1024) : "\u2014"}
                  {sd && (
                    <span className={`ml-1 text-[10px] inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`}>
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
              groupName={g.name}
              pid={pid}
              processName={processName}
              sortField={vmaSortField}
              sortAsc={vmaSortAsc}
              onToggleSort={onToggleVmaSort}
              onDump={onDump}
              dumpDisabled={dumpDisabled}
              entryDiffs={prevEntries ? diffSmapsEntries(prevEntries, g.entries) : null}
              leadingColCount={leadingColCount}
            />
          )}
        </Fragment>
        );
      })}
    </>
  );
}

// ─── Shared Mappings Table ────────────────────────────────────────────────────

function SharedMappingsTable({ mappings, loadedCount, loading, diffs, smapsData, onDump, dumpDisabled }: {
  mappings: SharedMapping[];
  loadedCount: number;
  loading: boolean;
  diffs?: SharedMappingDiff[] | null;
  smapsData: Map<number, SmapsAggregated[]>;
  onDump: (pid: number, processName: string, label: string, regions: { addrStart: string; addrEnd: string }[]) => void;
  dumpDisabled: boolean;
}) {
  const [sortField, sortAsc, toggleSort] = useSort<SmapsNumericField | "processCount">("pssKb");
  const [expandedMapping, setExpandedMapping] = useState<string | null>(null);

  const diffByName = useMemo(() => {
    if (!diffs) return null;
    return new Map(diffs.map(d => [d.current.name, d]));
  }, [diffs]);

  const sorted = useMemo(() => {
    const cmp = (a: SharedMapping, b: SharedMapping) => {
      return sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
    };
    return sortWithDiffPinning(mappings, diffs, cmp);
  }, [mappings, diffs, sortField, sortAsc]);

  const totals = useMemo(
    () => computeSmapsTotals(mappings, diffs),
    [mappings, diffs],
  );

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-2">
        Shared Mappings
        <span className="font-normal ml-2">
          ({mappings.length} mappings across {loadedCount} processes)
        </span>
        {loading && <span className="ml-2 text-sky-600 dark:text-sky-400 animate-pulse">loading{"\u2026"}</span>}
      </h3>
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 max-h-[500px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-stone-50 dark:bg-stone-800 z-10">
            <tr className="border-b border-stone-200 dark:border-stone-700">
              <th className="text-left py-1 px-2 text-stone-500 dark:text-stone-400 font-medium">Mapping</th>
              <th
                className="text-right py-1 px-1 text-stone-400 dark:text-stone-500 font-medium w-8 cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200"
                onClick={() => toggleSort("processCount")}
              >
                Procs {sortField === "processCount" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
              </th>
              {SMAPS_COLUMNS.map(([f, label]) => (
                <th
                  key={f}
                  className="text-right py-1 px-2 text-stone-500 dark:text-stone-400 font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200 whitespace-nowrap"
                  onClick={() => toggleSort(f)}
                >
                  {label} {sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b-2 border-stone-300 dark:border-stone-600 font-semibold">
              <td className="py-0.5 px-2 text-stone-600 dark:text-stone-300">Total</td>
              <td />
              {SMAPS_COLUMNS.map(([f]) => {
                const delta = totals[SMAPS_DELTA_KEY[f]];
                return (
                  <td key={f} className={`py-0.5 px-2 text-right font-mono whitespace-nowrap ${diffs ? deltaBgClass(delta) : ""}`}>
                    {totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014"}
                    {diffs && (
                      <span className={`ml-1 text-[10px] font-normal inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`}>
                        {delta !== 0 ? fmtDelta(delta) : ""}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
            {sorted.map((m, i) => {
              const sd = diffByName?.get(m.name);
              return (
              <Fragment key={`${m.name}-${i}`}>
                <tr
                  className={`border-t border-stone-100 dark:border-stone-800 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800 ${
                    sd?.status === "removed" ? "opacity-60" :
                    sd?.status === "added" ? "bg-green-50/50 dark:bg-green-900/30" : ""
                  }`}
                  onClick={() => sd?.status !== "removed" && setExpandedMapping(expandedMapping === m.name ? null : m.name)}
                >
                  <td className={`py-0.5 px-2 font-mono text-stone-700 dark:text-stone-200 ${sd?.status === "removed" ? "line-through" : ""}`} title={m.name}>
                    <div className="flex items-center gap-1">
                      <span className="text-stone-400 dark:text-stone-500 shrink-0">{expandedMapping === m.name ? "\u25BC" : "\u25B6"}</span>
                      <span className="truncate max-w-[280px]">{m.name}</span>
                      {sd && sd.status !== "matched" && (
                        <span className={`text-[10px] font-medium shrink-0 ${sd.status === "added" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {sd.status === "added" ? "NEW" : "GONE"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-0.5 px-1 text-right font-mono text-stone-400 dark:text-stone-500">{m.processCount}</td>
                  {SMAPS_COLUMNS.map(([f]) => {
                    const delta = sd ? sd[SMAPS_DELTA_KEY[f]] : 0;
                    return (
                      <td key={f} className={`py-0.5 px-2 text-right font-mono whitespace-nowrap ${sd ? deltaBgClass(delta) : ""}`}>
                        {m[f] > 0 ? fmtSize(m[f] * 1024) : "\u2014"}
                        {sd && (
                          <span className={`ml-1 text-[10px] inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`}>
                            {delta !== 0 ? fmtDelta(delta) : ""}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {expandedMapping === m.name && sd?.status !== "removed" && (
                  <>
                    <tr className="bg-stone-100 dark:bg-stone-700">
                      <td className="py-0.5 px-2 pl-6 text-stone-500 dark:text-stone-400 text-[10px] font-medium">
                        Process (PID)
                      </td>
                      <td />
                      {SMAPS_COLUMNS.map(([, label]) => (
                        <td key={label} className="py-0.5 px-2 text-right text-stone-500 dark:text-stone-400 text-[10px] font-medium">
                          {label}
                        </td>
                      ))}
                    </tr>
                    {m.processes.map(p => {
                      const procAgg = smapsData.get(p.pid);
                      const matchedGroup = procAgg?.find(g => g.name === m.name);
                      const regions = matchedGroup?.entries.map(e => ({ addrStart: e.addrStart, addrEnd: e.addrEnd }));
                      return (
                      <tr key={p.pid} className="border-t border-stone-50 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700">
                        <td className="py-0.5 px-2 pl-6 text-[10px] text-stone-600 dark:text-stone-300 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <span>{p.name} <span className="text-stone-400 dark:text-stone-500">({p.pid})</span></span>
                            <button
                              className="text-[10px] text-stone-400 dark:text-stone-500 hover:text-sky-600 dark:hover:text-sky-400 disabled:text-stone-300 dark:disabled:text-stone-600 shrink-0"
                              disabled={dumpDisabled || !regions?.length}
                              title={`Dump ${m.name} from ${p.name} (${p.pid})`}
                              onClick={() => regions && onDump(p.pid, p.name, m.name, regions)}
                            >dump</button>
                          </div>
                        </td>
                        <td />
                        {SMAPS_COLUMNS.map(([f]) => (
                          <td key={f} className="py-0.5 px-2 text-right font-mono text-[10px] whitespace-nowrap">
                            {p[f] > 0 ? fmtSize(p[f] * 1024) : "\u2014"}
                          </td>
                        ))}
                      </tr>
                      );
                    })}
                  </>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Per-Row Dump Button ──────────────────────────────────────────────────────

interface CaptureJob {
  status: string;
  progress: { done: number; total: number } | null;
  error: string | null;
}

function DumpButton({ pid, job, disabled, onDump, onCancel }: {
  pid: number;
  job: CaptureJob | undefined;
  disabled: boolean;
  onDump: (pid: number, withBitmaps: boolean) => void;
  onCancel: (pid: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on outside click or scroll
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("scroll", close, true); };
  }, [open]);

  if (job) {
    // Active capture — show status + cancel
    const pct = job.progress && job.progress.total > 0
      ? `${Math.round(job.progress.done / job.progress.total * 100)}%`
      : null;
    return (
      <button
        className="text-xs text-amber-700 dark:text-amber-400 hover:text-rose-700 dark:hover:text-rose-400 px-2 py-0.5 border border-amber-300 dark:border-amber-600 hover:border-rose-400 dark:hover:border-rose-500 whitespace-nowrap w-[104px] truncate"
        title="Click to cancel"
        onClick={(e) => { e.stopPropagation(); onCancel(pid); }}
      >
        {pct ?? job.status}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative inline-flex w-[104px]">
      <button
        className="flex-1 text-xs text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 disabled:text-stone-300 dark:disabled:text-stone-600 disabled:cursor-not-allowed px-2 py-0.5 border border-r-0 border-sky-200 dark:border-sky-700 hover:border-sky-400 dark:hover:border-sky-500 disabled:border-stone-200 dark:disabled:border-stone-700 whitespace-nowrap rounded-l"
        disabled={disabled}
        title="Dump Java heap"
        onClick={(e) => { e.stopPropagation(); onDump(pid, false); }}
      >
        Dump
      </button>
      <button
        ref={caretRef}
        className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 disabled:text-stone-300 dark:disabled:text-stone-600 disabled:cursor-not-allowed px-1 py-0.5 border border-sky-200 dark:border-sky-700 hover:border-sky-400 dark:hover:border-sky-500 disabled:border-stone-200 dark:disabled:border-stone-700 rounded-r"
        disabled={disabled}
        title="More options"
        onClick={(e) => {
          e.stopPropagation();
          if (!open && caretRef.current) {
            const r = caretRef.current.getBoundingClientRect();
            setMenuPos({ top: r.bottom + 2, left: r.right - 160 });
          }
          setOpen(!open);
        }}
      >
        {"\u25BE"}
      </button>
      {open && menuPos && (
        <div
          className="fixed z-50 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 shadow-lg rounded text-xs w-[160px]"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-900/30 text-stone-700 dark:text-stone-200 rounded-t"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDump(pid, false); }}
          >
            Java dump
          </button>
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-900/30 text-stone-700 dark:text-stone-200 border-t border-stone-100 dark:border-stone-800 rounded-b"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDump(pid, true); }}
          >
            + bitmaps
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Capture View ─────────────────────────────────────────────────────────────

type SortField = "pid" | "name" | "oomLabel" | SmapsNumericField;

// Process table columns shown when rollup data is available
const ROLLUP_COLUMNS: [SmapsNumericField, string][] = [
  ["rssKb", "RSS"], ["pssKb", "PSS"],
  ["privateDirtyKb", "Priv Dirty"], ["privateCleanKb", "Priv Clean"],
  ["sharedDirtyKb", "Shared Dirty"], ["sharedCleanKb", "Shared Clean"],
  ["swapKb", "Swap"],
];

/** Get a sortable value from either rollup data or ProcessInfo fallback. */
function getFieldValue(p: ProcessInfo, field: SmapsNumericField, rollup?: SmapsRollup): number {
  if (rollup) return rollup[field];
  if (field === "pssKb") return p.pssKb;
  if (field === "rssKb") return p.rssKb;
  return 0;
}

function CaptureView({ onCaptured, onVmaDump, conn }: {
  onCaptured: (name: string, buffer: ArrayBuffer) => void;
  onVmaDump: (name: string, buffer: ArrayBuffer, regions?: { addrStart: string; addrEnd: string }[]) => void;
  conn: AdbConnection;
}) {
  const [connected, setConnected] = useState(false);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);
  const [sortField, sortAsc, toggleSort] = useSort<SortField>("pssKb");
  const [error, setError] = useState<string | null>(null);

  // Enrichment runs in the background — independent of captures
  const enrichAbortRef = useRef<AbortController | null>(null);
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);

  // Per-PID capture state — each process row has independent dump lifecycle
  const [captureJobs, setCaptureJobs] = useState<Map<number, CaptureJob>>(new Map());
  const captureAbortRefs = useRef<Map<number, AbortController>>(new Map());

  // VMA dump state
  const vmaDumpAbortRef = useRef<AbortController | null>(null);
  const [vmaDumpStatus, setVmaDumpStatus] = useState<string | null>(null);

  // Smaps rollup — fast batch fetch (root-only)
  const [smapsRollups, setSmapsRollups] = useState<Map<number, SmapsRollup>>(new Map());
  const [globalMemInfo, setGlobalMemInfo] = useState<GlobalMemInfo | null>(null);
  // Java PIDs — from dumpsys meminfo, used to show Java dump button only for managed processes
  const [javaPids, setJavaPids] = useState<Set<number>>(new Set());

  // Full smaps — fetched on demand per process or via "Scan All"
  const [smapsData, setSmapsData] = useState<Map<number, SmapsAggregated[]>>(new Map());
  const smapsDataRef = useRef(smapsData);
  smapsDataRef.current = smapsData;
  const smapsFetchAbortRef = useRef<AbortController | null>(null);
  const [smapsFetchPid, setSmapsFetchPid] = useState<number | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);

  // Smaps expansion / sort state
  const [expandedSmapsPid, setExpandedSmapsPid] = useState<number | null>(null);
  const [expandedSmapsGroup, setExpandedSmapsGroup] = useState<string | null>(null);
  const [smapsSortField, smapsSortAsc, toggleSmapsSort] = useSort<SmapsSortFieldType>("pssKb");
  const [vmaSortField, vmaSortAsc, toggleVmaSort] = useSort<VmaSortFieldType>("pssKb");

  // Diff state
  const [diffMode, setDiffMode] = useState(false);
  const [prevProcesses, setPrevProcesses] = useState<ProcessInfo[] | null>(null);
  const [prevGlobalMemInfo, setPrevGlobalMemInfo] = useState<GlobalMemInfo | null>(null);
  const [processDiffs, setProcessDiffs] = useState<ProcessDiff[] | null>(null);
  const [globalMemInfoDiff, setGlobalMemInfoDiff] = useState<GlobalMemInfoDiff | null>(null);
  const [prevSmapsData, setPrevSmapsData] = useState<Map<number, SmapsAggregated[]>>(new Map());
  const [prevSmapsRollups, setPrevSmapsRollups] = useState<Map<number, SmapsRollup>>(new Map());
  const diffTriggeredRef = useRef(false);

  const clearDiff = useCallback(() => {
    setDiffMode(false);
    setPrevProcesses(null);
    setPrevGlobalMemInfo(null);
    setProcessDiffs(null);
    setGlobalMemInfoDiff(null);
    setPrevSmapsData(new Map());
    setPrevSmapsRollups(new Map());
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

  const cancelCapture = useCallback((pid: number) => {
    const ac = captureAbortRefs.current.get(pid);
    if (ac) { ac.abort(); captureAbortRefs.current.delete(pid); }
    setCaptureJobs(prev => { const m = new Map(prev); m.delete(pid); return m; });
  }, []);

  const cancelAllCaptures = useCallback(() => {
    for (const [, ac] of captureAbortRefs.current) ac.abort();
    captureAbortRefs.current.clear();
    setCaptureJobs(new Map());
  }, []);

  const cancelSmapsFetch = useCallback(() => {
    if (!smapsFetchAbortRef.current) return;
    smapsFetchAbortRef.current.abort();
    smapsFetchAbortRef.current = null;
    setSmapsFetchPid(null);
    setScanStatus(null);
    setScanProgress(null);
  }, []);

  const cancelVmaDump = useCallback(() => {
    if (!vmaDumpAbortRef.current) return;
    vmaDumpAbortRef.current.abort();
    vmaDumpAbortRef.current = null;
    setVmaDumpStatus(null);
  }, []);

  const refreshProcesses = useCallback(async () => {
    if (!conn.connected) return;
    cancelEnrichment();
    cancelSmapsFetch();
    if (!diffTriggeredRef.current) clearDiff();
    diffTriggeredRef.current = false;
    const ac = new AbortController();
    enrichAbortRef.current = ac;
    setEnrichStatus("Fetching smaps\u2026");
    setEnrichProgress(null);
    setSmapsRollups(new Map());
    setSmapsData(new Map());
    setExpandedSmapsPid(null);
    setExpandedSmapsGroup(null);
    setGlobalMemInfo(null);
    setJavaPids(new Set());
    setError(null);
    try {
      // Step 1: Fast Java process list from `dumpsys activity lru` + pinned system processes
      const lruList = await conn.getLruProcesses(ac.signal);
      if (ac.signal.aborted) return;
      const lruPids = new Set(lruList.map(p => p.pid));
      try {
        const pinned = await conn.getPinnedProcesses(lruPids, ac.signal);
        if (!ac.signal.aborted) lruList.unshift(...pinned);
      } catch { /* best-effort */ }
      if (ac.signal.aborted) return;
      const lruJavaPids = new Set(lruList.map(p => p.pid));
      setProcesses(lruList);
      setJavaPids(lruJavaPids);

      if (!conn.isRoot) {
        // Non-root: check debuggable packages, then stop
        if (!ac.signal.aborted) {
          try {
            const debuggable = await conn.getDebuggablePackages(ac.signal);
            if (!ac.signal.aborted) {
              for (const p of lruList) p.debuggable = debuggable.has(p.name);
              setProcesses([...lruList]);
            }
          } catch {}
        }
        return;
      }

      // Step 2 (root, bg): Get ALL processes + smaps_rollup from /proc
      if (!ac.signal.aborted) {
        const { list: procList, rollups, javaPids: procJavaPids } = await conn.getProcessesFromProc(ac.signal);
        if (ac.signal.aborted) return;

        // Merge: keep OOM labels from LRU, add all /proc processes
        const oomByPid = new Map(lruList.map(p => [p.pid, p.oomLabel]));
        for (const p of procList) {
          const oom = oomByPid.get(p.pid);
          if (oom) p.oomLabel = oom;
        }
        // Java PIDs: union of LRU (authoritative) + /proc heuristic
        const mergedJavaPids = new Set([...lruJavaPids, ...procJavaPids]);
        setProcesses(procList);
        setSmapsRollups(rollups);
        setJavaPids(mergedJavaPids);
      }

      // Step 3 (root, bg): /proc/meminfo for global memory stats
      if (!ac.signal.aborted) {
        try {
          const procInfo = await conn.getProcMeminfo(ac.signal);
          if (!ac.signal.aborted && procInfo.totalRamKb) {
            setGlobalMemInfo({
              totalRamKb: procInfo.totalRamKb ?? 0,
              freeRamKb: procInfo.freeRamKb ?? 0,
              usedPssKb: 0,
              lostRamKb: 0,
              zramPhysicalKb: 0,
              swapTotalKb: procInfo.swapTotalKb ?? 0,
              swapFreeKb: procInfo.swapFreeKb ?? 0,
              memAvailableKb: procInfo.memAvailableKb ?? 0,
              buffersKb: procInfo.buffersKb ?? 0,
              cachedKb: procInfo.cachedKb ?? 0,
            });
          }
        } catch {}
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
  }, [cancelEnrichment, cancelSmapsFetch, clearDiff]);

  // On-demand smaps fetch for a single process
  const fetchSmapsOnDemand = useCallback(async (pid: number) => {
    if (smapsDataRef.current.has(pid) || !conn.connected || !conn.isRoot) return;
    cancelSmapsFetch();
    const ac = new AbortController();
    smapsFetchAbortRef.current = ac;
    setSmapsFetchPid(pid);
    try {
      const entries = await conn.getSmapsForPid(pid, ac.signal);
      if (ac.signal.aborted) return;
      if (entries.length > 0) {
        setSmapsData(prev => new Map(prev).set(pid, aggregateSmaps(entries)));
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    } finally {
      if (smapsFetchAbortRef.current === ac) {
        smapsFetchAbortRef.current = null;
        setSmapsFetchPid(null);
      }
    }
  }, [conn, cancelSmapsFetch]);

  // Scan all processes for full smaps data (populates shared mappings table)
  const scanAllSmaps = useCallback(async () => {
    if (!conn.connected || !conn.isRoot || !processes) return;
    cancelSmapsFetch();
    const ac = new AbortController();
    smapsFetchAbortRef.current = ac;
    setScanStatus("Fetching process smaps\u2026");
    setScanProgress(null);
    try {
      await conn.fetchAllSmaps(
        processes,
        (pid, data) => {
          if (ac.signal.aborted) return;
          setSmapsData(prev => new Map(prev).set(pid, data));
        },
        (done, total, name) => {
          if (ac.signal.aborted) return;
          setScanStatus(name || "Fetching process smaps\u2026");
          setScanProgress({ done, total });
        },
        ac.signal,
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : "VMA scan failed");
    } finally {
      if (smapsFetchAbortRef.current === ac) {
        smapsFetchAbortRef.current = null;
        setScanStatus(null);
        setScanProgress(null);
      }
    }
  }, [conn, processes, cancelSmapsFetch]);

  const handleDiff = useCallback(() => {
    if (!processes) return;
    setPrevProcesses(processes.map(p => ({ ...p })));
    if (globalMemInfo) setPrevGlobalMemInfo({ ...globalMemInfo });
    setPrevSmapsData(new Map(smapsData));
    setPrevSmapsRollups(new Map(smapsRollups));
    setDiffMode(true);
    diffTriggeredRef.current = true;
    refreshProcesses();
  }, [processes, globalMemInfo, smapsData, smapsRollups, refreshProcesses]);

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

  const startCapture = useCallback(async (pid: number, withBitmaps: boolean) => {
    if (captureAbortRefs.current.has(pid)) return; // already in flight
    const ac = new AbortController();
    captureAbortRefs.current.set(pid, ac);
    setCaptureJobs(prev => new Map(prev).set(pid, { status: "Starting\u2026", progress: null, error: null }));

    const updateJob = (patch: Partial<CaptureJob>) => {
      setCaptureJobs(prev => {
        const old = prev.get(pid);
        if (!old) return prev;
        return new Map(prev).set(pid, { ...old, ...patch });
      });
    };

    try {
      const proc = processes?.find(p => p.pid === pid);
      const procName = proc?.name ?? `pid_${pid}`;
      const buffer = await conn.captureHeapDump(
        pid,
        withBitmaps,
        (phase: CapturePhase) => {
          switch (phase.step) {
            case "dumping": updateJob({ status: "Dumping\u2026" }); break;
            case "waiting": updateJob({ status: `Waiting (${Math.round(phase.elapsed / 1000)}s)` }); break;
            case "pulling": {
              const pct = phase.total > 0 ? Math.round(phase.received / phase.total * 100) : 0;
              const mb = (phase.received / 1048576).toFixed(1);
              updateJob({
                status: phase.total > 0 ? `${pct}% (${mb} MiB)` : `${mb} MiB`,
                progress: phase.total > 0 ? { done: phase.received, total: phase.total } : null,
              });
              break;
            }
            case "cleaning": updateJob({ status: "Cleaning\u2026" }); break;
            case "done": break;
          }
        },
        ac.signal,
      );
      const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
      onCaptured(`${procName}_${ts}`, buffer);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError") && !ac.signal.aborted) {
        updateJob({ status: "Failed", error: e instanceof Error ? e.message : "Capture failed" });
        setTimeout(() => setCaptureJobs(prev => { const m = new Map(prev); m.delete(pid); return m; }), 3000);
        captureAbortRefs.current.delete(pid);
        return;
      }
    }
    captureAbortRefs.current.delete(pid);
    setCaptureJobs(prev => { const m = new Map(prev); m.delete(pid); return m; });
  }, [conn, processes, onCaptured]);

  const handleVmaDump = useCallback(async (
    pid: number, processName: string,
    label: string,
    regions: { addrStart: string; addrEnd: string }[],
  ) => {
    if (!connected || vmaDumpStatus) return;
    const ac = new AbortController();
    vmaDumpAbortRef.current = ac;
    try {
      setVmaDumpStatus(`Dumping ${label}\u2026`);
      const data = await conn.dumpVmaMemory(pid, regions, status => {
        setVmaDumpStatus(status);
      }, ac.signal);
      if (ac.signal.aborted) return;
      const procSan = processName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const labelSan = label.replace(/[^a-zA-Z0-9._-]/g, "_");
      onVmaDump(`${procSan}_${labelSan}`, data.buffer as ArrayBuffer, regions);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "VMA dump failed");
    } finally {
      if (vmaDumpAbortRef.current === ac) {
        vmaDumpAbortRef.current = null;
        setVmaDumpStatus(null);
      }
    }
  }, [connected, vmaDumpStatus, conn, onVmaDump]);

  const handleDisconnect = useCallback(() => {
    cancelEnrichment();
    cancelSmapsFetch();
    cancelAllCaptures();
    cancelVmaDump();
    conn.disconnect();
    setConnected(false);
    setError(null);
    setEnrichStatus(null);
    setEnrichProgress(null);
  }, [cancelEnrichment, cancelSmapsFetch, cancelAllCaptures, cancelVmaDump]);

  useEffect(() => {
    return () => { cancelEnrichment(); cancelSmapsFetch(); cancelAllCaptures(); cancelVmaDump(); conn.disconnect(); };
  }, [cancelEnrichment, cancelSmapsFetch, cancelAllCaptures, cancelVmaDump]);

  const sorted = useMemo(() => {
    if (!processes) return null;
    const copy = [...processes];
    copy.sort((a, b) => {
      // Pin "System" processes at top
      const aPin = PINNED_PROCESSES.has(a.name) ? 0 : 1;
      const bPin = PINNED_PROCESSES.has(b.name) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      if (sortField === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortAsc ? cmp : -cmp;
      }
      if (sortField === "oomLabel") {
        const cmp = a.oomLabel.localeCompare(b.oomLabel);
        return sortAsc ? cmp : -cmp;
      }
      if (sortField === "pid") return sortAsc ? a.pid - b.pid : b.pid - a.pid;
      const aVal = getFieldValue(a, sortField, smapsRollups.get(a.pid));
      const bVal = getFieldValue(b, sortField, smapsRollups.get(b.pid));
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [processes, sortField, sortAsc, smapsRollups]);

  const sortedDiffs = useMemo(() => {
    if (!processDiffs) return null;
    const copy = [...processDiffs];
    copy.sort((a, b) => {
      const aPin = PINNED_PROCESSES.has(a.current.name) ? 0 : 1;
      const bPin = PINNED_PROCESSES.has(b.current.name) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      if (sortField === "name") {
        const cmp = a.current.name.localeCompare(b.current.name);
        return sortAsc ? cmp : -cmp;
      }
      if (sortField === "oomLabel") {
        const cmp = a.current.oomLabel.localeCompare(b.current.oomLabel);
        return sortAsc ? cmp : -cmp;
      }
      if (sortField === "pid") return sortAsc ? a.current.pid - b.current.pid : b.current.pid - a.current.pid;
      const aVal = getFieldValue(a.current, sortField, smapsRollups.get(a.current.pid));
      const bVal = getFieldValue(b.current, sortField, smapsRollups.get(b.current.pid));
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
    return copy;
  }, [processDiffs, sortField, sortAsc, smapsRollups]);

  // Cross-process shared mappings — from full smaps data (populated by Scan All or on-demand)
  const sharedMappings = useMemo(() => {
    if (smapsData.size === 0 || !processes) return null;
    return aggregateSharedMappings(smapsData, processes);
  }, [smapsData, processes]);

  const prevSharedMappings = useMemo(() => {
    if (prevSmapsData.size === 0 || !prevProcesses) return null;
    return aggregateSharedMappings(prevSmapsData, prevProcesses);
  }, [prevSmapsData, prevProcesses]);

  const sharedMappingDiffs = useMemo(() => {
    if (!diffMode || !sharedMappings || !prevSharedMappings) return null;
    return diffSharedMappings(prevSharedMappings, sharedMappings);
  }, [diffMode, sharedMappings, prevSharedMappings]);

  const hasOomLabel = processes ? processes.some(p => p.oomLabel !== "") : false;

  const processTotals = useMemo(() => {
    const activeProcs = (sorted ?? []).filter(p => !(diffMode && sortedDiffs?.find(d => d.current.pid === p.pid && d.status === "removed")));
    const totals: Record<string, number> = {};
    for (const [f] of ROLLUP_COLUMNS) totals[f] = 0;
    for (const p of activeProcs) {
      const r = smapsRollups.get(p.pid);
      for (const [f] of ROLLUP_COLUMNS) totals[f] += getFieldValue(p, f, r);
    }
    return { count: activeProcs.length, values: totals };
  }, [sorted, sortedDiffs, diffMode, smapsRollups]);

  const hasWebUsb = typeof navigator !== "undefined" && "usb" in navigator;

  if (!hasWebUsb) {
    return (
      <div className="text-center py-8">
        <p className="text-stone-600 dark:text-stone-300 mb-2">WebUSB is not available.</p>
        <p className="text-stone-400 dark:text-stone-500 text-sm">Use Chrome or Edge over HTTPS/localhost.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Connection */}
      {!connected && !processes && (
        <div className="text-center py-8">
          <button
            className="px-6 py-3 bg-stone-800 dark:bg-stone-700 text-white hover:bg-stone-700 dark:hover:bg-stone-600 transition-colors disabled:opacity-50"
            onClick={handleConnect}
            disabled={connectStatus !== null}
          >
            {connectStatus ?? "Connect USB Device"}
          </button>
          <p className="text-stone-400 dark:text-stone-500 text-xs mt-3">
            Enable USB debugging on device. If ADB is running, stop it first: <code className="bg-stone-100 dark:bg-stone-700 px-1">adb kill-server</code>
          </p>
        </div>
      )}
      {(connected || processes) && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            {connected ? (
              <>
                <span className="text-stone-600 dark:text-stone-300">{conn.productName}</span>
                <span className="text-stone-400 dark:text-stone-500 font-mono text-xs">{conn.serial}</span>
              </>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 text-xs">Disconnected</span>
            )}
            <span className="ml-auto" />
            <button className={`text-xs ${connected ? "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300" : "text-stone-300 dark:text-stone-600 cursor-not-allowed"}`} onClick={refreshProcesses} disabled={!connected}>
              {enrichStatus && !diffMode ? "Refreshing\u2026" : enrichStatus && diffMode ? "Diffing\u2026" : "Refresh"}
            </button>
            {connected && processes && !enrichStatus && (
              <button
                className="text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 text-xs border border-sky-300 dark:border-sky-600 px-2 py-0.5"
                onClick={handleDiff}
              >
                Diff
              </button>
            )}
            {diffMode && !enrichStatus && (
              <button
                className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 text-xs border border-amber-300 dark:border-amber-600 px-2 py-0.5"
                onClick={clearDiff}
              >
                Clear Diff
              </button>
            )}
            {connected ? (
              <button className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 text-xs" onClick={handleDisconnect}>
                Disconnect
              </button>
            ) : (
              <button
                className="px-3 py-0.5 text-xs bg-stone-800 dark:bg-stone-700 text-white hover:bg-stone-700 dark:hover:bg-stone-600 transition-colors disabled:opacity-50"
                onClick={handleConnect}
                disabled={connectStatus !== null}
              >
                {connectStatus ?? "Reconnect"}
              </button>
            )}
          </div>

          {/* Non-root banner */}
          {connected && !conn.isRoot && processes && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs px-3 py-2 mb-3">
              Non-rooted device — only debuggable apps can be captured
            </div>
          )}

          {/* VMA dump progress */}
          {vmaDumpStatus && (
            <div className="mb-2 text-xs text-stone-500 dark:text-stone-400">
              <div className="flex items-center gap-2">
                <span className="truncate">{vmaDumpStatus}</span>
                <button className="text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 ml-auto" onClick={cancelVmaDump}>Cancel</button>
              </div>
            </div>
          )}

          {/* Enrichment progress */}
          {enrichStatus && (
            <div className="mb-2 text-xs text-stone-500 dark:text-stone-400">
              <div className="flex items-center gap-2 mb-1">
                <span className="truncate">{diffMode ? `Diffing: ${enrichStatus}` : enrichStatus}</span>
                {enrichProgress && <span className="text-stone-400 dark:text-stone-500 whitespace-nowrap">{enrichProgress.done}/{enrichProgress.total}</span>}
                <button className="text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 ml-auto" onClick={cancelEnrichment}>Cancel</button>
              </div>
              {enrichProgress && enrichProgress.total > 0 && (
                <div className="h-1 bg-stone-100 dark:bg-stone-700 rounded overflow-hidden">
                  <div className="h-full bg-sky-500 transition-all" style={{ width: `${(enrichProgress.done / enrichProgress.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}

          {/* VMA scan progress */}
          {scanStatus && (
            <div className="mb-2 text-xs text-stone-500 dark:text-stone-400">
              <div className="flex items-center gap-2 mb-1">
                <span className="truncate">Scanning: {scanStatus}</span>
                {scanProgress && <span className="text-stone-400 dark:text-stone-500 whitespace-nowrap">{scanProgress.done}/{scanProgress.total}</span>}
                <button className="text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 ml-auto" onClick={cancelSmapsFetch}>Cancel</button>
              </div>
              {scanProgress && scanProgress.total > 0 && (
                <div className="h-1 bg-stone-100 dark:bg-stone-700 rounded overflow-hidden">
                  <div className="h-full bg-amber-500 transition-all" style={{ width: `${(scanProgress.done / scanProgress.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Global memory summary */}
          {globalMemInfo && (
            <div className="mb-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 px-3 py-2 overflow-x-auto">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                {([
                  ["Total", globalMemInfo.totalRamKb, globalMemInfoDiff?.deltaTotalRamKb, false],
                  ["Free", globalMemInfo.freeRamKb, globalMemInfoDiff?.deltaFreeRamKb, true],
                  ["Used", globalMemInfo.usedPssKb, globalMemInfoDiff?.deltaUsedPssKb, false],
                  ...(globalMemInfo.memAvailableKb > 0 ? [["Available", globalMemInfo.memAvailableKb, globalMemInfoDiff?.deltaMemAvailableKb, true] as const] : []),
                  ...(globalMemInfo.lostRamKb > 0 ? [["Lost", globalMemInfo.lostRamKb, globalMemInfoDiff?.deltaLostRamKb, false] as const] : []),
                ] as const).map(([label, value, delta, inverted]) => (
                  <span key={label} className="text-stone-500 dark:text-stone-400 whitespace-nowrap">
                    {label}{" "}
                    <span className="font-mono text-stone-800 dark:text-stone-100">{fmtSize(value * 1024)}</span>
                    {delta != null && delta !== 0 && (
                      <span className={`font-mono ml-1 ${(inverted ? -delta : delta) > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                        {fmtDelta(delta)}
                      </span>
                    )}
                  </span>
                ))}
                {globalMemInfo.swapTotalKb > 0 && (
                  <span className="text-stone-500 dark:text-stone-400 whitespace-nowrap">
                    ZRAM{" "}
                    <span className="font-mono text-stone-800 dark:text-stone-100">
                      {fmtSize(globalMemInfo.zramPhysicalKb * 1024)}{" / "}{fmtSize(globalMemInfo.swapTotalKb * 1024)}
                    </span>
                    {globalMemInfoDiff && globalMemInfoDiff.deltaZramPhysicalKb !== 0 && (
                      <span className={`font-mono ml-1 ${globalMemInfoDiff.deltaZramPhysicalKb > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
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
            <div className="text-stone-400 dark:text-stone-500 p-4">Loading processes&hellip;</div>
          ) : sorted.length === 0 ? (
            <div className="text-stone-400 dark:text-stone-500 p-4 flex items-center gap-3">
              No processes found.
              <button className="text-sky-700 dark:text-sky-400 underline decoration-sky-300 dark:decoration-sky-600" onClick={refreshProcesses}>
                Refresh
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="bg-stone-50 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-700">
                    <th className="py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium w-[120px]"></th>
                    <th className="text-left py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium w-14 cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200" onClick={() => toggleSort("pid")}>
                      PID {sortField === "pid" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                    </th>
                    <th className="text-left py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200" onClick={() => toggleSort("name")}>
                      Process {sortField === "name" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                    </th>
                    {hasOomLabel && (
                      <th
                        className="text-left py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200"
                        onClick={() => toggleSort("oomLabel")}
                      >
                        State {sortField === "oomLabel" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                    )}
                    {ROLLUP_COLUMNS.map(([field, label]) => (
                      <th
                        key={field}
                        className="text-right py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium w-20 cursor-pointer select-none whitespace-nowrap hover:text-stone-700 dark:hover:text-stone-200"
                        onClick={() => toggleSort(field)}
                      >
                        {label} {sortField === field ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Totals row */}
                  <tr className="border-b-2 border-stone-300 dark:border-stone-600 font-semibold bg-stone-50 dark:bg-stone-800">
                    <td className="py-1 px-2 text-stone-600 dark:text-stone-300" colSpan={hasOomLabel ? 4 : 3}>Total ({processTotals.count})</td>
                    {ROLLUP_COLUMNS.map(([f]) => (
                      <td key={f} className="py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem]">
                        {processTotals.values[f] > 0 ? fmtSize(processTotals.values[f] * 1024) : "\u2014"}
                      </td>
                    ))}
                  </tr>
                  {(diffMode && sortedDiffs ? sortedDiffs : (sorted ?? []).map(p => ({ status: "matched" as const, current: p, prev: null, deltaPssKb: 0, deltaRssKb: 0, deltaJavaHeapKb: 0, deltaNativeHeapKb: 0, deltaGraphicsKb: 0, deltaCodeKb: 0 }))).map(d => {
                    const p = d.current;
                    const isJava = javaPids.has(p.pid);
                    const canCapture = isJava && (conn.isRoot || p.debuggable !== false);
                    const hasSmaps = smapsData.has(p.pid);
                    const isExpanded = expandedSmapsPid === p.pid;
                    const isSmapsExpanded = isExpanded && hasSmaps;
                    const isSmapsLoading = isExpanded && !hasSmaps && smapsFetchPid === p.pid;
                    const isDiff = diffMode && sortedDiffs !== null;
                    const colCount = 3 + (hasOomLabel ? 1 : 0) + ROLLUP_COLUMNS.length;
                    const rollup = smapsRollups.get(p.pid);
                    const prevRollup = prevSmapsRollups.get(p.pid);
                    const rowKey = `${d.status}-${p.pid}`;
                    return (
                    <Fragment key={rowKey}>
                    <tr
                      className={`border-t border-stone-100 dark:border-stone-800 cursor-pointer ${
                        d.status === "removed" ? "opacity-60" :
                        d.status === "added" ? "bg-green-50/50 dark:bg-green-900/30" :
                        isSmapsExpanded ? "bg-sky-50 dark:bg-sky-900/20" : "hover:bg-stone-50 dark:hover:bg-stone-800"
                      }`}
                      onClick={() => {
                        if (d.status === "removed") return;
                        if (isExpanded) {
                          setExpandedSmapsPid(null);
                          setExpandedSmapsGroup(null);
                        } else if (conn.isRoot) {
                          setExpandedSmapsPid(p.pid);
                          setExpandedSmapsGroup(null);
                          if (!hasSmaps) fetchSmapsOnDemand(p.pid);
                        }
                      }}
                    >
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        {d.status !== "removed" && canCapture && (
                          <DumpButton
                            pid={p.pid}
                            job={captureJobs.get(p.pid)}
                            disabled={!connected}
                            onDump={startCapture}
                            onCancel={cancelCapture}
                          />
                        )}
                      </td>
                      <td className="py-1 px-2 font-mono text-stone-400 dark:text-stone-500 whitespace-nowrap">
                        {conn.isRoot && d.status !== "removed" && (
                          <span className="text-stone-400 dark:text-stone-500 mr-1">{isSmapsExpanded ? "\u25BC" : isSmapsLoading ? "\u2026" : "\u25B6"}</span>
                        )}
                        {p.pid}
                      </td>
                      <td className={`py-1 px-2 text-stone-800 dark:text-stone-100 truncate max-w-[400px] ${d.status === "removed" ? "line-through" : ""}`} title={p.name}>
                        {p.name}
                        {isDiff && d.status !== "matched" && (
                          <span className={`ml-2 text-[10px] font-medium ${d.status === "added" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {d.status === "added" ? "NEW" : "GONE"}
                          </span>
                        )}
                      </td>
                      {hasOomLabel && (
                        <td className="py-1 px-2 text-stone-500 dark:text-stone-400 text-xs whitespace-nowrap">
                          {p.oomLabel}
                          {isDiff && d.prev && d.prev.oomLabel !== p.oomLabel && (
                            <span className="ml-1 text-amber-600 dark:text-amber-400" title={`was: ${d.prev.oomLabel || "(none)"}`}>
                              {"\u2190 "}{d.prev.oomLabel || "\u2014"}
                            </span>
                          )}
                        </td>
                      )}
                      {ROLLUP_COLUMNS.map(([f]) => {
                        const value = getFieldValue(p, f, rollup);
                        const delta = isDiff && prevRollup && rollup ? rollup[f] - prevRollup[f] : 0;
                        return (
                          <td key={f} className={`py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem] ${isDiff ? deltaBgClass(delta) : ""}`}>
                            {value > 0 ? fmtSize(value * 1024) : "\u2014"}
                            {isDiff && delta !== 0 && (
                              <span className={`ml-1 text-[10px] ${delta > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
                                {fmtDelta(delta)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {isSmapsLoading && (
                      <tr>
                        <td colSpan={colCount} className="p-2 text-xs text-stone-400 dark:text-stone-500 animate-pulse border-t border-stone-200 dark:border-stone-700">
                          Fetching process smaps{"\u2026"}
                        </td>
                      </tr>
                    )}
                    {isSmapsExpanded && d.status !== "removed" && (
                      <SmapsSubTable
                        pid={p.pid}
                        processName={p.name}
                        aggregated={smapsData.get(p.pid)!}
                        expandedGroup={expandedSmapsGroup}
                        onToggleGroup={name => setExpandedSmapsGroup(expandedSmapsGroup === name ? null : name)}
                        sortField={smapsSortField}
                        sortAsc={smapsSortAsc}
                        onToggleSort={toggleSmapsSort}
                        vmaSortField={vmaSortField}
                        vmaSortAsc={vmaSortAsc}
                        onToggleVmaSort={toggleVmaSort}
                        onDump={handleVmaDump}
                        dumpDisabled={!connected || !!vmaDumpStatus}
                        smapsDiffs={isDiff && prevSmapsData.has(p.pid) ? diffSmaps(prevSmapsData.get(p.pid)!, smapsData.get(p.pid)!) : null}
                        prevAggregated={isDiff && prevSmapsData.has(p.pid) ? prevSmapsData.get(p.pid)! : null}
                        leadingColCount={3 + (hasOomLabel ? 1 : 0)}
                      />
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Scan All VMAs / Shared Mappings */}
          {conn.isRoot && processes && processes.length > 0 && (
            <div className="mt-4">
              {smapsData.size < (processes?.length ?? 0) && (
                <button
                  className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 border border-sky-300 dark:border-sky-600 px-2 py-0.5 mb-2"
                  onClick={scanStatus ? cancelSmapsFetch : scanAllSmaps}
                  disabled={!connected || !!vmaDumpStatus}
                >
                  {scanStatus ? `Cancel Scan (${smapsData.size}/${processes?.length ?? 0})` : `Scan All VMAs (${smapsData.size}/${processes?.length ?? 0})`}
                </button>
              )}
              {sharedMappings && sharedMappings.length > 0 && (
                <SharedMappingsTable
                  mappings={sharedMappings}
                  loadedCount={smapsData.size}
                  loading={scanStatus !== null}
                  diffs={sharedMappingDiffs}
                  smapsData={smapsData}
                  onDump={handleVmaDump}
                  dumpDisabled={!connected || !!vmaDumpStatus}
                />
              )}
            </div>
          )}

        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-sm">{error}</div>
      )}
    </div>
  );
}

export default CaptureView;
