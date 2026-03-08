import m from "mithril";
import { Fragment } from "../mithril-helpers";
import { AdbConnection, PINNED_PROCESSES, type ProcessInfo, type CapturePhase, type SmapsAggregated, type SmapsEntry, type SmapsRollup, type SharedMapping, type SharedMappingDiff, type GlobalMemInfo, type ProcessDiff, type GlobalMemInfoDiff, type SmapsDiff, type SmapsEntryDiff, diffProcesses, diffGlobalMemInfo, diffSmaps, diffSmapsEntries, aggregateSmaps, aggregateSharedMappings, diffSharedMappings } from "../adb/capture";
import { fmtSize, fmtDelta, deltaBgClass } from "../format";
import { sortWithDiffPinning, computeSmapsTotals, SMAPS_COLUMNS, SMAPS_DELTA_KEY, timelineClick, deleteSnapshotState, type TimelineState, type SmapsNumericField, type SmapsDeltaKey } from "./capture-helpers";

type SmapsSortFieldType = SmapsNumericField | SmapsDeltaKey | "count";
type VmaSortFieldType = SmapsNumericField | SmapsDeltaKey | "addrStart";

const DELTA_KEYS = new Set<string>(Object.values(SMAPS_DELTA_KEY));
function isDeltaKey(f: string): f is SmapsDeltaKey { return DELTA_KEYS.has(f); }

