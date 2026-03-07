import m from "mithril";
import { Fragment } from "../mithril-helpers";
import type { InstanceRow } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, SortableTable, InstanceLink } from "../components";
import { consumePendingScroll } from "../navigation";

export interface ObjectsParams { siteId: number; className: string; heap: string | null }

interface ObjectsViewAttrs { proxy: WorkerProxy; navigate: NavFn; params: ObjectsParams }

function ObjectsView(): m.Component<ObjectsViewAttrs> {
  let rows: InstanceRow[] | null = null;
  let prevSiteId: number | undefined;
  let prevClassName: string | undefined;
  let prevHeap: string | null | undefined;

  function fetchData(attrs: ObjectsViewAttrs) {
    const siteId: number = attrs.params.siteId ?? 0;
    const className: string = attrs.params.className ?? "";
    const heap: string | null = attrs.params.heap ?? null;
    prevSiteId = siteId;
    prevClassName = className;
    prevHeap = heap;
    rows = null;
    attrs.proxy.query<InstanceRow[]>("getObjects", { siteId, className, heap })
      .then(r => { rows = r; m.redraw(); consumePendingScroll(); })
      .catch(console.error);
  }

  return {
    oninit(vnode) {
      fetchData(vnode.attrs);
    },
    onupdate(vnode) {
      const siteId = vnode.attrs.params.siteId ?? 0;
      const className = vnode.attrs.params.className ?? "";
      const heap = vnode.attrs.params.heap ?? null;
      if (siteId !== prevSiteId || className !== prevClassName || heap !== prevHeap) {
        fetchData(vnode.attrs);
      }
    },
    view(vnode) {
      const className: string = vnode.attrs.params.className ?? "";
      const heap: string | null = vnode.attrs.params.heap ?? null;
      const navigate = vnode.attrs.navigate;

      if (!rows) return m("div", { className: "ah-loading" }, "Loading\u2026");

      return m("div", null,
        m("h2", { className: "ah-view-heading" }, "Instances"),
        m("div", { className: "ah-card--compact ah-mb-3" },
          m("div", { className: "ah-info-grid--compact" },
            m("span", { className: "ah-info-grid__label" }, "Class:"),
            m("span", { className: "ah-mono" }, className),
            heap && m(Fragment, null, m("span", { className: "ah-info-grid__label" }, "Heap:"), m("span", null, heap)),
            m("span", { className: "ah-info-grid__label" }, "Count:"),
            m("span", { className: "ah-mono" }, rows.length.toLocaleString())
          )
        ),
        m(SortableTable, {
          columns: [
            { label: "Size", align: "right", sortKey: (r: InstanceRow) => r.shallowJava + r.shallowNative, render: (r: InstanceRow) => m("span", { className: "ah-mono" }, fmtSize(r.shallowJava + r.shallowNative)) },
            { label: "Heap", render: (r: InstanceRow) => m("span", null, r.heap) },
            { label: "Object", render: (r: InstanceRow) => m(InstanceLink, { row: r, navigate }) },
          ],
          data: rows,
          rowKey: (r: InstanceRow) => r.id,
        })
      );
    },
  };
}

export default ObjectsView;
