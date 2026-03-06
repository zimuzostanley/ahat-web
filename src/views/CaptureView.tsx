import m from "mithril";
import { Fragment } from "../mithril-helpers";
import { AdbConnection, PINNED_PROCESSES, type ProcessInfo, type CapturePhase, type SmapsAggregated, type SmapsEntry, type SmapsRollup, type SharedMapping, type SharedMappingDiff, type GlobalMemInfo, type ProcessDiff, type GlobalMemInfoDiff, type SmapsDiff, type SmapsEntryDiff, diffProcesses, diffGlobalMemInfo, diffSmaps, diffSmapsEntries, aggregateSmaps, aggregateSharedMappings, diffSharedMappings } from "../adb/capture";
import { fmtSize, fmtDelta, deltaBgClass } from "../format";
import { sortWithDiffPinning, computeSmapsTotals, SMAPS_COLUMNS, SMAPS_DELTA_KEY, type SmapsNumericField } from "./capture-helpers";

type SmapsSortFieldType = SmapsNumericField | "count";
type VmaSortFieldType = SmapsNumericField | "addrStart";

function makeSort<F extends string>(initial: F) {
  let field = initial;
  let asc = false;
  return {
    get field() { return field; },
    get asc() { return asc; },
    toggle(f: F) {
      if (field === f) asc = !asc;
      else { field = f; asc = false; }
    },
  };
}

