import m from "mithril";
import { Fragment } from "../mithril-helpers";
import { fmtSize } from "../format";
import type { ProcessStringsResult, VmaString } from "../adb/capture";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "all" | "duplicates" | "byvma";
type AllSortField = "vmaAddr" | "str" | "vma";
type DupSortField = "count" | "totalBytes" | "value" | "length" | "vmas";
type VmaSortField = "stringCount" | "sizeKb" | "dupCount";

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
  dumpStatus: string | null;
  onCancelScan?: () => void;
  onCancelDump?: () => void;
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

/** Count duplicate strings per VMA index. */
function computeVmaDupCounts(strings: VmaString[]): Map<number, number> {
  // First pass: count occurrences of each string value
  const valueCounts = new Map<string, number>();
  for (const s of strings) {
    valueCounts.set(s.str, (valueCounts.get(s.str) ?? 0) + 1);
  }
  // Second pass: for each VMA, count strings that appear 2+ times
  const result = new Map<number, number>();
  for (const s of strings) {
    if ((valueCounts.get(s.str) ?? 0) >= 2) {
      result.set(s.vmaIndex, (result.get(s.vmaIndex) ?? 0) + 1);
    }
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
  let vmaSortField: VmaSortField = "stringCount";
  let vmaSortAsc = false;
  let minLen = 4;

  // Cached computations
  let cachedStrings: VmaString[] | undefined;
  let cachedDups: ExtractedDup[] = [];
  let cachedDupCountStrings: VmaString[] | undefined;
  let cachedVmaDupCounts = new Map<number, number>();

  function getDups(strings: VmaString[]): ExtractedDup[] {
    if (strings !== cachedStrings) {
      cachedStrings = strings;
      cachedDups = computeDuplicates(strings);
    }
    return cachedDups;
  }

  function getVmaDupCounts(strings: VmaString[]): Map<number, number> {
    if (strings !== cachedDupCountStrings) {
      cachedDupCountStrings = strings;
      cachedVmaDupCounts = computeVmaDupCounts(strings);
    }
    return cachedVmaDupCounts;
  }

  function toggleAllSort(f: AllSortField) {
    if (allSortField === f) allSortAsc = !allSortAsc;
    else { allSortField = f; allSortAsc = f === "str"; }
  }

  function toggleDupSort(f: DupSortField) {
    if (dupSortField === f) dupSortAsc = !dupSortAsc;
    else { dupSortField = f; dupSortAsc = false; }
  }

  function toggleVmaSort(f: VmaSortField) {
    if (vmaSortField === f) vmaSortAsc = !vmaSortAsc;
    else { vmaSortField = f; vmaSortAsc = false; }
  }

  function si(active: boolean, asc: boolean): string {
    return active ? (asc ? " \u25B2" : " \u25BC") : "";
  }

  return {
    view(vnode) {
      const { data, onDumpVma, dumpStatus, onCancelScan, onCancelDump } = vnode.attrs;
      const { strings: rawStrings, regions, pid, processName, scanning, scannedVmas, totalVmas } = data;
      const strings = minLen > 4 ? rawStrings.filter(s => s.str.length >= minLen) : rawStrings;
      const addrWidth = strings.length > 0 && strings.some(s => s.vmaAddr > 0xFFFFFFFF) ? 12 : 8;
      const dups = getDups(strings);
      const vmaDupCounts = getVmaDupCounts(strings);

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
        if (dupSortField === "value") return dupSortAsc ? a.value.localeCompare(b.value) : b.value.localeCompare(a.value);
        if (dupSortField === "length") return dupSortAsc ? a.value.length - b.value.length : b.value.length - a.value.length;
        if (dupSortField === "vmas") return dupSortAsc ? a.vmaIndices.size - b.vmaIndices.size : b.vmaIndices.size - a.vmaIndices.size;
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
        .sort((a, b) => {
          let cmp: number;
          if (vmaSortField === "dupCount") {
            cmp = (vmaDupCounts.get(a.originalIndex) ?? 0) - (vmaDupCounts.get(b.originalIndex) ?? 0);
          } else {
            cmp = a.region[vmaSortField] - b.region[vmaSortField];
          }
          return vmaSortAsc ? cmp : -cmp;
        });

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

        // ── Scanning progress ──
        scanning && totalVmas && totalVmas > 0 && (
          m("div", { className: "ah-capture-progress", style: { margin: "0 1rem" } }, [
            m("div", { className: "ah-capture-progress__row" }, [
              m("span", { className: "ah-capture-progress__text" }, "Scanning VMAs\u2026"),
              m("span", { className: "ah-capture-progress__count" }, `${scannedVmas ?? 0}/${totalVmas}`),
              onCancelScan && m("button", { className: "ah-capture-progress__cancel", onclick: onCancelScan }, "Cancel"),
            ]),
            m("div", { className: "ah-capture-progress-bar" }, [
              m("div", {
                className: "ah-capture-progress-bar__fill ah-capture-progress-bar__fill--accent",
                style: { width: `${((scannedVmas ?? 0) / totalVmas) * 100}%` },
              }),
            ]),
          ])
        ),

        // ── VMA dump progress ──
        dumpStatus && (
          m("div", { className: "ah-capture-progress", style: { margin: "0 1rem" } }, [
            m("div", { className: "ah-capture-progress__row" }, [
              m("span", { className: "ah-capture-progress__text" }, dumpStatus),
              onCancelDump && m("button", { className: "ah-capture-progress__cancel", onclick: onCancelDump }, "Cancel"),
            ]),
          ])
        ),

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
          m("label", { className: "ah-proc-strings__minlen" }, [
            "min ",
            m("input", {
              className: "ah-proc-strings__minlen-input",
              type: "number",
              min: 4,
              max: 999,
              value: minLen,
              oninput: (e: Event) => {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (isFinite(v) && v >= 4) minLen = v;
              },
            }),
          ]),
          m("span", { className: "ah-proc-strings__count" }, (() => {
            const lenNote = minLen > 4 ? ` (\u2265${minLen})` : "";
            if (tab === "all") {
              return filteredAll.length === strings.length
                ? `${strings.length.toLocaleString()} strings${lenNote}`
                : `${filteredAll.length.toLocaleString()} / ${strings.length.toLocaleString()}${lenNote}`;
            }
            if (tab === "duplicates") {
              return filteredDups.length === dups.length
                ? `${dups.length.toLocaleString()} groups${lenNote}`
                : `${filteredDups.length.toLocaleString()} / ${dups.length.toLocaleString()}${lenNote}`;
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
                    }, `Address${si(allSortField === "vmaAddr", allSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--vma ah-proc-strings__col--sortable",
                      onclick: () => toggleAllSort("vma"),
                    }, `VMA${si(allSortField === "vma", allSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--str ah-proc-strings__col--sortable",
                      onclick: () => toggleAllSort("str"),
                    }, `String${si(allSortField === "str", allSortAsc)}`),
                  ]),
                  m("div", { className: "ah-proc-strings__rows" },
                    displayAll.map((s) => {
                      const r = regions[s.vmaIndex];
                      return m("div", {
                        key: s.vmaAddr,
                        className: "ah-proc-strings__row",
                      }, [
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--addr" },
                          fmtAddr(s.vmaAddr, addrWidth)),
                        m("span", {
                          className: "ah-proc-strings__col ah-proc-strings__col--vma",
                          title: r?.name ?? "",
                        }, [
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
                        m("button", {
                          className: "ah-proc-strings__copy",
                          onclick: () => { navigator.clipboard.writeText(s.str).catch(() => {}); },
                          title: "Copy string",
                        }, "copy"),
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
                    }, `Bytes${si(dupSortField === "totalBytes", dupSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--count ah-proc-strings__col--sortable",
                      onclick: () => toggleDupSort("count"),
                    }, `Count${si(dupSortField === "count", dupSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--len ah-proc-strings__col--sortable",
                      onclick: () => toggleDupSort("length"),
                    }, `Len${si(dupSortField === "length", dupSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--vma-count ah-proc-strings__col--sortable",
                      onclick: () => toggleDupSort("vmas"),
                    }, `VMAs${si(dupSortField === "vmas", dupSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__col ah-proc-strings__col--str ah-proc-strings__col--sortable",
                      onclick: () => toggleDupSort("value"),
                    }, `String${si(dupSortField === "value", dupSortAsc)}`),
                  ]),
                  m("div", { className: "ah-proc-strings__rows" },
                    displayDups.map((d) =>
                      m("div", {
                        key: d.value,
                        className: "ah-proc-strings__row",
                        title: `Click to filter All tab (${d.vmaIndices.size} VMAs)`,
                        onclick: () => { tab = "all"; filter = d.value; allShowCount = MAX_DISPLAY; },
                      }, [
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--bytes" },
                          fmtSize(d.totalBytes)),
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--count" },
                          d.count.toLocaleString()),
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--len" },
                          d.value.length.toLocaleString()),
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--vma-count" },
                          d.vmaIndices.size.toLocaleString()),
                        m("span", { className: "ah-proc-strings__col ah-proc-strings__col--str" }, d.value),
                        m("button", {
                          className: "ah-proc-strings__copy",
                          onclick: (e: Event) => { e.stopPropagation(); navigator.clipboard.writeText(d.value).catch(() => {}); },
                          title: "Copy string",
                        }, "copy"),
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
              : m(Fragment, null, [
                  m("div", { className: "ah-proc-strings__table-header ah-proc-strings__vma-row" }, [
                    m("span", { className: "ah-proc-strings__vma-col-exp" }),
                    m("span", { className: "ah-proc-strings__vma-col-addr" }, "Address"),
                    m("span", { className: "ah-proc-strings__vma-col-name" }, "Name"),
                    m("span", {
                      className: "ah-proc-strings__vma-col-metric ah-proc-strings__col--sortable",
                      onclick: () => toggleVmaSort("stringCount"),
                    }, `Strings${si(vmaSortField === "stringCount", vmaSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__vma-col-metric ah-proc-strings__col--sortable",
                      onclick: () => toggleVmaSort("dupCount"),
                    }, `Dups${si(vmaSortField === "dupCount", vmaSortAsc)}`),
                    m("span", {
                      className: "ah-proc-strings__vma-col-metric ah-proc-strings__col--sortable",
                      onclick: () => toggleVmaSort("sizeKb"),
                    }, `Size${si(vmaSortField === "sizeKb", vmaSortAsc)}`),
                    m("span", { className: "ah-proc-strings__vma-col-action" }),
                  ]),
                  m("div", { className: "ah-proc-strings__rows" },
                    sortedRegions.map(({ region: r, originalIndex: ri }) => {
                      const isExpanded = expandedVma === ri;
                      const vmaStrings = isExpanded ? strings.filter(s => s.vmaIndex === ri) : [];
                      const dupCount = vmaDupCounts.get(ri) ?? 0;
                      return m(Fragment, { key: ri }, [
                        m("div", {
                          className: `ah-proc-strings__vma-group ah-proc-strings__vma-row${isExpanded ? " ah-proc-strings__vma-group--expanded" : ""}`,
                          onclick: () => { expandedVma = isExpanded ? null : ri; },
                          title: r.name,
                        }, [
                          m("span", { className: "ah-proc-strings__vma-col-exp" }, isExpanded ? "\u25BC" : "\u25B6"),
                          m("span", { className: "ah-proc-strings__vma-col-addr" },
                            `${r.addrStart}${r.perms ? " " + r.perms : ""}`),
                          m("span", { className: "ah-proc-strings__vma-col-name" }, r.name),
                          m("span", { className: "ah-proc-strings__vma-col-metric" },
                            r.stringCount > 0 ? r.stringCount.toLocaleString() : "\u2014"),
                          m("span", { className: "ah-proc-strings__vma-col-metric" },
                            dupCount > 0 ? dupCount.toLocaleString() : "\u2014"),
                          m("span", { className: "ah-proc-strings__vma-col-metric" },
                            fmtSize(r.sizeKb * 1024)),
                          m("span", { className: "ah-proc-strings__vma-col-action" },
                            m("button", {
                              className: "ah-smaps-action",
                              onclick: (e: Event) => {
                                e.stopPropagation();
                                onDumpVma(`${processName}_${r.addrStart}-${r.addrEnd}`, pid, r);
                              },
                              title: "Dump this VMA",
                            }, "dump")),
                        ]),
                        isExpanded && vmaStrings.length > 0 && (
                          m("div", { className: "ah-proc-strings__vma-strings" },
                            vmaStrings.slice(0, MAX_DISPLAY).map((s, si) =>
                              m("div", {
                                key: si,
                                className: "ah-proc-strings__row ah-proc-strings__row--nested",
                              }, [
                                m("span", { className: "ah-proc-strings__col ah-proc-strings__col--addr" },
                                  fmtAddr(s.vmaAddr, addrWidth)),
                                m("span", { className: "ah-proc-strings__col ah-proc-strings__col--str" }, s.str),
                                m("button", {
                                  className: "ah-proc-strings__copy",
                                  onclick: () => { navigator.clipboard.writeText(s.str).catch(() => {}); },
                                  title: "Copy string",
                                }, "copy"),
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
                  ),
                ])
          ),
        ]),
      ]);
    },
  };
}

export default ProcessStringsView;
