import m from "mithril";
import { Fragment } from "../mithril-helpers";
import type { InstanceRow } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, SortableTable, InstanceLink } from "../components";

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
      .then(r => { rows = r; m.redraw(); })
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

      if (!rows) return <div className="ah-loading">Loading&hellip;</div>;

      return (
        <div>
          <h2 className="ah-view-heading">Instances</h2>
          <div className="ah-card--compact ah-mb-3">
            <div className="ah-info-grid--compact">
              <span className="ah-info-grid__label">Class:</span>
              <span className="ah-mono">{className}</span>
              {heap && <><span className="ah-info-grid__label">Heap:</span><span>{heap}</span></>}
              <span className="ah-info-grid__label">Count:</span>
              <span className="ah-mono">{rows.length.toLocaleString()}</span>
            </div>
          </div>
          <SortableTable<InstanceRow>
            columns={[
              { label: "Size", align: "right", sortKey: (r: InstanceRow) => r.shallowJava + r.shallowNative, render: (r: InstanceRow) => <span className="ah-mono">{fmtSize(r.shallowJava + r.shallowNative)}</span> },
              { label: "Heap", render: (r: InstanceRow) => <span>{r.heap}</span> },
              { label: "Object", render: (r: InstanceRow) => <InstanceLink row={r} navigate={navigate} /> },
            ]}
            data={rows}
            rowKey={(r: InstanceRow) => r.id}
          />
        </div>
      );
    },
  };
}

export default ObjectsView;
