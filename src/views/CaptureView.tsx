import { useState, useCallback, useRef, useMemo, useEffect, Fragment } from "react";
import { AdbConnection, type ProcessInfo, type CapturePhase, type SmapsAggregated, type SmapsEntry, type SmapsRollup, type SharedMapping, type SharedMappingDiff, type GlobalMemInfo, type ProcessDiff, type GlobalMemInfoDiff, type SmapsDiff, type SmapsEntryDiff, diffProcesses, diffGlobalMemInfo, diffSmaps, diffSmapsEntries, aggregateSmaps, aggregateSharedMappings, diffSharedMappings } from "../adb/capture";
import { fmtSize, fmtDelta, deltaBgClass } from "../format";

type SmapsSortFieldType = "pssKb" | "rssKb" | "sizeKb" | "sharedCleanKb" | "sharedDirtyKb" | "privateCleanKb" | "privateDirtyKb" | "swapKb";
type VmaSortFieldType = SmapsSortFieldType | "addrStart";

const SMAPS_COLUMNS: [SmapsSortFieldType, string][] = [
  ["rssKb", "RSS"], ["pssKb", "PSS"],
  ["privateDirtyKb", "Priv Dirty"], ["privateCleanKb", "Priv Clean"],
  ["sharedDirtyKb", "Shared Dirty"], ["sharedCleanKb", "Shared Clean"],
  ["swapKb", "Swap"], ["sizeKb", "VSize"],
];

