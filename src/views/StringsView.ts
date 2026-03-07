import m from "mithril";
import { Fragment } from "../mithril-helpers";
import type { StringListRow } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, Section, SortableTable } from "../components";
import { computeDuplicates, type DuplicateGroup } from "./strings-helpers";
import { consumePendingScroll } from "../navigation";

// ─── StringsView ─────────────────────────────────────────────────────────────

interface StringsViewAttrs { proxy: WorkerProxy; navigate: NavFn; initialQuery?: string; initialExact?: boolean; initialHeap?: string }

function StringsView(): m.Component<StringsViewAttrs> {
  let allRows: StringListRow[] | null = null;
  let query = "";
  let selectedHeap = "all";
  let exactMatch = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scrollToResults = false;

  function updateUrl(q: string) {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (exactMatch) sp.set("exact", "1");
    if (selectedHeap !== "all") sp.set("heap", selectedHeap);
    const qs = sp.toString();
    const url = qs ? `/strings?${qs}` : "/strings";
    const prev = window.history.state;
    const params: Record<string, unknown> = {};
    if (q) params.q = q;
    if (exactMatch) params.exact = true;
    if (selectedHeap !== "all") params.heap = selectedHeap;
    window.history.replaceState({ view: "strings", params, trail: prev?.trail, trailIndex: prev?.trailIndex }, "", url);
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
      exactMatch = vnode.attrs.initialExact ?? false;
      selectedHeap = vnode.attrs.initialHeap ?? "all";
      vnode.attrs.proxy.query<StringListRow[]>("getStringList")
        .then(r => { allRows = r; m.redraw(); consumePendingScroll(); })
        .catch(console.error);
    },
    onremove() {
      if (timer) clearTimeout(timer);
    },
    view(vnode) {
      const { navigate } = vnode.attrs;

      if (!allRows) return m("div", { className: "ah-loading" }, "Loading\u2026");

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

      return m("div", null,
        m("div", { style: { display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" } },
          m("h2", { className: "ah-view-heading", style: { marginBottom: 0 } }, "Strings"),
          heaps.length > 1 && (
            m("select", {
              value: selectedHeap,
              onchange: (e: Event) => { selectedHeap = (e.target as HTMLSelectElement).value; updateUrl(query); },
              className: "ah-select",
              style: { backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 20 20' fill='%23888'%3E%3Cpath d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 0.4rem center" },
            },
              m("option", { value: "all" }, "All heaps"),
              heaps.map(h => m("option", { key: h, value: h }, h))
            )
          )
        ),

        // Summary
        m("div", { className: "ah-card ah-mb-4" },
          m("div", { className: "ah-info-grid" },
            m("span", { className: "ah-info-grid__label" }, "Total strings:"),
            m("span", { className: "ah-mono" }, heapFiltered.length.toLocaleString()),
            m("span", { className: "ah-info-grid__label" }, "Unique values:"),
            m("span", { className: "ah-mono" }, uniqueCount.toLocaleString()),
            m("span", { className: "ah-info-grid__label" }, "Duplicate groups:"),
            m("span", { className: "ah-mono" }, duplicates.length > 0
              ? m("span", { style: { color: "var(--ah-badge-warning)" } }, duplicates.length.toLocaleString())
              : "0"
            ),
            totalWasted > 0 && m(Fragment, null,
              m("span", { className: "ah-info-grid__label" }, "Wasted by duplicates:"),
              m("span", { className: "ah-mono", style: { color: "var(--ah-badge-warning)" } }, fmtSize(totalWasted))
            ),
            m("span", { className: "ah-info-grid__label" }, "Total retained:"),
            m("span", { className: "ah-mono" }, fmtSize(totalRetained))
          )
        ),

        // Duplicates section
        duplicates.length > 0 && (
          m("div", { className: "ah-mb-4" },
            m(Section, { title: `Duplicate strings (${duplicates.length} groups, ${fmtSize(totalWasted)} wasted)`, defaultOpen: false },
              m(SortableTable, {
                columns: [
                  { label: "Wasted", align: "right", sortKey: (r: DuplicateGroup) => r.wastedBytes, render: (r: DuplicateGroup) => m("span", { className: "ah-mono" }, fmtSize(r.wastedBytes)) },
                  { label: "Count", align: "right", sortKey: (r: DuplicateGroup) => r.count, render: (r: DuplicateGroup) => m("span", { className: "ah-mono" }, r.count) },
                  { label: "Value", render: (r: DuplicateGroup) =>
                    m("span", { className: "ah-mono ah-break-all", style: { color: "var(--ah-badge-string)" } },
                      "\"", r.value.length > 200 ? r.value.slice(0, 200) + "\u2026" : r.value, "\""),
                  },
                ],
                data: duplicates,
                onRowClick: (r: DuplicateGroup) => { query = r.value; exactMatch = true; scrollToResults = true; updateUrl(r.value); },
              })
            )
          )
        ),

        // Search
        m("input", {
          type: "text", value: query, oninput: (e: Event) => handleChange((e.target as HTMLInputElement).value),
          placeholder: "Filter strings\u2026",
          className: "ah-input",
        }),

        filtered.length > 0 && (
          m(Fragment, null,
            (query || selectedHeap !== "all") && (
              m("div", {
                className: "ah-table__more ah-mb-2",
                oncreate: (vnode: m.VnodeDOM) => {
                  if (scrollToResults) {
                    scrollToResults = false;
                    (vnode.dom as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                },
                onupdate: (vnode: m.VnodeDOM) => {
                  if (scrollToResults) {
                    scrollToResults = false;
                    (vnode.dom as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                },
              },
                filtered.length.toLocaleString(), " match", filtered.length !== 1 ? "es" : "")
            ),
            m(SortableTable, {
              columns: [
                { label: "Retained", align: "right", sortKey: (r: StringListRow) => r.retainedSize, render: (r: StringListRow) => m("span", { className: "ah-mono" }, fmtSize(r.retainedSize)) },
                { label: "Length", align: "right", sortKey: (r: StringListRow) => r.length, render: (r: StringListRow) => m("span", { className: "ah-mono" }, r.length.toLocaleString()) },
                { label: "Heap", render: (r: StringListRow) => m("span", { className: "ah-info-grid__label" }, r.heap) },
                { label: "Value", render: (r: StringListRow) =>
                  m("span", null,
                    m("button", {
                      className: "ah-link",
                      onclick: () => navigate("object", { id: r.id, label: `"${r.value.length > 40 ? r.value.slice(0, 40) + "\u2026" : r.value}"` }),
                    },
                      m("span", { className: "ah-mono ah-break-all", style: { color: "var(--ah-badge-string)" } },
                        "\"", r.value.length > 300 ? r.value.slice(0, 300) + "\u2026" : r.value, "\"")
                    )
                  ),
                },
              ],
              data: filtered,
              rowKey: (r: StringListRow) => r.id,
            })
          )
        ),
        (query || selectedHeap !== "all") && filtered.length === 0 && (
          m("div", { className: "ah-info-grid__label" }, "No matching strings.")
        )
      );
    },
  };
}

export default StringsView;
