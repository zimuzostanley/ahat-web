import m from "mithril";
import { Fragment } from "../mithril-helpers";
import { fmtSize } from "../format";
import type { ProcessStringsResult, VmaString } from "../adb/capture";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "all" | "duplicates" | "byvma";
type AllSortField = "vmaAddr" | "str" | "vma";
type DupSortField = "count" | "totalBytes" | "value";

interface ExtractedDup {
  value: string;
  count: number;
  totalBytes: number;
  vmaIndices: Set<number>;
}

interface ProcessStringsViewAttrs {
  data: ProcessStringsResult;
  name: string;
  onDumpVma: (name: string, pid: number, region: { addrStart: string; addrEnd: string }, filterString?: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAX_DISPLAY = 5000;

function computeDuplicates(strings: VmaString[]): ExtractedDup[] {
  const groups = new Map<string, { count: number; totalBytes: number; vmaIndices: Set<number> }>();
  for (const s of strings) {
    const existing = groups.get(s.str);
    if (existing) {
      existing.count++;
      existing.totalBytes += s.str.length;
      existing.vmaIndices.add(s.vmaIndex);
    } else {
      groups.set(s.str, { count: 1, totalBytes: s.str.length, vmaIndices: new Set([s.vmaIndex]) });
    }
  }
  const result: ExtractedDup[] = [];
  for (const [value, g] of groups) {
    if (g.count < 2) continue;
    result.push({ value, count: g.count, totalBytes: g.totalBytes, vmaIndices: g.vmaIndices });
  }
  return result;
}

function fmtAddr(addr: number, width: number): string {
  return addr.toString(16).padStart(width, "0");
}

// ─── Component ───────────────────────────────────────────────────────────────

function ProcessStringsView(): m.Component<ProcessStringsViewAttrs> {
  let tab: Tab = "duplicates";
  let filter = "";
  let allSortField: AllSortField = "vmaAddr";
  let allSortAsc = true;
  let allShowCount = MAX_DISPLAY;
  let dupSortField: DupSortField = "totalBytes";
  let dupSortAsc = false;
  let dupFilter = "";
  let dupShowCount = MAX_DISPLAY;
  let expandedVma: number | null = null;
  let vmaFilter = "";

  // Cached duplicates
  let cachedStrings: VmaString[] | undefined;
  let cachedDups: ExtractedDup[] = [];

  function getDups(strings: VmaString[]): ExtractedDup[] {
    if (strings !== cachedStrings) {
      cachedStrings = strings;
      cachedDups = computeDuplicates(strings);
    }
    return cachedDups;
  }

  function toggleAllSort(f: AllSortField) {
    if (allSortField === f) allSortAsc = !allSortAsc;
    else { allSortField = f; allSortAsc = f === "str"; }
  }

  function toggleDupSort(f: DupSortField) {
    if (dupSortField === f) dupSortAsc = !dupSortAsc;
    else { dupSortField = f; dupSortAsc = false; }
  }

  function sortIndicator(active: boolean, asc: boolean): string {
    return active ? (asc ? " \u25B2" : " \u25BC") : "";
  }

  return {
    view(vnode) {
      const { data, onDumpVma } = vnode.attrs;
      const { strings, regions, pid, processName } = data;
      const addrWidth = strings.length > 0 && strings.some(s => s.vmaAddr > 0xFFFFFFFF) ? 12 : 8;
      const dups = getDups(strings);

      // ── All tab data ──
      const filteredAll = filter
        ? strings.filter(s => s.str.toLowerCase().includes(filter.toLowerCase()))
        : strings;
      const sortedAll = [...filteredAll].sort((a, b) => {
        let cmp: number;
        if (allSortField === "vmaAddr") cmp = a.vmaAddr - b.vmaAddr;
        else if (allSortField === "str") cmp = a.str.localeCompare(b.str);
        else cmp = a.vmaIndex - b.vmaIndex;
        return allSortAsc ? cmp : -cmp;
      });
      const displayAll = sortedAll.slice(0, allShowCount);

      // ── Duplicates tab data ──
      const filteredDups = dupFilter
        ? dups.filter(d => d.value.toLowerCase().includes(dupFilter.toLowerCase()))
        : dups;
      const sortedDups = [...filteredDups].sort((a, b) => {
        if (dupSortField === "value") {
          const cmp = a.value.localeCompare(b.value);
          return dupSortAsc ? cmp : -cmp;
        }
        const cmp = a[dupSortField] - b[dupSortField];
        return dupSortAsc ? cmp : -cmp;
      });
      const displayDups = sortedDups.slice(0, dupShowCount);

      // ── By VMA tab data ──
      const filteredRegions = vmaFilter
        ? regions.filter(r => r.name.toLowerCase().includes(vmaFilter.toLowerCase()) || r.addrStart.includes(vmaFilter.toLowerCase()))
        : regions;
      const sortedRegions = [...filteredRegions]
        .map(r => ({ region: r, originalIndex: regions.indexOf(r) }))
        .sort((a, b) => b.region.stringCount - a.region.stringCount);

      return m("div", { className: "ah-proc-strings" }, [
        // ── Toolbar ──
        m("div", { className: "ah-hex-toolbar" }, [
          m("h2", { className: "ah-view-heading ah-truncate", style: { marginBottom: 0, minWidth: 0 } },
            `${processName} (${pid})`),
          m("span", { style: { fontSize: "0.875rem", color: "var(--ah-text-muted)", whiteSpace: "nowrap" } },
            `${strings.length.toLocaleString()} strings`),
          m("span", { style: { fontSize: "0.75rem", color: "var(--ah-text-faint)", whiteSpace: "nowrap" } },
            `${regions.length} VMAs`),
          dups.length > 0 && m("span", { style: { fontSize: "0.75rem", color: "var(--ah-text-faint)", whiteSpace: "nowrap" } },
            `${dups.length.toLocaleString()} duplicates`),
        ]),

        // ── Tab bar ──
        m("div", { className: "ah-proc-strings__tabs" }, [
          m("div", { style: { display: "flex", gap: "0.25rem" } }, [
            (["all", "duplicates", "byvma"] as Tab[]).map(t => {
              const label = t === "all" ? "All" : t === "duplicates" ? "Duplicates" : "By VMA";
              return m("button", {
                key: t,
                className: `ah-hex-btn${tab === t ? " ah-hex-btn--active" : ""}`,
                onclick: () => { tab = t; },
              }, label);
            }),
          ]),
          // Search bar — shared across tabs
          m("input", {
            className: "ah-proc-strings__search",
            placeholder: tab === "byvma" ? "Filter VMAs\u2026" : tab === "duplicates" ? "Filter duplicates\u2026" : "Filter strings\u2026",
            value: tab === "all" ? filter : tab === "duplicates" ? dupFilter : vmaFilter,
            oninput: (e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              if (tab === "all") { filter = v; allShowCount = MAX_DISPLAY; }
              else if (tab === "duplicates") { dupFilter = v; dupShowCount = MAX_DISPLAY; }
              else { vmaFilter = v; }
            },
          }),
          m("span", { className: "ah-proc-strings__count" }, (() => {
            if (tab === "all") {
              return filteredAll.length === strings.length
                ? `${strings.length.toLocaleString()} strings`
                : `${filteredAll.length.toLocaleString()} / ${strings.length.toLocaleString()}`;
            }
            if (tab === "duplicates") {
              return filteredDups.length === dups.length
                ? `${dups.length.toLocaleString()} groups`
                : `${filteredDups.length.toLocaleString()} / ${dups.length.toLocaleString()}`;
            }
            return filteredRegions.length === regions.length
              ? `${regions.length} VMAs`
              : `${filteredRegions.length} / ${regions.length}`;
          })()),
        ]),

        // ── Content ──
        m("div", { className: "ah-proc-strings__content" }, [
          // ─── All tab ───
          tab === "all" && (
            sortedAll.length === 0
              ? m("div", { className: "ah-proc-strings__empty" }, filter ? "No matching strings" : "No strings found")
              : m(Fragment, null, [
                  m("div", { className: "ah-proc-strings__table-header" }, [
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--addr ah-proc-strings__col--sortable",
                      onclick: () => toggleAllSort("vmaAddr"),
                    }, `Address${sortIndicator(allSortField === "vmaAddr", allSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--vma ah-proc-strings__col--sortable",
                      onclick: () => toggleAllSort("vma"),
                    }, `VMA${sortIndicator(allSortField === "vma", allSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--str ah-proc-strings__col--sortable",
                      onclick: () => toggleAllSort("str"),
                    }, `String${sortIndicator(allSortField === "str", allSortAsc)}`),
                  ]),
                  m("div", { className: "ah-proc-strings__rows" },
                    displayAll.map((s, i) => {
                      const r = regions[s.vmaIndex];
                      return m("div", {
                        key: i,
                        className: "ah-proc-strings__row",
                        title: `Click to copy \u2014 ${r?.name ?? ""}`,
                        onclick: () => { navigator.clipboard.writeText(s.str).catch(() => {}); },
                      }, [
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--addr" },
                          fmtAddr(s.vmaAddr, addrWidth)),
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--vma" }, [
                          r && m("button", {
                            className: "ah-smaps-action",
                            onclick: (e: Event) => {
                              e.stopPropagation();
                              onDumpVma(`${processName}_${r.addrStart}-${r.addrEnd}`, pid, r, s.str);
                            },
                            title: "Dump this VMA",
                          }, "dump"),
                          m("span", { className: "ah-proc-strings__vma-name" }, r?.name ?? "?"),
                        ]),
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--str" }, s.str),
                      ]);
                    }),
                    sortedAll.length > allShowCount && (
                      m("div", { className: "ah-proc-strings__more" },
                        "Showing ", allShowCount.toLocaleString(), " of ", sortedAll.length.toLocaleString(),
                        " \u2014 ",
                        m("button", { className: "ah-more-link", onclick: () => { allShowCount = Math.min(allShowCount + 5_000, sortedAll.length); } }, "show more"),
                        " ",
                        m("button", { className: "ah-more-link", onclick: () => { allShowCount = sortedAll.length; } }, "show all"),
                      )
                    ),
                  ),
                ])
          ),

          // ─── Duplicates tab ───
          tab === "duplicates" && (
            sortedDups.length === 0
              ? m("div", { className: "ah-proc-strings__empty" }, dupFilter ? "No matching duplicates" : "No duplicate strings found")
              : m(Fragment, null, [
                  m("div", { className: "ah-proc-strings__table-header" }, [
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--bytes ah-proc-strings__col--sortable",
                      onclick: () => toggleDupSort("totalBytes"),
                    }, `Bytes${sortIndicator(dupSortField === "totalBytes", dupSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--count ah-proc-strings__col--sortable",
                      onclick: () => toggleDupSort("count"),
                    }, `Count${sortIndicator(dupSortField === "count", dupSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--str ah-proc-strings__col--sortable",
                      onclick: () => toggleDupSort("value"),
                    }, `String${sortIndicator(dupSortField === "value", dupSortAsc)}`),
                  ]),
                  m("div", { className: "ah-proc-strings__rows" },
                    displayDups.map((d, i) =>
                      m("div", {
                        key: i,
                        className: "ah-proc-strings__row",
                        title: `Click to filter All tab to this string (${d.vmaIndices.size} VMAs)`,
                        onclick: () => { tab = "all"; filter = d.value; allShowCount = MAX_DISPLAY; },
                      }, [
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--bytes" },
                          fmtSize(d.totalBytes)),
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--count" },
                          d.count.toLocaleString()),
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--str" }, d.value),
                      ]),
                    ),
                    sortedDups.length > dupShowCount && (
                      m("div", { className: "ah-proc-strings__more" },
                        "Showing ", dupShowCount.toLocaleString(), " of ", sortedDups.length.toLocaleString(),
                        " \u2014 ",
                        m("button", { className: "ah-more-link", onclick: () => { dupShowCount = Math.min(dupShowCount + 5_000, sortedDups.length); } }, "show more"),
                        " ",
                        m("button", { className: "ah-more-link", onclick: () => { dupShowCount = sortedDups.length; } }, "show all"),
                      )
                    ),
                  ),
                ])
          ),

          // ─── By VMA tab ───
          tab === "byvma" && (
            sortedRegions.length === 0
              ? m("div", { className: "ah-proc-strings__empty" }, vmaFilter ? "No matching VMAs" : "No VMAs")
              : m("div", { className: "ah-proc-strings__rows" },
                  sortedRegions.map(({ region: r, originalIndex: ri }) => {
                    const isExpanded = expandedVma === ri;
                    const vmaStrings = isExpanded ? strings.filter(s => s.vmaIndex === ri) : [];
                    return m(Fragment, { key: ri }, [
                      m("div", {
                        className: `ah-proc-strings__vma-group${isExpanded ? " ah-proc-strings__vma-group--expanded" : ""}`,
                        onclick: () => { expandedVma = isExpanded ? null : ri; },
                      }, [
                        m("span", { className: "ah-expander" }, isExpanded ? "\u25BC" : "\u25B6"),
                        m("span", { className: "ah-proc-strings__vma-addr" },
                          `${r.addrStart}-${r.addrEnd}`),
                        m("span", { className: "ah-proc-strings__vma-perms" }, r.perms),
                        m("span", { className: "ah-proc-strings__vma-name ah-truncate" }, r.name),
                        m("span", { className: "ah-proc-strings__vma-count" },
                          r.stringCount > 0 ? `${r.stringCount.toLocaleString()} strings` : "\u2014"),
                        m("span", { className: "ah-proc-strings__vma-size" },
                          fmtSize(r.sizeKb * 1024)),
                        m("button", {
                          className: "ah-smaps-action",
                          onclick: (e: Event) => {
                            e.stopPropagation();
                            onDumpVma(`${processName}_${r.addrStart}-${r.addrEnd}`, pid, r);
                          },
                          title: "Dump this VMA",
                        }, "dump"),
                      ]),
                      isExpanded && vmaStrings.length > 0 && (
                        m("div", { className: "ah-proc-strings__vma-strings" },
                          vmaStrings.slice(0, MAX_DISPLAY).map((s, si) =>
                            m("div", {
                              key: si,
                              className: "ah-proc-strings__row ah-proc-strings__row--nested",
                              onclick: () => { navigator.clipboard.writeText(s.str).catch(() => {}); },
                              title: "Click to copy",
                            }, [
                              m("span", { className: "ah-proc-strings__col ah-proc-strings__col--addr" },
                                fmtAddr(s.vmaAddr, addrWidth)),
                              m("span", { className: "ah-proc-strings__col ah-proc-strings__col--str" }, s.str),
                            ]),
                          ),
                          vmaStrings.length > MAX_DISPLAY && (
                            m("div", { className: "ah-proc-strings__more" },
                              `Showing ${MAX_DISPLAY.toLocaleString()} of ${vmaStrings.length.toLocaleString()}`)
                          ),
                        )
                      ),
                      isExpanded && vmaStrings.length === 0 && (
                        m("div", { className: "ah-proc-strings__vma-strings" },
                          m("div", { className: "ah-proc-strings__empty" }, "No strings in this VMA"))
                      ),
                    ]);
                  }),
                )
          ),
        ]),
      ]);
    },
  };
}

export default ProcessStringsView;
