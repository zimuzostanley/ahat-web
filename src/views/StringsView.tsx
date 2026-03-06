import m from "mithril";
import { Fragment } from "../mithril-helpers";
import type { StringListRow } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, Section, SortableTable } from "../components";
import { computeDuplicates, type DuplicateGroup } from "./strings-helpers";

// ─── StringsView ─────────────────────────────────────────────────────────────

interface StringsViewAttrs { proxy: WorkerProxy; navigate: NavFn; initialQuery?: string }

function StringsView(): m.Component<StringsViewAttrs> {
  let allRows: StringListRow[] | null = null;
  let query = "";
  let selectedHeap = "all";
  let exactMatch = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function updateUrl(q: string) {
    const url = q ? `/strings?q=${encodeURIComponent(q)}` : "/strings";
    const prev = window.history.state;
    window.history.replaceState({ view: "strings", params: q ? { q } : {}, trail: prev?.trail, trailIndex: prev?.trailIndex }, "", url);
  }

  function handleChange(q: string) {
    query = q;
    exactMatch = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => updateUrl(q), 300);
  }

  return {
    oninit(vnode) {
      query = vnode.attrs.initialQuery ?? "";
      vnode.attrs.proxy.query<StringListRow[]>("getStringList")
        .then(r => { allRows = r; m.redraw(); })
        .catch(console.error);
    },
    onremove() {
      if (timer) clearTimeout(timer);
    },
    view(vnode) {
      const { navigate } = vnode.attrs;

      if (!allRows) return <div className="text-stone-400 dark:text-stone-500 p-4">Loading&hellip;</div>;

      // Compute heaps
      const heaps: string[] = [];
      {
        const s = new Set<string>();
        for (const r of allRows) s.add(r.heap);
        heaps.push(...[...s].sort());
      }

      // Compute filtered
      const qLower = query.toLowerCase();
      const filtered = allRows.filter(r => {
        if (selectedHeap !== "all" && r.heap !== selectedHeap) return false;
        if (!qLower) return true;
        if (exactMatch) return r.value === query;
        return r.value.toLowerCase().includes(qLower);
      });

      // Compute heapFiltered
      const heapFiltered = selectedHeap === "all" ? allRows : allRows.filter(r => r.heap === selectedHeap);

      const duplicates = computeDuplicates(heapFiltered);
      const totalRetained = heapFiltered.reduce((s, r) => s + r.retainedSize, 0);
      const totalWasted = duplicates.reduce((s, d) => s + d.wastedBytes, 0);
      const uniqueCount = (() => {
        const seen = new Set<string>();
        for (const r of heapFiltered) seen.add(r.value);
        return seen.size;
      })();

      return (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100">Strings</h2>
            {heaps.length > 1 && (
              <select
                value={selectedHeap}
                onchange={(e: Event) => { selectedHeap = (e.target as HTMLSelectElement).value; }}
                className="appearance-none pl-2 pr-6 py-1 border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 rounded cursor-pointer"
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
              <span className="font-mono">{heapFiltered.length.toLocaleString()}</span>
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
                    { label: "Wasted", align: "right", sortKey: (r: DuplicateGroup) => r.wastedBytes, render: (r: DuplicateGroup) => <span className="font-mono">{fmtSize(r.wastedBytes)}</span> },
                    { label: "Count", align: "right", sortKey: (r: DuplicateGroup) => r.count, render: (r: DuplicateGroup) => <span className="font-mono">{r.count}</span> },
                    { label: "Value", render: (r: DuplicateGroup) => (
                      <span className="font-mono text-emerald-700 dark:text-emerald-400 break-all">
                        "{r.value.length > 200 ? r.value.slice(0, 200) + "\u2026" : r.value}"
                      </span>
                    )},
                  ]}
                  data={duplicates}
                  onRowClick={(r: DuplicateGroup) => { query = r.value; exactMatch = true; updateUrl(r.value); }}
                />
              </Section>
            </div>
          )}

          {/* Search */}
          <input
            type="text" value={query} oninput={(e: Event) => handleChange((e.target as HTMLInputElement).value)}
            placeholder={"Filter strings\u2026"}
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 mb-3 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />

          {filtered.length > 0 && (
            <>
              {(query || selectedHeap !== "all") && (
                <div className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  {filtered.length.toLocaleString()} match{filtered.length !== 1 ? "es" : ""}
                </div>
              )}
              <SortableTable<StringListRow>
                columns={[
                  { label: "Retained", align: "right", sortKey: (r: StringListRow) => r.retainedSize, render: (r: StringListRow) => <span className="font-mono">{fmtSize(r.retainedSize)}</span> },
                  { label: "Length", align: "right", sortKey: (r: StringListRow) => r.length, render: (r: StringListRow) => <span className="font-mono">{r.length.toLocaleString()}</span> },
                  { label: "Heap", render: (r: StringListRow) => <span className="text-stone-500 dark:text-stone-400">{r.heap}</span> },
                  { label: "Value", render: (r: StringListRow) => (
                    <span>
                      <button
                        className="text-sky-700 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300 underline decoration-sky-300 hover:decoration-sky-500 dark:decoration-sky-600 dark:hover:decoration-sky-400"
                        onclick={() => navigate("object", { id: r.id, label: `"${r.value.length > 40 ? r.value.slice(0, 40) + "\u2026" : r.value}"` })}
                      >
                        <span className="font-mono text-emerald-700 dark:text-emerald-400 break-all">
                          "{r.value.length > 300 ? r.value.slice(0, 300) + "\u2026" : r.value}"
                        </span>
                      </button>
                    </span>
                  )},
                ]}
                data={filtered}
                rowKey={(r: StringListRow) => r.id}
              />
            </>
          )}
          {(query || selectedHeap !== "all") && filtered.length === 0 && (
            <div className="text-stone-500 dark:text-stone-400">No matching strings.</div>
          )}
        </div>
      );
    },
  };
}

export default StringsView;
