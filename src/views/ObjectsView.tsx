import { useState, useEffect } from "react";
import type { InstanceRow } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, SortableTable, InstanceLink } from "../components";

export interface ObjectsParams { siteId: number; className: string; heap: string | null }

function ObjectsView({ proxy, navigate, params }: { proxy: WorkerProxy; navigate: NavFn; params: ObjectsParams }) {
  const siteId: number = params.siteId ?? 0;
  const className: string = params.className ?? "";
  const heap: string | null = params.heap ?? null;
  const [rows, setRows] = useState<InstanceRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    proxy.query<InstanceRow[]>("getObjects", { siteId, className, heap })
      .then(setRows).catch(console.error);
  }, [proxy, siteId, className, heap]);

  if (!rows) return <div className="text-stone-400 p-4">Loading&hellip;</div>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Instances</h2>
      <div className="bg-white border border-stone-200 p-3 mb-3">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <span className="text-stone-500">Class:</span>
          <span className="font-mono">{className}</span>
          {heap && <><span className="text-stone-500">Heap:</span><span>{heap}</span></>}
          <span className="text-stone-500">Count:</span>
          <span className="font-mono">{rows.length.toLocaleString()}</span>
        </div>
      </div>
      <SortableTable<InstanceRow>
        columns={[
          { label: "Size", align: "right", sortKey: r => r.shallowJava + r.shallowNative, render: r => <span className="font-mono">{fmtSize(r.shallowJava + r.shallowNative)}</span> },
          { label: "Heap", render: r => <span>{r.heap}</span> },
          { label: "Object", render: r => <InstanceLink row={r} navigate={navigate} /> },
        ]}
        data={rows}
        rowKey={r => r.id}
      />
    </div>
  );
}

export default ObjectsView;
