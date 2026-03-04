import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type {
  OverviewData, HeapInfo,
  InstanceRow, InstanceDetail, DiffedField,
  SiteData, SiteChildRow, SiteObjectsRow,
  PrimOrRef, BitmapListRow,
} from "./hprof.worker";
import { AdbConnection } from "./adb/capture";
import HprofWorkerInline from "./hprof.worker.ts?worker&inline";
import { type WorkerProxy, makeWorkerProxy } from "./worker-proxy";
import { stateToUrl, urlToState } from "./routing";
import { fmtSize, fmtHex, fmtSizeDelta, deltaBgClassBytes } from "./format";
import CaptureView from "./views/CaptureView";

// Re-export format helpers for backward compatibility with tests
export { deltaBgClass, fmtDelta, fmtSizeDelta, deltaBgClassBytes } from "./format";

// ─── Navigation types ─────────────────────────────────────────────────────────

type NavFn = (view: string, params?: Record<string, unknown>) => void;

// ─── Reusable components ──────────────────────────────────────────────────────

const SHOW_LIMIT = 200;

/** Minimal shape for rendering a clickable object link. */
type ObjLinkRef = { id: number; display: string; str?: string | null };

function InstanceLink({ row, navigate }: { row: InstanceRow | ObjLinkRef | null; navigate: NavFn }) {
  if (!row || row.id === 0) return <span className="text-stone-500">ROOT</span>;
  const full = "className" in row ? row as InstanceRow : null;
  return (
    <span>
      {full && full.reachabilityName !== "unreachable" && full.reachabilityName !== "strong" && (
        <span className="text-amber-600 text-xs mr-1">{full.reachabilityName}</span>
      )}
      {full?.isRoot && <span className="text-rose-500 text-xs mr-1">root</span>}
      <button
        className="text-sky-700 hover:text-sky-500 underline decoration-sky-300 hover:decoration-sky-500"
        onClick={() => navigate("object", { id: row.id })}
      >
        {row.display}
      </button>
      {row.str != null && (
        <span className="text-emerald-700 ml-1">
          "{row.str.length > 80 ? row.str.slice(0, 80) + "\u2026" : row.str}"
        </span>
      )}
      {full?.referent && (
        <span className="text-stone-500 ml-1">
          {" "}for <InstanceLink row={full.referent} navigate={navigate} />
        </span>
      )}
    </span>
  );
}

function SiteLinkRaw({ id, method, signature, filename, line, navigate }: {
  id: number; method: string; signature: string; filename: string; line: number; navigate: NavFn;
}) {
  const text = `${method}${signature} - ${filename}${line > 0 ? ":" + line : ""}`;
  return (
    <button
      className="text-sky-700 hover:text-sky-500 underline decoration-sky-300 hover:decoration-sky-500"
      onClick={() => navigate("site", { id })}
    >{text}</button>
  );
}

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-stone-200">
      <button
        className="w-full px-4 py-2 flex justify-between items-center text-left hover:bg-stone-50"
        onClick={() => setOpen(!open)}
      >
        <span className="text-sm font-semibold text-stone-700">{title}</span>
        <span className="text-stone-400 text-xs">{open ? "\u25BC" : "\u25B6"}</span>
      </button>
      {open && <div className="px-4 pb-3 border-t border-stone-100 pt-3 overflow-x-auto">{children}</div>}
    </div>
  );
}