const VmaEntries: m.Component<{
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
}> = {
  view(vnode) {
    const { entries, groupName, pid, processName, sortField, sortAsc, onToggleSort, onDump, dumpDisabled, entryDiffs, leadingColCount } = vnode.attrs;

    const diffByAddr: Map<string, SmapsEntryDiff> | null = entryDiffs
      ? new Map(entryDiffs.map(d => [d.current.addrStart, d] as const))
      : null;

    const sorted = (() => {
      const cmp = (a: SmapsEntry, b: SmapsEntry) => {
        if (sortField === "addrStart") {
          return sortAsc ? a.addrStart.localeCompare(b.addrStart) : b.addrStart.localeCompare(a.addrStart);
        }
        return sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
      };
      return sortWithDiffPinning(entries, entryDiffs, cmp);
    })();

    return m(Fragment, [
      m("tr", { className: "bg-stone-100 dark:bg-stone-700" }, [
        m("td", { colSpan: leadingColCount, className: "py-0.5 px-2 pl-8" }, [
          m("span", {
            className: "text-stone-500 dark:text-stone-400 text-[10px] font-medium cursor-pointer hover:text-stone-700 dark:hover:text-stone-200",
            onclick: () => onToggleSort("addrStart"),
          }, `Address ${sortField === "addrStart" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
          m("span", { className: "ml-3 text-stone-400 dark:text-stone-500 text-[10px]" }, "Perms"),
          m("button", {
            className: "ml-3 text-[10px] text-stone-400 dark:text-stone-500 hover:text-sky-600 dark:hover:text-sky-400 disabled:text-stone-300 dark:disabled:text-stone-600",
            disabled: dumpDisabled,
            title: "Dump all VMA memory in this group",
            onclick: () => onDump(pid, processName, groupName, entries.map(e => ({ addrStart: e.addrStart, addrEnd: e.addrEnd }))),
          }, "dump all"),
        ]),
        SMAPS_COLUMNS.map(([f, label]) =>
          m("td", {
            key: f,
            className: "py-0.5 px-2 text-right text-stone-500 dark:text-stone-400 text-[10px] font-medium cursor-pointer hover:text-stone-700 dark:hover:text-stone-200",
            onclick: () => onToggleSort(f),
          }, `${label} ${sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
        ),
      ]),
      sorted.map((e, i) => {
        const ed = diffByAddr?.get(e.addrStart);
        return m("tr", {
          key: i,
          className: `border-t border-stone-50 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 ${
            ed?.status === "removed" ? "opacity-60" :
            ed?.status === "added" ? "bg-green-50/50 dark:bg-green-900/30" : ""
          }`,
        }, [
          m("td", {
            colSpan: leadingColCount,
            className: `py-0.5 px-2 pl-8 font-mono text-[10px] text-stone-500 dark:text-stone-400 whitespace-nowrap ${ed?.status === "removed" ? "line-through" : ""}`,
          }, [
            `${e.addrStart}-${e.addrEnd}`,
            m("span", { className: "ml-2 text-stone-400 dark:text-stone-500" }, e.perms),
            ed && ed.status !== "matched" && (
              m("span", {
                className: `ml-2 font-medium ${ed.status === "added" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`,
              }, ed.status === "added" ? "NEW" : "GONE")
            ),
            m("button", {
              className: "ml-2 text-stone-400 dark:text-stone-500 hover:text-sky-600 dark:hover:text-sky-400 disabled:text-stone-300 dark:disabled:text-stone-600",
              disabled: dumpDisabled || ed?.status === "removed",
              title: "Dump this VMA",
              onclick: () => onDump(pid, processName, `${groupName}_${e.addrStart}-${e.addrEnd}`, [{ addrStart: e.addrStart, addrEnd: e.addrEnd }]),
            }, "dump"),
          ]),
          SMAPS_COLUMNS.map(([f]) => {
            const delta = ed ? ed[SMAPS_DELTA_KEY[f]] : 0;
            return m("td", {
              key: f,
              className: `py-0.5 px-2 text-right font-mono text-[10px] whitespace-nowrap ${ed ? deltaBgClass(delta) : ""}`,
            }, [
              e[f] > 0 ? fmtSize(e[f] * 1024) : "\u2014",
              ed && (
                m("span", {
                  className: `ml-1 inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`,
                }, delta !== 0 ? fmtDelta(delta) : "")
              ),
            ]);
          }),
        ]);
      }),
    ]);
  },
};

const SmapsSubTable: m.Component<{
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
}> = {
  view(vnode) {
    const { pid, processName, aggregated, expandedGroup, onToggleGroup, sortField, sortAsc, onToggleSort, vmaSortField, vmaSortAsc, onToggleVmaSort, onDump, dumpDisabled, smapsDiffs, prevAggregated, leadingColCount } = vnode.attrs;

    const diffByName: Map<string, SmapsDiff> | null = smapsDiffs
      ? new Map(smapsDiffs.map(d => [d.current.name, d] as const))
      : null;

    const prevByName: Map<string, SmapsAggregated> | null = prevAggregated
      ? new Map(prevAggregated.map(a => [a.name, a] as const))
      : null;

    const sorted = (() => {
      const cmp = (a: SmapsAggregated, b: SmapsAggregated) => {
        return sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
      };
      return sortWithDiffPinning(aggregated, smapsDiffs, cmp);
    })();

    const totals = computeSmapsTotals(aggregated, smapsDiffs);

    return m(Fragment, [
      // Sub-table header
      m("tr", { className: "bg-stone-50 dark:bg-stone-800 border-t border-stone-200 dark:border-stone-700" }, [
        m("td", {
          colSpan: leadingColCount - 1,
          className: "text-left py-1 px-2 pl-6 text-stone-500 dark:text-stone-400 text-xs font-medium",
        }, "Mapping"),
        m("td", {
          className: "text-right py-1 px-1 text-stone-400 dark:text-stone-500 text-xs font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200",
          onclick: () => onToggleSort("count"),
        }, `# ${sortField === "count" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
        SMAPS_COLUMNS.map(([f, label]) =>
          m("td", {
            key: f,
            className: "text-right py-1 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200 whitespace-nowrap",
            onclick: () => onToggleSort(f),
          }, `${label} ${sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
        ),
      ]),
      // Totals row
      m("tr", { className: "border-b-2 border-stone-300 dark:border-stone-600 font-semibold bg-stone-50 dark:bg-stone-800" }, [
        m("td", {
          colSpan: leadingColCount,
          className: "py-0.5 px-2 pl-6 text-stone-600 dark:text-stone-300 text-xs",
        }, "Total"),
        SMAPS_COLUMNS.map(([f]) => {
          const delta = totals[SMAPS_DELTA_KEY[f]];
          return m("td", {
            key: f,
            className: `py-0.5 px-2 text-right font-mono text-xs whitespace-nowrap ${smapsDiffs ? deltaBgClass(delta) : ""}`,
          }, [
            totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014",
            smapsDiffs && (
              m("span", {
                className: `ml-1 text-[10px] font-normal inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`,
              }, delta !== 0 ? fmtDelta(delta) : "")
            ),
          ]);
        }),
      ]),
      sorted.map(g => {
        const sd = diffByName?.get(g.name);
        const prevEntries = sd && sd.status === "matched" && prevByName ? prevByName.get(g.name)?.entries ?? null : null;
        return m(Fragment, { key: g.name }, [
          m("tr", {
            className: `border-t border-stone-100 dark:border-stone-800 cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-700 bg-stone-50 dark:bg-stone-800 text-xs ${
              sd?.status === "removed" ? "opacity-60" :
              sd?.status === "added" ? "bg-green-50/50 dark:bg-green-900/30" : ""
            }`,
            onclick: () => sd?.status !== "removed" && onToggleGroup(g.name),
          }, [
            m("td", {
              colSpan: leadingColCount - 1,
              className: `py-0.5 px-2 pl-6 font-mono text-stone-700 dark:text-stone-200 ${sd?.status === "removed" ? "line-through" : ""}`,
              title: g.name,
            }, [
              m("div", { className: "flex items-center gap-1" }, [
                m("span", { className: "text-stone-400 dark:text-stone-500 shrink-0" }, expandedGroup === g.name ? "\u25BC" : "\u25B6"),
                m("span", { className: "truncate max-w-[280px]" }, g.name),
                sd && sd.status !== "matched" && (
                  m("span", {
                    className: `text-[10px] font-medium shrink-0 ${sd.status === "added" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`,
                  }, sd.status === "added" ? "NEW" : "GONE")
                ),
                m("button", {
                  className: "text-[10px] text-stone-400 dark:text-stone-500 hover:text-sky-600 dark:hover:text-sky-400 disabled:text-stone-300 dark:disabled:text-stone-600 shrink-0",
                  disabled: dumpDisabled || sd?.status === "removed",
                  title: `Dump ${g.name} memory`,
                  onclick: (e: Event) => { e.stopPropagation(); onDump(pid, processName, g.name, g.entries.map(en => ({ addrStart: en.addrStart, addrEnd: en.addrEnd }))); },
                }, "dump"),
              ]),
            ]),
            m("td", { className: "py-0.5 px-1 text-right font-mono text-stone-400 dark:text-stone-500" }, String(g.count)),
            SMAPS_COLUMNS.map(([f]) => {
              const delta = sd ? sd[SMAPS_DELTA_KEY[f]] : 0;
              return m("td", {
                key: f,
                className: `py-0.5 px-2 text-right font-mono whitespace-nowrap ${sd ? deltaBgClass(delta) : ""}`,
              }, [
                g[f] > 0 ? fmtSize(g[f] * 1024) : "\u2014",
                sd && (
                  m("span", {
                    className: `ml-1 text-[10px] inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`,
                  }, delta !== 0 ? fmtDelta(delta) : "")
                ),
              ]);
            }),
          ]),
          expandedGroup === g.name && sd?.status !== "removed" && (
            m(VmaEntries, {
              entries: g.entries,
              groupName: g.name,
              pid,
              processName,
              sortField: vmaSortField,
              sortAsc: vmaSortAsc,
              onToggleSort: onToggleVmaSort,
              onDump,
              dumpDisabled,
              entryDiffs: prevEntries ? diffSmapsEntries(prevEntries, g.entries) : null,
              leadingColCount,
            })
          ),
        ]);
      }),
    ]);
  },
};

// --- Shared Mappings Table -------------------------------------------------------

function SharedMappingsTable(): m.Component<{
  mappings: SharedMapping[];
  loadedCount: number;
  loading: boolean;
  diffs?: SharedMappingDiff[] | null;
  smapsData: Map<number, SmapsAggregated[]>;
  onDump: (pid: number, processName: string, label: string, regions: { addrStart: string; addrEnd: string }[]) => void;
  dumpDisabled: boolean;
}> {
  const sort = makeSort<SmapsNumericField | "processCount">("pssKb");
  let expandedMapping: string | null = null;

  return {
    view(vnode) {
      const { mappings, loadedCount, loading, diffs, smapsData, onDump, dumpDisabled } = vnode.attrs;

      const diffByName: Map<string, SharedMappingDiff> | null = diffs
        ? new Map(diffs.map(d => [d.current.name, d] as const))
        : null;

      const sorted = (() => {
        const cmp = (a: SharedMapping, b: SharedMapping) => {
          return sort.asc ? a[sort.field] - b[sort.field] : b[sort.field] - a[sort.field];
        };
        return sortWithDiffPinning(mappings, diffs, cmp);
      })();

      const totals = computeSmapsTotals(mappings, diffs);

      return m("div", { className: "mt-4" }, [
        m("h3", { className: "text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider mb-2" }, [
          "Shared Mappings",
          m("span", { className: "font-normal ml-2" },
            `(${mappings.length} mappings across ${loadedCount} processes)`,
          ),
          loading && m("span", { className: "ml-2 text-sky-600 dark:text-sky-400 animate-pulse" }, "loading\u2026"),
        ]),
        m("div", { className: "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 max-h-[500px] overflow-y-auto" }, [
          m("table", { className: "w-full text-xs" }, [
            m("thead", { className: "sticky top-0 bg-stone-50 dark:bg-stone-800 z-10" }, [
              m("tr", { className: "border-b border-stone-200 dark:border-stone-700" }, [
                m("th", { className: "text-left py-1 px-2 text-stone-500 dark:text-stone-400 font-medium" }, "Mapping"),
                m("th", {
                  className: "text-right py-1 px-1 text-stone-400 dark:text-stone-500 font-medium w-8 cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200",
                  onclick: () => sort.toggle("processCount"),
                }, `Procs ${sort.field === "processCount" ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                SMAPS_COLUMNS.map(([f, label]) =>
                  m("th", {
                    key: f,
                    className: "text-right py-1 px-2 text-stone-500 dark:text-stone-400 font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200 whitespace-nowrap",
                    onclick: () => sort.toggle(f),
                  }, `${label} ${sort.field === f ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                ),
              ]),
            ]),
            m("tbody", [
              m("tr", { className: "border-b-2 border-stone-300 dark:border-stone-600 font-semibold" }, [
                m("td", { className: "py-0.5 px-2 text-stone-600 dark:text-stone-300" }, "Total"),
                m("td"),
                SMAPS_COLUMNS.map(([f]) => {
                  const delta = totals[SMAPS_DELTA_KEY[f]];
                  return m("td", {
                    key: f,
                    className: `py-0.5 px-2 text-right font-mono whitespace-nowrap ${diffs ? deltaBgClass(delta) : ""}`,
                  }, [
                    totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014",
                    diffs && (
                      m("span", {
                        className: `ml-1 text-[10px] font-normal inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`,
                      }, delta !== 0 ? fmtDelta(delta) : "")
                    ),
                  ]);
                }),
              ]),
              sorted.map((mp, i) => {
                const sd = diffByName?.get(mp.name);
                return m(Fragment, { key: `${mp.name}-${i}` }, [
                  m("tr", {
                    className: `border-t border-stone-100 dark:border-stone-800 cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800 ${
                      sd?.status === "removed" ? "opacity-60" :
                      sd?.status === "added" ? "bg-green-50/50 dark:bg-green-900/30" : ""
                    }`,
                    onclick: () => sd?.status !== "removed" && (expandedMapping = expandedMapping === mp.name ? null : mp.name),
                  }, [
                    m("td", {
                      className: `py-0.5 px-2 font-mono text-stone-700 dark:text-stone-200 ${sd?.status === "removed" ? "line-through" : ""}`,
                      title: mp.name,
                    }, [
                      m("div", { className: "flex items-center gap-1" }, [
                        m("span", { className: "text-stone-400 dark:text-stone-500 shrink-0" }, expandedMapping === mp.name ? "\u25BC" : "\u25B6"),
                        m("span", { className: "truncate max-w-[280px]" }, mp.name),
                        sd && sd.status !== "matched" && (
                          m("span", {
                            className: `text-[10px] font-medium shrink-0 ${sd.status === "added" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`,
                          }, sd.status === "added" ? "NEW" : "GONE")
                        ),
                      ]),
                    ]),
                    m("td", { className: "py-0.5 px-1 text-right font-mono text-stone-400 dark:text-stone-500" }, String(mp.processCount)),
                    SMAPS_COLUMNS.map(([f]) => {
                      const delta = sd ? sd[SMAPS_DELTA_KEY[f]] : 0;
                      return m("td", {
                        key: f,
                        className: `py-0.5 px-2 text-right font-mono whitespace-nowrap ${sd ? deltaBgClass(delta) : ""}`,
                      }, [
                        mp[f] > 0 ? fmtSize(mp[f] * 1024) : "\u2014",
                        sd && (
                          m("span", {
                            className: `ml-1 text-[10px] inline-block min-w-[4rem] text-right ${delta > 0 ? "text-red-700 dark:text-red-400" : delta < 0 ? "text-green-700 dark:text-green-400" : ""}`,
                          }, delta !== 0 ? fmtDelta(delta) : "")
                        ),
                      ]);
                    }),
                  ]),
                  expandedMapping === mp.name && sd?.status !== "removed" && m(Fragment, [
                    m("tr", { className: "bg-stone-100 dark:bg-stone-700" }, [
                      m("td", { className: "py-0.5 px-2 pl-6 text-stone-500 dark:text-stone-400 text-[10px] font-medium" }, "Process (PID)"),
                      m("td"),
                      SMAPS_COLUMNS.map(([, label]) =>
                        m("td", {
                          key: label,
                          className: "py-0.5 px-2 text-right text-stone-500 dark:text-stone-400 text-[10px] font-medium",
                        }, label),
                      ),
                    ]),
                    mp.processes.map(p => {
                      const procAgg = smapsData.get(p.pid);
                      const matchedGroup = procAgg?.find(g => g.name === mp.name);
                      const regions = matchedGroup?.entries.map(e => ({ addrStart: e.addrStart, addrEnd: e.addrEnd }));
                      return m("tr", {
                        key: p.pid,
                        className: "border-t border-stone-50 dark:border-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700",
                      }, [
                        m("td", { className: "py-0.5 px-2 pl-6 text-[10px] text-stone-600 dark:text-stone-300 whitespace-nowrap" }, [
                          m("div", { className: "flex items-center gap-1" }, [
                            m("span", [
                              `${p.name} `,
                              m("span", { className: "text-stone-400 dark:text-stone-500" }, `(${p.pid})`),
                            ]),
                            m("button", {
                              className: "text-[10px] text-stone-400 dark:text-stone-500 hover:text-sky-600 dark:hover:text-sky-400 disabled:text-stone-300 dark:disabled:text-stone-600 shrink-0",
                              disabled: dumpDisabled || !regions?.length,
                              title: `Dump ${mp.name} from ${p.name} (${p.pid})`,
                              onclick: () => regions && onDump(p.pid, p.name, mp.name, regions),
                            }, "dump"),
                          ]),
                        ]),
                        m("td"),
                        SMAPS_COLUMNS.map(([f]) =>
                          m("td", {
                            key: f,
                            className: "py-0.5 px-2 text-right font-mono text-[10px] whitespace-nowrap",
                          }, p[f] > 0 ? fmtSize(p[f] * 1024) : "\u2014"),
                        ),
                      ]);
                    }),
                  ]),
                ]);
              }),
            ]),
          ]),
        ]),
      ]);
    },
  };
}

// --- Per-Row Dump Button ---------------------------------------------------------

interface CaptureJob {
  status: string;
  progress: { done: number; total: number } | null;
  error: string | null;
}

function DumpButton(): m.Component<{
  pid: number;
  job: CaptureJob | undefined;
  disabled: boolean;
  onDump: (pid: number, withBitmaps: boolean) => void;
  onCancel: (pid: number) => void;
}> {
  let open = false;
  let menuPos: { top: number; left: number } | null = null;
  let containerEl: HTMLDivElement | null = null;
  let caretEl: HTMLButtonElement | null = null;

  function closeMenu() { open = false; m.redraw(); }
  function handleOutsideClick(e: Event) {
    if (containerEl && !containerEl.contains(e.target as Node)) closeMenu();
  }
  function handleScroll() { closeMenu(); }

  return {
    onremove() {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("scroll", handleScroll, true);
    },
    view(vnode) {
      const { pid, job, disabled, onDump, onCancel } = vnode.attrs;

      if (job) {
        // Active capture -- show status + cancel
        const pct = job.progress && job.progress.total > 0
          ? `${Math.round(job.progress.done / job.progress.total * 100)}%`
          : null;
        return m("button", {
          className: "text-xs text-amber-700 dark:text-amber-400 hover:text-rose-700 dark:hover:text-rose-400 px-2 py-0.5 border border-amber-300 dark:border-amber-600 hover:border-rose-400 dark:hover:border-rose-500 whitespace-nowrap w-[104px] truncate",
          title: "Click to cancel",
          onclick: (e: Event) => { e.stopPropagation(); onCancel(pid); },
        }, pct ?? job.status);
      }

      return m("div", {
        className: "relative inline-flex w-[104px]",
        oncreate: (v: m.VnodeDOM) => { containerEl = v.dom as HTMLDivElement; },
      }, [
        m("button", {
          className: "flex-1 text-xs text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 disabled:text-stone-300 dark:disabled:text-stone-600 disabled:cursor-not-allowed px-2 py-0.5 border border-r-0 border-sky-200 dark:border-sky-700 hover:border-sky-400 dark:hover:border-sky-500 disabled:border-stone-200 dark:disabled:border-stone-700 whitespace-nowrap rounded-l",
          disabled,
          title: "Dump Java heap",
          onclick: (e: Event) => { e.stopPropagation(); onDump(pid, false); },
        }, "Dump"),
        m("button", {
          className: "text-xs text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 disabled:text-stone-300 dark:disabled:text-stone-600 disabled:cursor-not-allowed px-1 py-0.5 border border-sky-200 dark:border-sky-700 hover:border-sky-400 dark:hover:border-sky-500 disabled:border-stone-200 dark:disabled:border-stone-700 rounded-r",
          disabled,
          title: "More options",
          oncreate: (v: m.VnodeDOM) => { caretEl = v.dom as HTMLButtonElement; },
          onclick: (e: Event) => {
            e.stopPropagation();
            if (!open && caretEl) {
              const r = caretEl.getBoundingClientRect();
              menuPos = { top: r.bottom + 2, left: r.right - 160 };
            }
            open = !open;
            if (open) {
              document.addEventListener("mousedown", handleOutsideClick);
              document.addEventListener("scroll", handleScroll, true);
            } else {
              document.removeEventListener("mousedown", handleOutsideClick);
              document.removeEventListener("scroll", handleScroll, true);
            }
          },
        }, "\u25BE"),
        open && menuPos && (
          m("div", {
            className: "fixed z-50 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 shadow-lg rounded text-xs w-[160px]",
            style: { top: `${menuPos.top}px`, left: `${menuPos.left}px` },
          }, [
            m("button", {
              className: "block w-full text-left px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-900/30 text-stone-700 dark:text-stone-200 rounded-t",
              onclick: (e: Event) => {
                e.stopPropagation();
                open = false;
                document.removeEventListener("mousedown", handleOutsideClick);
                document.removeEventListener("scroll", handleScroll, true);
                onDump(pid, false);
              },
            }, "Java dump"),
            m("button", {
              className: "block w-full text-left px-3 py-1.5 hover:bg-sky-50 dark:hover:bg-sky-900/30 text-stone-700 dark:text-stone-200 border-t border-stone-100 dark:border-stone-800 rounded-b",
              onclick: (e: Event) => {
                e.stopPropagation();
                open = false;
                document.removeEventListener("mousedown", handleOutsideClick);
                document.removeEventListener("scroll", handleScroll, true);
                onDump(pid, true);
              },
            }, "+ bitmaps"),
          ])
        ),
      ]);
    },
  };
}

// --- Capture View ----------------------------------------------------------------

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

interface CaptureViewAttrs {
  onCaptured: (name: string, buffer: ArrayBuffer) => void;
  onVmaDump: (name: string, buffer: ArrayBuffer, regions?: { addrStart: string; addrEnd: string }[]) => void;
  conn: AdbConnection;
}

function CaptureView(): m.Component<CaptureViewAttrs> {
  let connected = false;
  let connectStatus: string | null = null;
  let processes: ProcessInfo[] | null = null;
  const sort = makeSort<SortField>("pssKb");
  let error: string | null = null;

  // Enrichment runs in the background -- independent of captures
  let enrichAbortCtrl: AbortController | null = null;
  let enrichStatus: string | null = null;
  let enrichProgress: { done: number; total: number } | null = null;

  // Per-PID capture state -- each process row has independent dump lifecycle
  let captureJobs = new Map<number, CaptureJob>();
  let captureAbortCtrls = new Map<number, AbortController>();

  // VMA dump state
  let vmaDumpAbortCtrl: AbortController | null = null;
  let vmaDumpStatus: string | null = null;

  // Smaps rollup -- fast batch fetch (root-only)
  let smapsRollups = new Map<number, SmapsRollup>();
  let globalMemInfo: GlobalMemInfo | null = null;
  // Java PIDs -- from dumpsys meminfo, used to show Java dump button only for managed processes
  let javaPids = new Set<number>();

  // Full smaps -- fetched on demand per process or via "Scan All"
  let smapsData = new Map<number, SmapsAggregated[]>();
  let smapsFetchAbortCtrl: AbortController | null = null;
  let smapsFetchPid: number | null = null;
  let scanStatus: string | null = null;
  let scanProgress: { done: number; total: number } | null = null;

  // Smaps expansion / sort state
  let expandedSmapsPid: number | null = null;
  let expandedSmapsGroup: string | null = null;
  const smapsSort = makeSort<SmapsSortFieldType>("pssKb");
  const vmaSort = makeSort<VmaSortFieldType>("pssKb");

  // Diff state
  let diffMode = false;
  let prevProcesses: ProcessInfo[] | null = null;
  let prevGlobalMemInfo: GlobalMemInfo | null = null;
  let processDiffs: ProcessDiff[] | null = null;
  let globalMemInfoDiff: GlobalMemInfoDiff | null = null;
  let prevSmapsData = new Map<number, SmapsAggregated[]>();
  let prevSmapsRollups = new Map<number, SmapsRollup>();
  let diffTriggered = false;

  // Cached conn reference
  let conn: AdbConnection;

  function clearDiff() {
    diffMode = false;
    prevProcesses = null;
    prevGlobalMemInfo = null;
    processDiffs = null;
    globalMemInfoDiff = null;
    prevSmapsData = new Map();
    prevSmapsRollups = new Map();
    diffTriggered = false;
  }

  // Progressive diff recomputation
  function recomputeDiffs() {
    if (diffMode && prevProcesses && processes) {
      processDiffs = diffProcesses(prevProcesses, processes);
    }
    if (diffMode && prevGlobalMemInfo && globalMemInfo) {
      globalMemInfoDiff = diffGlobalMemInfo(prevGlobalMemInfo, globalMemInfo);
    }
  }

  function cancelEnrichment() {
    if (!enrichAbortCtrl) return;
    enrichAbortCtrl.abort();
    enrichAbortCtrl = null;
    enrichStatus = null;
    enrichProgress = null;
  }

  function cancelCapture(pid: number) {
    const ac = captureAbortCtrls.get(pid);
    if (ac) { ac.abort(); captureAbortCtrls.delete(pid); }
    captureJobs = new Map(captureJobs);
    captureJobs.delete(pid);
  }

  function cancelAllCaptures() {
    for (const [, ac] of captureAbortCtrls) ac.abort();
    captureAbortCtrls.clear();
    captureJobs = new Map();
  }

  function cancelSmapsFetch() {
    if (!smapsFetchAbortCtrl) return;
    smapsFetchAbortCtrl.abort();
    smapsFetchAbortCtrl = null;
    smapsFetchPid = null;
    scanStatus = null;
    scanProgress = null;
  }

  function cancelVmaDump() {
    if (!vmaDumpAbortCtrl) return;
    vmaDumpAbortCtrl.abort();
    vmaDumpAbortCtrl = null;
    vmaDumpStatus = null;
  }

  async function refreshProcesses() {
    if (!conn.connected) return;
    cancelEnrichment();
    cancelSmapsFetch();
    if (!diffTriggered) clearDiff();
    diffTriggered = false;
    const ac = new AbortController();
    enrichAbortCtrl = ac;
    enrichStatus = "Fetching smaps\u2026";
    enrichProgress = null;
    smapsRollups = new Map();
    smapsData = new Map();
    expandedSmapsPid = null;
    expandedSmapsGroup = null;
    globalMemInfo = null;
    javaPids = new Set();
    error = null;
    m.redraw();
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
      processes = lruList;
      javaPids = lruJavaPids;
      m.redraw();

      if (!conn.isRoot) {
        // Non-root: check debuggable packages, then stop
        if (!ac.signal.aborted) {
          try {
            const debuggable = await conn.getDebuggablePackages(ac.signal);
            if (!ac.signal.aborted) {
              for (const p of lruList) p.debuggable = debuggable.has(p.name);
              processes = [...lruList];
              m.redraw();
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
        processes = procList;
        smapsRollups = rollups;
        javaPids = mergedJavaPids;
        recomputeDiffs();
        m.redraw();
      }

      // Step 3 (root, bg): /proc/meminfo for global memory stats
      if (!ac.signal.aborted) {
        try {
          const procInfo = await conn.getProcMeminfo(ac.signal);
          if (!ac.signal.aborted && procInfo.totalRamKb) {
            globalMemInfo = {
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
            };
            recomputeDiffs();
            m.redraw();
          }
        } catch {}
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      error = e instanceof Error ? e.message : "Failed to get process list";
      m.redraw();
    } finally {
      if (enrichAbortCtrl === ac) {
        enrichAbortCtrl = null;
        enrichStatus = null;
        enrichProgress = null;
        m.redraw();
      }
    }
  }

  // On-demand smaps fetch for a single process
  async function fetchSmapsOnDemand(pid: number) {
    if (smapsData.has(pid) || !conn.connected || !conn.isRoot) return;
    cancelSmapsFetch();
    const ac = new AbortController();
    smapsFetchAbortCtrl = ac;
    smapsFetchPid = pid;
    m.redraw();
    try {
      const entries = await conn.getSmapsForPid(pid, ac.signal);
      if (ac.signal.aborted) return;
      if (entries.length > 0) {
        smapsData = new Map(smapsData).set(pid, aggregateSmaps(entries));
        m.redraw();
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    } finally {
      if (smapsFetchAbortCtrl === ac) {
        smapsFetchAbortCtrl = null;
        smapsFetchPid = null;
        m.redraw();
      }
    }
  }

  // Scan all processes for full smaps data (populates shared mappings table)
  async function scanAllSmaps() {
    if (!conn.connected || !conn.isRoot || !processes) return;
    cancelSmapsFetch();
    const ac = new AbortController();
    smapsFetchAbortCtrl = ac;
    scanStatus = "Fetching process smaps\u2026";
    scanProgress = null;
    m.redraw();
    try {
      await conn.fetchAllSmaps(
        processes,
        (pid, data) => {
          if (ac.signal.aborted) return;
          smapsData = new Map(smapsData).set(pid, data);
          m.redraw();
        },
        (done, total, name) => {
          if (ac.signal.aborted) return;
          scanStatus = name || "Fetching process smaps\u2026";
          scanProgress = { done, total };
          m.redraw();
        },
        ac.signal,
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (ac.signal.aborted) return;
      error = e instanceof Error ? e.message : "VMA scan failed";
      m.redraw();
    } finally {
      if (smapsFetchAbortCtrl === ac) {
        smapsFetchAbortCtrl = null;
        scanStatus = null;
        scanProgress = null;
        m.redraw();
      }
    }
  }

  function handleDiff() {
    if (!processes) return;
    prevProcesses = processes.map(p => ({ ...p }));
    if (globalMemInfo) prevGlobalMemInfo = { ...globalMemInfo };
    prevSmapsData = new Map(smapsData);
    prevSmapsRollups = new Map(smapsRollups);
    diffMode = true;
    diffTriggered = true;
    refreshProcesses();
  }

  async function handleConnect() {
    connectStatus = "Connecting\u2026";
    error = null;
    m.redraw();
    try {
      await conn.requestAndConnect((msg) => { connectStatus = msg; m.redraw(); });
      connected = true;
      m.redraw();
      refreshProcesses();
    } catch (e) {
      if (e instanceof Error && e.name === "NotFoundError") {
        // User cancelled device picker
      } else {
        error = e instanceof Error ? e.message : "Connection failed";
      }
      m.redraw();
    } finally {
      connectStatus = null;
      m.redraw();
    }
  }

  async function startCapture(pid: number, withBitmaps: boolean) {
    if (captureAbortCtrls.has(pid)) return; // already in flight
    const ac = new AbortController();
    captureAbortCtrls.set(pid, ac);
    captureJobs = new Map(captureJobs).set(pid, { status: "Starting\u2026", progress: null, error: null });
    m.redraw();

    const updateJob = (patch: Partial<CaptureJob>) => {
      const old = captureJobs.get(pid);
      if (!old) return;
      captureJobs = new Map(captureJobs).set(pid, { ...old, ...patch });
      m.redraw();
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
      _onCaptured(`${procName}_${ts}`, buffer);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError") && !ac.signal.aborted) {
        updateJob({ status: "Failed", error: e instanceof Error ? e.message : "Capture failed" });
        setTimeout(() => {
          captureJobs = new Map(captureJobs);
          captureJobs.delete(pid);
          captureAbortCtrls.delete(pid);
          m.redraw();
        }, 3000);
        return;
      }
    }
    captureAbortCtrls.delete(pid);
    captureJobs = new Map(captureJobs);
    captureJobs.delete(pid);
    m.redraw();
  }

  async function handleVmaDump(
    pid: number, processName: string,
    label: string,
    regions: { addrStart: string; addrEnd: string }[],
  ) {
    if (!connected || vmaDumpStatus) return;
    const ac = new AbortController();
    vmaDumpAbortCtrl = ac;
    try {
      vmaDumpStatus = `Dumping ${label}\u2026`;
      m.redraw();
      const data = await conn.dumpVmaMemory(pid, regions, status => {
        vmaDumpStatus = status;
        m.redraw();
      }, ac.signal);
      if (ac.signal.aborted) return;
      const procSan = processName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const labelSan = label.replace(/[^a-zA-Z0-9._-]/g, "_");
      _onVmaDump(`${procSan}_${labelSan}`, data.buffer as ArrayBuffer, regions);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      error = e instanceof Error ? e.message : "VMA dump failed";
      m.redraw();
    } finally {
      if (vmaDumpAbortCtrl === ac) {
        vmaDumpAbortCtrl = null;
        vmaDumpStatus = null;
        m.redraw();
      }
    }
  }

  function handleDisconnect() {
    cancelEnrichment();
    cancelSmapsFetch();
    cancelAllCaptures();
    cancelVmaDump();
    conn.disconnect();
    connected = false;
    error = null;
    enrichStatus = null;
    enrichProgress = null;
  }

  // Attrs-derived callbacks stored each render
  let _onCaptured: (name: string, buffer: ArrayBuffer) => void;
  let _onVmaDump: (name: string, buffer: ArrayBuffer, regions?: { addrStart: string; addrEnd: string }[]) => void;

  return {
    oninit(vnode) {
      conn = vnode.attrs.conn;
      _onCaptured = vnode.attrs.onCaptured;
      _onVmaDump = vnode.attrs.onVmaDump;
    },
    onremove() {
      cancelEnrichment();
      cancelSmapsFetch();
      cancelAllCaptures();
      cancelVmaDump();
      conn.disconnect();
    },
    view(vnode) {
      conn = vnode.attrs.conn;
      _onCaptured = vnode.attrs.onCaptured;
      _onVmaDump = vnode.attrs.onVmaDump;

      // Recompute diffs if needed (equivalent to useEffect on deps)
      recomputeDiffs();

      const sorted = (() => {
        if (!processes) return null;
        const copy = [...processes];
        copy.sort((a, b) => {
          // Pin "System" processes at top
          const aPin = PINNED_PROCESSES.has(a.name) ? 0 : 1;
          const bPin = PINNED_PROCESSES.has(b.name) ? 0 : 1;
          if (aPin !== bPin) return aPin - bPin;
          if (sort.field === "name") {
            const cmp = a.name.localeCompare(b.name);
            return sort.asc ? cmp : -cmp;
          }
          if (sort.field === "oomLabel") {
            const cmp = a.oomLabel.localeCompare(b.oomLabel);
            return sort.asc ? cmp : -cmp;
          }
          if (sort.field === "pid") return sort.asc ? a.pid - b.pid : b.pid - a.pid;
          const aVal = getFieldValue(a, sort.field, smapsRollups.get(a.pid));
          const bVal = getFieldValue(b, sort.field, smapsRollups.get(b.pid));
          return sort.asc ? aVal - bVal : bVal - aVal;
        });
        return copy;
      })();

      const sortedDiffs = (() => {
        if (!processDiffs) return null;
        const copy = [...processDiffs];
        copy.sort((a, b) => {
          const aPin = PINNED_PROCESSES.has(a.current.name) ? 0 : 1;
          const bPin = PINNED_PROCESSES.has(b.current.name) ? 0 : 1;
          if (aPin !== bPin) return aPin - bPin;
          if (sort.field === "name") {
            const cmp = a.current.name.localeCompare(b.current.name);
            return sort.asc ? cmp : -cmp;
          }
          if (sort.field === "oomLabel") {
            const cmp = a.current.oomLabel.localeCompare(b.current.oomLabel);
            return sort.asc ? cmp : -cmp;
          }
          if (sort.field === "pid") return sort.asc ? a.current.pid - b.current.pid : b.current.pid - a.current.pid;
          const aVal = getFieldValue(a.current, sort.field, smapsRollups.get(a.current.pid));
          const bVal = getFieldValue(b.current, sort.field, smapsRollups.get(b.current.pid));
          return sort.asc ? aVal - bVal : bVal - aVal;
        });
        return copy;
      })();

      // Cross-process shared mappings -- from full smaps data (populated by Scan All or on-demand)
      const sharedMappings = (() => {
        if (smapsData.size === 0 || !processes) return null;
        return aggregateSharedMappings(smapsData, processes);
      })();

      const prevSharedMappings = (() => {
        if (prevSmapsData.size === 0 || !prevProcesses) return null;
        return aggregateSharedMappings(prevSmapsData, prevProcesses);
      })();

      const sharedMappingDiffs = (() => {
        if (!diffMode || !sharedMappings || !prevSharedMappings) return null;
        return diffSharedMappings(prevSharedMappings, sharedMappings);
      })();

      const hasOomLabel = processes ? processes.some(p => p.oomLabel !== "") : false;

      const processTotals = (() => {
        const activeProcs = (sorted ?? []).filter(p => !(diffMode && sortedDiffs?.find(d => d.current.pid === p.pid && d.status === "removed")));
        const totals: Record<string, number> = {};
        for (const [f] of ROLLUP_COLUMNS) totals[f] = 0;
        for (const p of activeProcs) {
          const r = smapsRollups.get(p.pid);
          for (const [f] of ROLLUP_COLUMNS) totals[f] += getFieldValue(p, f, r);
        }
        return { count: activeProcs.length, values: totals };
      })();

      const hasWebUsb = typeof navigator !== "undefined" && "usb" in navigator;

      if (!hasWebUsb) {
        return m("div", { className: "text-center py-8" }, [
          m("p", { className: "text-stone-600 dark:text-stone-300 mb-2" }, "WebUSB is not available."),
          m("p", { className: "text-stone-400 dark:text-stone-500 text-sm" }, "Use Chrome or Edge over HTTPS/localhost."),
        ]);
      }

      return m("div", [
        // Connection
        !connected && !processes && (
          m("div", { className: "text-center py-8" }, [
            m("button", {
              className: "px-6 py-3 bg-stone-800 dark:bg-stone-700 text-white hover:bg-stone-700 dark:hover:bg-stone-600 transition-colors disabled:opacity-50",
              onclick: handleConnect,
              disabled: connectStatus !== null,
            }, connectStatus ?? "Connect USB Device"),
            m("p", { className: "text-stone-400 dark:text-stone-500 text-xs mt-3" }, [
              "Enable USB debugging on device. If ADB is running, stop it first: ",
              m("code", { className: "bg-stone-100 dark:bg-stone-700 px-1" }, "adb kill-server"),
            ]),
          ])
        ),
        (connected || processes) && (
          m("div", [
            m("div", { className: "flex items-center gap-3 mb-4 flex-wrap" }, [
              connected ? m(Fragment, [
                m("span", { className: "text-stone-600 dark:text-stone-300" }, conn.productName),
                m("span", { className: "text-stone-400 dark:text-stone-500 font-mono text-xs" }, conn.serial),
              ]) : (
                m("span", { className: "text-amber-600 dark:text-amber-400 text-xs" }, "Disconnected")
              ),
              m("span", { className: "ml-auto" }),
              m("button", {
                className: `text-xs ${connected ? "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300" : "text-stone-300 dark:text-stone-600 cursor-not-allowed"}`,
                onclick: refreshProcesses,
                disabled: !connected,
              }, enrichStatus && !diffMode ? "Refreshing\u2026" : enrichStatus && diffMode ? "Diffing\u2026" : "Refresh"),
              connected && processes && !enrichStatus && (
                m("button", {
                  className: "text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 text-xs border border-sky-300 dark:border-sky-600 px-2 py-0.5",
                  onclick: handleDiff,
                }, "Diff")
              ),
              diffMode && !enrichStatus && (
                m("button", {
                  className: "text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 text-xs border border-amber-300 dark:border-amber-600 px-2 py-0.5",
                  onclick: clearDiff,
                }, "Clear Diff")
              ),
              connected ? (
                m("button", {
                  className: "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 text-xs",
                  onclick: handleDisconnect,
                }, "Disconnect")
              ) : (
                m("button", {
                  className: "px-3 py-0.5 text-xs bg-stone-800 dark:bg-stone-700 text-white hover:bg-stone-700 dark:hover:bg-stone-600 transition-colors disabled:opacity-50",
                  onclick: handleConnect,
                  disabled: connectStatus !== null,
                }, connectStatus ?? "Reconnect")
              ),
            ]),

            // Non-root banner
            connected && !conn.isRoot && processes && (
              m("div", {
                className: "bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs px-3 py-2 mb-3",
              }, "Non-rooted device \u2014 only debuggable apps can be captured")
            ),

            // VMA dump progress
            vmaDumpStatus && (
              m("div", { className: "mb-2 text-xs text-stone-500 dark:text-stone-400" }, [
                m("div", { className: "flex items-center gap-2" }, [
                  m("span", { className: "truncate" }, vmaDumpStatus),
                  m("button", {
                    className: "text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 ml-auto",
                    onclick: cancelVmaDump,
                  }, "Cancel"),
                ]),
              ])
            ),

            // Enrichment progress
            enrichStatus && (
              m("div", { className: "mb-2 text-xs text-stone-500 dark:text-stone-400" }, [
                m("div", { className: "flex items-center gap-2 mb-1" }, [
                  m("span", { className: "truncate" }, diffMode ? `Diffing: ${enrichStatus}` : enrichStatus),
                  enrichProgress && m("span", { className: "text-stone-400 dark:text-stone-500 whitespace-nowrap" }, `${enrichProgress.done}/${enrichProgress.total}`),
                  m("button", {
                    className: "text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 ml-auto",
                    onclick: cancelEnrichment,
                  }, "Cancel"),
                ]),
                enrichProgress && enrichProgress.total > 0 && (
                  m("div", { className: "h-1 bg-stone-100 dark:bg-stone-700 rounded overflow-hidden" }, [
                    m("div", {
                      className: "h-full bg-sky-500 transition-all",
                      style: { width: `${(enrichProgress.done / enrichProgress.total) * 100}%` },
                    }),
                  ])
                ),
              ])
            ),

            // VMA scan progress
            scanStatus && (
              m("div", { className: "mb-2 text-xs text-stone-500 dark:text-stone-400" }, [
                m("div", { className: "flex items-center gap-2 mb-1" }, [
                  m("span", { className: "truncate" }, `Scanning: ${scanStatus}`),
                  scanProgress && m("span", { className: "text-stone-400 dark:text-stone-500 whitespace-nowrap" }, `${scanProgress.done}/${scanProgress.total}`),
                  m("button", {
                    className: "text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 ml-auto",
                    onclick: cancelSmapsFetch,
                  }, "Cancel"),
                ]),
                scanProgress && scanProgress.total > 0 && (
                  m("div", { className: "h-1 bg-stone-100 dark:bg-stone-700 rounded overflow-hidden" }, [
                    m("div", {
                      className: "h-full bg-amber-500 transition-all",
                      style: { width: `${(scanProgress.done / scanProgress.total) * 100}%` },
                    }),
                  ])
                ),
              ])
            ),

            // Global memory summary
            globalMemInfo && (
              m("div", { className: "mb-3 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 px-3 py-2 overflow-x-auto" }, [
                m("div", { className: "flex flex-wrap gap-x-6 gap-y-1 text-xs" }, [
                  ([
                    ["Total", globalMemInfo.totalRamKb, globalMemInfoDiff?.deltaTotalRamKb, false],
                    ["Free", globalMemInfo.freeRamKb, globalMemInfoDiff?.deltaFreeRamKb, true],
                    ["Used", globalMemInfo.usedPssKb, globalMemInfoDiff?.deltaUsedPssKb, false],
                    ...(globalMemInfo.memAvailableKb > 0 ? [["Available", globalMemInfo.memAvailableKb, globalMemInfoDiff?.deltaMemAvailableKb, true] as const] : []),
                    ...(globalMemInfo.lostRamKb > 0 ? [["Lost", globalMemInfo.lostRamKb, globalMemInfoDiff?.deltaLostRamKb, false] as const] : []),
                  ] as const).map(([label, value, delta, inverted]) =>
                    m("span", { key: label, className: "text-stone-500 dark:text-stone-400 whitespace-nowrap" }, [
                      `${label} `,
                      m("span", { className: "font-mono text-stone-800 dark:text-stone-100" }, fmtSize(value * 1024)),
                      delta != null && delta !== 0 && (
                        m("span", {
                          className: `font-mono ml-1 ${(inverted ? -delta : delta) > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`,
                        }, fmtDelta(delta))
                      ),
                    ]),
                  ),
                  globalMemInfo.swapTotalKb > 0 && (
                    m("span", { className: "text-stone-500 dark:text-stone-400 whitespace-nowrap" }, [
                      "ZRAM ",
                      m("span", { className: "font-mono text-stone-800 dark:text-stone-100" }, [
                        fmtSize(globalMemInfo.zramPhysicalKb * 1024),
                        " / ",
                        fmtSize(globalMemInfo.swapTotalKb * 1024),
                      ]),
                      globalMemInfoDiff && globalMemInfoDiff.deltaZramPhysicalKb !== 0 && (
                        m("span", {
                          className: `font-mono ml-1 ${globalMemInfoDiff.deltaZramPhysicalKb > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`,
                        }, fmtDelta(globalMemInfoDiff.deltaZramPhysicalKb))
                      ),
                    ])
                  ),
                ]),
              ])
            ),

            // Process list
            sorted === null ? (
              m("div", { className: "text-stone-400 dark:text-stone-500 p-4" }, "Loading processes\u2026")
            ) : sorted.length === 0 ? (
              m("div", { className: "text-stone-400 dark:text-stone-500 p-4 flex items-center gap-3" }, [
                "No processes found.",
                m("button", {
                  className: "text-sky-700 dark:text-sky-400 underline decoration-sky-300 dark:decoration-sky-600",
                  onclick: refreshProcesses,
                }, "Refresh"),
              ])
            ) : (
              m("div", { className: "bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 overflow-x-auto" }, [
                m("table", { className: "w-full min-w-[700px] text-sm" }, [
                  m("thead", [
                    m("tr", { className: "bg-stone-50 dark:bg-stone-800 border-b border-stone-200 dark:border-stone-700" }, [
                      m("th", { className: "py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium w-[120px]" }),
                      m("th", {
                        className: "text-left py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium w-14 cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200",
                        onclick: () => sort.toggle("pid"),
                      }, `PID ${sort.field === "pid" ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                      m("th", {
                        className: "text-left py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200",
                        onclick: () => sort.toggle("name"),
                      }, `Process ${sort.field === "name" ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                      hasOomLabel && (
                        m("th", {
                          className: "text-left py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-200",
                          onclick: () => sort.toggle("oomLabel"),
                        }, `State ${sort.field === "oomLabel" ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`)
                      ),
                      ROLLUP_COLUMNS.map(([field, label]) =>
                        m("th", {
                          key: field,
                          className: "text-right py-1.5 px-2 text-stone-500 dark:text-stone-400 text-xs font-medium w-20 cursor-pointer select-none whitespace-nowrap hover:text-stone-700 dark:hover:text-stone-200",
                          onclick: () => sort.toggle(field),
                        }, `${label} ${sort.field === field ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                      ),
                    ]),
                  ]),
                  m("tbody", [
                    // Totals row
                    m("tr", { className: "border-b-2 border-stone-300 dark:border-stone-600 font-semibold bg-stone-50 dark:bg-stone-800" }, [
                      m("td", {
                        className: "py-1 px-2 text-stone-600 dark:text-stone-300",
                        colSpan: hasOomLabel ? 4 : 3,
                      }, `Total (${processTotals.count})`),
                      ROLLUP_COLUMNS.map(([f]) =>
                        m("td", {
                          key: f,
                          className: "py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem]",
                        }, processTotals.values[f] > 0 ? fmtSize(processTotals.values[f] * 1024) : "\u2014"),
                      ),
                    ]),
                    (diffMode && sortedDiffs ? sortedDiffs : (sorted ?? []).map(p => ({ status: "matched" as const, current: p, prev: null, deltaPssKb: 0, deltaRssKb: 0, deltaJavaHeapKb: 0, deltaNativeHeapKb: 0, deltaGraphicsKb: 0, deltaCodeKb: 0 }))).map(d => {
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
                      return m(Fragment, { key: rowKey }, [
                        m("tr", {
                          className: `border-t border-stone-100 dark:border-stone-800 cursor-pointer ${
                            d.status === "removed" ? "opacity-60" :
                            d.status === "added" ? "bg-green-50/50 dark:bg-green-900/30" :
                            isSmapsExpanded ? "bg-sky-50 dark:bg-sky-900/20" : "hover:bg-stone-50 dark:hover:bg-stone-800"
                          }`,
                          onclick: () => {
                            if (d.status === "removed") return;
                            if (isExpanded) {
                              expandedSmapsPid = null;
                              expandedSmapsGroup = null;
                            } else if (conn.isRoot) {
                              expandedSmapsPid = p.pid;
                              expandedSmapsGroup = null;
                              if (!hasSmaps) fetchSmapsOnDemand(p.pid);
                            }
                          },
                        }, [
                          m("td", { className: "py-1 px-2 text-center whitespace-nowrap" }, [
                            d.status !== "removed" && canCapture && (
                              m(DumpButton, {
                                pid: p.pid,
                                job: captureJobs.get(p.pid),
                                disabled: !connected,
                                onDump: startCapture,
                                onCancel: cancelCapture,
                              })
                            ),
                          ]),
                          m("td", { className: "py-1 px-2 font-mono text-stone-400 dark:text-stone-500 whitespace-nowrap" }, [
                            conn.isRoot && d.status !== "removed" && (
                              m("span", { className: "text-stone-400 dark:text-stone-500 mr-1" }, isSmapsExpanded ? "\u25BC" : isSmapsLoading ? "\u2026" : "\u25B6")
                            ),
                            String(p.pid),
                          ]),
                          m("td", {
                            className: `py-1 px-2 text-stone-800 dark:text-stone-100 truncate max-w-[400px] ${d.status === "removed" ? "line-through" : ""}`,
                            title: p.name,
                          }, [
                            p.name,
                            isDiff && d.status !== "matched" && (
                              m("span", {
                                className: `ml-2 text-[10px] font-medium ${d.status === "added" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`,
                              }, d.status === "added" ? "NEW" : "GONE")
                            ),
                          ]),
                          hasOomLabel && (
                            m("td", { className: "py-1 px-2 text-stone-500 dark:text-stone-400 text-xs whitespace-nowrap" }, [
                              p.oomLabel,
                              isDiff && d.prev && d.prev.oomLabel !== p.oomLabel && (
                                m("span", {
                                  className: "ml-1 text-amber-600 dark:text-amber-400",
                                  title: `was: ${d.prev.oomLabel || "(none)"}`,
                                }, `\u2190 ${d.prev.oomLabel || "\u2014"}`)
                              ),
                            ])
                          ),
                          ROLLUP_COLUMNS.map(([f]) => {
                            const value = getFieldValue(p, f, rollup);
                            const delta = isDiff && prevRollup && rollup ? rollup[f] - prevRollup[f] : 0;
                            return m("td", {
                              key: f,
                              className: `py-1 px-2 text-right font-mono whitespace-nowrap min-w-[5rem] ${isDiff ? deltaBgClass(delta) : ""}`,
                            }, [
                              value > 0 ? fmtSize(value * 1024) : "\u2014",
                              isDiff && delta !== 0 && (
                                m("span", {
                                  className: `ml-1 text-[10px] ${delta > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`,
                                }, fmtDelta(delta))
                              ),
                            ]);
                          }),
                        ]),
                        isSmapsLoading && (
                          m("tr", [
                            m("td", {
                              colSpan: colCount,
                              className: "p-2 text-xs text-stone-400 dark:text-stone-500 animate-pulse border-t border-stone-200 dark:border-stone-700",
                            }, "Fetching process smaps\u2026"),
                          ])
                        ),
                        isSmapsExpanded && d.status !== "removed" && (
                          m(SmapsSubTable, {
                            pid: p.pid,
                            processName: p.name,
                            aggregated: smapsData.get(p.pid)!,
                            expandedGroup: expandedSmapsGroup,
                            onToggleGroup: (name: string) => { expandedSmapsGroup = expandedSmapsGroup === name ? null : name; },
                            sortField: smapsSort.field,
                            sortAsc: smapsSort.asc,
                            onToggleSort: (f: SmapsSortFieldType) => smapsSort.toggle(f),
                            vmaSortField: vmaSort.field,
                            vmaSortAsc: vmaSort.asc,
                            onToggleVmaSort: (f: VmaSortFieldType) => vmaSort.toggle(f),
                            onDump: handleVmaDump,
                            dumpDisabled: !connected || !!vmaDumpStatus,
                            smapsDiffs: isDiff && prevSmapsData.has(p.pid) ? diffSmaps(prevSmapsData.get(p.pid)!, smapsData.get(p.pid)!) : null,
                            prevAggregated: isDiff && prevSmapsData.has(p.pid) ? prevSmapsData.get(p.pid)! : null,
                            leadingColCount: 3 + (hasOomLabel ? 1 : 0),
                          })
                        ),
                      ]);
                    }),
                  ]),
                ]),
              ])
            ),

            // Scan All VMAs / Shared Mappings
            conn.isRoot && processes && processes.length > 0 && (
              m("div", { className: "mt-4" }, [
                smapsData.size < (processes?.length ?? 0) && (
                  m("button", {
                    className: "text-xs text-sky-600 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 border border-sky-300 dark:border-sky-600 px-2 py-0.5 mb-2",
                    onclick: scanStatus ? cancelSmapsFetch : scanAllSmaps,
                    disabled: !connected || !!vmaDumpStatus,
                  }, scanStatus ? `Cancel Scan (${smapsData.size}/${processes?.length ?? 0})` : `Scan All VMAs (${smapsData.size}/${processes?.length ?? 0})`)
                ),
                sharedMappings && sharedMappings.length > 0 && (
                  m(SharedMappingsTable, {
                    mappings: sharedMappings,
                    loadedCount: smapsData.size,
                    loading: scanStatus !== null,
                    diffs: sharedMappingDiffs,
                    smapsData,
                    onDump: handleVmaDump,
                    dumpDisabled: !connected || !!vmaDumpStatus,
                  })
                ),
              ])
            ),
          ])
        ),

        error && (
          m("div", {
            className: "mt-4 p-3 bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-sm",
          }, error)
        ),
      ]);
    },
  };
}

export default CaptureView;
