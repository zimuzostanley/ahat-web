import m from "mithril";
import { Fragment } from "../mithril-helpers";
import type { SmapsAggregated, SmapsEntry } from "../adb/capture";
import { fmtSize } from "../format";
import { SMAPS_COLUMNS, computeSmapsTotals, type SmapsNumericField } from "./capture-helpers";

type SortField = SmapsNumericField | "count";

function SmapsFileView(): m.Component<{
  aggregated: SmapsAggregated[];
  name: string;
}> {
  let sortField: SortField = "pssKb";
  let sortAsc = false;
  let expandedGroup: string | null = null;
  let vmaSortField: SmapsNumericField | "addrStart" = "pssKb";
  let vmaSortAsc = false;

  function toggleSort(f: SortField) {
    if (sortField === f) sortAsc = !sortAsc;
    else { sortField = f; sortAsc = false; }
  }

  function toggleVmaSort(f: SmapsNumericField | "addrStart") {
    if (vmaSortField === f) vmaSortAsc = !vmaSortAsc;
    else { vmaSortField = f; vmaSortAsc = false; }
  }

  return {
    view(vnode) {
      const { aggregated, name } = vnode.attrs;

      const sorted = [...aggregated].sort((a, b) => {
        const cmp = sortField === "count"
          ? a.count - b.count
          : a[sortField] - b[sortField];
        return sortAsc ? cmp : -cmp;
      });

      const totals = computeSmapsTotals(aggregated, null);
      const isRollup = aggregated.length === 1 && aggregated[0].name === "[rollup]";

      return m("div", { className: "ah-smaps-file" }, [
        m("h2", { className: "ah-smaps-file__title" }, [
          name,
          m("span", { className: "ah-smaps-file__meta" },
            isRollup
              ? "(smaps_rollup summary)"
              : `(${aggregated.length} mappings, ${aggregated.reduce((s, g) => s + g.count, 0)} VMAs)`,
          ),
        ]),
        m("div", { className: "ah-shared-mappings__table-wrap" }, [
          m("table", { className: "ah-shared-mappings__table" }, [
            m("thead", { className: "ah-shared-mappings__thead" }, [
              m("tr", { style: { borderBottom: "1px solid var(--ah-border)" } }, [
                m("th", { className: "ah-smaps-th" }, "Mapping"),
                m("th", {
                  className: "ah-smaps-th--right ah-smaps-th--sortable",
                  style: { width: "2rem", paddingRight: "0.25rem" },
                  onclick: () => toggleSort("count"),
                }, `# ${sortField === "count" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
                SMAPS_COLUMNS.map(([f, label]) =>
                  m("th", {
                    key: f,
                    className: "ah-smaps-th--right ah-smaps-th--sortable",
                    onclick: () => toggleSort(f),
                  }, `${label} ${sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
                ),
              ]),
            ]),
            m("tbody", [
              // Totals row
              m("tr", { className: "ah-smaps-total-row" }, [
                m("td", { className: "ah-smaps-td", style: { color: "var(--ah-text-secondary)" } }, "Total"),
                m("td"),
                SMAPS_COLUMNS.map(([f]) =>
                  m("td", {
                    key: f,
                    className: "ah-smaps-td--right",
                  }, totals[f] > 0 ? fmtSize(totals[f] * 1024) : "\u2014"),
                ),
              ]),
              // Data rows
              sorted.map((g, i) =>
                m(Fragment, { key: `${g.name}-${i}` }, [
                  m("tr", {
                    className: `ah-smaps-row${expandedGroup === g.name ? " ah-smaps-row--expanded" : ""}`,
                    onclick: () => { expandedGroup = expandedGroup === g.name ? null : g.name; },
                  }, [
                    m("td", {
                      className: "ah-smaps-td--name",
                      title: g.name,
                    }, [
                      m("div", { className: "ah-smaps-td--name-inner" }, [
                        m("span", { className: "ah-expander" }, expandedGroup === g.name ? "\u25BC" : "\u25B6"),
                        m("span", { className: "ah-truncate", style: { maxWidth: "400px" } }, g.name),
                      ]),
                    ]),
                    m("td", { className: "ah-smaps-td--count" }, String(g.count)),
                    SMAPS_COLUMNS.map(([f]) =>
                      m("td", {
                        key: f,
                        className: "ah-smaps-td--right",
                      }, g[f] > 0 ? fmtSize(g[f] * 1024) : "\u2014"),
                    ),
                  ]),
                  expandedGroup === g.name && g.entries.length > 0 && (
                    m(VmaTable, {
                      entries: g.entries,
                      sortField: vmaSortField,
                      sortAsc: vmaSortAsc,
                      onToggleSort: toggleVmaSort,
                    })
                  ),
                ]),
              ),
            ]),
          ]),
        ]),
      ]);
    },
  };
}

// Inline VMA sub-table for expanded groups
const VmaTable: m.Component<{
  entries: SmapsEntry[];
  sortField: SmapsNumericField | "addrStart";
  sortAsc: boolean;
  onToggleSort: (f: SmapsNumericField | "addrStart") => void;
}> = {
  view(vnode) {
    const { entries, sortField, sortAsc, onToggleSort } = vnode.attrs;

    const sorted = [...entries].sort((a, b) => {
      if (sortField === "addrStart") {
        return sortAsc
          ? a.addrStart.localeCompare(b.addrStart)
          : b.addrStart.localeCompare(a.addrStart);
      }
      return sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField];
    });

    return m(Fragment, [
      m("tr", { className: "ah-vma-header" }, [
        m("td", {
          className: `ah-smaps-th ah-smaps-th--sortable`,
          style: { paddingLeft: "1.5rem" },
          onclick: () => onToggleSort("addrStart"),
        }, `Address ${sortField === "addrStart" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
        m("td", { className: "ah-smaps-th--right" }, "Perms"),
        SMAPS_COLUMNS.map(([f, label]) =>
          m("td", {
            key: f,
            className: "ah-smaps-th--right ah-smaps-th--sortable",
            onclick: () => onToggleSort(f),
          }, `${label} ${sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}`),
        ),
      ]),
      sorted.map(e =>
        m("tr", {
          key: e.addrStart,
          className: "ah-vma-row",
        }, [
          m("td", {
            className: "ah-vma-td",
            style: { paddingLeft: "1.5rem", fontFamily: "monospace", fontSize: "0.75rem" },
          }, `${e.addrStart}-${e.addrEnd}`),
          m("td", {
            className: "ah-vma-td",
            style: { textAlign: "right", fontFamily: "monospace", fontSize: "0.75rem" },
          }, e.perms),
          SMAPS_COLUMNS.map(([f]) =>
            m("td", {
              key: f,
              className: "ah-vma-td--right",
            }, e[f] > 0 ? fmtSize(e[f] * 1024) : "\u2014"),
          ),
        ]),
      ),
    ]);
  },
};

export default SmapsFileView;
