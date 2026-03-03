import { useState, useCallback, useRef, useMemo, useEffect, Fragment } from "react";
import type {
  OverviewData, HeapInfo,
  InstanceRow, InstanceDetail,
  SiteData, SiteChildRow, SiteObjectsRow,
  PrimOrRef, BitmapListRow,
} from "./hprof.worker";
import { AdbConnection, type ProcessInfo, type CapturePhase, type SmapsAggregated, type SmapsEntry } from "./adb/capture";
import HprofWorkerInline from "./hprof.worker.ts?worker&inline";

// ─── Worker proxy ─────────────────────────────────────────────────────────────

type QueryName = "getOverview" | "getRooted" | "getInstance" | "getSite" | "search" | "getObjects" | "getBitmapList";

type WorkerInMessage =
  | { type: "progress"; msg: string; pct: number }
  | { type: "ready"; overview: OverviewData }
  | { type: "error"; message: string }
  | { type: "result"; id: number; data: unknown }
  | { type: "queryError"; id: number; message: string };

interface WorkerProxy {
  query<T>(name: QueryName, params?: Record<string, unknown>): Promise<T>;
  terminate(): void;
}

function makeWorkerProxy(
  worker: Worker,
  buffer: ArrayBuffer,
  onProgress: (msg: string, pct: number) => void,
): Promise<{ proxy: WorkerProxy; overview: OverviewData }> {
  return new Promise((resolve, reject) => {
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let ready = false;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as WorkerInMessage;
      if (msg.type === "progress") {
        onProgress(msg.msg, msg.pct);
      } else if (msg.type === "ready") {
        ready = true;
        const proxy: WorkerProxy = {
          query<T>(name: QueryName, params?: Record<string, unknown>): Promise<T> {
            return new Promise<T>((res, rej) => {
              const id = nextId++;
              pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
              worker.postMessage({ type: "query", id, name, params });
            });
          },
          terminate() { worker.terminate(); },
        };
        resolve({ proxy, overview: msg.overview });
      } else if (msg.type === "error") {
        if (!ready) reject(new Error(msg.message));
      } else if (msg.type === "result") {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.resolve(msg.data); }
      } else if (msg.type === "queryError") {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.reject(new Error(msg.message)); }
      }
    };
    worker.onerror = (err) => {
      if (!ready) reject(new Error(err.message ?? "Worker error"));
    };

    const forWorker = buffer.slice(0);
    worker.postMessage({ type: "parse", buffer: forWorker }, [forWorker]);
  });
}

// ─── URL routing helpers ─────────────────────────────────────────────────────

interface NavState { view: string; params: Record<string, unknown> }

function stateToUrl(view: string, params: Record<string, unknown>): string {
  switch (view) {
    case "overview": return "/";
    case "rooted": return "/rooted";
    case "object": return `/object?id=0x${Number(params.id ?? 0).toString(16)}`;
    case "objects": {
      const sp = new URLSearchParams();
      sp.set("id", String(params.siteId ?? 0));
      sp.set("class", String(params.className ?? ""));
      if (params.heap) sp.set("heap", String(params.heap));
      return `/objects?${sp.toString()}`;
    }
    case "site": return `/site?id=${params.id ?? 0}`;
    case "search": {
      const q = String(params.q ?? "");
      return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
    }
    case "bitmaps": {
      const bid = params.id ? `0x${Number(params.id).toString(16)}` : null;
      return bid ? `/bitmaps?id=${bid}` : "/bitmaps";
    }
    default: return "/";
  }
}

