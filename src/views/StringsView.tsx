import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { StringListRow } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, Section, SortableTable } from "../components";
import { computeDuplicates, type DuplicateGroup } from "./strings-helpers";

// ─── StringsView ─────────────────────────────────────────────────────────────

function StringsView({ proxy, navigate, initialQuery }: {
  proxy: WorkerProxy; navigate: NavFn; initialQuery?: string;
}) {
  const [allRows, setAllRows] = useState<StringListRow[] | null>(null);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [selectedHeap, setSelectedHeap] = useState("all");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    proxy.query<StringListRow[]>("getStringList").then(setAllRows).catch(console.error);
  }, [proxy]);

  // Update URL on query change (debounced)
  const updateUrl = useCallback((q: string) => {
    const url = q ? `/strings?q=${encodeURIComponent(q)}` : "/strings";
    window.history.replaceState({ view: "strings", params: q ? { q } : {} }, "", url);
  }, []);

  const handleChange = useCallback((q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => updateUrl(q), 300);
  }, [updateUrl]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const heaps = useMemo(() => {
    if (!allRows) return [];
    const s = new Set<string>();
    for (const r of allRows) s.add(r.heap);
    return [...s].sort();
  }, [allRows]);

  const filtered = useMemo(() => {
    if (!allRows) return null;
    const q = query.toLowerCase();
    return allRows.filter(r => {
      if (selectedHeap !== "all" && r.heap !== selectedHeap) return false;
      if (q && !r.value.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, query, selectedHeap]);

  const heapFiltered = useMemo(() => {
    if (!allRows) return null;
    if (selectedHeap === "all") return allRows;
    return allRows.filter(r => r.heap === selectedHeap);
  }, [allRows, selectedHeap]);

  const duplicates = useMemo(() => heapFiltered ? computeDuplicates(heapFiltered) : [], [heapFiltered]);

  const totalRetained = useMemo(() => heapFiltered?.reduce((s, r) => s + r.retainedSize, 0) ?? 0, [heapFiltered]);
  const totalWasted = useMemo(() => duplicates.reduce((s, d) => s + d.wastedBytes, 0), [duplicates]);
  const uniqueCount = useMemo(() => {
    if (!heapFiltered) return 0;
    const seen = new Set<string>();
    for (const r of heapFiltered) seen.add(r.value);
    return seen.size;
  }, [heapFiltered]);

  if (!allRows) return <div className="text-stone-400 dark:text-stone-500 p-4">Loading&hellip;</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">Strings</h2>
        {heaps.length > 1 && (
          <select
            value={selectedHeap}
            onChange={e => setSelectedHeap(e.target.value)}
            className="appearance-none pl-2 pr-6 py-1 border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 rounded"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 20 20' fill='%23888'%3E%3Cpath d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 0.4rem center" }}
          >
            <option value="all">All heaps</option>
            {heaps.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        )}
      </div>

      {/* Summary */}
      <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 p-3 mb-4">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <span className="text-stone-500 dark:text-stone-400">Total strings:</span>
          <span className="font-mono">{(heapFiltered ?? allRows).length.toLocaleString()}</span>
          <span className="text-stone-500 dark:text-stone-400">Unique values:</span>
          <span className="font-mono">{uniqueCount.toLocaleString()}</span>
          <span className="text-stone-500 dark:text-stone-400">Duplicate groups:</span>
          <span className="font-mono">{duplicates.length > 0
            ? <span className="text-amber-600 dark:text-amber-400">{duplicates.length.toLocaleString()}</span>
            : "0"
          }</span>
          {totalWasted > 0 && (<>
            <span className="text-stone-500 dark:text-stone-400">Wasted by duplicates:</span>
            <span className="font-mono text-amber-600 dark:text-amber-400">{fmtSize(totalWasted)}</span>
          </>)}
          <span className="text-stone-500 dark:text-stone-400">Total retained:</span>
          <span className="font-mono">{fmtSize(totalRetained)}</span>
        </div>
      </div>

      {/* Duplicates section */}
      {duplicates.length > 0 && (
        <div className="mb-4">
          <Section title={`Duplicate strings (${duplicates.length} groups, ${fmtSize(totalWasted)} wasted)`} defaultOpen={false}>
            <SortableTable<DuplicateGroup>
              columns={[
                { label: "Wasted", align: "right", sortKey: r => r.wastedBytes, render: r => <span className="font-mono">{fmtSize(r.wastedBytes)}</span> },
                { label: "Count", align: "right", sortKey: r => r.count, render: r => <span className="font-mono">{r.count}</span> },
                { label: "Value", render: r => (
                  <button
                    className="text-left font-mono text-emerald-700 dark:text-emerald-400 break-all hover:text-emerald-500 dark:hover:text-emerald-300"
                    onClick={() => handleChange(r.value)}
                    title="Click to filter by this value"
                  >
                    "{r.value.length > 200 ? r.value.slice(0, 200) + "\u2026" : r.value}"
                  </button>
                )},
              ]}
              data={duplicates}
            />
          </Section>
        </div>
      )}

      {/* Search */}
      <input
        type="text" value={query} onChange={e => handleChange(e.target.value)}
        placeholder={"Filter strings\u2026"}
        className="w-full px-3 py-2 border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 mb-3 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />

      {filtered && filtered.length > 0 && (
        <>
          {(query || selectedHeap !== "all") && (
            <div className="text-xs text-stone-500 dark:text-stone-400 mb-2">
              {filtered.length.toLocaleString()} match{filtered.length !== 1 ? "es" : ""}
            </div>
          )}
          <SortableTable<StringListRow>
            columns={[
              { label: "Retained", align: "right", sortKey: r => r.retainedSize, render: r => <span className="font-mono">{fmtSize(r.retainedSize)}</span> },
              { label: "Length", align: "right", sortKey: r => r.length, render: r => <span className="font-mono">{r.length.toLocaleString()}</span> },
              { label: "Heap", render: r => <span className="text-stone-500 dark:text-stone-400">{r.heap}</span> },
              { label: "Value", render: r => (
                <span>
                  <button
                    className="text-sky-700 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300 underline decoration-sky-300 hover:decoration-sky-500 dark:decoration-sky-600 dark:hover:decoration-sky-400"
                    onClick={() => navigate("object", { id: r.id })}
                  >
                    <span className="font-mono text-emerald-700 dark:text-emerald-400 break-all">
                      "{r.value.length > 300 ? r.value.slice(0, 300) + "\u2026" : r.value}"
                    </span>
                  </button>
                </span>
              )},
            ]}
            data={filtered}
            rowKey={r => r.id}
          />
        </>
      )}
      {(query || selectedHeap !== "all") && filtered && filtered.length === 0 && (
        <div className="text-stone-500 dark:text-stone-400">No matching strings.</div>
      )}
    </div>
  );
}

export default StringsView;