function makeSort<F extends string>(initial: F) {
  let field = initial;
  let asc = false;
  let userSorted = false;
  return {
    get field() { return field; },
    get asc() { return asc; },
    get userSorted() { return userSorted; },
    toggle(f: F) {
      userSorted = true;
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
  showDeltaCols: boolean;
  leadingColCount: number;
}> = {
  view(vnode) {
    const { entries, groupName, pid, processName, sortField, sortAsc, onToggleSort, onDump, dumpDisabled, entryDiffs, showDeltaCols, leadingColCount } = vnode.attrs;

    const diffByAddr: Map<string, SmapsEntryDiff> | null = entryDiffs
      ? new Map(entryDiffs.map(d => [d.current.addrStart, d] as const))
      : null;

    const sorted = (() => {
      const cmp = (a: SmapsEntry, b: SmapsEntry) => {
        if (sortField === "addrStart") {
          return sortAsc ? a.addrStart.localeCompare(b.addrStart) : b.addrStart.localeCompare(a.addrStart);
        }
        if (isDeltaKey(sortField)) {
          if (!diffByAddr) return 0;
          const aD = diffByAddr.get(a.addrStart)?.[sortField] ?? 0;
          const bD = diffByAddr.get(b.addrStart)?.[sortField] ?? 0;
          return sortAsc ? aD - bD : bD - aD;
        }
        const f = sortField;
        return sortAsc ? a[f] - b[f] : b[f] - a[f];
      };
      return sortWithDiffPinning(entries, entryDiffs, cmp);
    })();

    return m(Fragment, [
      m("tr", { className: "ah-vma-header" }, [
        m("td", { colSpan: leadingColCount, className: "ah-vma-th", style: { paddingLeft: "2rem" } }, [
          m("span", {
            className: "ah-smaps-action",
            style: { cursor: "pointer", fontWeight: 500 },
            onclick: () => onToggleSort("addrStart"),
          }, `Address ${sortField === "addrStart" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
          m("span", { style: { marginLeft: "0.75rem", color: "var(--ah-text-faint)", fontSize: "10px" } }, "Perms"),
          m("button", {
            className: "ah-smaps-action",
            style: { marginLeft: "0.75rem" },
            disabled: dumpDisabled,
            title: "Dump all VMA memory in this group",
            onclick: () => onDump(pid, processName, groupName, entries.map(e => ({ addrStart: e.addrStart, addrEnd: e.addrEnd }))),
          }, "dump all"),
        ]),
        SMAPS_COLUMNS.flatMap(([f, label]) => {
          const cells = [
            m("td", {
              key: f,
              className: "ah-vma-td--right ah-smaps-th--sortable",
              style: { fontWeight: 500 },
              onclick: () => onToggleSort(f),
            }, `${label} ${sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
          ];
          if (showDeltaCols) {
            const dk = SMAPS_DELTA_KEY[f];
            cells.push(m("td", {
              key: dk,
              className: "ah-vma-td--right ah-smaps-th--sortable",
              style: { fontWeight: 500 },
              onclick: () => onToggleSort(dk),
            }, `\u0394 ${label} ${sortField === dk ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`));
          }
          return cells;
        }),
      ]),
      sorted.map((e, i) => {
        const ed = diffByAddr?.get(e.addrStart);
        return m("tr", {
          key: i,
          className: `ah-vma-row${
            ed?.status === "removed" ? " ah-vma-row--removed" :
            ed?.status === "added" ? " ah-vma-row--added" : ""
          }`,
        }, [
          m("td", {
            colSpan: leadingColCount,
            className: `ah-vma-td${ed?.status === "removed" ? " ah-line-through" : ""}`,
            style: { paddingLeft: "2rem" },
          }, [
            `${e.addrStart}-${e.addrEnd}`,
            m("span", { style: { marginLeft: "0.5rem", color: "var(--ah-text-faint)" } }, e.perms),
            ed && ed.status !== "matched" && (
              m("span", {
                className: ed.status === "added" ? "ah-status-new" : "ah-status-gone",
                style: { marginLeft: "0.5rem" },
              }, ed.status === "added" ? "NEW" : "GONE")
            ),
            m("button", {
              className: "ah-smaps-action",
              style: { marginLeft: "0.5rem" },
              disabled: dumpDisabled || ed?.status === "removed",
              title: "Dump this VMA",
              onclick: () => onDump(pid, processName, `${groupName}_${e.addrStart}-${e.addrEnd}`, [{ addrStart: e.addrStart, addrEnd: e.addrEnd }]),
            }, "dump"),
          ]),
          SMAPS_COLUMNS.flatMap(([f]) => {
            const cells = [
              m("td", {
                key: f,
                className: "ah-vma-td--right",
              }, e[f] > 0 ? fmtSize(e[f] * 1024) : "\u2014"),
            ];
            if (showDeltaCols) {
              const delta = ed ? ed[SMAPS_DELTA_KEY[f]] : 0;
              cells.push(m("td", {
                key: `d-${f}`,
                className: `ah-vma-td--right ${ed ? deltaBgClass(delta) : ""}`,
              }, delta !== 0 ? m("span", {
                className: delta > 0 ? "ah-delta-pos" : "ah-delta-neg",
              }, fmtDelta(delta)) : "\u2014"));
            }
            return cells;
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
  showDeltaCols: boolean;
  leadingColCount: number;
}> = {
  view(vnode) {
    const { pid, processName, aggregated, expandedGroup, onToggleGroup, sortField, sortAsc, onToggleSort, vmaSortField, vmaSortAsc, onToggleVmaSort, onDump, dumpDisabled, smapsDiffs, prevAggregated, showDeltaCols, leadingColCount } = vnode.attrs;

    const diffByName: Map<string, SmapsDiff> | null = smapsDiffs
      ? new Map(smapsDiffs.map(d => [d.current.name, d] as const))
      : null;

    const prevByName: Map<string, SmapsAggregated> | null = prevAggregated
      ? new Map(prevAggregated.map(a => [a.name, a] as const))
      : null;

    const sorted = (() => {
      const cmp = (a: SmapsAggregated, b: SmapsAggregated) => {
        if (isDeltaKey(sortField)) {
          if (!diffByName) return 0;
          const aD = diffByName.get(a.name)?.[sortField] ?? 0;
          const bD = diffByName.get(b.name)?.[sortField] ?? 0;
          return sortAsc ? aD - bD : bD - aD;
        }
        const f = sortField;
        return sortAsc ? a[f] - b[f] : b[f] - a[f];
      };
      return sortWithDiffPinning(aggregated, smapsDiffs, cmp);
    })();

    const totals = computeSmapsTotals(aggregated, smapsDiffs);

    return m(Fragment, [
      // Sub-table header
      m("tr", { className: "ah-smaps-header" }, [
        m("td", {
          colSpan: leadingColCount - 1,
          className: "ah-smaps-th",
          style: { paddingLeft: "1.5rem" },
        }, "Mapping"),
        m("td", {
          className: "ah-smaps-th--right ah-smaps-th--sortable",
          style: { paddingRight: "0.25rem" },
          onclick: () => onToggleSort("count"),
        }, `# ${sortField === "count" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
        SMAPS_COLUMNS.flatMap(([f, label]) => {
          const cells = [
            m("td", {
              key: f,
              className: "ah-smaps-th--right ah-smaps-th--sortable",
              onclick: () => onToggleSort(f),
            }, `${label} ${sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
          ];
          if (showDeltaCols) {
            const dk = SMAPS_DELTA_KEY[f];
            cells.push(m("td", {
              key: dk,
              className: "ah-smaps-th--right ah-smaps-th--sortable",
              onclick: () => onToggleSort(dk),
            }, `\u0394 ${label} ${sortField === dk ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`));
          }
          return cells;
        }),
      ]),
      // Totals row
      m("tr", { className: "ah-smaps-total-row" }, [
        m("td", {
          colSpan: leadingColCount,
          className: "ah-smaps-td",
          style: { paddingLeft: "1.5rem", color: "var(--ah-text-secondary)", fontSize: "0.75rem" },
        }, "Total"),
        SMAPS_COLUMNS.flatMap(([f]) => {
          const cells = [
            m("td", {
              key: f,
              className: "ah-smaps-td--right",
              style: { fontSize: "0.75rem" },
            }, totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014"),
          ];
          if (showDeltaCols) {
            const delta = totals[SMAPS_DELTA_KEY[f]];
            cells.push(m("td", {
              key: `d-${f}`,
              className: `ah-smaps-td--right ${deltaBgClass(delta)}`,
              style: { fontSize: "0.75rem" },
            }, delta !== 0 ? m("span", {
              className: delta > 0 ? "ah-delta-pos" : "ah-delta-neg",
            }, fmtDelta(delta)) : "\u2014"));
          }
          return cells;
        }),
      ]),
      sorted.map(g => {
        const sd = diffByName?.get(g.name);
        const prevEntries = sd && sd.status === "matched" && prevByName ? prevByName.get(g.name)?.entries ?? null : null;
        return m(Fragment, { key: g.name }, [
          m("tr", {
            className: `ah-smaps-row${
              sd?.status === "removed" ? " ah-smaps-row--removed" :
              sd?.status === "added" ? " ah-smaps-row--added" : ""
            }`,
            onclick: () => sd?.status !== "removed" && onToggleGroup(g.name),
          }, [
            m("td", {
              colSpan: leadingColCount - 1,
              className: `ah-smaps-td--name${sd?.status === "removed" ? " ah-line-through" : ""}`,
              style: { paddingLeft: "1.5rem" },
              title: g.name,
            }, [
              m("div", { className: "ah-smaps-td--name-inner" }, [
                m("span", { className: "ah-expander" }, expandedGroup === g.name ? "\u25BC" : "\u25B6"),
                m("span", { className: "ah-truncate", style: { maxWidth: "280px" } }, g.name),
                sd && sd.status !== "matched" && (
                  m("span", {
                    className: sd.status === "added" ? "ah-status-new" : "ah-status-gone",
                  }, sd.status === "added" ? "NEW" : "GONE")
                ),
                m("button", {
                  className: "ah-smaps-action",
                  disabled: dumpDisabled || sd?.status === "removed",
                  title: `Dump ${g.name} memory`,
                  onclick: (e: Event) => { e.stopPropagation(); onDump(pid, processName, g.name, g.entries.map(en => ({ addrStart: en.addrStart, addrEnd: en.addrEnd }))); },
                }, "dump"),
              ]),
            ]),
            m("td", { className: "ah-smaps-td--count" }, String(g.count)),
            SMAPS_COLUMNS.flatMap(([f]) => {
              const cells = [
                m("td", {
                  key: f,
                  className: "ah-smaps-td--right",
                }, g[f] > 0 ? fmtSize(g[f] * 1024) : "\u2014"),
              ];
              if (showDeltaCols) {
                const delta = sd ? sd[SMAPS_DELTA_KEY[f]] : 0;
                cells.push(m("td", {
                  key: `d-${f}`,
                  className: `ah-smaps-td--right ${sd ? deltaBgClass(delta) : ""}`,
                }, delta !== 0 ? m("span", {
                  className: delta > 0 ? "ah-delta-pos" : "ah-delta-neg",
                }, fmtDelta(delta)) : "\u2014"));
              }
              return cells;
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
              showDeltaCols,
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

      return m("div", { className: "ah-shared-mappings" }, [
        m("h3", { className: "ah-sub-heading" }, [
          "Shared Mappings",
          m("span", { style: { fontWeight: "normal", marginLeft: "0.5rem" } },
            `(${mappings.length} mappings across ${loadedCount} processes)`,
          ),
          loading && m("span", { className: "ah-animate-pulse", style: { marginLeft: "0.5rem", color: "var(--ah-link-alt)" } }, "loading\u2026"),
        ]),
        m("div", { className: "ah-shared-mappings__table-wrap" }, [
          m("table", { className: "ah-shared-mappings__table" }, [
            m("thead", { className: "ah-shared-mappings__thead" }, [
              m("tr", { style: { borderBottom: "1px solid var(--ah-border)" } }, [
                m("th", { className: "ah-smaps-th" }, "Mapping"),
                m("th", {
                  className: "ah-smaps-th--right ah-smaps-th--sortable",
                  style: { width: "2rem", paddingRight: "0.25rem" },
                  onclick: () => sort.toggle("processCount"),
                }, `Procs ${sort.field === "processCount" ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                SMAPS_COLUMNS.flatMap(([f, label]) => {
                  const cells = [
                    m("th", {
                      key: f,
                      className: "ah-smaps-th--right ah-smaps-th--sortable",
                      onclick: () => sort.toggle(f),
                    }, `${label} ${sort.field === f ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                  ];
                  if (diffs) {
                    cells.push(m("th", {
                      key: `d-${f}`,
                      className: "ah-smaps-th--right",
                      style: { color: "var(--ah-text-faint)" },
                    }, `\u0394 ${label}`));
                  }
                  return cells;
                }),
              ]),
            ]),
            m("tbody", [
              m("tr", { className: "ah-smaps-total-row" }, [
                m("td", { className: "ah-smaps-td", style: { color: "var(--ah-text-secondary)" } }, "Total"),
                m("td"),
                SMAPS_COLUMNS.flatMap(([f]) => {
                  const cells = [
                    m("td", {
                      key: f,
                      className: "ah-smaps-td--right",
                    }, totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014"),
                  ];
                  if (diffs) {
                    const delta = totals[SMAPS_DELTA_KEY[f]];
                    cells.push(m("td", {
                      key: `d-${f}`,
                      className: `ah-smaps-td--right ${deltaBgClass(delta)}`,
                    }, delta !== 0 ? m("span", {
                      className: delta > 0 ? "ah-delta-pos" : "ah-delta-neg",
                    }, fmtDelta(delta)) : "\u2014"));
                  }
                  return cells;
                }),
              ]),
              sorted.map((mp, i) => {
                const sd = diffByName?.get(mp.name);
                return m(Fragment, { key: `${mp.name}-${i}` }, [
                  m("tr", {
                    className: `ah-smaps-row${
                      sd?.status === "removed" ? " ah-smaps-row--removed" :
                      sd?.status === "added" ? " ah-smaps-row--added" : ""
                    }`,
                    onclick: () => sd?.status !== "removed" && (expandedMapping = expandedMapping === mp.name ? null : mp.name),
                  }, [
                    m("td", {
                      className: `ah-smaps-td--name${sd?.status === "removed" ? " ah-line-through" : ""}`,
                      title: mp.name,
                    }, [
                      m("div", { className: "ah-smaps-td--name-inner" }, [
                        m("span", { className: "ah-expander" }, expandedMapping === mp.name ? "\u25BC" : "\u25B6"),
                        m("span", { className: "ah-truncate", style: { maxWidth: "280px" } }, mp.name),
                        sd && sd.status !== "matched" && (
                          m("span", {
                            className: sd.status === "added" ? "ah-status-new" : "ah-status-gone",
                          }, sd.status === "added" ? "NEW" : "GONE")
                        ),
                      ]),
                    ]),
                    m("td", { className: "ah-smaps-td--count" }, String(mp.processCount)),
                    SMAPS_COLUMNS.flatMap(([f]) => {
                      const cells = [
                        m("td", {
                          key: f,
                          className: "ah-smaps-td--right",
                        }, mp[f] > 0 ? fmtSize(mp[f] * 1024) : "\u2014"),
                      ];
                      if (diffs) {
                        const delta = sd ? sd[SMAPS_DELTA_KEY[f]] : 0;
                        cells.push(m("td", {
                          key: `d-${f}`,
                          className: `ah-smaps-td--right ${sd ? deltaBgClass(delta) : ""}`,
                        }, delta !== 0 ? m("span", {
                          className: delta > 0 ? "ah-delta-pos" : "ah-delta-neg",
                        }, fmtDelta(delta)) : "\u2014"));
                      }
                      return cells;
                    }),
                  ]),
                  expandedMapping === mp.name && sd?.status !== "removed" && m(Fragment, [
                    m("tr", { className: "ah-vma-header" }, [
                      m("td", { className: "ah-smaps-th", style: { paddingLeft: "1.5rem" } }, "Process (PID)"),
                      m("td"),
                      SMAPS_COLUMNS.map(([, label]) =>
                        m("td", {
                          key: label,
                          className: "ah-smaps-th--right",
                        }, label),
                      ),
                    ]),
                    mp.processes.map(p => {
                      const procAgg = smapsData.get(p.pid);
                      const matchedGroup = procAgg?.find(g => g.name === mp.name);
                      const regions = matchedGroup?.entries.map(e => ({ addrStart: e.addrStart, addrEnd: e.addrEnd }));
                      return m("tr", {
                        key: p.pid,
                        className: "ah-vma-row",
                      }, [
                        m("td", { className: "ah-vma-td", style: { paddingLeft: "1.5rem", color: "var(--ah-text-secondary)" } }, [
                          m("div", { className: "ah-smaps-td--name-inner" }, [
                            m("span", [
                              `${p.name} `,
                              m("span", { style: { color: "var(--ah-text-faint)" } }, `(${p.pid})`),
                            ]),
                            m("button", {
                              className: "ah-smaps-action",
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
                            className: "ah-vma-td--right",
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
          className: "ah-dump-btn--active",
          title: "Click to cancel",
          onclick: (e: Event) => { e.stopPropagation(); onCancel(pid); },
        }, pct ?? job.status);
      }

      return m("div", {
        className: "ah-dump-btn-wrap",
        oncreate: (v: m.VnodeDOM) => { containerEl = v.dom as HTMLDivElement; },
      }, [
        m("button", {
          className: "ah-dump-btn",
          disabled,
          title: "Dump Java heap",
          onclick: (e: Event) => { e.stopPropagation(); onDump(pid, false); },
        }, "Dump"),
        m("button", {
          className: "ah-dump-btn__caret",
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
            className: "ah-dump-btn__menu",
            style: { top: `${menuPos.top}px`, left: `${menuPos.left}px` },
          }, [
            m("button", {
              className: "ah-dump-btn__menu-item",
              onclick: (e: Event) => {
                e.stopPropagation();
                open = false;
                document.removeEventListener("mousedown", handleOutsideClick);
                document.removeEventListener("scroll", handleScroll, true);
                onDump(pid, false);
              },
            }, "Java dump"),
            m("button", {
              className: "ah-dump-btn__menu-item",
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

type SortField = "pid" | "name" | "oomLabel" | SmapsNumericField | SmapsDeltaKey;

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
  sessionFile?: File | null;
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
  let lastRefreshTs: number | null = null;

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

  // Snapshot history & diff state
  interface Snapshot {
    id: number;
    ts: number;
    processes: ProcessInfo[];
    globalMemInfo: GlobalMemInfo | null;
    smapsRollups: Map<number, SmapsRollup>;
    smapsData: Map<number, SmapsAggregated[]>;
  }
  const snapshots: Snapshot[] = [];
  let nextSnapId = 0;
  let diffMode = false;
  let diffBaseIdx: number | null = null; // index into snapshots for base (null = live)
  let viewSnapIdx: number | null = null; // which snapshot to display (null = live)
  let processDiffs: ProcessDiff[] | null = null;
  let globalMemInfoDiff: GlobalMemInfoDiff | null = null;
  let diffTriggered = false;

  function getBaseSnap(): Snapshot | null {
    if (!diffMode) return null;
    if (diffBaseIdx === null) {
      // Live is the diff base
      if (!processes) return null;
      return { id: -1, ts: Date.now(), processes, globalMemInfo, smapsRollups, smapsData };
    }
    return diffBaseIdx >= 0 && diffBaseIdx < snapshots.length ? snapshots[diffBaseIdx] : null;
  }

  function getViewSnap(): Snapshot | null {
    return viewSnapIdx !== null && viewSnapIdx >= 0 && viewSnapIdx < snapshots.length ? snapshots[viewSnapIdx] : null;
  }

  // Cached conn reference
  let conn: AdbConnection;

  function hideDiff() {
    diffMode = false;
    processDiffs = null;
    globalMemInfoDiff = null;
    diffTriggered = false;
  }

  /** Build current timeline state from closure vars. */
  function currentTimeline(): TimelineState {
    return { viewSnapIdx, diffBaseIdx, diffMode, count: snapshots.length };
  }

  /** CSS modifier for a timeline dot: green (active), blue (base), or none. */
  function dotColorClass(idx: number | null): string {
    const isViewing = viewSnapIdx === idx;
    const isBase = diffMode && diffBaseIdx === idx;
    return isViewing ? " ah-timeline__dot--active" : isBase ? " ah-timeline__dot--base" : "";
  }

  /** Is this dot the green (active) one? Used to short-circuit no-op clicks. */
  function isGreenDot(idx: number | null): boolean {
    return viewSnapIdx === idx && !(diffMode && diffBaseIdx === idx);
  }

  /** Apply a TimelineState result from timelineClick / deleteSnapshotState. */
  function applyTimelineState(next: { viewSnapIdx: number | null; diffBaseIdx: number | null; diffMode: boolean }) {
    viewSnapIdx = next.viewSnapIdx;
    diffBaseIdx = next.diffBaseIdx;
    if (!next.diffMode && diffMode) hideDiff();
    else diffMode = next.diffMode;
  }

  function deleteSnapshot(idx: number) {
    if (idx < 0 || idx >= snapshots.length) return;
    const next = deleteSnapshotState(currentTimeline(), idx);
    snapshots.splice(idx, 1);
    applyTimelineState(next);
  }

  // Session serialization — save/load snapshots + current live state
  interface SerializedSession {
    version: 1;
    deviceName: string;
    serial: string;
    savedAt: number;
    snapshots: {
      id: number;
      ts: number;
      processes: ProcessInfo[];
      globalMemInfo: GlobalMemInfo | null;
      smapsRollups: [number, SmapsRollup][];
      smapsData: [number, SmapsAggregated[]][];
    }[];
    live: {
      processes: ProcessInfo[] | null;
      globalMemInfo: GlobalMemInfo | null;
      smapsRollups: [number, SmapsRollup][];
      smapsData: [number, SmapsAggregated[]][];
      javaPids: number[];
    };
  }

  function exportSession() {
    const session: SerializedSession = {
      version: 1,
      deviceName: conn?.productName ?? "",
      serial: conn?.serial ?? "",
      savedAt: Date.now(),
      snapshots: snapshots.map(s => ({
        id: s.id,
        ts: s.ts,
        processes: s.processes,
        globalMemInfo: s.globalMemInfo,
        smapsRollups: [...s.smapsRollups],
        smapsData: [...s.smapsData],
      })),
      live: {
        processes,
        globalMemInfo,
        smapsRollups: [...smapsRollups],
        smapsData: [...smapsData],
        javaPids: [...javaPids],
      },
    };
    const json = JSON.stringify(session);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `ahat-session-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSession(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const session = JSON.parse(reader.result as string) as SerializedSession;
        if (session.version !== 1) throw new Error("Unsupported session version");
        // Restore snapshots
        snapshots.length = 0;
        for (const s of session.snapshots) {
          snapshots.push({
            id: s.id,
            ts: s.ts,
            processes: s.processes,
            globalMemInfo: s.globalMemInfo,
            smapsRollups: new Map(s.smapsRollups),
            smapsData: new Map(s.smapsData),
          });
        }
        nextSnapId = snapshots.length > 0 ? Math.max(...snapshots.map(s => s.id)) + 1 : 0;
        // Restore live state
        processes = session.live.processes;
        globalMemInfo = session.live.globalMemInfo;
        smapsRollups = new Map(session.live.smapsRollups);
        smapsData = new Map(session.live.smapsData);
        javaPids = new Set(session.live.javaPids);
        // Reset: view live, diff against latest snapshot
        lastRefreshTs = Date.now();
        viewSnapIdx = null;
        if (snapshots.length > 0) {
          diffBaseIdx = snapshots.length - 1;
          diffMode = true;
        } else {
          hideDiff();
        }
        error = null;
        m.redraw();
      } catch (e) {
        error = `Failed to load session: ${e instanceof Error ? e.message : String(e)}`;
        m.redraw();
      }
    };
    reader.readAsText(file);
  }

  // Recompute diffs progressively — process diffs update as enrichment runs.
  function recomputeDiffs() {
    const base = getBaseSnap();
    if (!base) { processDiffs = null; globalMemInfoDiff = null; return; }
    const viewSnap = getViewSnap();
    const rightProcs = viewSnap?.processes ?? processes;
    const rightMem = viewSnap?.globalMemInfo ?? globalMemInfo;
    if (base.processes && rightProcs) {
      processDiffs = diffProcesses(base.processes, rightProcs);
    }
    if (base.globalMemInfo && rightMem) {
      globalMemInfoDiff = diffGlobalMemInfo(base.globalMemInfo, rightMem);
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
    if (!diffTriggered) hideDiff();
    diffTriggered = false;
    const ac = new AbortController();
    enrichAbortCtrl = ac;
    lastRefreshTs = Date.now();
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

      // Fetch meminfo right away — it's cheap (single cat /proc/meminfo)
      if (conn.isRoot && !ac.signal.aborted) {
        try {
          const procInfo = await conn.getProcMeminfo(ac.signal);
          if (!ac.signal.aborted && procInfo.totalRamKb) {
            globalMemInfo = {
              totalRamKb: procInfo.totalRamKb ?? 0,
              freeRamKb: procInfo.freeRamKb ?? 0,
              memAvailableKb: procInfo.memAvailableKb ?? 0,
              buffersKb: procInfo.buffersKb ?? 0,
              cachedKb: procInfo.cachedKb ?? 0,
              shmemKb: procInfo.shmemKb ?? 0,
              slabKb: procInfo.slabKb ?? 0,
              swapTotalKb: procInfo.swapTotalKb ?? 0,
              swapFreeKb: procInfo.swapFreeKb ?? 0,
            };
            recomputeDiffs();
            m.redraw();
          }
        } catch { /* best-effort */ }
      }

      if (!conn.isRoot) {
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

      if (!ac.signal.aborted) {
        const { list: procList, rollups, javaPids: procJavaPids } = await conn.getProcessesFromProc(ac.signal);
        if (ac.signal.aborted) return;
        const oomByPid = new Map(lruList.map(p => [p.pid, p.oomLabel]));
        for (const p of procList) {
          const oom = oomByPid.get(p.pid);
          if (oom) p.oomLabel = oom;
        }
        const mergedJavaPids = new Set([...lruJavaPids, ...procJavaPids]);
        processes = procList;
        smapsRollups = rollups;
        javaPids = mergedJavaPids;
        recomputeDiffs();
        m.redraw();
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

  function handleSnapshot() {
    if (!processes) return;
    snapshots.push({
      id: nextSnapId++,
      ts: lastRefreshTs ?? Date.now(),
      processes: processes.map(p => ({ ...p })),
      globalMemInfo: globalMemInfo ? { ...globalMemInfo } : null,
      smapsRollups: new Map(smapsRollups),
      smapsData: new Map(smapsData),
    });
    // New snapshot becomes the diff base; live is the active view
    diffBaseIdx = snapshots.length - 1;
    diffMode = true;
    viewSnapIdx = null;
    diffTriggered = true;
    refreshProcesses();
  }

  async function handleConnect() {
    connectStatus = "Connecting\u2026";
    error = null;
    // Clear all snapshot state on reconnect
    snapshots.length = 0;
    nextSnapId = 0;
    viewSnapIdx = null;
    hideDiff();
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
    if (captureAbortCtrls.has(pid)) return;
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
  let _importedSessionFile: File | null = null;

  return {
    oninit(vnode) {
      conn = vnode.attrs.conn;
      _onCaptured = vnode.attrs.onCaptured;
      _onVmaDump = vnode.attrs.onVmaDump;
      if (vnode.attrs.sessionFile) {
        _importedSessionFile = vnode.attrs.sessionFile;
        importSession(vnode.attrs.sessionFile);
      }
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
      if (vnode.attrs.sessionFile && vnode.attrs.sessionFile !== _importedSessionFile) {
        _importedSessionFile = vnode.attrs.sessionFile;
        importSession(vnode.attrs.sessionFile);
      }

      recomputeDiffs();

      const baseSnap = getBaseSnap();
      const baseRollups = baseSnap?.smapsRollups ?? null;
      const baseSmapsData = baseSnap?.smapsData ?? null;
      const baseProcesses = baseSnap?.processes ?? null;

      // Display data: snapshot view or live
      const viewSnap = getViewSnap();
      const isLive = viewSnapIdx === null;
      const dProcs = viewSnap?.processes ?? processes;
      const dMemInfo = viewSnap?.globalMemInfo ?? globalMemInfo;
      const dRollups = viewSnap?.smapsRollups ?? smapsRollups;
      const dSmaps = viewSnap?.smapsData ?? smapsData;
      const pinProcesses = !sort.userSorted;

      const sorted = (() => {
        if (!dProcs) return null;
        const copy = [...dProcs];
        copy.sort((a, b) => {
          if (pinProcesses) {
            const aPin = PINNED_PROCESSES.has(a.name) ? 0 : 1;
            const bPin = PINNED_PROCESSES.has(b.name) ? 0 : 1;
            if (aPin !== bPin) return aPin - bPin;
          }
          if (sort.field === "name") {
            const cmp = a.name.localeCompare(b.name);
            return sort.asc ? cmp : -cmp;
          }
          if (sort.field === "oomLabel") {
            const cmp = a.oomLabel.localeCompare(b.oomLabel);
            return sort.asc ? cmp : -cmp;
          }
          if (sort.field === "pid") return sort.asc ? a.pid - b.pid : b.pid - a.pid;
          if (isDeltaKey(sort.field)) {
            const sf = sort.field;
            // Find the base field from the delta key
            const baseField = Object.entries(SMAPS_DELTA_KEY).find(([, dk]) => dk === sf)?.[0] as SmapsNumericField | undefined;
            if (!baseField) return 0;
            const aR = dRollups.get(a.pid);
            const bR = dRollups.get(b.pid);
            const aPR = baseRollups?.get(a.pid);
            const bPR = baseRollups?.get(b.pid);
            const aD = aR && aPR ? aR[baseField] - aPR[baseField] : 0;
            const bD = bR && bPR ? bR[baseField] - bPR[baseField] : 0;
            return sort.asc ? aD - bD : bD - aD;
          }
          const aVal = getFieldValue(a, sort.field, dRollups.get(a.pid));
          const bVal = getFieldValue(b, sort.field, dRollups.get(b.pid));
          return sort.asc ? aVal - bVal : bVal - aVal;
        });
        return copy;
      })();

      const sortedDiffs = (() => {
        if (!processDiffs) return null;
        const copy = [...processDiffs];
        copy.sort((a, b) => {
          if (pinProcesses) {
            const aPin = PINNED_PROCESSES.has(a.current.name) ? 0 : 1;
            const bPin = PINNED_PROCESSES.has(b.current.name) ? 0 : 1;
            if (aPin !== bPin) return aPin - bPin;
          }
          if (sort.field === "name") {
            const cmp = a.current.name.localeCompare(b.current.name);
            return sort.asc ? cmp : -cmp;
          }
          if (sort.field === "oomLabel") {
            const cmp = a.current.oomLabel.localeCompare(b.current.oomLabel);
            return sort.asc ? cmp : -cmp;
          }
          if (sort.field === "pid") return sort.asc ? a.current.pid - b.current.pid : b.current.pid - a.current.pid;
          if (isDeltaKey(sort.field)) {
            const sf = sort.field;
            const baseField = Object.entries(SMAPS_DELTA_KEY).find(([, dk]) => dk === sf)?.[0] as SmapsNumericField | undefined;
            if (!baseField) return 0;
            const aR = dRollups.get(a.current.pid);
            const bR = dRollups.get(b.current.pid);
            const aPR = baseRollups?.get(a.current.pid);
            const bPR = baseRollups?.get(b.current.pid);
            const aD = aR && aPR ? aR[baseField] - aPR[baseField] : 0;
            const bD = bR && bPR ? bR[baseField] - bPR[baseField] : 0;
            return sort.asc ? aD - bD : bD - aD;
          }
          const aVal = getFieldValue(a.current, sort.field, dRollups.get(a.current.pid));
          const bVal = getFieldValue(b.current, sort.field, dRollups.get(b.current.pid));
          return sort.asc ? aVal - bVal : bVal - aVal;
        });
        return copy;
      })();

      const sharedMappings = (() => {
        if (dSmaps.size === 0 || !dProcs) return null;
        return aggregateSharedMappings(dSmaps, dProcs);
      })();

      const prevSharedMappings = (() => {
        if (!baseSmapsData || baseSmapsData.size === 0 || !baseProcesses) return null;
        return aggregateSharedMappings(baseSmapsData, baseProcesses);
      })();

      const sharedMappingDiffs = (() => {
        if (!diffMode || !sharedMappings || !prevSharedMappings) return null;
        return diffSharedMappings(prevSharedMappings, sharedMappings);
      })();

      const hasOomLabel = dProcs ? dProcs.some(p => p.oomLabel !== "") : false;

      const processTotals = (() => {
        const activeProcs = (sorted ?? []).filter(p => !(diffMode && sortedDiffs?.find(d => d.current.pid === p.pid && d.status === "removed")));
        const totals: Record<string, number> = {};
        for (const [f] of ROLLUP_COLUMNS) totals[f] = 0;
        for (const p of activeProcs) {
          const r = dRollups.get(p.pid);
          for (const [f] of ROLLUP_COLUMNS) totals[f] += getFieldValue(p, f, r);
        }
        return { count: activeProcs.length, values: totals };
      })();

      const hasWebUsb = typeof navigator !== "undefined" && "usb" in navigator;

      if (!hasWebUsb) {
        return m("div", { className: "ah-no-webusb" }, [
          m("p", { className: "ah-no-webusb__title" }, "WebUSB is not available."),
          m("p", { className: "ah-no-webusb__hint" }, "Use Chrome or Edge over HTTPS/localhost."),
        ]);
      }

      return m("div", [
        // Connection
        !connected && !processes && (
          m("div", { className: "ah-capture-connect" }, [
            m("button", {
              className: "ah-capture-connect__btn",
              onclick: handleConnect,
              disabled: connectStatus !== null,
            }, connectStatus ?? "Connect USB Device"),
            m("p", { className: "ah-capture-connect__hint" }, [
              "Enable USB debugging on device. If ADB is running, stop it first: ",
              m("code", "adb kill-server"),
            ]),
            m("label", {
              className: "ah-capture-connect__load",
            }, [
              "or load a saved session",
              m("input", {
                type: "file",
                accept: ".json",
                style: { display: "none" },
                onchange: (e: Event) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) importSession(file);
                  (e.target as HTMLInputElement).value = "";
                },
              }),
            ]),
          ])
        ),
        (connected || processes) && (
          m("div", [
            m("div", { className: "ah-capture-toolbar" }, [
              connected ? m(Fragment, [
                m("span", { className: "ah-capture-toolbar__device" }, conn.productName),
                m("span", { className: "ah-capture-toolbar__serial" }, conn.serial),
              ]) : (
                m("span", { className: "ah-capture-toolbar__disconnected" }, "Disconnected")
              ),
              m("span", { className: "ah-capture-toolbar__spacer" }),
              connected && processes && !enrichStatus && (
                m("button", {
                  className: "ah-capture-toolbar__btn--accent",
                  onclick: handleSnapshot,
                }, "Snapshot")
              ),
              snapshots.length > 0 && !enrichStatus && (
                m("button", {
                  className: diffMode ? "ah-capture-toolbar__btn--warning" : "ah-capture-toolbar__btn",
                  onclick: () => {
                    if (diffMode) { hideDiff(); return; }
                    if (diffBaseIdx === null || diffBaseIdx >= snapshots.length) diffBaseIdx = snapshots.length - 1;
                    diffMode = true;
                  },
                }, diffMode ? "Hide Diff" : "Show Diff")
              ),
              m("button", {
                className: "ah-capture-toolbar__btn",
                onclick: refreshProcesses,
                disabled: !connected,
              }, enrichStatus && !diffMode ? "Refreshing\u2026" : enrichStatus && diffMode ? "Scanning\u2026" : "Refresh"),
              processes && m("span", { className: "ah-capture-toolbar__divider" }),
              processes && m("button", {
                className: "ah-capture-toolbar__btn",
                onclick: exportSession,
              }, "Save"),
              !connected && m("span", { className: "ah-capture-toolbar__divider" }),
              !connected && m("label", { className: "ah-capture-toolbar__btn ah-capture-toolbar__file-label" }, [
                "Load",
                m("input", {
                  type: "file",
                  accept: ".json",
                  style: { display: "none" },
                  onchange: (e: Event) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) importSession(file);
                    (e.target as HTMLInputElement).value = "";
                  },
                }),
              ]),
              m("span", { className: "ah-capture-toolbar__divider" }),
              connected ? (
                m("button", {
                  className: "ah-capture-toolbar__btn",
                  onclick: handleDisconnect,
                }, "Disconnect")
              ) : (
                m("button", {
                  className: "ah-capture-toolbar__btn--connect",
                  onclick: handleConnect,
                  disabled: connectStatus !== null,
                }, connectStatus ?? "Reconnect")
              ),
            ]),

            // Snapshot timeline
            snapshots.length > 0 && (
              m("div", { className: "ah-timeline" },
                m("div", { className: "ah-timeline__track" },
                  snapshots.map((snap, i) => {
                    const time = new Date(snap.ts);
                    const label = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}`;
                    const color = dotColorClass(i);
                    return m(Fragment, { key: snap.id }, [
                      i > 0 && m("div", { className: "ah-timeline__segment" }),
                      m("button", {
                        className: `ah-timeline__dot${color}`,
                        onclick: () => applyTimelineState(timelineClick(currentTimeline(), i)),
                        title: `Snapshot ${i + 1} \u2014 ${label}${color ? ` (${color.includes("active") ? "viewing" : "diff base"})` : ""}`,
                      }, [
                        m("div", { className: "ah-timeline__dot-circle" }),
                        m("div", { className: "ah-timeline__dot-label" }, label),
                        m("button", {
                          className: "ah-timeline__dot-delete",
                          onclick: (e: Event) => { e.stopPropagation(); deleteSnapshot(i); },
                          title: "Delete snapshot",
                        }, "\u00D7"),
                      ]),
                    ]);
                  }),
                  // Live dot — same click rules as snapshot dots
                  m("div", { className: "ah-timeline__segment" }),
                  (() => {
                    const t = lastRefreshTs ? new Date(lastRefreshTs) : null;
                    const label = t
                      ? `${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}`
                      : "now";
                    return m("button", {
                      className: `ah-timeline__dot${dotColorClass(null)}`,
                      onclick: () => {
                        if (isGreenDot(null)) return;
                        applyTimelineState(timelineClick(currentTimeline(), null));
                      },
                      title: `Latest \u2014 ${label}`,
                    }, [
                      m("div", { className: "ah-timeline__dot-circle" }),
                      m("div", { className: "ah-timeline__dot-label" }, label),
                    ]);
                  })(),
                ),
              )
            ),

            // Non-root banner
            connected && !conn.isRoot && processes && (
              m("div", { className: "ah-warning-banner" }, "Non-rooted device \u2014 only debuggable apps can be captured")
            ),

            // VMA dump progress
            vmaDumpStatus && (
              m("div", { className: "ah-capture-progress" }, [
                m("div", { className: "ah-capture-progress__row" }, [
                  m("span", { className: "ah-capture-progress__text" }, vmaDumpStatus),
                  m("button", {
                    className: "ah-capture-progress__cancel",
                    onclick: cancelVmaDump,
                  }, "Cancel"),
                ]),
              ])
            ),

            // Enrichment progress
            enrichStatus && (
              m("div", { className: "ah-capture-progress" }, [
                m("div", { className: "ah-capture-progress__row" }, [
                  m("span", { className: "ah-capture-progress__text" }, diffMode ? `Snapshot: ${enrichStatus}` : enrichStatus),
                  enrichProgress && m("span", { className: "ah-capture-progress__count" }, `${enrichProgress.done}/${enrichProgress.total}`),
                  m("button", {
                    className: "ah-capture-progress__cancel",
                    onclick: cancelEnrichment,
                  }, "Cancel"),
                ]),
                enrichProgress && enrichProgress.total > 0 && (
                  m("div", { className: "ah-capture-progress-bar" }, [
                    m("div", {
                      className: "ah-capture-progress-bar__fill ah-capture-progress-bar__fill--accent",
                      style: { width: `${(enrichProgress.done / enrichProgress.total) * 100}%` },
                    }),
                  ])
                ),
              ])
            ),

            // VMA scan progress
            scanStatus && (
              m("div", { className: "ah-capture-progress" }, [
                m("div", { className: "ah-capture-progress__row" }, [
                  m("span", { className: "ah-capture-progress__text" }, `Scanning: ${scanStatus}`),
                  scanProgress && m("span", { className: "ah-capture-progress__count" }, `${scanProgress.done}/${scanProgress.total}`),
                  m("button", {
                    className: "ah-capture-progress__cancel",
                    onclick: cancelSmapsFetch,
                  }, "Cancel"),
                ]),
                scanProgress && scanProgress.total > 0 && (
                  m("div", { className: "ah-capture-progress-bar" }, [
                    m("div", {
                      className: "ah-capture-progress-bar__fill ah-capture-progress-bar__fill--warning",
                      style: { width: `${(scanProgress.done / scanProgress.total) * 100}%` },
                    }),
                  ])
                ),
              ])
            ),

            // Global memory summary
            dMemInfo && (
              m("div", { className: "ah-global-mem" }, [
                m("div", { className: "ah-global-mem__inner" }, [
                  (() => {
                    const g = dMemInfo!;
                    const d = globalMemInfoDiff;
                    const usedKb = g.totalRamKb - g.memAvailableKb;
                    const deltaUsedKb = d ? d.deltaTotalRamKb - d.deltaMemAvailableKb : 0;
                    const items: [string, number, number, boolean | null][] = [
                      ["Total", g.totalRamKb, d?.deltaTotalRamKb ?? 0, null],
                      ["Used", usedKb, deltaUsedKb, false],
                      ["Free", g.freeRamKb, d?.deltaFreeRamKb ?? 0, true],
                      ["Available", g.memAvailableKb, d?.deltaMemAvailableKb ?? 0, true],
                      ["Cached", g.cachedKb + g.buffersKb, d ? d.deltaCachedKb + d.deltaBuffersKb : 0, null],
                      ["Shmem", g.shmemKb, d?.deltaShmemKb ?? 0, false],
                      ["Slab", g.slabKb, d?.deltaSlabKb ?? 0, false],
                    ];
                    return items.map(([label, value, delta, inverted]) =>
                      m("span", { key: label, className: "ah-global-mem__item" }, [
                        `${label} `,
                        m("span", { className: "ah-global-mem__value" }, fmtSize(value * 1024)),
                        delta !== 0 && (
                          m("span", {
                            className: `ah-mono ah-ml-1${inverted !== null ? ` ${(inverted ? -delta : delta) > 0 ? "ah-delta-pos" : "ah-delta-neg"}` : ""}`,
                          }, fmtDelta(delta))
                        ),
                      ]),
                    );
                  })(),
                  dMemInfo.swapTotalKb > 0 && (
                    m("span", { className: "ah-global-mem__item" }, [
                      "Swap ",
                      m("span", { className: "ah-global-mem__value" }, [
                        fmtSize((dMemInfo.swapTotalKb - dMemInfo.swapFreeKb) * 1024),
                        " / ",
                        fmtSize(dMemInfo.swapTotalKb * 1024),
                      ]),
                      globalMemInfoDiff && globalMemInfoDiff.deltaSwapFreeKb !== 0 && (
                        m("span", { className: "ah-mono ah-ml-1" }, fmtDelta(-globalMemInfoDiff.deltaSwapFreeKb))
                      ),
                    ])
                  ),
                ]),
              ])
            ),

            // Process list
            sorted === null ? (
              m("div", { className: "ah-loading" }, "Loading processes\u2026")
            ) : sorted.length === 0 ? (
              m("div", { className: "ah-loading", style: { display: "flex", alignItems: "center", gap: "0.75rem" } }, [
                "No processes found.",
                m("button", {
                  className: "ah-link",
                  onclick: refreshProcesses,
                }, "Refresh"),
              ])
            ) : (
              m("div", { className: "ah-capture-table-wrap" }, [
                m("table", { className: "ah-capture-table" }, [
                  m("thead", [
                    m("tr", { className: "ah-capture-table-header" }, [
                      m("th", { className: "ah-capture-th", style: { width: "120px" } }),
                      m("th", {
                        className: "ah-capture-th ah-capture-th--sortable",
                        style: { textAlign: "left", width: "3.5rem" },
                        onclick: () => sort.toggle("pid"),
                      }, `PID ${sort.field === "pid" ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                      m("th", {
                        className: "ah-capture-th ah-capture-th--sortable",
                        style: { textAlign: "left" },
                        onclick: () => sort.toggle("name"),
                      }, `Process ${sort.field === "name" ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                      hasOomLabel && (
                        m("th", {
                          className: "ah-capture-th ah-capture-th--sortable",
                          style: { textAlign: "left" },
                          onclick: () => sort.toggle("oomLabel"),
                        }, `State ${sort.field === "oomLabel" ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`)
                      ),
                      ROLLUP_COLUMNS.flatMap(([field, label]) => {
                        const cells = [
                          m("th", {
                            key: field,
                            className: "ah-capture-th ah-capture-th--sortable ah-capture-th--right",
                            onclick: () => sort.toggle(field),
                          }, `${label} ${sort.field === field ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`),
                        ];
                        if (diffMode) {
                          const dk = SMAPS_DELTA_KEY[field];
                          cells.push(m("th", {
                            key: dk,
                            className: "ah-capture-th ah-capture-th--sortable ah-capture-th--right",
                            onclick: () => sort.toggle(dk),
                          }, `\u0394 ${label} ${sort.field === dk ? (sort.asc ? "\u25B2" : "\u25BC") : ""}`));
                        }
                        return cells;
                      }),
                    ]),
                  ]),
                  m("tbody", [
                    // Totals row
                    m("tr", { className: "ah-capture-totals-row" }, [
                      m("td", {
                        className: "ah-capture-td",
                        style: { color: "var(--ah-text-secondary)" },
                        colSpan: hasOomLabel ? 4 : 3,
                      }, `Total (${processTotals.count})`),
                      ROLLUP_COLUMNS.flatMap(([f]) => {
                        const cells = [
                          m("td", {
                            key: f,
                            className: "ah-capture-td--right",
                          }, processTotals.values[f] > 0 ? fmtSize(processTotals.values[f] * 1024) : "\u2014"),
                        ];
                        if (diffMode) {
                          const totalDelta = sortedDiffs ? sortedDiffs.reduce((s, d) => {
                            const r = dRollups.get(d.current.pid);
                            const pr = baseRollups?.get(d.current.pid);
                            return s + (r && pr ? r[f] - pr[f] : 0);
                          }, 0) : 0;
                          cells.push(m("td", {
                            key: `d-${f}`,
                            className: "ah-capture-td--right",
                          }, totalDelta !== 0 ? m("span", {
                            className: totalDelta > 0 ? "ah-delta-pos" : "ah-delta-neg",
                          }, fmtDelta(totalDelta)) : "\u2014"));
                        }
                        return cells;
                      }),
                    ]),
                    (diffMode && sortedDiffs ? sortedDiffs : (sorted ?? []).map(p => ({ status: "matched" as const, current: p, prev: null, deltaPssKb: 0, deltaRssKb: 0, deltaJavaHeapKb: 0, deltaNativeHeapKb: 0, deltaGraphicsKb: 0, deltaCodeKb: 0 }))).map(d => {
                      const p = d.current;
                      const isJava = javaPids.has(p.pid);
                      const canCapture = isJava && (conn.isRoot || p.debuggable !== false);
                      const hasSmaps = dSmaps.has(p.pid);
                      const isExpanded = expandedSmapsPid === p.pid;
                      const isSmapsExpanded = isExpanded && hasSmaps;
                      const isSmapsLoading = isExpanded && !hasSmaps && smapsFetchPid === p.pid;
                      const isDiff = diffMode;
                      const colCount = 3 + (hasOomLabel ? 1 : 0) + ROLLUP_COLUMNS.length + (isDiff ? ROLLUP_COLUMNS.length : 0);
                      const rollup = dRollups.get(p.pid);
                      const prevRollup = baseRollups?.get(p.pid);
                      const rowKey = `${d.status}-${p.pid}`;
                      return m(Fragment, { key: rowKey }, [
                        m("tr", {
                          className: `ah-capture-row${
                            d.status === "removed" ? " ah-capture-row--removed" :
                            d.status === "added" ? " ah-capture-row--added" :
                            isSmapsExpanded ? " ah-capture-row--expanded" : ""
                          }`,
                          onclick: () => {
                            if (d.status === "removed") return;
                            if (isExpanded) {
                              expandedSmapsPid = null;
                              expandedSmapsGroup = null;
                            } else if (conn.isRoot || hasSmaps) {
                              expandedSmapsPid = p.pid;
                              expandedSmapsGroup = null;
                              if (!hasSmaps) fetchSmapsOnDemand(p.pid);
                            }
                          },
                        }, [
                          m("td", { className: "ah-capture-td--center" }, [
                            d.status !== "removed" && canCapture && (
                              m(DumpButton, {
                                pid: p.pid,
                                job: captureJobs.get(p.pid),
                                disabled: !connected || !isLive,
                                onDump: startCapture,
                                onCancel: cancelCapture,
                              })
                            ),
                          ]),
                          m("td", { className: "ah-capture-td--pid" }, [
                            (conn.isRoot || hasSmaps) && d.status !== "removed" && (
                              m("span", { className: isSmapsLoading ? "ah-expander--loading" : "ah-expander", style: { marginRight: "0.25rem" } }, isSmapsExpanded ? "\u25BC" : isSmapsLoading ? "\u2026" : "\u25B6")
                            ),
                            String(p.pid),
                          ]),
                          m("td", {
                            className: `ah-capture-td--name${d.status === "removed" ? " ah-line-through" : ""}`,
                            title: p.name,
                          }, [
                            p.name,
                            isDiff && d.status !== "matched" && (
                              m("span", {
                                className: d.status === "added" ? "ah-status-new" : "ah-status-gone",
                                style: { marginLeft: "0.5rem" },
                              }, d.status === "added" ? "NEW" : "GONE")
                            ),
                          ]),
                          hasOomLabel && (
                            m("td", { className: "ah-capture-td", style: { color: "var(--ah-text-muted)", fontSize: "0.75rem", whiteSpace: "nowrap" } }, [
                              p.oomLabel,
                              isDiff && d.prev && d.prev.oomLabel !== p.oomLabel && (
                                m("span", {
                                  className: "ah-status-changed",
                                  title: `was: ${d.prev.oomLabel || "(none)"}`,
                                  style: { marginLeft: "0.25rem" },
                                }, `\u2190 ${d.prev.oomLabel || "\u2014"}`)
                              ),
                            ])
                          ),
                          ROLLUP_COLUMNS.flatMap(([f]) => {
                            const value = getFieldValue(p, f, rollup);
                            const cells = [
                              m("td", {
                                key: f,
                                className: "ah-capture-td--right",
                              }, value > 0 ? fmtSize(value * 1024) : "\u2014"),
                            ];
                            if (isDiff) {
                              const delta = prevRollup && rollup ? rollup[f] - prevRollup[f] : 0;
                              cells.push(m("td", {
                                key: `d-${f}`,
                                className: `ah-capture-td--right ${deltaBgClass(delta)}`,
                              }, delta !== 0 ? m("span", {
                                className: delta > 0 ? "ah-delta-pos" : "ah-delta-neg",
                              }, fmtDelta(delta)) : "\u2014"));
                            }
                            return cells;
                          }),
                        ]),
                        isSmapsLoading && (
                          m("tr", [
                            m("td", {
                              colSpan: colCount,
                              className: "ah-capture-td ah-animate-pulse",
                              style: { fontSize: "0.75rem", color: "var(--ah-text-faint)", borderTop: "1px solid var(--ah-border)" },
                            }, "Fetching process smaps\u2026"),
                          ])
                        ),
                        isSmapsExpanded && d.status !== "removed" && (
                          m(SmapsSubTable, {
                            pid: p.pid,
                            processName: p.name,
                            aggregated: dSmaps.get(p.pid)!,
                            expandedGroup: expandedSmapsGroup,
                            onToggleGroup: (name: string) => { expandedSmapsGroup = expandedSmapsGroup === name ? null : name; },
                            sortField: smapsSort.field,
                            sortAsc: smapsSort.asc,
                            onToggleSort: (f: SmapsSortFieldType) => smapsSort.toggle(f),
                            vmaSortField: vmaSort.field,
                            vmaSortAsc: vmaSort.asc,
                            onToggleVmaSort: (f: VmaSortFieldType) => vmaSort.toggle(f),
                            onDump: handleVmaDump,
                            dumpDisabled: !connected || !isLive || !!vmaDumpStatus,
                            smapsDiffs: isDiff && baseSmapsData?.has(p.pid) ? diffSmaps(baseSmapsData.get(p.pid)!, dSmaps.get(p.pid)!) : null,
                            prevAggregated: isDiff && baseSmapsData?.has(p.pid) ? baseSmapsData.get(p.pid)! : null,
                            showDeltaCols: diffMode,
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
            (conn.isRoot || dSmaps.size > 0) && dProcs && dProcs.length > 0 && (
              m("div", { className: "ah-mt-4" }, [
                conn.isRoot && smapsData.size < (dProcs?.length ?? 0) && (
                  m("button", {
                    className: "ah-capture-toolbar__btn--accent ah-mb-2",
                    onclick: scanStatus ? cancelSmapsFetch : scanAllSmaps,
                    disabled: !connected || !isLive || !!vmaDumpStatus,
                  }, scanStatus ? `Cancel Scan (${smapsData.size}/${dProcs?.length ?? 0})` : `Scan All VMAs (${smapsData.size}/${dProcs?.length ?? 0})`)
                ),
                sharedMappings && sharedMappings.length > 0 && (
                  m(SharedMappingsTable, {
                    mappings: sharedMappings,
                    loadedCount: dSmaps.size,
                    loading: scanStatus !== null,
                    diffs: sharedMappingDiffs,
                    smapsData: dSmaps,
                    onDump: handleVmaDump,
                    dumpDisabled: !connected || !isLive || !!vmaDumpStatus,
                  })
                ),
              ])
            ),
          ])
        ),

        error && (
          m("div", { className: "ah-error-banner ah-mt-4" }, error)
        ),
      ]);
    },
  };
}

export default CaptureView;
