import { useState, useEffect } from "react";
import type { InstanceRow, HeapInfo } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize, fmtSizeDelta } from "../format";
import { type NavFn, SortableTable, InstanceLink } from "../components";

function RootedView({ proxy, heaps, navigate, isDiffed }: { proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn; isDiffed: boolean }) {
  const [rows, setRows] = useState<InstanceRow[] | null>(null);
  useEffect(() => {
    proxy.query<InstanceRow[]>("getRooted").then(setRows).catch(console.error);
  }, [proxy]);

  if (!rows) return <div className="text-stone-400 p-4">Loading&hellip;</div>;

  const heapCols = heaps.filter(h => h.java + h.native_ > 0);
  const diffed = isDiffed && rows.some(r => r.baselineRetainedTotal !== undefined);

  type Col = { label: string; align?: string; minWidth?: string; sortKey?: (r: InstanceRow) => number; render: (r: InstanceRow, idx: number) => React.ReactNode };
  const cols: Col[] = [
    {
      label: "Retained", align: "right", minWidth: "5rem",
      sortKey: r => r.retainedTotal,
      render: r => <span className={`font-mono ${r.isPlaceHolder ? "opacity-60" : ""}`}>{fmtSize(r.retainedTotal)}</span>,
    },
  ];
  if (diffed) {
    cols.push({
      label: "\u0394", align: "right", minWidth: "5rem",
      sortKey: r => r.retainedTotal - (r.baselineRetainedTotal ?? r.retainedTotal),
      render: r => {
        const d = r.retainedTotal - (r.baselineRetainedTotal ?? r.retainedTotal);
        if (r.baselineRetainedTotal === undefined || d === 0) return null;
        return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-red-700" : "text-green-700"}`}>{fmtSizeDelta(d)}</span>;
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
        return <span className={`font-mono ${r.isPlaceHolder ? "opacity-60" : ""}`}>{fmtSize((s?.java ?? 0) + (s?.native_ ?? 0))}</span>;
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
          return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-red-700" : "text-green-700"}`}>{fmtSizeDelta(d)}</span>;
        },
      });
    }
  }
  cols.push({
    label: "Object",
    render: r => (
      <span className={r.isPlaceHolder ? "opacity-60" : ""}>
        <InstanceLink row={r} navigate={navigate} />
      </span>
    ),
  });

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Rooted</h2>
      <SortableTable<InstanceRow> columns={cols} data={rows} rowKey={r => r.id} />
    </div>
  );
}

export default RootedView;
