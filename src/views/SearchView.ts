import m from "mithril";
import type { InstanceRow } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, SortableTable, InstanceLink } from "../components";

interface SearchViewAttrs { proxy: WorkerProxy; navigate: NavFn; initialQuery?: string }

function SearchView(): m.Component<SearchViewAttrs> {
  let query = "";
  let results: InstanceRow[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let searched = false;

  function doSearch(q: string, proxy: WorkerProxy) {
    if (q.length < 2) { results = []; m.redraw(); return; }
    proxy.query<InstanceRow[]>("search", { query: q })
      .then(r => { results = r; m.redraw(); })
      .catch(console.error);
  }

  function handleChange(q: string, proxy: WorkerProxy) {
    query = q;
    if (timer) clearTimeout(timer);
    if (q.length < 2) { results = []; return; }
    timer = setTimeout(() => {
      doSearch(q, proxy);
      // Update URL without adding to history
      const url = q ? `/search?q=${encodeURIComponent(q)}` : "/search";
      const prev = window.history.state;
      window.history.replaceState({ view: "search", params: { q }, trail: prev?.trail, trailIndex: prev?.trailIndex }, "", url);
    }, 300);
  }

  return {
    oninit(vnode) {
      const { initialQuery, proxy } = vnode.attrs;
      query = initialQuery ?? "";
      if (initialQuery && initialQuery.length >= 2 && !searched) {
        searched = true;
        doSearch(initialQuery, proxy);
      }
    },
    onremove() {
      if (timer) clearTimeout(timer);
    },
    view(vnode) {
      const { navigate, proxy } = vnode.attrs;

      return m("div", null,
        m("h2", { className: "ah-view-heading" }, "Search"),
        m("input", {
          type: "text", value: query, oninput: (e: Event) => handleChange((e.target as HTMLInputElement).value, proxy),
          placeholder: "Class name or 0x\u2026 hex id",
          className: "ah-input",
        }),
        results.length > 0 && (
          m(SortableTable, {
            columns: [
              { label: "Retained", align: "right", sortKey: (r: InstanceRow) => r.retainedTotal, render: (r: InstanceRow) => m("span", { className: "ah-mono" }, fmtSize(r.retainedTotal)) },
              { label: "Object", render: (r: InstanceRow) => m(InstanceLink, { row: r, navigate }) },
            ],
            data: results,
            rowKey: (r: InstanceRow) => r.id,
          })
        ),
        query.length >= 2 && results.length === 0 && (
          m("div", { className: "ah-info-grid__label" }, "No results found.")
        )
      );
    },
  };
}

export default SearchView;