function urlToState(url: URL): NavState {
  const path = url.pathname.replace(/\/$/, "") || "/";
  const sp = url.searchParams;

  switch (path) {
    case "/":
      return { view: "overview", params: {} };
    case "/rooted":
      return { view: "rooted", params: {} };
    case "/object": {
      const raw = sp.get("id") ?? "0";
      const id = raw.startsWith("0x") ? parseInt(raw.slice(2), 16) : parseInt(raw, 10);
      return { view: "object", params: { id: id || 0 } };
    }
    case "/objects": {
      const siteId = parseInt(sp.get("id") ?? "0", 10) || 0;
      const className = sp.get("class") ?? "";
      const heap = sp.get("heap") || null;
      return { view: "objects", params: { siteId, className, heap } };
    }
    case "/site": {
      const id = parseInt(sp.get("id") ?? "0", 10) || 0;
      return { view: "site", params: { id } };
    }
    case "/search": {
      const q = sp.get("q") ?? "";
      return { view: "search", params: { q } };
    }
    case "/bitmaps": {
      const raw = sp.get("id") ?? "";
      const selectedId = raw.startsWith("0x") ? parseInt(raw.slice(2), 16) : (raw ? parseInt(raw, 10) : 0);
      return { view: "bitmaps", params: selectedId ? { id: selectedId } : {} };
    }
    default:
      return { view: "overview", params: {} };
  }
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtSize(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return n.toLocaleString();
}

function fmtHex(id: number): string {
  return "0x" + id.toString(16).padStart(8, "0");
}

// ─── Navigation types ─────────────────────────────────────────────────────────

type NavFn = (view: string, params?: Record<string, unknown>) => void;

// ─── Reusable components ──────────────────────────────────────────────────────

const SHOW_LIMIT = 200;

function InstanceLink({ row, navigate }: { row: InstanceRow | null; navigate: NavFn }) {
  if (!row || row.id === 0) return <span className="text-stone-500">ROOT</span>;
  return (
    <span>
      {row.reachabilityName !== "unreachable" && row.reachabilityName !== "strong" && (
        <span className="text-amber-600 text-xs mr-1">{row.reachabilityName}</span>
      )}
      {row.isRoot && <span className="text-rose-500 text-xs mr-1">root</span>}
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
      {row.referent && (
        <span className="text-stone-500 ml-1">
          {" "}for <InstanceLink row={row.referent} navigate={navigate} />
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

function SortableTable<T>({ columns, data, limit = SHOW_LIMIT }: {
  columns: {
    label: string;
    align?: string;
    sortKey?: (row: T) => number;
    render: (row: T, idx: number) => React.ReactNode;
  }[];
  data: T[];
  limit?: number;
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
  }, [data, sortCol, sortAsc]);

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
            <tr key={ri} className="border-b border-stone-200 hover:bg-stone-50">
              {columns.map((c, ci) => (
                <td key={ci} className={`px-2 py-1 ${c.align === "right" ? "text-right font-mono" : ""}`}>
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
    return <InstanceLink row={{
      id: v.id, display: v.display, className: "", isRoot: false, rootTypeNames: null,
      reachabilityName: "strong", heap: "", shallowJava: 0, shallowNative: 0,
      retainedTotal: 0, retainedByHeap: [], str: v.str, referent: null,
    }} navigate={navigate} />;
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
      if (!canvas) return undefined;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      const clamped = new Uint8ClampedArray(data.length);
      clamped.set(data);
      ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
      return undefined;
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

function OverviewView({ overview, sessions, activeSessionId, onSwitch, onDiscard }: {
  overview: OverviewData;
  sessions: Session[];
  activeSessionId: string | null;
  onSwitch: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const heaps = overview.heaps.filter(h => h.java + h.native_ > 0);
  const totalJava = heaps.reduce((a, h) => a + h.java, 0);
  const totalNative = heaps.reduce((a, h) => a + h.native_, 0);
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
          <span className="font-mono">{overview.instanceCount.toLocaleString()}</span>
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
              <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">Native Size</th>
              <th className="text-right py-1 px-2 text-stone-600 text-xs font-medium">Total Size</th>
            </tr>
          </thead>
          <tbody>
            {heaps.map(h => (
              <tr key={h.name} className="border-t border-stone-100">
                <td className="py-1 px-2">{h.name}</td>
                <td className="py-1 px-2 text-right font-mono">{fmtSize(h.java)}</td>
                <td className="py-1 px-2 text-right font-mono">{fmtSize(h.native_)}</td>
                <td className="py-1 px-2 text-right font-mono font-semibold">{fmtSize(h.java + h.native_)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-stone-300 font-semibold">
              <td className="py-1 px-2">Total</td>
              <td className="py-1 px-2 text-right font-mono">{fmtSize(totalJava)}</td>
              <td className="py-1 px-2 text-right font-mono">{fmtSize(totalNative)}</td>
              <td className="py-1 px-2 text-right font-mono">{fmtSize(totalJava + totalNative)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RootedView({ proxy, heaps, navigate }: { proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn }) {
  const [rows, setRows] = useState<InstanceRow[] | null>(null);
  useEffect(() => {
    proxy.query<InstanceRow[]>("getRooted").then(setRows).catch(console.error);
  }, [proxy]);

  if (!rows) return <div className="text-stone-400 p-4">Loading&hellip;</div>;

  const heapCols = heaps.filter(h => h.java + h.native_ > 0);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Rooted</h2>
      <SortableTable<InstanceRow>
        columns={[
          {
            label: "Retained", align: "right",
            sortKey: r => r.retainedTotal,
            render: r => <span className="font-mono">{fmtSize(r.retainedTotal)}</span>,
          },
          ...heapCols.map(h => ({
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
        data={rows}
      />
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
        <Section title="Sample Path from GC Root">
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
          <span className="font-mono">{fmtSize(row.shallowJava + row.shallowNative)}{row.shallowNative > 0 && <span className="text-stone-400"> (java: {fmtSize(row.shallowJava)}, native: {fmtSize(row.shallowNative)})</span>}</span>
          <span className="text-stone-500">Retained Size:</span>
          <span className="font-mono font-semibold">{fmtSize(row.retainedTotal)}</span>
        </div>
      </Section>

      {detail.isClassObj && (
        <>
          <Section title="Class Info">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mb-3">
              <span className="text-stone-500">Super Class:</span>
              <span>{detail.superClassObjId != null
                ? <InstanceLink row={{ id: detail.superClassObjId, display: fmtHex(detail.superClassObjId), className: "", isRoot: false, rootTypeNames: null, reachabilityName: "strong", heap: "", shallowJava: 0, shallowNative: 0, retainedTotal: 0, retainedByHeap: [], str: null, referent: null }} navigate={navigate} />
                : "none"}</span>
              <span className="text-stone-500">Instance Size:</span>
              <span className="font-mono">{detail.instanceSize}</span>
            </div>
          </Section>
          <Section title="Static Fields">
            <FieldsTable fields={detail.staticFields} navigate={navigate} />
          </Section>
        </>
      )}

      {detail.isClassInstance && detail.instanceFields.length > 0 && (
        <Section title="Fields">
          <FieldsTable fields={detail.instanceFields} navigate={navigate} />
        </Section>
      )}

      {detail.isArrayInstance && (
        <Section title={`Array Elements (${detail.arrayLength})`}>
          <ArrayView
            elems={detail.arrayElems}
            elemTypeName={detail.elemTypeName ?? "Object"}
            total={detail.arrayLength}
            navigate={navigate}
            onShowAll={detail.arrayLength > detail.arrayElems.length ? () => {
              proxy.query<InstanceDetail | null>("getInstance", { id: params.id, arrayLimit: 0 })
                .then(full => { if (full) setDetail(full); })
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

function FieldsTable({ fields, navigate }: {
  fields: { name: string; typeName: string; value: PrimOrRef }[];
  navigate: NavFn;
}) {
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

function ArrayView({ elems, elemTypeName, total, navigate, onShowAll }: {
  elems: { idx: number; value: PrimOrRef }[];
  elemTypeName: string;
  total: number;
  navigate: NavFn;
  onShowAll?: () => void;
}) {
  return (
    <div>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="text-right px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium w-16">Index</th>
            <th className="text-left px-2 py-1 bg-stone-100 text-stone-600 text-xs font-medium">Value ({elemTypeName})</th>
          </tr>
        </thead>
        <tbody>
          {elems.map(e => (
            <tr key={e.idx} className="border-t border-stone-100">
              <td className="px-2 py-0.5 text-right font-mono text-stone-400">{e.idx}</td>
              <td className="px-2 py-0.5"><PrimOrRefCell v={e.value} navigate={navigate} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > elems.length && (
        <div className="text-xs text-stone-500 pt-2">
          Showing first {elems.length.toLocaleString()} of {total.toLocaleString()} elements
          {onShowAll && (
            <>
              {" \u2014 "}
              <button className="text-sky-600 hover:underline" onClick={onShowAll}>show all</button>
            </>
          )}
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
      />
    </div>
  );
}

function SiteView({ proxy, heaps, navigate, params }: { proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn; params: SiteParams }) {
  const [data, setData] = useState<SiteData | null>(null);
  useEffect(() => {
    setData(null);
    proxy.query<SiteData>("getSite", { id: params.id ?? 0 }).then(setData).catch(console.error);
  }, [proxy, params.id]);

  if (!data) return <div className="text-stone-400 p-4">Loading&hellip;</div>;
  const heapCols = heaps.filter(h => h.java + h.native_ > 0);

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
          <SortableTable<SiteChildRow>
            columns={[
              { label: "Total Size", align: "right", sortKey: r => r.totalJava + r.totalNative, render: r => <span className="font-mono">{fmtSize(r.totalJava + r.totalNative)}</span> },
              ...heapCols.map(h => ({
                label: h.name, align: "right",
                sortKey: (r: SiteChildRow) => {
                  const s = r.byHeap.find(x => x.heap === h.name);
                  return (s?.java ?? 0) + (s?.native_ ?? 0);
                },
                render: (r: SiteChildRow) => {
                  const s = r.byHeap.find(x => x.heap === h.name);
                  return <span className="font-mono">{fmtSize((s?.java ?? 0) + (s?.native_ ?? 0))}</span>;
                },
              })),
              { label: "Child Site", render: r => <SiteLinkRaw {...r} navigate={navigate} /> },
            ]}
            data={data.children}
          />
        </Section>
      )}

      <Section title="Objects Allocated">
        <SortableTable<SiteObjectsRow>
          columns={[
            { label: "Size", align: "right", sortKey: r => r.java + r.native_, render: r => <span className="font-mono">{fmtSize(r.java + r.native_)}</span> },
            {
              label: "Instances", align: "right",
              sortKey: r => r.numInstances,
              render: r => (
                <button className="text-sky-700 underline decoration-sky-300 hover:decoration-sky-500 font-mono"
                  onClick={() => navigate("objects", { siteId: data.id, className: r.className, heap: r.heap })}>
                  {r.numInstances.toLocaleString()}
                </button>
              ),
            },
            { label: "Heap", render: r => <span>{r.heap}</span> },
            {
              label: "Class", render: r => r.classObjId != null
                ? <InstanceLink row={{ id: r.classObjId, display: r.className, className: r.className, isRoot: false, rootTypeNames: null, reachabilityName: "strong", heap: r.heap, shallowJava: 0, shallowNative: 0, retainedTotal: 0, retainedByHeap: [], str: null, referent: null }} navigate={navigate} />
                : <span>{r.className}</span>,
            },
          ]}
          data={data.objectsInfos}
        />
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

// ─── Smaps sub-table components ──────────────────────────────────────────────

type SmapsSortFieldType = "pssKb" | "rssKb" | "sizeKb" | "sharedCleanKb" | "sharedDirtyKb" | "privateCleanKb" | "privateDirtyKb" | "swapKb";
type VmaSortFieldType = SmapsSortFieldType | "addrStart";

const SMAPS_COLUMNS: [SmapsSortFieldType, string][] = [
  ["pssKb", "PSS"], ["rssKb", "RSS"], ["sizeKb", "VSize"],
  ["privateCleanKb", "Priv Clean"], ["privateDirtyKb", "Priv Dirty"],
  ["sharedCleanKb", "Shared Clean"], ["sharedDirtyKb", "Shared Dirty"],
  ["swapKb", "Swap"],
];

function VmaEntries({ entries, sortField, sortAsc, onToggleSort }: {
  entries: SmapsEntry[];
  sortField: VmaSortFieldType;
  sortAsc: boolean;
  onToggleSort: (f: VmaSortFieldType) => void;
}) {
  const sorted = useMemo(() => {
    const copy = [...entries];
    if (sortField === "addrStart") {
      copy.sort((a, b) => sortAsc ? a.addrStart.localeCompare(b.addrStart) : b.addrStart.localeCompare(a.addrStart));
    } else {
      copy.sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]);
    }
    return copy;
  }, [entries, sortField, sortAsc]);

  return (
    <>
      <tr className="bg-stone-100">
        <td className="py-0.5 px-2 pl-6">
          <span className="text-stone-500 text-[10px] font-medium cursor-pointer hover:text-stone-700" onClick={() => onToggleSort("addrStart")}>
            Address {sortField === "addrStart" ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
          </span>
          <span className="ml-3 text-stone-400 text-[10px]">Perms</span>
        </td>
        <td />
        {SMAPS_COLUMNS.map(([f, label]) => (
          <td key={f} className="py-0.5 px-2 text-right text-stone-500 text-[10px] font-medium cursor-pointer hover:text-stone-700" onClick={() => onToggleSort(f)}>
            {label} {sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
          </td>
        ))}
      </tr>
      {sorted.map((e, i) => (
        <tr key={i} className="border-t border-stone-50">
          <td className="py-0.5 px-2 pl-6 font-mono text-[10px] text-stone-500 whitespace-nowrap">
            {e.addrStart}-{e.addrEnd}
            <span className="ml-2 text-stone-400">{e.perms}</span>
          </td>
          <td />
          {SMAPS_COLUMNS.map(([f]) => (
            <td key={f} className="py-0.5 px-2 text-right font-mono text-[10px] whitespace-nowrap">
              {e[f] > 0 ? fmtSize(e[f] * 1024) : "\u2014"}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function SmapsSubTable({ aggregated, expandedGroup, onToggleGroup, sortField, sortAsc, onToggleSort, vmaSortField, vmaSortAsc, onToggleVmaSort }: {
  aggregated: SmapsAggregated[];
  expandedGroup: string | null;
  onToggleGroup: (name: string) => void;
  sortField: SmapsSortFieldType;
  sortAsc: boolean;
  onToggleSort: (f: SmapsSortFieldType) => void;
  vmaSortField: VmaSortFieldType;
  vmaSortAsc: boolean;
  onToggleVmaSort: (f: VmaSortFieldType) => void;
}) {
  const sorted = useMemo(() => {
    const copy = [...aggregated];
    copy.sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]);
    return copy;
  }, [aggregated, sortField, sortAsc]);

  return (
    <div className="bg-stone-50 px-4 py-2 max-h-[400px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-stone-50 z-10">
          <tr className="border-b border-stone-200">
            <th className="text-left py-1 px-2 text-stone-500 font-medium">Mapping</th>
            <th className="text-right py-1 px-1 text-stone-400 font-medium w-8">#</th>
            {SMAPS_COLUMNS.map(([f, label]) => (
              <th
                key={f}
                className="text-right py-1 px-2 text-stone-500 font-medium cursor-pointer select-none hover:text-stone-700 whitespace-nowrap"
                onClick={() => onToggleSort(f)}
              >
                {label} {sortField === f ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(g => (
            <Fragment key={g.name}>
              <tr
                className="border-t border-stone-100 cursor-pointer hover:bg-stone-100"
                onClick={() => onToggleGroup(g.name)}
              >
                <td className="py-0.5 px-2 font-mono text-stone-700 truncate max-w-[300px]" title={g.name}>
                  <span className="text-stone-400 mr-1">{expandedGroup === g.name ? "\u25BC" : "\u25B6"}</span>
                  {g.name}
                </td>
                <td className="py-0.5 px-1 text-right font-mono text-stone-400">{g.count}</td>
                {SMAPS_COLUMNS.map(([f]) => (
                  <td key={f} className="py-0.5 px-2 text-right font-mono whitespace-nowrap">
                    {g[f] > 0 ? fmtSize(g[f] * 1024) : "\u2014"}
                  </td>
                ))}
              </tr>
              {expandedGroup === g.name && (
                <VmaEntries
                  entries={g.entries}
                  sortField={vmaSortField}
                  sortAsc={vmaSortAsc}
                  onToggleSort={onToggleVmaSort}
                />
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Capture View ─────────────────────────────────────────────────────────────

type SortField = "pssKb" | "rssKb" | "javaHeapKb" | "nativeHeapKb" | "graphicsKb";

function CaptureView({ onCaptured, conn }: {
  onCaptured: (name: string, buffer: ArrayBuffer) => void;
  conn: AdbConnection;
}) {
  const [connected, setConnected] = useState(false);
  const [connectStatus, setConnectStatus] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ProcessInfo[] | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [withBitmaps, setWithBitmaps] = useState(false);
  const [sortField, setSortField] = useState<SortField>("pssKb");
  const [sortAsc, setSortAsc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Enrichment runs in the background — doesn't block capture
  const enrichAbortRef = useRef<AbortController | null>(null);
  const [enrichStatus, setEnrichStatus] = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);

  // Capture is a foreground operation — auto-cancels enrichment since ADB is serial
  const captureAbortRef = useRef<AbortController | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureStatus, setCaptureStatus] = useState("");
  const [captureProgress, setCaptureProgress] = useState<{ done: number; total: number } | null>(null);

  // Smaps — fetched alongside meminfo enrichment (root-only)
  const [smapsData, setSmapsData] = useState<Map<number, SmapsAggregated[]>>(new Map());
  const [expandedSmapsPid, setExpandedSmapsPid] = useState<number | null>(null);
  const [expandedSmapsGroup, setExpandedSmapsGroup] = useState<string | null>(null);
  type SmapsSortField = "pssKb" | "rssKb" | "sizeKb" | "sharedCleanKb" | "sharedDirtyKb" | "privateCleanKb" | "privateDirtyKb" | "swapKb";
  const [smapsSortField, setSmapsSortField] = useState<SmapsSortField>("pssKb");
  const [smapsSortAsc, setSmapsSortAsc] = useState(false);
  type VmaSortField = SmapsSortField | "addrStart";
  const [vmaSortField, setVmaSortField] = useState<VmaSortField>("pssKb");
  const [vmaSortAsc, setVmaSortAsc] = useState(false);

  const cancelEnrichment = useCallback(() => {
    if (!enrichAbortRef.current) return;
    enrichAbortRef.current.abort();
    enrichAbortRef.current = null;
    setEnrichStatus(null);
    setEnrichProgress(null);
  }, []);

  const cancelCapture = useCallback(() => {
    if (!captureAbortRef.current) return;
    captureAbortRef.current.abort();
    captureAbortRef.current = null;
    setCapturing(false);
    setCaptureStatus("");
    setCaptureProgress(null);
  }, []);

  const refreshProcesses = useCallback(async () => {
    if (!conn.connected) return;
    cancelEnrichment();
    const ac = new AbortController();
    enrichAbortRef.current = ac;
    setEnrichStatus("Fetching process list\u2026");
    setEnrichProgress(null);
    setSmapsData(new Map());
    setExpandedSmapsPid(null);
    setExpandedSmapsGroup(null);
    setError(null);
    try {
      const result = await conn.getProcessList(ac.signal);
      const list = result.list;
      if (ac.signal.aborted) return;
      // On non-rooted devices, annotate processes with debuggable status
      if (!conn.isRoot) {
        const debuggable = await conn.getDebuggablePackages(ac.signal);
        if (ac.signal.aborted) return;
        for (const p of list) p.debuggable = debuggable.has(p.name);
      }
      setProcesses(list);
      // Single per-process pass: enrich meminfo (if needed) + smaps (if root).
      // Each process is fully ready before moving to the next.
      const needsMeminfo = !result.hasBreakdown;
      const needsSmaps = conn.isRoot;
      if (needsMeminfo || needsSmaps) {
        await conn.enrichPerProcess(
          list,
          { meminfo: needsMeminfo, smaps: needsSmaps },
          (done, total, current) => {
            if (ac.signal.aborted) return;
            setEnrichStatus(current);
            setEnrichProgress({ done, total });
          },
          () => {
            if (ac.signal.aborted) return;
            setProcesses([...list]);
          },
          (pid, data) => {
            if (ac.signal.aborted) return;
            setSmapsData(prev => new Map(prev).set(pid, data));
          },
          ac.signal,
        );
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to get process list");
    } finally {
      if (enrichAbortRef.current === ac) {
        enrichAbortRef.current = null;
        setEnrichStatus(null);
        setEnrichProgress(null);
      }
    }
  }, [cancelEnrichment]);

  useEffect(() => {
    if (connected) refreshProcesses();
  }, [connected, refreshProcesses]);

  const handleConnect = useCallback(async () => {
    setConnectStatus("Connecting\u2026");
    setError(null);
    try {
      await conn.requestAndConnect((msg) => setConnectStatus(msg));
      setConnected(true);
    } catch (e) {
      if (e instanceof Error && e.name === "NotFoundError") {
        // User cancelled device picker
      } else {
        setError(e instanceof Error ? e.message : "Connection failed");
      }
    } finally {
      setConnectStatus(null);
    }
  }, []);

  const handleCapture = useCallback(async (overridePid?: number) => {
    const pid = overridePid ?? selectedPid;
    if (pid === null || capturing) return;
    // Cancel enrichment (includes smaps) — ADB device handles one command at a time
    cancelEnrichment();
    if (overridePid !== undefined) setSelectedPid(overridePid);
    const ac = new AbortController();
    captureAbortRef.current = ac;
    setCapturing(true);
    setCaptureStatus("Starting heap dump\u2026");
    setCaptureProgress(null);
    setError(null);
    try {
      const proc = processes?.find(p => p.pid === pid);
      const procName = proc?.name ?? `pid_${pid}`;
      const buffer = await conn.captureHeapDump(
        pid,
        withBitmaps,
        (phase: CapturePhase) => {
          switch (phase.step) {
            case "dumping": setCaptureStatus("Dumping heap\u2026"); break;
            case "waiting": setCaptureStatus(`Waiting for dump\u2026 (${Math.round(phase.elapsed / 1000)}s)`); break;
            case "pulling": {
              const pct = phase.total > 0 ? Math.round(phase.received / phase.total * 100) : 0;
              const mb = (phase.received / 1048576).toFixed(1);
              setCaptureStatus(phase.total > 0 ? `Pulling: ${mb} MB (${pct}%)` : `Pulling: ${mb} MB`);
              if (phase.total > 0) setCaptureProgress({ done: phase.received, total: phase.total });
              break;
            }
            case "cleaning": setCaptureStatus("Cleaning up\u2026"); break;
            case "done": break;
          }
        },
        ac.signal,
      );
      const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
      const name = `${procName}_${ts}`;
      onCaptured(name, buffer);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      // Only clear state if we're still the active capture
      if (captureAbortRef.current === ac) {
        captureAbortRef.current = null;
        setCapturing(false);
        setCaptureStatus("");
        setCaptureProgress(null);
      }
    }
  }, [selectedPid, withBitmaps, processes, onCaptured, capturing, cancelEnrichment]);

  const handleDisconnect = useCallback(() => {
    cancelEnrichment();
    cancelCapture();
    conn.disconnect();
    setConnected(false);
    setProcesses(null);
    setSelectedPid(null);
    setError(null);
    setEnrichStatus(null);
    setEnrichProgress(null);
    setCapturing(false);
    setCaptureStatus("");
    setCaptureProgress(null);
    setSmapsData(new Map());
    setExpandedSmapsPid(null);
    setExpandedSmapsGroup(null);
  }, [cancelEnrichment, cancelCapture]);

  // Clean up on unmount
  useEffect(() => {
    return () => { cancelEnrichment(); cancelCapture(); conn.disconnect(); };
  }, [cancelEnrichment, cancelCapture]);

  const sorted = useMemo(() => {
    if (!processes) return null;
    const copy = [...processes];
    copy.sort((a, b) => sortAsc ? a[sortField] - b[sortField] : b[sortField] - a[sortField]);
    return copy;
  }, [processes, sortField, sortAsc]);

  const hasRss = processes ? processes.some(p => p.rssKb > 0) : false;
  // Show breakdown columns as soon as enrichment starts or any data arrives
  const hasBreakdown = enrichStatus !== null || (processes ? processes.some(p => p.javaHeapKb > 0 || p.nativeHeapKb > 0 || p.graphicsKb > 0) : false);
  const hasOomLabel = processes ? processes.some(p => p.oomLabel !== "") : false;

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  }, [sortField, sortAsc]);

  const toggleSmapsSort = useCallback((field: SmapsSortField) => {
    if (smapsSortField === field) setSmapsSortAsc(!smapsSortAsc);
    else { setSmapsSortField(field); setSmapsSortAsc(false); }
  }, [smapsSortField, smapsSortAsc]);

  const toggleVmaSort = useCallback((field: VmaSortField) => {
    if (vmaSortField === field) setVmaSortAsc(!vmaSortAsc);
    else { setVmaSortField(field); setVmaSortAsc(false); }
  }, [vmaSortField, vmaSortAsc]);

  const hasWebUsb = typeof navigator !== "undefined" && "usb" in navigator;

  if (!hasWebUsb) {
    return (
      <div className="text-center py-8">
        <p className="text-stone-600 mb-2">WebUSB is not available.</p>
        <p className="text-stone-400 text-sm">Use Chrome or Edge over HTTPS/localhost.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Connection */}
      {!connected ? (
        <div className="text-center py-8">
          <button
            className="px-6 py-3 bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:opacity-50"
            onClick={handleConnect}
            disabled={connectStatus !== null}
          >
            {connectStatus ?? "Connect USB Device"}
          </button>
          <p className="text-stone-400 text-xs mt-3">
            Enable USB debugging on device. If ADB is running, stop it first: <code className="bg-stone-100 px-1">adb kill-server</code>
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-stone-600">{conn.productName}</span>
              <span className="text-stone-400 ml-2 font-mono text-xs">{conn.serial}</span>
            </div>
            <div className="flex items-center gap-3">
              <button className="text-stone-400 hover:text-stone-600 text-xs" onClick={refreshProcesses}>
                {enrichStatus ? "Refreshing\u2026" : "Refresh"}
              </button>
              <button className="text-stone-400 hover:text-stone-600 text-xs" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </div>

          {/* Non-root banner */}
          {connected && !conn.isRoot && processes && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 mb-3">
              Non-rooted device — only debuggable apps can be captured
            </div>
          )}

          {/* Capture controls */}
          <div className="bg-white border border-stone-200 p-3 mb-4 flex items-center gap-4">
            <label className="flex items-center gap-2 text-stone-600">
              <input type="checkbox" checked={withBitmaps} onChange={e => setWithBitmaps(e.target.checked)} className="accent-sky-600" />
              Include bitmaps (-b)
            </label>
            <button
              className={`px-4 py-1.5 text-white transition-colors disabled:opacity-50 ml-auto ${
                capturing ? "bg-amber-600 hover:bg-amber-700" : "bg-sky-600 hover:bg-sky-700"
              }`}
              onClick={() => handleCapture()}
              disabled={selectedPid === null || capturing}
              title={selectedPid === null ? "Select a process first" : capturing ? "Capture in progress" : "Capture heap dump"}
            >
              {capturing ? (captureStatus || "Capturing\u2026") : "Capture Heap Dump"}
            </button>
          </div>

          {/* Enrichment / smaps progress */}
          {enrichStatus && (
            <div className="mb-2 text-xs text-stone-500">
              <div className="flex items-center gap-2 mb-1">
                <span className="truncate">{enrichStatus}</span>
                {enrichProgress && <span className="text-stone-400 whitespace-nowrap">{enrichProgress.done}/{enrichProgress.total}</span>}
                <button className="text-rose-500 hover:text-rose-700 ml-auto" onClick={cancelEnrichment}>Cancel</button>
              </div>
              {enrichProgress && enrichProgress.total > 0 && (
                <div className="h-1 bg-stone-100 rounded overflow-hidden">
                  <div className="h-full bg-sky-500 transition-all" style={{ width: `${(enrichProgress.done / enrichProgress.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Process list */}
          {sorted === null ? (
            <div className="text-stone-400 p-4">Loading processes&hellip;</div>
          ) : sorted.length === 0 ? (
            <div className="text-stone-400 p-4 flex items-center gap-3">
              No processes found.
              <button className="text-sky-700 underline decoration-sky-300" onClick={refreshProcesses}>
                Refresh
              </button>
            </div>
          ) : (
            <div className="bg-white border border-stone-200 overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="text-left py-1.5 px-2 text-stone-500 text-xs font-medium w-14">PID</th>
                    <th className="text-left py-1.5 px-2 text-stone-500 text-xs font-medium">Process</th>
                    {hasOomLabel && <th className="text-left py-1.5 px-2 text-stone-500 text-xs font-medium">State</th>}
                    {([
                      ["pssKb", "PSS"],
                      ...(hasRss ? [["rssKb", "RSS"]] : []),
                      ...(hasBreakdown ? [
                        ["javaHeapKb", "Java"],
                        ["nativeHeapKb", "Native"],
                        ["graphicsKb", "Graphics"],
                      ] : []),
                    ] as [SortField, string][]).map(([field, label]) => (
                      <th
                        key={field}
                        className="text-right py-1.5 px-2 text-stone-500 text-xs font-medium w-20 cursor-pointer select-none whitespace-nowrap hover:text-stone-700"
                        onClick={() => toggleSort(field)}
                      >
                        {label} {sortField === field ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
                      </th>
                    ))}
                    <th className="py-1.5 px-2 text-stone-500 text-xs font-medium w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(p => {
                    const canCapture = conn.isRoot || p.debuggable !== false;
                    const isCapturingThis = capturing && selectedPid === p.pid;
                    const hasSmaps = smapsData.has(p.pid);
                    const isSmapsExpanded = expandedSmapsPid === p.pid && hasSmaps;
                    const colCount = 2 + (hasOomLabel ? 1 : 0) + 1 + (hasRss ? 1 : 0) + (hasBreakdown ? 3 : 0) + 1;
                    return (
                    <Fragment key={p.pid}>
                    <tr
                      className={`border-t border-stone-100 cursor-pointer ${
                        isSmapsExpanded ? "bg-sky-50" : "hover:bg-stone-50"
                      } ${!canCapture ? "opacity-50" : ""}`}
                      onClick={() => {
                        if (hasSmaps) {
                          if (expandedSmapsPid === p.pid) {
                            setExpandedSmapsPid(null);
                            setExpandedSmapsGroup(null);
                          } else {
                            setExpandedSmapsPid(p.pid);
                            setExpandedSmapsGroup(null);
                          }
                        }
                        setSelectedPid(p.pid);
                      }}
                    >
                      <td className="py-1 px-2 font-mono text-stone-400 whitespace-nowrap">
                        {hasSmaps ? (
                          <span className="text-stone-400 mr-1">{isSmapsExpanded ? "\u25BC" : "\u25B6"}</span>
                        ) : enrichProgress ? (
                          <span className="text-stone-300 mr-1 text-[10px]">{"\u2026"}</span>
                        ) : null}
                        {p.pid}
                      </td>
                      <td className="py-1 px-2 text-stone-800 truncate max-w-[400px]" title={p.name}>{p.name}</td>
                      {hasOomLabel && <td className="py-1 px-2 text-stone-500 text-xs whitespace-nowrap">{p.oomLabel}</td>}
                      <td className="py-1 px-2 text-right font-mono whitespace-nowrap">{fmtSize(p.pssKb * 1024)}</td>
                      {hasRss && <td className="py-1 px-2 text-right font-mono whitespace-nowrap">{fmtSize(p.rssKb * 1024)}</td>}
                      {hasBreakdown && <>
                        <td className="py-1 px-2 text-right font-mono whitespace-nowrap">{p.javaHeapKb > 0 ? fmtSize(p.javaHeapKb * 1024) : "\u2014"}</td>
                        <td className="py-1 px-2 text-right font-mono whitespace-nowrap">{p.nativeHeapKb > 0 ? fmtSize(p.nativeHeapKb * 1024) : "\u2014"}</td>
                        <td className="py-1 px-2 text-right font-mono whitespace-nowrap">{p.graphicsKb > 0 ? fmtSize(p.graphicsKb * 1024) : "\u2014"}</td>
                      </>}
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        {!canCapture ? (
                          <span className="text-xs text-stone-400" title="Only debuggable apps can be captured on non-rooted devices">locked</span>
                        ) : (
                          <button
                            className="text-xs text-sky-600 hover:text-sky-800 disabled:text-stone-300 disabled:cursor-not-allowed px-2 py-0.5 border border-sky-200 hover:border-sky-400 disabled:border-stone-200 whitespace-nowrap"
                            disabled={capturing}
                            title={capturing ? "Capture in progress" : "Capture heap dump"}
                            onClick={e => { e.stopPropagation(); handleCapture(p.pid); }}
                          >
                            {isCapturingThis ? "\u2026" : "Capture"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {isSmapsExpanded && (
                      <tr>
                        <td colSpan={colCount} className="p-0 border-t border-stone-200">
                          <SmapsSubTable
                            aggregated={smapsData.get(p.pid)!}
                            expandedGroup={expandedSmapsGroup}
                            onToggleGroup={name => setExpandedSmapsGroup(expandedSmapsGroup === name ? null : name)}
                            sortField={smapsSortField}
                            sortAsc={smapsSortAsc}
                            onToggleSort={toggleSmapsSort}
                            vmaSortField={vmaSortField}
                            vmaSortAsc={vmaSortAsc}
                            onToggleVmaSort={toggleVmaSort}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Capture status */}
          {capturing && (
            <div className="mt-2 text-xs text-stone-600">
              <div className="flex items-center gap-2 mb-1">
                <span className="truncate font-medium">{captureStatus}</span>
                {captureProgress && <span className="text-stone-400 whitespace-nowrap">{(captureProgress.done / 1048576).toFixed(1)}/{(captureProgress.total / 1048576).toFixed(1)} MB</span>}
                <button className="text-rose-500 hover:text-rose-700 ml-auto" onClick={cancelCapture}>Cancel</button>
              </div>
              {captureProgress && captureProgress.total > 0 && (
                <div className="h-1 bg-stone-100 rounded overflow-hidden">
                  <div className="h-full bg-sky-600 transition-all" style={{ width: `${(captureProgress.done / captureProgress.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>
      )}
    </div>
  );
}

// ─── Session helpers ──────────────────────────────────────────────────────────

function downloadBuffer(name: string, buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".hprof") ? name : name + ".hprof";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const skipPushRef = useRef(false);
  const adbConnRef = useRef(new AdbConnection());

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;
  const proxy = activeSession?.proxy ?? null;
  const overview = activeSession?.overview ?? null;

  // Navigate: push new state to browser history
  const navigate: NavFn = useCallback((v, p = {}) => {
    setView(v);
    setParams(p);
    const url = stateToUrl(v, p);
    window.history.pushState({ view: v, params: p }, "", url);
    window.scrollTo(0, 0);
  }, []);

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

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setView("overview");
    setParams({});
    setShowCapture(false);
  }, []);

  const discardSession = useCallback((id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) session.proxy.terminate();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
  }, [sessions, activeSessionId]);

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
          <div className="ml-auto flex items-center gap-3">
            <button
              className="text-stone-400 hover:text-white text-sm"
              onClick={() => window.history.back()}
            >
              &larr; Back
            </button>
            {activeSession && (
              <button
                className="text-stone-400 hover:text-white text-xs border border-stone-600 px-2 py-0.5"
                onClick={() => downloadBuffer(activeSession.name, activeSession.buffer)}
                title="Download .hprof file"
              >
                Download
              </button>
            )}
            <button
              className={`text-xs border px-2 py-0.5 transition-colors ${
                showCapture ? "bg-stone-600 text-white border-stone-500" : "text-stone-400 hover:text-white border-stone-600"
              }`}
              onClick={() => setShowCapture(!showCapture)}
            >
              Capture
            </button>
            <button
              className="text-stone-400 hover:text-white text-xs border border-stone-600 px-2 py-0.5"
              onClick={() => fileRef.current?.click()}
            >
              Open File
            </button>
            <input ref={fileRef} type="file" accept=".hprof" className="hidden" onChange={handleFile} />
            {activeSession && sessions.length === 1 && (
              <button
                className="text-stone-400 hover:text-rose-400 text-xs"
                onClick={() => discardSession(activeSession.id)}
              >
                Discard
              </button>
            )}
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
          <div className="p-8 pb-0 max-w-[90%] mx-auto">
            <div className="flex items-center gap-4 mb-6">
              <button className="text-stone-400 hover:text-stone-600" onClick={() => setShowCapture(false)}>
                &larr; Back
              </button>
              <h1 className="text-lg font-semibold text-stone-800">Capture from Device</h1>
            </div>
          </div>
        )}
        <div className={hasSession ? "flex-1 p-4 max-w-[90%] mx-auto w-full text-sm" : "max-w-[90%] mx-auto px-8"}>
          <CaptureView onCaptured={handleCaptured} conn={adbConnRef.current} />
        </div>
      </div>

      {/* Main content views */}
      {hasSession && !showCapture && (
        <main className="flex-1 p-4 max-w-7xl mx-auto w-full text-sm">
          {view === "overview" && overview && <OverviewView overview={overview} sessions={sessions} activeSessionId={activeSessionId} onSwitch={switchSession} onDiscard={discardSession} />}
          {view === "rooted"   && proxy    && <RootedView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} />}
          {view === "object"   && proxy    && <ObjectView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} params={params as unknown as ObjectParams} />}
          {view === "objects"  && proxy    && <ObjectsView proxy={proxy} navigate={navigate} params={params as unknown as ObjectsParams} />}
          {view === "site"     && proxy    && <SiteView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} params={params as unknown as SiteParams} />}
          {view === "search"   && proxy    && <SearchView proxy={proxy} navigate={navigate} initialQuery={params.q as string | undefined} />}
          {view === "bitmaps"  && proxy    && <BitmapGalleryView proxy={proxy} navigate={navigate} />}
        </main>
      )}
    </div>
  );
}
