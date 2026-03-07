import m from "mithril";
import type { InstanceRow, HeapInfo } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize, fmtSizeDelta } from "../format";
import { type NavFn, SortableTable, InstanceLink } from "../components";

interface RootedViewAttrs { proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn; isDiffed: boolean }

function RootedView(): m.Component<RootedViewAttrs> {
  let rows: InstanceRow[] | null = null;

  return {
    oninit(vnode) {
      vnode.attrs.proxy.query<InstanceRow[]>("getRooted")
        .then(r => { rows = r; m.redraw(); })
        .catch(console.error);
    },
    view(vnode) {
      const { heaps, navigate, isDiffed } = vnode.attrs;

      if (!rows) return m("div", { className: "ah-loading" }, "Loading\u2026");

      const heapCols = heaps.filter(h => h.java + h.native_ > 0);
      const diffed = isDiffed && rows.some(r => r.baselineRetainedTotal !== undefined);

      type Col = { label: string; align?: string; minWidth?: string; sortKey?: (r: InstanceRow) => number; render: (r: InstanceRow, idx: number) => m.Children };
      const cols: Col[] = [
        {
          label: "Retained", align: "right", minWidth: "5rem",
          sortKey: r => r.retainedTotal,
          render: r => m("span", { className: `ah-mono${r.isPlaceHolder ? " ah-opacity-60" : ""}` }, fmtSize(r.retainedTotal)),
        },
      ];
      if (diffed) {
        cols.push({
          label: "\u0394", align: "right", minWidth: "5rem",
          sortKey: r => r.retainedTotal - (r.baselineRetainedTotal ?? r.retainedTotal),
          render: r => {
            const d = r.retainedTotal - (r.baselineRetainedTotal ?? r.retainedTotal);
            if (r.baselineRetainedTotal === undefined || d === 0) return null;
            return m("span", { className: `ah-mono ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}` }, fmtSizeDelta(d));
          },
        });
      }
      for (const h of heapCols) {
        cols.push({
          label: h.name, align: "right", minWidth: "5rem",
          sortKey: (r: InstanceRow) => {
            const s = r.retainedByHeap.find(x => x.heap === h.name);
            return (s?.java ?? 0) + (s?.native_ ?? 0);
          },
          render: (r: InstanceRow) => {
            const s = r.retainedByHeap.find(x => x.heap === h.name);
            return m("span", { className: `ah-mono${r.isPlaceHolder ? " ah-opacity-60" : ""}` }, fmtSize((s?.java ?? 0) + (s?.native_ ?? 0)));
          },
        });
        if (diffed) {
          cols.push({
            label: "\u0394", align: "right", minWidth: "5rem",
            sortKey: (r: InstanceRow) => {
              const s = r.retainedByHeap.find(x => x.heap === h.name);
              const bs = r.baselineRetainedByHeap?.find(x => x.heap === h.name);
              return ((s?.java ?? 0) + (s?.native_ ?? 0)) - ((bs?.java ?? 0) + (bs?.native_ ?? 0));
            },
            render: (r: InstanceRow) => {
              const s = r.retainedByHeap.find(x => x.heap === h.name);
              const bs = r.baselineRetainedByHeap?.find(x => x.heap === h.name);
              const d = ((s?.java ?? 0) + (s?.native_ ?? 0)) - ((bs?.java ?? 0) + (bs?.native_ ?? 0));
              if (d === 0 || !bs) return null;
              return m("span", { className: `ah-mono ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}` }, fmtSizeDelta(d));
            },
          });
        }
      }
      cols.push({
        label: "Object",
        render: r => m("span", { className: r.isPlaceHolder ? "ah-opacity-60" : "" },
          m(InstanceLink, { row: r, navigate })),
      });

      return m("div", null,
        m("h2", { className: "ah-view-heading" }, "Rooted"),
        m(SortableTable, { columns: cols, data: rows, rowKey: (r: InstanceRow) => r.id })
      );
    },
  };
}

export default RootedView;