function SortableTable<T>({ columns, data, limit = SHOW_LIMIT, rowKey }: {
  columns: {
    label: string;
    align?: string;
    sortKey?: (row: T) => number;
    render: (row: T, idx: number) => React.ReactNode;
  }[];
  data: T[];
  limit?: number;
  rowKey?: (row: T, idx: number) => string | number;
}) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [showCount, setShowCount] = useState(limit);

  const sorted = useMemo(() => {
    if (sortCol === null || !columns[sortCol].sortKey) return data;
    const key = columns[sortCol].sortKey!;
    const copy = [...data];
    copy.sort((a, b) => sortAsc ? key(a) - key(b) : key(b) - key(a));
    return copy;
  }, [data, sortCol, sortAsc, columns]);

  const visible = sorted.slice(0, showCount);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className="px-2 py-1.5 text-left bg-stone-700 text-stone-200 text-xs font-medium cursor-pointer select-none whitespace-nowrap border-b border-stone-600"
                onClick={() => { if (sortCol === i) setSortAsc(!sortAsc); else { setSortCol(i); setSortAsc(false); } }}
              >
                {c.label} {sortCol === i ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, ri) => (
            <tr key={rowKey ? rowKey(row, ri) : ri} className="border-b border-stone-200 hover:bg-stone-50">
              {columns.map((c, ci) => (
                <td key={ci} className={`px-2 py-1 ${c.align === "right" ? "text-right font-mono whitespace-nowrap" : ""}`}>
                  {c.render(row, ri)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > showCount && (
        <div className="text-xs text-stone-500 py-2">
          Showing {showCount} of {sorted.length}
          {" \u2014 "}
          <button className="text-sky-600 ml-1 hover:underline" onClick={() => setShowCount(Math.min(showCount + 500, sorted.length))}>show more</button>
          {" "}
          <button className="text-sky-600 ml-2 hover:underline" onClick={() => setShowCount(sorted.length)}>show all</button>
        </div>
      )}
    </div>
  );
}

function PrimOrRefCell({ v, navigate }: { v: PrimOrRef; navigate: NavFn }) {
  if (v.kind === "ref") {
    return <InstanceLink row={{ id: v.id, display: v.display, str: v.str }} navigate={navigate} />;
  }
  return <span className="font-mono">{v.v}</span>;
}

/** Renders a bitmap from either raw RGBA data or a compressed image blob. */
function BitmapImage({ width, height, format, data }: {
  width: number; height: number; format: string; data: Uint8Array;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (format === "rgba") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const clamped = new Uint8ClampedArray(data.length);
      clamped.set(data);
      ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
      return;
    }
    const mimeMap: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
    const copy = new Uint8Array(data.length);
    copy.set(data);
    const blob = new Blob([copy], { type: mimeMap[format] ?? "image/png" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [width, height, format, data]);

  if (format === "rgba") {
    return <canvas ref={canvasRef} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", imageRendering: "pixelated" }} />;
  }
  if (!blobUrl) return null;
  return <img src={blobUrl} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", imageRendering: "pixelated" }} />;
}

// ─── Views ────────────────────────────────────────────────────────────────────

function DeltaCell({ current, baseline }: { current: number; baseline: number }) {
  const d = current - baseline;
  if (d === 0) return <td className="py-1 px-2 text-right font-mono" />;
  return (
    <td className={`py-1 px-2 text-right font-mono whitespace-nowrap ${d > 0 ? "text-green-700" : "text-red-700"} ${deltaBgClassBytes(d)}`}>
      {fmtSizeDelta(d)}
    </td>
  );
}

function OverviewView({ overview, sessions, activeSessionId, onSwitch, onDiscard, navigate }: {
  overview: OverviewData;
  sessions: Session[];
  activeSessionId: string | null;
  onSwitch: (id: string) => void;
  onDiscard: (id: string) => void;
  navigate: NavFn;
}) {
  const diffed = overview.isDiffed ?? false;
  const baseHeaps = overview.baselineHeaps;
  // Filter to heaps with non-zero current or baseline sizes
  const heapIndices: number[] = [];
  for (let i = 0; i < overview.heaps.length; i++) {
    const h = overview.heaps[i];
    const bh = baseHeaps?.[i];
    if (h.java + h.native_ > 0 || (bh && bh.java + bh.native_ > 0)) heapIndices.push(i);
  }
  const heaps = heapIndices.map(i => overview.heaps[i]);
  const totalJava = heaps.reduce((a, h) => a + h.java, 0);
  const totalNative = heaps.reduce((a, h) => a + h.native_, 0);
  const baseTotalJava = diffed ? heapIndices.reduce((a, i) => a + (baseHeaps![i]?.java ?? 0), 0) : 0;
  const baseTotalNative = diffed ? heapIndices.reduce((a, i) => a + (baseHeaps![i]?.native_ ?? 0), 0) : 0;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Overview</h2>

      <div className="bg-white border border-stone-200 p-4 mb-4">
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">General Information</h3>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 max-w-md items-center">
          <span className="text-stone-500">Heap Dump:</span>
          <span className="flex items-center gap-2">
            <select
              className="text-sm bg-transparent text-stone-800 border-b border-stone-200 focus:border-sky-500 outline-none py-0.5 pr-4 cursor-pointer"
              value={activeSessionId ?? ""}
              onChange={e => onSwitch(e.target.value)}
            >
              {sessions.map(s => {
                const sh = s.overview.heaps.filter(h => h.java + h.native_ > 0);
                const total = sh.reduce((a, h) => a + h.java + h.native_, 0);
                return (
                  <option key={s.id} value={s.id} title={`${s.overview.instanceCount.toLocaleString()} instances, ${fmtSize(total)} retained`}>
                    {s.name}
                  </option>
                );
              })}
            </select>
            {sessions.length > 1 && (
              <button
                className="text-stone-300 hover:text-rose-500 text-xs"
                onClick={() => activeSessionId && onDiscard(activeSessionId)}
                title="Close this heap dump"
              >&times;</button>
            )}
          </span>
          <span className="text-stone-500">Total Instances:</span>
          <span className="font-mono">
            {overview.instanceCount.toLocaleString()}
            {diffed && overview.baselineInstanceCount != null && overview.instanceCount !== overview.baselineInstanceCount && (
              <span className={`ml-2 whitespace-nowrap ${overview.instanceCount - overview.baselineInstanceCount > 0 ? "text-green-700" : "text-red-700"}`}>
                {(overview.instanceCount - overview.baselineInstanceCount > 0 ? "+" : "\u2212") + Math.abs(overview.instanceCount - overview.baselineInstanceCount).toLocaleString()}
              </span>
            )}
          </span>
          <span className="text-stone-500">Heaps:</span>
          <span>{heaps.map(h => h.name).join(", ")}</span>
        </div>
      </div>
      <div className="bg-white border border-stone-200 p-4">
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Bytes Retained by Heap</h3>
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left py-1 px-2 text-stone-600 text-xs font-medium">Heap</th>
              <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">Java Size</th>
              {diffed && <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">{"\u0394"}</th>}
              <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">Native Size</th>
              {diffed && <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">{"\u0394"}</th>}
              <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">Total Size</th>
              {diffed && <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">{"\u0394"}</th>}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b-2 border-stone-300 font-semibold">
              <td className="py-1 px-2">Total</td>
              <td className="py-1 px-2 text-right font-mono">{fmtSize(totalJava)}</td>
              {diffed && <DeltaCell current={totalJava} baseline={baseTotalJava} />}
              <td className="py-1 px-2 text-right font-mono">{fmtSize(totalNative)}</td>
              {diffed && <DeltaCell current={totalNative} baseline={baseTotalNative} />}
              <td className="py-1 px-2 text-right font-mono">{fmtSize(totalJava + totalNative)}</td>
              {diffed && <DeltaCell current={totalJava + totalNative} baseline={baseTotalJava + baseTotalNative} />}
            </tr>
            {heapIndices.map(i => {
              const h = overview.heaps[i];
              const bh = baseHeaps?.[i];
              return (
                <tr key={h.name} className="border-t border-stone-100">
                  <td className="py-1 px-2">{h.name}</td>
                  <td className="py-1 px-2 text-right font-mono">{fmtSize(h.java)}</td>
                  {diffed && bh && <DeltaCell current={h.java} baseline={bh.java} />}
                  <td className="py-1 px-2 text-right font-mono">{fmtSize(h.native_)}</td>
                  {diffed && bh && <DeltaCell current={h.native_} baseline={bh.native_} />}
                  <td className="py-1 px-2 text-right font-mono font-semibold">{fmtSize(h.java + h.native_)}</td>
                  {diffed && bh && <DeltaCell current={h.java + h.native_} baseline={bh.java + bh.native_} />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {overview.duplicateBitmaps && overview.duplicateBitmaps.length > 0 && (
        <div className="bg-white border border-stone-200 p-4 mt-4">
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Heap Analysis Results</h3>
          <p className="text-sm text-stone-700 mb-2">
            {overview.duplicateBitmaps.length} group{overview.duplicateBitmaps.length > 1 ? "s" : ""} of duplicate bitmaps detected, wasting{" "}
            <span className="font-mono font-semibold">{fmtSize(overview.duplicateBitmaps.reduce((a, g) => a + g.wastedBytes, 0))}</span>.{" "}
            <button className="text-sky-600 hover:underline" onClick={() => navigate("/bitmaps")}>View Bitmaps</button>
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left py-1 px-2 text-stone-600 text-xs font-medium">Dimensions</th>
                <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">Copies</th>
                <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">Total</th>
                <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">Wasted</th>
              </tr>
            </thead>
            <tbody>
              {overview.duplicateBitmaps.map((g, i) => (
                <tr key={i} className="border-t border-stone-100">
                  <td className="py-1 px-2 font-mono">{g.width} {"\u00d7"} {g.height}</td>
                  <td className="py-1 px-2 text-right font-mono">{g.count}</td>
                  <td className="py-1 px-2 text-right font-mono">{fmtSize(g.totalBytes)}</td>
                  <td className="py-1 px-2 text-right font-mono text-rose-600">{fmtSize(g.wastedBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RootedView({ proxy, heaps, navigate, isDiffed }: { proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn; isDiffed: boolean }) {
  const [rows, setRows] = useState<InstanceRow[] | null>(null);
  useEffect(() => {
    proxy.query<InstanceRow[]>("getRooted").then(setRows).catch(console.error);
  }, [proxy]);

  if (!rows) return <div className="text-stone-400 p-4">Loading&hellip;</div>;

  const heapCols = heaps.filter(h => h.java + h.native_ > 0);
  const diffed = isDiffed && rows.some(r => r.baselineRetainedTotal !== undefined);

  type Col = { label: string; align?: string; sortKey?: (r: InstanceRow) => number; render: (r: InstanceRow, idx: number) => React.ReactNode };
  const cols: Col[] = [
    {
      label: "Retained", align: "right",
      sortKey: r => r.retainedTotal,
      render: r => <span className={`font-mono ${r.isPlaceHolder ? "opacity-60" : ""}`}>{fmtSize(r.retainedTotal)}</span>,
    },
  ];
  if (diffed) {
    cols.push({
      label: "\u0394", align: "right",
      sortKey: r => r.retainedTotal - (r.baselineRetainedTotal ?? r.retainedTotal),
      render: r => {
        const d = r.retainedTotal - (r.baselineRetainedTotal ?? r.retainedTotal);
        if (r.baselineRetainedTotal === undefined || d === 0) return null;
        return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-green-700" : "text-red-700"}`}>{fmtSizeDelta(d)}</span>;
      },
    });
  }
  for (const h of heapCols) {
    cols.push({
      label: h.name, align: "right",
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
        label: "\u0394", align: "right",
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
          return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-green-700" : "text-red-700"}`}>{fmtSizeDelta(d)}</span>;
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

interface ObjectParams { id: number }
interface ObjectsParams { siteId: number; className: string; heap: string | null }
interface SiteParams { id: number }

function ObjectView({ proxy, heaps, navigate, params }: {
  proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn; params: ObjectParams;
}) {
  const [detail, setDetail] = useState<InstanceDetail | null | "loading">("loading");

  useEffect(() => {
    setDetail("loading");
    proxy.query<InstanceDetail | null>("getInstance", { id: params.id })
      .then(setDetail)
      .catch(err => { console.error(err); setDetail(null); });
  }, [proxy, params.id]);

  if (detail === "loading") return <div className="text-stone-400 p-4">Loading&hellip;</div>;
  if (!detail) return <div className="text-rose-600 p-4">No object with id {fmtHex(params.id)}</div>;

  const { row } = detail;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold mb-1 text-stone-800">Object {fmtHex(row.id)}</h2>
        <div className="text-base"><InstanceLink row={row} navigate={navigate} /></div>
      </div>

      {detail.bitmap && (
        <Section title="Bitmap Image">
          <BitmapImage width={detail.bitmap.width} height={detail.bitmap.height} format={detail.bitmap.format} data={detail.bitmap.data} />
          <div className="text-xs text-stone-500 mt-1">{detail.bitmap.width} x {detail.bitmap.height} px ({detail.bitmap.format.toUpperCase()})</div>
        </Section>
      )}

      {detail.siteId > 0 && (
        <Section title="Allocation Site">
          <div className="space-y-0.5">
            <SiteChainView siteId={detail.siteId} proxy={proxy} navigate={navigate} />
          </div>
        </Section>
      )}

      {detail.pathFromRoot && (
        <Section title={detail.isUnreachablePath ? "Sample Path" : "Sample Path from GC Root"}>
          <div className="space-y-0.5">
            {detail.pathFromRoot.map((pe, i) => (
              <div key={i} className={`flex items-baseline gap-1 min-w-0 ${pe.isDominator ? "font-semibold" : ""}`} style={{ paddingLeft: Math.min(i, 20) * 12 }}>
                <span className="text-stone-400">{i === 0 ? "" : "\u2192"}</span>
                <InstanceLink row={pe.row} navigate={navigate} />
                {pe.field && <span className="text-stone-500">{pe.field}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Object Info">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <span className="text-stone-500">Class:</span>
          <span>{detail.classObjRow ? <InstanceLink row={detail.classObjRow} navigate={navigate} /> : "???"}</span>
          <span className="text-stone-500">Heap:</span>
          <span>{row.heap}</span>
          {row.isRoot && (
            <><span className="text-stone-500">Root Types:</span><span>{row.rootTypeNames?.join(", ")}</span></>
          )}
        </div>
      </Section>

      <Section title="Object Size">
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <span className="text-stone-500">Shallow Size:</span>
          <span className="font-mono">
            {fmtSize(row.shallowJava + row.shallowNative)}
            {row.shallowNative > 0 && <span className="text-stone-400"> (java: {fmtSize(row.shallowJava)}, native: {fmtSize(row.shallowNative)})</span>}
            {row.baselineShallowJava !== undefined && (() => {
              const d = (row.shallowJava + row.shallowNative) - ((row.baselineShallowJava ?? 0) + (row.baselineShallowNative ?? 0));
              return d !== 0 ? <span className={`ml-2 whitespace-nowrap ${d > 0 ? "text-green-700" : "text-red-700"}`}>{fmtSizeDelta(d)}</span> : null;
            })()}
          </span>
          <span className="text-stone-500">Retained Size:</span>
          <span className="font-mono font-semibold">
            {fmtSize(row.retainedTotal)}
            {row.baselineRetainedTotal !== undefined && (() => {
              const d = row.retainedTotal - row.baselineRetainedTotal;
              return d !== 0 ? <span className={`ml-2 font-normal whitespace-nowrap ${d > 0 ? "text-green-700" : "text-red-700"}`}>{fmtSizeDelta(d)}</span> : null;
            })()}
          </span>
        </div>
      </Section>

      {detail.isClassObj && (
        <>
          <Section title="Class Info">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mb-3">
              <span className="text-stone-500">Super Class:</span>
              <span>{detail.superClassObjId != null
                ? <InstanceLink row={{ id: detail.superClassObjId, display: fmtHex(detail.superClassObjId) }} navigate={navigate} />
                : "none"}</span>
              <span className="text-stone-500">Instance Size:</span>
              <span className="font-mono">{detail.instanceSize}</span>
            </div>
          </Section>
          <Section title="Static Fields">
            <FieldsTable fields={detail.staticFields} diffedFields={detail.diffedStaticFields} navigate={navigate} />
          </Section>
        </>
      )}

      {detail.isClassInstance && (detail.instanceFields.length > 0 || (detail.diffedInstanceFields && detail.diffedInstanceFields.length > 0)) && (
        <Section title="Fields">
          <FieldsTable fields={detail.instanceFields} diffedFields={detail.diffedInstanceFields} navigate={navigate} />
        </Section>
      )}

      {detail.isArrayInstance && (
        <Section title={`Array Elements (${detail.arrayLength})`}>
          <ArrayView
            elems={detail.arrayElems}
            elemTypeName={detail.elemTypeName ?? "Object"}
            total={detail.arrayLength}
            navigate={navigate}
            onDownloadBytes={detail.elemTypeName === "byte" ? () => {
              proxy.query<ArrayBuffer | null>("getByteArray", { id: params.id })
                .then(buf => { if (buf) downloadBlob(`array-${fmtHex(params.id)}.bin`, buf); })
                .catch(console.error);
            } : undefined}
          />
        </Section>
      )}

      {detail.reverseRefs.length > 0 && (
        <Section title={`Objects with References to this Object (${detail.reverseRefs.length})`} defaultOpen={detail.reverseRefs.length < 50}>
          <SortableTable<InstanceRow>
            columns={[
              { label: "Object", render: r => <InstanceLink row={r} navigate={navigate} /> },
            ]}
            data={detail.reverseRefs}
            rowKey={r => r.id}
          />
        </Section>
      )}

      {detail.dominated.length > 0 && (
        <Section title={`Immediately Dominated Objects (${detail.dominated.length})`} defaultOpen={detail.dominated.length < 50}>
          <SortableTable<InstanceRow>
            columns={[
              { label: "Retained", align: "right", sortKey: r => r.retainedTotal, render: r => <span className="font-mono">{fmtSize(r.retainedTotal)}</span> },
              ...heaps.filter(h => h.java + h.native_ > 0).map(h => ({
                label: h.name, align: "right",
                sortKey: (r: InstanceRow) => {
                  const s = r.retainedByHeap.find(x => x.heap === h.name);
                  return (s?.java ?? 0) + (s?.native_ ?? 0);
                },
                render: (r: InstanceRow) => {
                  const s = r.retainedByHeap.find(x => x.heap === h.name);
                  return <span className="font-mono">{fmtSize((s?.java ?? 0) + (s?.native_ ?? 0))}</span>;
                },
              })),
              { label: "Object", render: r => <InstanceLink row={r} navigate={navigate} /> },
            ]}
            data={detail.dominated}
            rowKey={r => r.id}
          />
        </Section>
      )}
    </div>
  );
}

function SiteChainView({ siteId, proxy, navigate }: { siteId: number; proxy: WorkerProxy; navigate: NavFn }) {
  const [chain, setChain] = useState<SiteData["chain"] | null>(null);
  useEffect(() => {
    proxy.query<SiteData>("getSite", { id: siteId }).then(d => setChain(d.chain)).catch(console.error);
  }, [siteId, proxy]);
  if (!chain) return <span className="text-stone-400">&hellip;</span>;
  return <>{chain.map((s, i) => (
    <div key={i} style={{ paddingLeft: Math.min(i, 20) * 16 }}>
      {i > 0 && "\u2192 "}
      <SiteLinkRaw {...s} navigate={navigate} />
    </div>
  ))}</>;
}

function FieldsTable({ fields, diffedFields, navigate }: {
  fields: { name: string; typeName: string; value: PrimOrRef }[];
  diffedFields?: DiffedField[];
  navigate: NavFn;
}) {
  if (diffedFields) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">Type</th>
              <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">Name</th>
              <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">Value</th>
              <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">{"\u0394"}</th>
            </tr>
          </thead>
          <tbody>
            {diffedFields.map((f, i) => (
              <tr key={i} className={`border-t border-stone-100 ${f.status === "deleted" ? "opacity-60" : ""}`}>
                <td className="px-2 py-0.5 text-stone-500 font-mono">{f.typeName}</td>
                <td className="px-2 py-0.5 font-mono">{f.name}</td>
                <td className="px-2 py-0.5">
                  {f.value ? <PrimOrRefCell v={f.value} navigate={navigate} /> : <span className="text-stone-400">{"\u2014"}</span>}
                </td>
                <td className="px-2 py-0.5 text-xs whitespace-nowrap">
                  {f.status === "added" && <span className="text-green-700 font-medium">new</span>}
                  {f.status === "deleted" && (
                    <span className="text-red-700">
                      <span className="font-medium">del</span>
                      {f.baselineValue && <>{" was "}<PrimOrRefCell v={f.baselineValue} navigate={navigate} /></>}
                    </span>
                  )}
                  {f.status === "matched" && f.baselineValue && (
                    <span className="text-amber-700">was <PrimOrRefCell v={f.baselineValue} navigate={navigate} /></span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">Type</th>
            <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">Name</th>
            <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={i} className="border-t border-stone-100">
              <td className="px-2 py-0.5 text-stone-500 font-mono">{f.typeName}</td>
              <td className="px-2 py-0.5 font-mono">{f.name}</td>
              <td className="px-2 py-0.5"><PrimOrRefCell v={f.value} navigate={navigate} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArrayView({ elems, elemTypeName, total, navigate, onDownloadBytes }: {
  elems: { idx: number; value: PrimOrRef; baselineValue?: PrimOrRef }[];
  elemTypeName: string;
  total: number;
  navigate: NavFn;
  onDownloadBytes?: () => void;
}) {
  const hasDiff = elems.some(e => e.baselineValue !== undefined);
  return (
    <div>
      {onDownloadBytes && (
        <div className="mb-2">
          <button className="text-xs text-sky-600 hover:underline" onClick={onDownloadBytes}>Download bytes</button>
        </div>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-right px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium w-16">Index</th>
            <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">Value ({elemTypeName})</th>
            {hasDiff && <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">{"\u0394"}</th>}
          </tr>
        </thead>
        <tbody>
          {elems.map(e => (
            <tr key={e.idx} className="border-t border-stone-100">
              <td className="px-2 py-0.5 text-right font-mono text-stone-400">{e.idx}</td>
              <td className="px-2 py-0.5"><PrimOrRefCell v={e.value} navigate={navigate} /></td>
              {hasDiff && (
                <td className="px-2 py-0.5 text-xs whitespace-nowrap">
                  {e.baselineValue && <span className="text-amber-700">was <PrimOrRefCell v={e.baselineValue} navigate={navigate} /></span>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {total > elems.length && (
        <div className="text-xs text-stone-500 pt-2">
          Showing first {elems.length.toLocaleString()} of {total.toLocaleString()} elements
        </div>
      )}
    </div>
  );
}

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
  type ChildCol = { label: string; align?: string; sortKey?: (r: SiteChildRow) => number; render: (r: SiteChildRow, idx: number) => React.ReactNode };
  const childCols: ChildCol[] = [
    { label: "Total Size", align: "right", sortKey: r => r.totalJava + r.totalNative, render: r => <span className="font-mono">{fmtSize(r.totalJava + r.totalNative)}</span> },
  ];
  if (childDiffed) {
    childCols.push({
      label: "\u0394", align: "right",
      sortKey: r => (r.totalJava + r.totalNative) - ((r.baselineTotalJava ?? r.totalJava) + (r.baselineTotalNative ?? r.totalNative)),
      render: r => {
        const d = (r.totalJava + r.totalNative) - ((r.baselineTotalJava ?? r.totalJava) + (r.baselineTotalNative ?? r.totalNative));
        if (d === 0) return null;
        return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-green-700" : "text-red-700"}`}>{fmtSizeDelta(d)}</span>;
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
  type ObjCol = { label: string; align?: string; sortKey?: (r: SiteObjectsRow) => number; render: (r: SiteObjectsRow, idx: number) => React.ReactNode };
  const objCols: ObjCol[] = [
    { label: "Size", align: "right", sortKey: r => r.java + r.native_, render: r => <span className="font-mono">{fmtSize(r.java + r.native_)}</span> },
  ];
  if (objDiffed) {
    objCols.push({
      label: "\u0394 Size", align: "right",
      sortKey: r => (r.java + r.native_) - ((r.baselineJava ?? r.java) + (r.baselineNative ?? r.native_)),
      render: r => {
        const d = (r.java + r.native_) - ((r.baselineJava ?? r.java) + (r.baselineNative ?? r.native_));
        if (d === 0) return null;
        return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-green-700" : "text-red-700"}`}>{fmtSizeDelta(d)}</span>;
      },
    });
  }
  objCols.push({
    label: "Instances", align: "right",
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
      label: "\u0394 #", align: "right",
      sortKey: r => r.numInstances - (r.baselineNumInstances ?? r.numInstances),
      render: r => {
        const d = r.numInstances - (r.baselineNumInstances ?? r.numInstances);
        if (d === 0) return null;
        return <span className={`font-mono whitespace-nowrap ${d > 0 ? "text-green-700" : "text-red-700"}`}>{d > 0 ? "+" : "\u2212"}{Math.abs(d).toLocaleString()}</span>;
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

function SearchView({ proxy, navigate, initialQuery }: { proxy: WorkerProxy; navigate: NavFn; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<InstanceRow[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchedRef = useRef(false);

  const doSearch = useCallback((q: string) => {
    if (q.length < 2) { setResults([]); return; }
    proxy.query<InstanceRow[]>("search", { query: q }).then(setResults).catch(console.error);
  }, [proxy]);

  // Run initial search from URL param
  useEffect(() => {
    if (initialQuery && initialQuery.length >= 2 && !searchedRef.current) {
      searchedRef.current = true;
      doSearch(initialQuery);
    }
  }, [initialQuery, doSearch]);

  const handleChange = useCallback((q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(() => {
      doSearch(q);
      // Update URL without adding to history
      const url = q ? `/search?q=${encodeURIComponent(q)}` : "/search";
      window.history.replaceState({ view: "search", params: { q } }, "", url);
    }, 300);
  }, [doSearch]);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Search</h2>
      <input
        type="text" value={query} onChange={e => handleChange(e.target.value)}
        placeholder={"Class name or 0x\u2026 hex id"}
        className="w-full px-3 py-2 border border-stone-300 mb-3 focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
      {results.length > 0 && (
        <SortableTable<InstanceRow>
          columns={[
            { label: "Retained", align: "right", sortKey: r => r.retainedTotal, render: r => <span className="font-mono">{fmtSize(r.retainedTotal)}</span> },
            { label: "Object", render: r => <InstanceLink row={r} navigate={navigate} /> },
          ]}
          data={results}
          rowKey={r => r.id}
        />
      )}
      {query.length >= 2 && results.length === 0 && (
        <div className="text-stone-500">No results found.</div>
      )}
    </div>
  );
}

// ─── Bitmap Gallery View ─────────────────────────────────────────────────────

/** Lazy-loaded thumbnail for a single bitmap in the gallery. */
function BitmapCard({ row, proxy, navigate, density, deviceScale }: {
  row: BitmapListRow; proxy: WorkerProxy; navigate: NavFn; density: number; deviceScale: boolean;
}) {
  const [bitmap, setBitmap] = useState<InstanceDetail["bitmap"] | null | "loading" | "error">(null);

  const load = useCallback(() => {
    if (bitmap !== null) return;
    setBitmap("loading");
    proxy.query<InstanceDetail | null>("getInstance", { id: row.row.id })
      .then(detail => setBitmap(detail?.bitmap ?? "error"))
      .catch(() => setBitmap("error"));
  }, [proxy, row.row.id, bitmap]);

  // Auto-load when element enters viewport
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!row.hasPixelData) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { load(); obs.disconnect(); } }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [load, row.hasPixelData]);

  // dp = px / (dpi / 160). mDensity is the bitmap's target DPI.
  const dpi = density > 0 ? density : 420;
  const scale = dpi / 160;
  const dpW = Math.round(row.width / scale);
  const dpH = Math.round(row.height / scale);

  return (
    <div ref={ref} className="bg-white border border-stone-200">
      {/* Image area */}
      <div
        className="bg-stone-50 flex items-center justify-center overflow-hidden"
        style={deviceScale
          ? { maxWidth: dpW, maxHeight: "45vh", aspectRatio: `${row.width} / ${row.height}`, margin: "0 auto" }
          : { width: "100%", maxHeight: "45vh", aspectRatio: `${row.width} / ${row.height}` }
        }
      >
        {bitmap && typeof bitmap === "object" ? (
          <BitmapImage width={bitmap.width} height={bitmap.height} format={bitmap.format} data={bitmap.data} />
        ) : bitmap === "loading" ? (
          <span className="text-stone-300">&hellip;</span>
        ) : bitmap === "error" ? (
          <span className="text-stone-300 text-sm">no data</span>
        ) : !row.hasPixelData ? (
          <span className="text-stone-300 text-sm">no pixel data</span>
        ) : null}
      </div>
      {/* Info bar */}
      <div className="px-3 py-2 border-t border-stone-100 flex items-center justify-between">
        <div>
          <span className="text-xs font-mono text-stone-600">{row.width}&times;{row.height} px</span>
          <span className="text-xs text-stone-400 ml-2">{dpW}&times;{dpH} dp</span>
          <span className="text-xs text-stone-400 ml-2">@{dpi}dpi</span>
          <span className="text-xs text-stone-400 ml-2">{fmtSize(row.row.retainedTotal)}</span>
        </div>
        <button
          className="text-xs text-sky-700 underline decoration-sky-300 hover:decoration-sky-500"
          onClick={() => navigate("object", { id: row.row.id })}
        >Details</button>
      </div>
    </div>
  );
}

function BitmapGalleryView({ proxy, navigate }: { proxy: WorkerProxy; navigate: NavFn }) {
  const [rows, setRows] = useState<BitmapListRow[] | null>(null);
  const [deviceScale, setDeviceScale] = useState(false);

  useEffect(() => {
    proxy.query<BitmapListRow[]>("getBitmapList").then(setRows).catch(console.error);
  }, [proxy]);

  if (!rows) return <div className="text-stone-400 p-4">Loading&hellip;</div>;

  // Duplicate detection
  const hashCounts = new Map<string, number>();
  for (const r of rows) if (r.hasPixelData) hashCounts.set(r.bufferHash, (hashCounts.get(r.bufferHash) ?? 0) + 1);

  const totalRetained = rows.reduce((sum, r) => sum + r.row.retainedTotal, 0);
  const withPixels = rows.filter(r => r.hasPixelData);
  const withoutPixels = rows.filter(r => !r.hasPixelData);
  const dupCount = [...hashCounts.values()].filter(c => c > 1).reduce((s, c) => s + c, 0);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Bitmaps</h2>

      {rows.length === 0 ? (
        <div className="text-stone-500">No bitmaps found in this heap dump.</div>
      ) : (
        <>
          <div className="bg-white border border-stone-200 p-3 mb-4">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <span className="text-stone-500">Total bitmaps:</span>
              <span className="font-mono">{rows.length}</span>
              <span className="text-stone-500">With pixel data:</span>
              <span className="font-mono">{withPixels.length}{withPixels.length === 0 && <span className="text-stone-400 ml-2">(dump with <code className="bg-stone-100 px-1">-b</code> to include pixel data)</span>}</span>
              {dupCount > 0 && (<><span className="text-stone-500">Duplicates:</span><span className="font-mono text-amber-600">{dupCount}</span></>)}
              <span className="text-stone-500">Total retained:</span>
              <span className="font-mono">{fmtSize(totalRetained)}</span>
            </div>
          </div>

          {/* Vertical bitmap feed */}
          {withPixels.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
                  {withPixels.length} bitmap{withPixels.length > 1 ? "s" : ""} with pixel data
                </h3>
                <div className="inline-flex text-xs border border-stone-200 divide-x divide-stone-200">
                  <button
                    className={`px-2 py-0.5 ${deviceScale ? "bg-sky-50 text-sky-700 font-medium" : "text-stone-400 hover:text-stone-600"}`}
                    onClick={() => setDeviceScale(true)}
                  >Device size</button>
                  <button
                    className={`px-2 py-0.5 ${!deviceScale ? "bg-sky-50 text-sky-700 font-medium" : "text-stone-400 hover:text-stone-600"}`}
                    onClick={() => setDeviceScale(false)}
                  >Full width</button>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {withPixels.map(r => (
                  <BitmapCard key={r.row.id} row={r} proxy={proxy} navigate={navigate} density={r.density} deviceScale={deviceScale} />
                ))}
              </div>
            </div>
          )}

          {/* Table for bitmaps without pixel data */}
          {withoutPixels.length > 0 && (
            <Section title={`Bitmaps without pixel data (${withoutPixels.length})`} defaultOpen={withPixels.length === 0}>
              <SortableTable<BitmapListRow>
                columns={[
                  { label: "Size", render: r => <span className="font-mono">{r.width}&times;{r.height}</span> },
                  { label: "Retained", align: "right", sortKey: r => r.row.retainedTotal, render: r => <span className="font-mono">{fmtSize(r.row.retainedTotal)}</span> },
                  { label: "Object", render: r => <InstanceLink row={r.row} navigate={navigate} /> },
                ]}
                data={withoutPixels}
              />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

// ─── Session type ─────────────────────────────────────────────────────────────

interface Session {
  id: string;
  name: string;
  buffer: ArrayBuffer;
  proxy: WorkerProxy;
  overview: OverviewData;
}

// ─── Session helpers ──────────────────────────────────────────────────────────

const PERFETTO_UI = "https://ui.perfetto.dev";

function openInPerfetto(buffer: ArrayBuffer, title: string): void {
  const win = window.open(PERFETTO_UI);
  if (!win) return;
  const timer = setInterval(() => win.postMessage("PING", PERFETTO_UI), 50);
  const onPong = (evt: MessageEvent) => {
    if (evt.data !== "PONG") return;
    clearInterval(timer);
    window.removeEventListener("message", onPong);
    win.postMessage({ perfetto: { buffer, title } }, PERFETTO_UI);
  };
  window.addEventListener("message", onPong);
}

function downloadBlob(name: string, buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBuffer(name: string, buffer: ArrayBuffer): void {
  downloadBlob(name.endsWith(".hprof") ? name : name + ".hprof", buffer);
}

let nextSessionId = 1;

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [view, setView] = useState("overview");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ msg: "", pct: 0 });
  const [loadingName, setLoadingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showCapture, setShowCapture] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [baselineSessionId, setBaselineSessionId] = useState<string | null>(null);
  const [diffing, setDiffing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mapFileRef = useRef<HTMLInputElement>(null);
  const skipPushRef = useRef(false);
  const adbConnRef = useRef(new AdbConnection());

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;
  const proxy = activeSession?.proxy ?? null;
  const overview = activeSession?.overview ?? null;
  const isDiffed = overview?.isDiffed ?? false;

  // Navigate: push new state to browser history
  const navigate: NavFn = useCallback((v, p = {}) => {
    setView(v);
    setParams(p);
    const url = stateToUrl(v, p);
    window.history.pushState({ view: v, params: p }, "", url);
    window.scrollTo(0, 0);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(false);
    // Delay so the opening click doesn't immediately close
    const id = requestAnimationFrame(() => document.addEventListener("click", handler));
    return () => { cancelAnimationFrame(id); document.removeEventListener("click", handler); };
  }, [menuOpen]);

  // Listen for browser back/forward
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (e.state && e.state.view) {
        skipPushRef.current = true;
        setView(e.state.view);
        setParams(e.state.params ?? {});
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Parse ArrayBuffer into a session
  const loadBuffer = useCallback(async (name: string, buffer: ArrayBuffer) => {
    setLoading(true);
    setLoadingName(name);
    setProgress({ msg: "Starting parser\u2026", pct: 2 });
    setError(null);
    setShowCapture(false);
    try {
      const worker = new HprofWorkerInline();
      const { proxy: p, overview: ov } = await makeWorkerProxy(
        worker,
        buffer,
        (msg: string, pct: number) => setProgress({ msg, pct }),
      );

      const id = `session-${nextSessionId++}`;
      const session: Session = { id, name, buffer, proxy: p, overview: ov };
      setSessions(prev => [...prev, session]);
      setActiveSessionId(id);

      const initial = urlToState(new URL(window.location.href));
      setView(initial.view);
      setParams(initial.params);
      window.history.replaceState(
        { view: initial.view, params: initial.params },
        "",
        stateToUrl(initial.view, initial.params),
      );
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to parse hprof file");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    setLoadingName(file.name);
    setProgress({ msg: "Reading file\u2026", pct: 0 });
    setError(null);
    setShowCapture(false);
    try {
      const buffer = await file.arrayBuffer();
      await loadBuffer(file.name.replace(/\.hprof$/i, ""), buffer);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to read file");
      setLoading(false);
    }
  }, [loadBuffer]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleMapFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !proxy) return;
    const text = await file.text();
    await proxy.loadProguardMap(text);
    // Refresh current view by re-querying overview
    const ov = await proxy.query<OverviewData>("getOverview");
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, overview: ov } : s));
    e.target.value = "";
  }, [proxy, activeSessionId]);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setBaselineSessionId(null); // clear diff when switching sessions
    setView("overview");
    setParams({});
    setShowCapture(false);
  }, []);

  const handleBaselineChange = useCallback(async (blId: string | null) => {
    if (!proxy || !activeSession) return;
    if (!blId) {
      // Clear baseline
      setDiffing(true);
      try {
        const ov = await proxy.clearBaseline();
        setBaselineSessionId(null);
        setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, overview: ov } : s));
      } finally {
        setDiffing(false);
      }
      return;
    }
    const blSession = sessions.find(s => s.id === blId);
    if (!blSession) return;
    setDiffing(true);
    try {
      const ov = await proxy.diffWithBaseline(
        blSession.buffer,
        (_msg, _pct) => {}, // progress handled silently
      );
      setBaselineSessionId(blId);
      setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, overview: ov } : s));
    } catch (err) {
      console.error("Diff failed:", err);
      setBaselineSessionId(null);
    } finally {
      setDiffing(false);
    }
  }, [proxy, activeSession, sessions]);

  const discardSession = useCallback((id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) session.proxy.terminate();
    setSessions(prev => prev.filter(s => s.id !== id));
    // Clear diff if discarding baseline session
    if (id === baselineSessionId) {
      setBaselineSessionId(null);
      // Clear diff in active worker too
      if (proxy && activeSessionId !== id) {
        proxy.clearBaseline().then(ov => {
          setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, overview: ov } : s));
        }).catch(() => {});
      }
    }
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      setBaselineSessionId(null);
    }
  }, [sessions, activeSessionId, baselineSessionId, proxy]);

  const handleCaptured = useCallback((name: string, buffer: ArrayBuffer) => {
    loadBuffer(name, buffer);
  }, [loadBuffer]);

  const isLanding = sessions.length === 0 && !loading;
  const isLoading = loading;
  const hasSession = sessions.length > 0 && !loading;

  const navItems = [
    { view: "overview", label: "Overview", params: {} },
    { view: "rooted", label: "Rooted", params: {} },
    { view: "site", label: "Allocations", params: { id: 0 } },
    { view: "bitmaps", label: "Bitmaps", params: {} },
    { view: "search", label: "Search", params: {} },
  ];

  // Single render tree — CaptureView is always mounted (one instance) to preserve
  // USB connection state across landing → loading → main-app transitions.
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header — shown only when sessions are loaded */}
      {hasSession && (
        <header className="bg-stone-800 text-white px-4 py-2 flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-sky-600 flex items-center justify-center text-white font-bold text-xs">A</div>
            <span className="font-bold tracking-tight text-sm">ahat<span className="text-stone-400 font-normal">.web</span></span>
          </div>

          {activeSession && (
            <span className="text-stone-400 text-xs ml-2 border-l border-stone-600 pl-3 truncate max-w-[200px]">{activeSession.name}</span>
          )}

          <nav className="flex gap-0.5 ml-4">
            {navItems.map(n => (
              <button
                key={n.view}
                className={`px-3 py-1 text-sm transition-colors ${
                  view === n.view && !showCapture ? "bg-stone-600 text-white" : "text-stone-300 hover:bg-stone-700 hover:text-white"
                }`}
                onClick={() => { setShowCapture(false); navigate(n.view, n.params); }}
              >
                {n.label}
              </button>
            ))}
          </nav>
          {sessions.length > 1 && (
            <div className="flex items-center gap-1.5 ml-3 border-l border-stone-600 pl-3">
              <span className="text-stone-500 text-xs">Diff:</span>
              <select
                className="text-xs bg-stone-700 text-stone-300 border border-stone-600 px-1.5 py-0.5 cursor-pointer max-w-[120px] truncate"
                value={baselineSessionId ?? ""}
                disabled={diffing}
                onChange={e => handleBaselineChange(e.target.value || null)}
              >
                <option value="">None</option>
                {sessions.filter(s => s.id !== activeSessionId).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {diffing && <span className="text-stone-500 text-xs">{"\u2026"}</span>}
            </div>
          )}
          <div className="ml-auto flex items-center gap-3">
            <button
              className="text-stone-400 hover:text-white text-sm"
              onClick={() => window.history.back()}
            >
              &larr; Back
            </button>
            <button
              className={`text-xs border px-2 py-0.5 transition-colors ${
                showCapture ? "bg-stone-600 text-white border-stone-500" : "text-stone-400 hover:text-white border-stone-600"
              }`}
              onClick={() => setShowCapture(!showCapture)}
            >
              Capture
            </button>
            <div className="relative">
              <button
                className="text-stone-400 hover:text-white text-xs border border-stone-600 px-2 py-0.5"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                {"\u22EF"}
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-stone-800 border border-stone-600 shadow-lg z-50 min-w-[140px]">
                  {activeSession && (
                    <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { downloadBuffer(activeSession.name, activeSession.buffer); setMenuOpen(false); }}>
                      Download
                    </button>
                  )}
                  {activeSession && (
                    <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { openInPerfetto(activeSession.buffer, activeSession.name); setMenuOpen(false); }}>
                      Perfetto
                    </button>
                  )}
                  <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}>
                    Open File
                  </button>
                  {activeSession && (
                    <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { mapFileRef.current?.click(); setMenuOpen(false); }}>
                      Load Mapping
                    </button>
                  )}
                  {activeSession && sessions.length === 1 && (
                    <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-rose-400" onClick={() => { discardSession(activeSession.id); setMenuOpen(false); }}>
                      Discard
                    </button>
                  )}
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".hprof" className="hidden" onChange={handleFile} />
            <input ref={mapFileRef} type="file" accept=".txt,.map" className="hidden" onChange={handleMapFile} />
          </div>
        </header>
      )}

      {/* Landing page */}
      {isLanding && !showCapture && (
        <div
          className="flex items-center justify-center p-8 min-h-screen"
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="max-w-lg w-full">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-stone-800 flex items-center justify-center text-white font-bold text-sm">A</div>
                <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
                  ahat<span className="text-stone-400 font-normal">.web</span>
                </h1>
              </div>
              <p className="text-stone-500 text-sm">Android Heap Analysis Tool — runs entirely in your browser</p>
            </div>
            <div
              className="bg-white border-2 border-dashed border-stone-300 p-10 text-center cursor-pointer hover:border-sky-400 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <div className="mb-4">
                <svg className="w-12 h-12 mx-auto text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="text-stone-700 font-medium mb-1">Drop an .hprof file here or click to browse</p>
              <p className="text-stone-400 text-sm">Supports J2SE HPROF format with Android extensions</p>
              <input ref={fileRef} type="file" accept=".hprof" className="hidden" onChange={handleFile} />
            </div>
            <div className="mt-4 text-center">
              <button
                className="px-5 py-2.5 border border-stone-300 text-stone-700 hover:border-stone-400 hover:bg-white transition-colors"
                onClick={() => setShowCapture(true)}
              >
                <span className="inline-flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                  </svg>
                  Capture from device
                </span>
              </button>
            </div>
            {error && (
              <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>
            )}
          </div>
        </div>
      )}

      {/* Loading screen */}
      {isLoading && (
        <div className="flex items-center justify-center p-8 min-h-screen">
          <div className="max-w-md w-full bg-white border border-stone-200 p-8">
            <h2 className="text-lg font-semibold text-stone-800 mb-4 truncate" title={`Parsing ${loadingName || "Heap Dump"}`}>Parsing {loadingName || "Heap Dump"}&hellip;</h2>
            <div className="w-full h-2 bg-stone-100 overflow-hidden mb-3">
              <div className="h-full bg-sky-500 transition-all duration-300" style={{ width: progress.pct + "%" }} />
            </div>
            <p className="text-sm text-stone-500 truncate" title={progress.msg}>{progress.msg}</p>
          </div>
        </div>
      )}

      {/* CaptureView — ALWAYS mounted, single instance preserves USB connection
         across landing → loading → main-app state transitions.
         Hidden via CSS when not active; wrapper styling adapts to context. */}
      <div className={showCapture && !isLoading ? "" : "hidden"}>
        {!hasSession && (
          <div className="p-8 pb-0 max-w-[95%] mx-auto">
            <div className="flex items-center gap-4 mb-6">
              <button className="text-stone-400 hover:text-stone-600" onClick={() => setShowCapture(false)}>
                &larr; Back
              </button>
              <h1 className="text-lg font-semibold text-stone-800">Capture from device</h1>
            </div>
          </div>
        )}
        <div className={hasSession ? "flex-1 p-4 max-w-[95%] mx-auto w-full text-sm" : "max-w-[95%] mx-auto px-8"}>
          <CaptureView onCaptured={handleCaptured} conn={adbConnRef.current} />
        </div>
      </div>

      {/* Main content views */}
      {hasSession && !showCapture && (
        <main className="flex-1 p-4 max-w-[95%] mx-auto w-full text-sm">
          {view === "overview" && overview && <OverviewView overview={overview} sessions={sessions} activeSessionId={activeSessionId} onSwitch={switchSession} onDiscard={discardSession} navigate={navigate} />}
          {view === "rooted"   && proxy    && <RootedView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} isDiffed={isDiffed} />}
          {view === "object"   && proxy    && <ObjectView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} params={params as unknown as ObjectParams} />}
          {view === "objects"  && proxy    && <ObjectsView proxy={proxy} navigate={navigate} params={params as unknown as ObjectsParams} />}
          {view === "site"     && proxy    && <SiteView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} params={params as unknown as SiteParams} isDiffed={isDiffed} />}
          {view === "search"   && proxy    && <SearchView proxy={proxy} navigate={navigate} initialQuery={params.q as string | undefined} />}
          {view === "bitmaps"  && proxy    && <BitmapGalleryView proxy={proxy} navigate={navigate} />}
        </main>
      )}
    </div>
  );
}