function VmaEntries({ entries, groupName, pid, processName, sortField, sortAsc, onToggleSort, onDump, dumpDisabled, entryDiffs }: {
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
          <button
            className="ml-3 text-[10px] text-stone-400 hover:text-sky-600 disabled:text-stone-300"
            disabled={dumpDisabled}
            title="Dump all VMA memory in this group"
            onClick={() => onDump(pid, processName, groupName, entries.map(e => ({ addrStart: e.addrStart, addrEnd: e.addrEnd })))}
          >dump all</button>
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
        <tr key={i} className={`border-t border-stone-50 hover:bg-stone-100 ${
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
            <button
              className="ml-2 text-stone-400 hover:text-sky-600 disabled:text-stone-300"
              disabled={dumpDisabled || ed?.status === "removed"}
              title="Dump this VMA"
              onClick={() => onDump(pid, processName, `${groupName}_${e.addrStart}-${e.addrEnd}`, [{ addrStart: e.addrStart, addrEnd: e.addrEnd }])}
            >dump</button>
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

function SmapsSubTable({ pid, processName, aggregated, expandedGroup, onToggleGroup, sortField, sortAsc, onToggleSort, vmaSortField, vmaSortAsc, onToggleVmaSort, onDump, dumpDisabled, smapsDiffs, prevAggregated }: {
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
                <td className={`py-0.5 px-2 font-mono text-stone-700 ${sd?.status === "removed" ? "line-through" : ""}`} title={g.name}>
                  <div className="flex items-center gap-1">
                    <span className="text-stone-400 shrink-0">{expandedGroup === g.name ? "\u25BC" : "\u25B6"}</span>
                    <span className="truncate max-w-[280px]">{g.name}</span>
                    {sd && sd.status !== "matched" && (
                      <span className={`text-[10px] font-medium shrink-0 ${sd.status === "added" ? "text-green-600" : "text-red-600"}`}>
                        {sd.status === "added" ? "NEW" : "GONE"}
                      </span>
                    )}
                    <button
                      className="text-[10px] text-stone-400 hover:text-sky-600 disabled:text-stone-300 shrink-0"
                      disabled={dumpDisabled || sd?.status === "removed"}
                      title={`Dump ${g.name} memory`}
                      onClick={e => { e.stopPropagation(); onDump(pid, processName, g.name, g.entries.map(en => ({ addrStart: en.addrStart, addrEnd: en.addrEnd }))); }}
                    >dump</button>
                  </div>
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
                  groupName={g.name}
                  pid={pid}
                  processName={processName}
                  sortField={vmaSortField}
                  sortAsc={vmaSortAsc}
                  onToggleSort={onToggleVmaSort}
                  onDump={onDump}
                  dumpDisabled={dumpDisabled}
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
  const [sortField, setSortField] = useState<SmapsSortFieldType | "processCount">("pssKb");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedMapping, setExpandedMapping] = useState<string | null>(null);

  const toggleSort = useCallback((f: SmapsSortFieldType | "processCount") => {
    if (sortField === f) setSortAsc(!sortAsc);
    else { setSortField(f); setSortAsc(false); }
  }, [sortField, sortAsc]);

  const diffByName = useMemo(() => {
    if (!diffs) return null;
    return new Map(diffs.map(d => [d.current.name, d]));
  }, [diffs]);

  const sorted = useMemo(() => {
    if (diffs) {
      const copy = [...diffs];
      copy.sort((a, b) => {
        const aPin = a.status !== "matched" ? 1 : 0;
        const bPin = b.status !== "matched" ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;
        return sortAsc ? a.current[sortField] - b.current[sortField] : b.current[sortField] - a.current[sortField];
      });
      return copy.map(d => d.current);
    }
    const copy = [...mappings];
    copy.sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]);
    return copy;
  }, [mappings, diffs, sortField, sortAsc]);

  const totals = useMemo(() => {
    const t = { pssKb: 0, rssKb: 0, sizeKb: 0, sharedCleanKb: 0, sharedDirtyKb: 0, privateCleanKb: 0, privateDirtyKb: 0, swapKb: 0,
      deltaPssKb: 0, deltaRssKb: 0, deltaSizeKb: 0, deltaSharedCleanKb: 0, deltaSharedDirtyKb: 0, deltaPrivateCleanKb: 0, deltaPrivateDirtyKb: 0, deltaSwapKb: 0 };
    if (diffs) {
      for (const d of diffs) {
        if (d.status !== "removed") {
          for (const [f] of SMAPS_COLUMNS) t[f] += d.current[f];
        }
        for (const [f] of SMAPS_COLUMNS) {
          const dk = SMAPS_DELTA_KEY[f];
          (t as Record<string, number>)[dk] += (d as unknown as Record<string, number>)[dk];
        }
      }
    } else {
      for (const m of mappings) {
        for (const [f] of SMAPS_COLUMNS) t[f] += m[f];
      }
    }
    return t;
  }, [mappings, diffs]);

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
        Shared Mappings
        <span className="font-normal ml-2">
          ({mappings.length} mappings across {loadedCount} processes)
        </span>
        {loading && <span className="ml-2 text-sky-600 animate-pulse">loading{"\u2026"}</span>}
      </h3>
      <div className="bg-white border border-stone-200 max-h-[500px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-stone-50 z-10">
            <tr className="border-b border-stone-200">
              <th className="text-left py-1 px-2 text-stone-500 font-medium">Mapping</th>
              <th
                className="text-right py-1 px-1 text-stone-400 font-medium w-8 cursor-pointer select-none hover:text-stone-700"
                onClick={() => toggleSort("processCount")}
              >
                Procs {sortField === "processCount" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
              </th>
              {SMAPS_COLUMNS.map(([f, label]) => (
                <th
                  key={f}
                  className="text-right py-1 px-2 text-stone-500 font-medium cursor-pointer select-none hover:text-stone-700 whitespace-nowrap"
                  onClick={() => toggleSort(f)}
                >
                  {label} {sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b-2 border-stone-300 font-semibold">
              <td className="py-0.5 px-2 text-stone-600">Total</td>
              <td />
              {SMAPS_COLUMNS.map(([f]) => {
                const dk = SMAPS_DELTA_KEY[f];
                const delta = (totals as Record<string, number>)[dk];
                return (
                  <td key={f} className={`py-0.5 px-2 text-right font-mono whitespace-nowrap ${diffs ? deltaBgClass(delta) : ""}`}>
                    {totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014"}
                    {diffs && (
                      <span className={`ml-1 text-[10px] font-normal inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700" : delta < 0 ? "text-green-700" : ""}`}>
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
                  className={`border-t border-stone-100 cursor-pointer hover:bg-stone-50 ${
                    sd?.status === "removed" ? "opacity-60" :
                    sd?.status === "added" ? "bg-green-50/50" : ""
                  }`}
                  onClick={() => sd?.status !== "removed" && setExpandedMapping(expandedMapping === m.name ? null : m.name)}
                >
                  <td className={`py-0.5 px-2 font-mono text-stone-700 ${sd?.status === "removed" ? "line-through" : ""}`} title={m.name}>
                    <div className="flex items-center gap-1">
                      <span className="text-stone-400 shrink-0">{expandedMapping === m.name ? "\u25BC" : "\u25B6"}</span>
                      <span className="truncate max-w-[280px]">{m.name}</span>
                      {sd && sd.status !== "matched" && (
                        <span className={`text-[10px] font-medium shrink-0 ${sd.status === "added" ? "text-green-600" : "text-red-600"}`}>
                          {sd.status === "added" ? "NEW" : "GONE"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-0.5 px-1 text-right font-mono text-stone-400">{m.processCount}</td>
                  {SMAPS_COLUMNS.map(([f]) => {
                    const delta = sd ? (sd as unknown as Record<string, number>)[SMAPS_DELTA_KEY[f]] : 0;
                    return (
                      <td key={f} className={`py-0.5 px-2 text-right font-mono whitespace-nowrap ${sd ? deltaBgClass(delta) : ""}`}>
                        {m[f] > 0 ? fmtSize(m[f] * 1024) : "\u2014"}
                        {sd && (
                          <span className={`ml-1 text-[10px] inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700" : delta < 0 ? "text-green-700" : ""}`}>
                            {delta !== 0 ? fmtDelta(delta) : ""}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {expandedMapping === m.name && sd?.status !== "removed" && (
                  <>
                    <tr className="bg-stone-100">
                      <td className="py-0.5 px-2 pl-6 text-stone-500 text-[10px] font-medium">
                        Process (PID)
                      </td>
                      <td />
                      {SMAPS_COLUMNS.map(([, label]) => (
                        <td key={label} className="py-0.5 px-2 text-right text-stone-500 text-[10px] font-medium">
                          {label}
                        </td>
                      ))}
                    </tr>
                    {m.processes.map(p => {
                      const procAgg = smapsData.get(p.pid);
                      const matchedGroup = procAgg?.find(g => g.name === m.name);
                      const regions = matchedGroup?.entries.map(e => ({ addrStart: e.addrStart, addrEnd: e.addrEnd }));
                      return (
                      <tr key={p.pid} className="border-t border-stone-50 hover:bg-stone-100">
                        <td className="py-0.5 px-2 pl-6 text-[10px] text-stone-600 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <span>{p.name} <span className="text-stone-400">({p.pid})</span></span>
                            <button
                              className="text-[10px] text-stone-400 hover:text-sky-600 disabled:text-stone-300 shrink-0"
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

// ─── Capture View ─────────────────────────────────────────────────────────────

type SortField = "pssKb" | "rssKb" | "privateDirtyKb" | "privateCleanKb" | "sharedDirtyKb" | "sharedCleanKb" | "swapKb" | "oomLabel";

// Process table columns shown when rollup data is available
const ROLLUP_COLUMNS: [SortField, string][] = [
  ["rssKb", "RSS"], ["pssKb", "PSS"],
  ["privateDirtyKb", "Priv Dirty"], ["privateCleanKb", "Priv Clean"],
  ["sharedDirtyKb", "Shared Dirty"], ["sharedCleanKb", "Shared Clean"],
  ["swapKb", "Swap"],
];

/** Get a sortable value from either rollup data or ProcessInfo fallback. */
function getFieldValue(p: ProcessInfo, field: SortField, rollup?: SmapsRollup): number {
  if (rollup) return rollup[field as keyof SmapsRollup] as number;
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
  const smapsFetchAbortRef = useRef<AbortController | null>(null);
  const [smapsFetchPid, setSmapsFetchPid] = useState<number | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);

  // Smaps expansion / sort state
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

  const cancelCapture = useCallback(() => {
    if (!captureAbortRef.current) return;
    captureAbortRef.current.abort();
    captureAbortRef.current = null;
    setCapturing(false);
    setCaptureStatus("");
    setCaptureProgress(null);
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
    setEnrichStatus("Fetching process list\u2026");
    setEnrichProgress(null);
    setSmapsRollups(new Map());
    setSmapsData(new Map());
    setExpandedSmapsPid(null);
    setExpandedSmapsGroup(null);
    setGlobalMemInfo(null);
    setJavaPids(new Set());
    setError(null);
    try {
      // Step 1: Fast Java process list from `dumpsys activity lru` (works without root)
      const lruList = await conn.getLruProcesses(ac.signal);
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
    if (smapsData.has(pid) || !conn.connected || !conn.isRoot) return;
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
  }, [conn, smapsData, cancelSmapsFetch]);

  // Scan all processes for full smaps data (populates shared mappings table)
  const scanAllSmaps = useCallback(async () => {
    if (!conn.connected || !conn.isRoot || !processes) return;
    cancelSmapsFetch();
    const ac = new AbortController();
    smapsFetchAbortRef.current = ac;
    setScanStatus("Scanning VMAs\u2026");
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
          setScanStatus(name || "Scanning VMAs\u2026");
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

  const handleCapture = useCallback(async (overridePid?: number) => {
    const pid = overridePid ?? selectedPid;
    if (pid === null || capturing) return;
    cancelEnrichment();
    cancelSmapsFetch();
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

  const handleVmaDump = useCallback(async (
    pid: number, processName: string,
    label: string,
    regions: { addrStart: string; addrEnd: string }[],
  ) => {
    if (!connected || vmaDumpStatus) return;
    cancelEnrichment();
    cancelSmapsFetch();
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
  }, [connected, vmaDumpStatus, conn, onVmaDump, cancelEnrichment]);

  const handleDisconnect = useCallback(() => {
    cancelEnrichment();
    cancelSmapsFetch();
    cancelCapture();
    cancelVmaDump();
    conn.disconnect();
    setConnected(false);
    setError(null);
    setEnrichStatus(null);
    setEnrichProgress(null);
    setCapturing(false);
    setCaptureStatus("");
    setCaptureProgress(null);
  }, [cancelEnrichment, cancelSmapsFetch, cancelCapture, cancelVmaDump]);

  useEffect(() => {
    return () => { cancelEnrichment(); cancelSmapsFetch(); cancelCapture(); cancelVmaDump(); conn.disconnect(); };
  }, [cancelEnrichment, cancelCapture, cancelVmaDump]);

  const sorted = useMemo(() => {
    if (!processes) return null;
    const copy = [...processes];
    copy.sort((a, b) => {
      if (sortField === "oomLabel") {
        const cmp = a.oomLabel.localeCompare(b.oomLabel);
        return sortAsc ? cmp : -cmp;
      }
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
      if (sortField === "oomLabel") {
        const cmp = a.current.oomLabel.localeCompare(b.current.oomLabel);
        return sortAsc ? cmp : -cmp;
      }
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

  const hasRollup = true;
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
              disabled={!connected || selectedPid === null || capturing || !javaPids.has(selectedPid!)}
              title={selectedPid === null ? "Select a process first" : !javaPids.has(selectedPid) ? "Not a Java process" : capturing ? "Dump in progress" : "Dump Java heap"}
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

          {/* Capture status */}
          {capturing && (
            <div className="mb-2 text-xs text-stone-600">
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

          {/* VMA dump progress */}
          {vmaDumpStatus && (
            <div className="mb-2 text-xs text-stone-500">
              <div className="flex items-center gap-2">
                <span className="truncate">{vmaDumpStatus}</span>
                <button className="text-rose-500 hover:text-rose-700 ml-auto" onClick={cancelVmaDump}>Cancel</button>
              </div>
            </div>
          )}

          {/* Enrichment progress */}
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

          {/* VMA scan progress */}
          {scanStatus && (
            <div className="mb-2 text-xs text-stone-500">
              <div className="flex items-center gap-2 mb-1">
                <span className="truncate">Scanning: {scanStatus}</span>
                {scanProgress && <span className="text-stone-400 whitespace-nowrap">{scanProgress.done}/{scanProgress.total}</span>}
                <button className="text-rose-500 hover:text-rose-700 ml-auto" onClick={cancelSmapsFetch}>Cancel</button>
              </div>
              {scanProgress && scanProgress.total > 0 && (
                <div className="h-1 bg-stone-100 rounded overflow-hidden">
                  <div className="h-full bg-amber-500 transition-all" style={{ width: `${(scanProgress.done / scanProgress.total) * 100}%` }} />
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
                    {hasOomLabel && (
                      <th
                        className="text-left py-1.5 px-2 text-stone-500 text-xs font-medium cursor-pointer select-none hover:text-stone-700"
                        onClick={() => toggleSort("oomLabel")}
                      >
                        State {sortField === "oomLabel" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                    )}
                    {(hasRollup ? ROLLUP_COLUMNS : [["pssKb", "PSS"] as [SortField, string]]).map(([field, label]) => (
                      <th
                        key={field}
                        className="text-right py-1.5 px-2 text-stone-500 text-xs font-medium w-20 cursor-pointer select-none whitespace-nowrap hover:text-stone-700"
                        onClick={() => toggleSort(field)}
                      >
                        {label} {sortField === field ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Totals row */}
                  {(() => {
                    const activeProcs = (sorted ?? []).filter(p => !(diffMode && sortedDiffs?.find(d => d.current.pid === p.pid && d.status === "removed")));
                    const cols = hasRollup ? ROLLUP_COLUMNS : [["pssKb", "PSS"] as [SortField, string]];
                    const totals: Record<string, number> = {};
                    for (const [f] of cols) totals[f] = 0;
                    for (const p of activeProcs) {
                      const r = smapsRollups.get(p.pid);
                      for (const [f] of cols) totals[f] += getFieldValue(p, f, r);
                    }
                    return (
                      <tr className="border-b-2 border-stone-300 font-semibold bg-stone-50">
                        <td className="py-1 px-2 text-stone-600" colSpan={hasOomLabel ? 4 : 3}>Total ({activeProcs.length})</td>
                        {cols.map(([f]) => (
                          <td key={f} className="py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem]">
                            {totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014"}
                          </td>
                        ))}
                      </tr>
                    );
                  })()}
                  {(diffMode && sortedDiffs ? sortedDiffs : (sorted ?? []).map(p => ({ status: "matched" as const, current: p, prev: null, deltaPssKb: 0, deltaRssKb: 0, deltaJavaHeapKb: 0, deltaNativeHeapKb: 0, deltaGraphicsKb: 0, deltaCodeKb: 0 }))).map(d => {
                    const p = d.current;
                    const isJava = javaPids.has(p.pid);
                    const canCapture = isJava && (conn.isRoot || p.debuggable !== false);
                    const isCapturingThis = capturing && selectedPid === p.pid;
                    const hasSmaps = smapsData.has(p.pid);
                    const isExpanded = expandedSmapsPid === p.pid;
                    const isSmapsExpanded = isExpanded && hasSmaps;
                    const isSmapsLoading = isExpanded && !hasSmaps && smapsFetchPid === p.pid;
                    const isDiff = diffMode && sortedDiffs !== null;
                    const cols = hasRollup ? ROLLUP_COLUMNS : [["pssKb", "PSS"] as [SortField, string]];
                    const colCount = 3 + (hasOomLabel ? 1 : 0) + cols.length;
                    const rollup = smapsRollups.get(p.pid);
                    const prevRollup = prevSmapsRollups.get(p.pid);
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
                        setSelectedPid(p.pid);
                        if (isExpanded) {
                          setExpandedSmapsPid(null);
                          setExpandedSmapsGroup(null);
                        } else if (conn.isRoot) {
                          setExpandedSmapsPid(p.pid);
                          setExpandedSmapsGroup(null);
                          if (!hasSmaps && !capturing && !vmaDumpStatus) {
                            fetchSmapsOnDemand(p.pid);
                          }
                        }
                      }}
                    >
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        {d.status !== "removed" && canCapture && (
                          <button
                            className="text-xs text-sky-600 hover:text-sky-800 disabled:text-stone-300 disabled:cursor-not-allowed px-2 py-0.5 border border-sky-200 hover:border-sky-400 disabled:border-stone-200 whitespace-nowrap"
                            disabled={!connected || capturing}
                            title={!connected ? "Disconnected" : capturing ? "Dump in progress" : "Dump Java heap"}
                            onClick={e => { e.stopPropagation(); handleCapture(p.pid); }}
                          >
                            {isCapturingThis ? "\u2026" : "Java dump"}
                          </button>
                        )}
                      </td>
                      <td className="py-1 px-2 font-mono text-stone-400 whitespace-nowrap">
                        {conn.isRoot && d.status !== "removed" && (
                          <span className="text-stone-400 mr-1">{isSmapsExpanded ? "\u25BC" : isSmapsLoading ? "\u2026" : "\u25B6"}</span>
                        )}
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
                      {cols.map(([f]) => {
                        const value = getFieldValue(p, f, rollup);
                        const delta = isDiff && prevRollup && rollup ? rollup[f as keyof SmapsRollup] - prevRollup[f as keyof SmapsRollup] : 0;
                        return (
                          <td key={f} className={`py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem] ${isDiff ? deltaBgClass(delta) : ""}`}>
                            {value > 0 ? fmtSize(value * 1024) : "\u2014"}
                            {isDiff && delta !== 0 && (
                              <span className={`ml-1 text-[10px] ${delta > 0 ? "text-red-700" : "text-green-700"}`}>
                                {fmtDelta(delta)}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {isSmapsLoading && (
                      <tr>
                        <td colSpan={colCount} className="p-2 text-xs text-stone-400 animate-pulse border-t border-stone-200">
                          Loading VMAs{"\u2026"}
                        </td>
                      </tr>
                    )}
                    {isSmapsExpanded && d.status !== "removed" && (
                      <tr>
                        <td colSpan={colCount} className="p-0 border-t border-stone-200">
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

          {/* Scan All VMAs / Shared Mappings */}
          {conn.isRoot && processes && processes.length > 0 && (
            <div className="mt-4">
              {smapsData.size < (processes?.length ?? 0) && (
                <button
                  className="text-xs text-sky-600 hover:text-sky-800 border border-sky-300 px-2 py-0.5 mb-2"
                  onClick={scanStatus ? cancelSmapsFetch : scanAllSmaps}
                  disabled={!connected || capturing || !!vmaDumpStatus}
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
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>
      )}
    </div>
  );
}

export default CaptureView;
