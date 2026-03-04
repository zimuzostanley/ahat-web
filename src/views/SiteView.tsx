import { useState, useEffect } from "react";
import type { SiteData, SiteChildRow, SiteObjectsRow, HeapInfo } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize, fmtSizeDelta } from "../format";
import { type NavFn, SiteLinkRaw, Section, SortableTable, InstanceLink } from "../components";

export interface SiteParams { id: number }

function SiteView({ proxy, heaps, navigate, params, isDiffed }: { proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn; params: SiteParams; isDiffed: boolean }) {
  const [data, setData] = useState<SiteData | null>(null);
  useEffect(() => {
    setData(null);
    proxy.query<SiteData>("getSite", { id: params.id ?? 0 }).then(setData).catch(console.error);
  }, [proxy, params.id]);

  if (!data) return <div className="text-stone-400 p-4">Loading&hellip;</div>;
  const heapCols = heaps.filter(h => h.java + h.native_ > 0);
  const childDiffed = isDiffed && data.children.some(c => c.baselineTotalJava !== undefined);
  const objDiffed = isDiffed && data.objectsInfos.some(o => o.baselineNumInstances !== undefined);

  // Build child site columns
  type ChildCol = { label: string; align?: string; minWidth?: string; sortKey?: (r: SiteChildRow) => number; render: (r: SiteChildRow, idx: number) => React.ReactNode };
  const childCols: ChildCol[] = [
    { label: "Total Size", align: "right", minWidth: "5rem", sortKey: r => r.totalJava + r.totalNative, render: r => <span className="font-mono">{fmtSize(r.totalJava + r.totalNative)}</span> },
  ];
  if (childDiffed) {
    childCols.push({
      label: "\u0394", align: "right", minWidth: "5rem",
      sortKey: r => (r.totalJava + r.totalNative) - ((r.baselineTotalJava ?? r.totalJava) + (r.baselineTotalNative ?? r.totalNative)),
      render: r => {
        const d = (r.totalJava + r.totalNative) - ((r.baselineTotalJava ?? r.totalJava) + (r.baselineTotalNative ?? r.totalNative));
        if (d === 0) return null;
        return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-red-700" : "text-green-700"}`}>{fmtSizeDelta(d)}</span>;
      },
    });
  }
  for (const h of heapCols) {
    childCols.push({
      label: h.name, align: "right",
      sortKey: (r: SiteChildRow) => { const s = r.byHeap.find(x => x.heap === h.name); return (s?.java ?? 0) + (s?.native_ ?? 0); },
      render: (r: SiteChildRow) => { const s = r.byHeap.find(x => x.heap === h.name); return <span className="font-mono">{fmtSize((s?.java ?? 0) + (s?.native_ ?? 0))}</span>; },
    });
  }
  childCols.push({ label: "Child Site", render: r => <SiteLinkRaw {...r} navigate={navigate} /> });

  // Build objects allocated columns
  type ObjCol = { label: string; align?: string; minWidth?: string; sortKey?: (r: SiteObjectsRow) => number; render: (r: SiteObjectsRow, idx: number) => React.ReactNode };
  const objCols: ObjCol[] = [
    { label: "Size", align: "right", minWidth: "5rem", sortKey: r => r.java + r.native_, render: r => <span className="font-mono">{fmtSize(r.java + r.native_)}</span> },
  ];
  if (objDiffed) {
    objCols.push({
      label: "\u0394 Size", align: "right", minWidth: "5rem",
      sortKey: r => (r.java + r.native_) - ((r.baselineJava ?? r.java) + (r.baselineNative ?? r.native_)),
      render: r => {
        const d = (r.java + r.native_) - ((r.baselineJava ?? r.java) + (r.baselineNative ?? r.native_));
        if (d === 0) return null;
        return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-red-700" : "text-green-700"}`}>{fmtSizeDelta(d)}</span>;
      },
    });
  }
  objCols.push({
    label: "Instances", align: "right", minWidth: "4rem",
    sortKey: r => r.numInstances,
    render: r => (
      <button className="text-sky-700 underline decoration-sky-300 hover:decoration-sky-500 font-mono"
        onClick={() => navigate("objects", { siteId: data.id, className: r.className, heap: r.heap })}>
        {r.numInstances.toLocaleString()}
      </button>
    ),
  });
  if (objDiffed) {
    objCols.push({
      label: "\u0394 #", align: "right", minWidth: "4rem",
      sortKey: r => r.numInstances - (r.baselineNumInstances ?? r.numInstances),
      render: r => {
        const d = r.numInstances - (r.baselineNumInstances ?? r.numInstances);
        if (d === 0) return null;
        return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-red-700" : "text-green-700"}`}>{d > 0 ? "+" : "\u2212"}{Math.abs(d).toLocaleString()}</span>;
      },
    });
  }
  objCols.push({ label: "Heap", render: r => <span>{r.heap}</span> });
  objCols.push({
    label: "Class", render: r => r.classObjId != null
      ? <InstanceLink row={{ id: r.classObjId, display: r.className }} navigate={navigate} />
      : <span>{r.className}</span>,
  });

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold mb-1 text-stone-800">Site</h2>
        <SiteLinkRaw {...data} navigate={navigate} />
      </div>

      <Section title="Allocation Site">
        <div className="space-y-0.5">
          {data.chain.map((s, i) => (
            <div key={i} style={{ paddingLeft: Math.min(i, 20) * 16 }}>{i > 0 && "\u2192 "}<SiteLinkRaw {...s} navigate={navigate} /></div>
          ))}
        </div>
      </Section>

      {data.children.length > 0 && (
        <Section title="Sites Called from Here">
          <SortableTable<SiteChildRow> columns={childCols} data={data.children} />
        </Section>
      )}

      <Section title="Objects Allocated">
        <SortableTable<SiteObjectsRow> columns={objCols} data={data.objectsInfos} />
      </Section>
    </div>
  );
}

export default SiteView;
