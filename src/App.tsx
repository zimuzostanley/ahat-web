import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type {
  OverviewData, HeapInfo,
  InstanceRow, InstanceDetail,
  SiteData, SiteChildRow, SiteObjectsRow,
  PrimOrRef, BitmapListRow,
} from "./hprof.worker";

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

    worker.postMessage({ type: "parse", buffer }, [buffer]);
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
    case "bitmaps": return "/bitmaps";
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
    case "/bitmaps":
      return { view: "bitmaps", params: {} };
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
      {open && <div className="px-4 pb-3 border-t border-stone-100 pt-3">{children}</div>}
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
    <div>
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

function BitmapCanvas({ width, height, rgbaData }: { width: number; height: number; rgbaData: Uint8Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const clamped = new Uint8ClampedArray(rgbaData.length);
    clamped.set(rgbaData);
    const imgData = new ImageData(clamped, width, height);
    ctx.putImageData(imgData, 0, 0);
  }, [width, height, rgbaData]);

  // Scale down large bitmaps to fit, preserving aspect ratio
  const maxDisplay = 512;
  const scale = Math.min(1, maxDisplay / Math.max(width, height));
  const displayW = Math.round(width * scale);
  const displayH = Math.round(height * scale);

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ width: displayW, height: displayH, imageRendering: "pixelated" }}
      />
      <div className="text-xs text-stone-500 mt-1">{width} x {height} px</div>
    </div>
  );
}

// ─── Views ────────────────────────────────────────────────────────────────────

function OverviewView({ overview }: { overview: OverviewData }) {
  const heaps = overview.heaps.filter(h => h.java + h.native_ > 0);
  const totalJava = heaps.reduce((a, h) => a + h.java, 0);
  const totalNative = heaps.reduce((a, h) => a + h.native_, 0);
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Overview</h2>
      <div className="bg-white border border-stone-200 p-4 mb-4">
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">General Information</h3>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 max-w-md">
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
          <BitmapCanvas width={detail.bitmap.width} height={detail.bitmap.height} rgbaData={detail.bitmap.rgbaData} />
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
              <div key={i} className={`flex items-baseline gap-1 ${pe.isDominator ? "font-semibold" : ""}`} style={{ paddingLeft: i * 12 }}>
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
    <div key={i} style={{ paddingLeft: i * 16 }}>
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
            <div key={i} style={{ paddingLeft: i * 16 }}>{i > 0 && "\u2192 "}<SiteLinkRaw {...s} navigate={navigate} /></div>
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

function BitmapGalleryView({ proxy, navigate }: { proxy: WorkerProxy; navigate: NavFn }) {
  const [rows, setRows] = useState<BitmapListRow[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedBitmap, setExpandedBitmap] = useState<{ width: number; height: number; rgbaData: Uint8Array } | null>(null);

  useEffect(() => {
    proxy.query<BitmapListRow[]>("getBitmapList").then(setRows).catch(console.error);
  }, [proxy]);

  const [bitmapError, setBitmapError] = useState<string | null>(null);

  const loadBitmap = useCallback((id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedBitmap(null);
      setBitmapError(null);
      return;
    }
    setExpandedId(id);
    setExpandedBitmap(null);
    setBitmapError(null);
    proxy.query<InstanceDetail | null>("getInstance", { id })
      .then(detail => {
        if (detail?.bitmap) {
          setExpandedBitmap(detail.bitmap);
        } else {
          setBitmapError("No bitmap data available");
        }
      })
      .catch(err => {
        console.error(err);
        setBitmapError(err instanceof Error ? err.message : "Failed to load bitmap");
      });
  }, [proxy, expandedId]);

  if (!rows) return <div className="text-stone-400 p-4">Loading&hellip;</div>;

  // Duplicate detection
  const hashCounts = new Map<string, number>();
  for (const r of rows) hashCounts.set(r.bufferHash, (hashCounts.get(r.bufferHash) ?? 0) + 1);

  const totalRetained = rows.reduce((sum, r) => sum + r.row.retainedTotal, 0);
  const uniqueCount = hashCounts.size;
  const softwareCount = rows.filter(r => r.hasPixelData).length;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-stone-800">Bitmaps</h2>

      {rows.length === 0 ? (
        <div className="text-stone-500 text-sm">No bitmaps found in this heap dump.</div>
      ) : (
        <>
          <div className="bg-white border border-stone-200 p-3 mb-4">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <span className="text-stone-500">Bitmaps found:</span>
              <span className="font-mono">{rows.length.toLocaleString()}</span>
              <span className="text-stone-500">With pixel data:</span>
              <span className="font-mono">{softwareCount.toLocaleString()}{softwareCount === 0 && <span className="text-stone-400 ml-2">(all hardware bitmaps — pixel data in native memory)</span>}</span>
              <span className="text-stone-500">Unique images:</span>
              <span className="font-mono">{uniqueCount.toLocaleString()}</span>
              <span className="text-stone-500">Total retained:</span>
              <span className="font-mono">{fmtSize(totalRetained)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {rows.map(r => {
              const dupCount = hashCounts.get(r.bufferHash) ?? 1;
              const isExpanded = expandedId === r.row.id;
              return (
                <div key={r.row.id} className={`bg-white border border-stone-200 p-3 ${isExpanded ? "sm:col-span-2 lg:col-span-3 xl:col-span-4" : ""}`}>
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-sm font-mono">{r.width} &times; {r.height} px</span>
                    <div className="flex items-center gap-1">
                      {dupCount > 1 && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5">{dupCount}&times; dup</span>
                      )}
                      <span className="text-xs text-stone-500 font-mono">{fmtSize(r.row.retainedTotal)}</span>
                    </div>
                  </div>

                  {isExpanded && expandedBitmap && (
                    <div className="mb-2">
                      <BitmapCanvas width={expandedBitmap.width} height={expandedBitmap.height} rgbaData={expandedBitmap.rgbaData} />
                    </div>
                  )}
                  {isExpanded && !expandedBitmap && !bitmapError && (
                    <div className="text-stone-400 text-sm mb-2">Loading image&hellip;</div>
                  )}
                  {isExpanded && bitmapError && (
                    <div className="text-rose-500 text-sm mb-2">{bitmapError}</div>
                  )}

                  <div className="flex items-center gap-2 text-sm">
                    {r.hasPixelData ? (
                      <button className="text-sky-700 hover:underline" onClick={() => loadBitmap(r.row.id)}>
                        {isExpanded ? "Hide" : "Preview"}
                      </button>
                    ) : (
                      <span className="text-stone-400 italic">hardware bitmap</span>
                    )}
                    <button className="text-sky-700 hover:underline" onClick={() => navigate("object", { id: r.row.id })}>
                      Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [proxy, setProxy] = useState<WorkerProxy | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [view, setView] = useState("overview");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ msg: "", pct: 0 });
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const skipPushRef = useRef(false);

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

  const loadFile = useCallback(async (file: File) => {
    proxy?.terminate();
    setProxy(null); setOverview(null); setLoading(true); setError(null);
    setFileName(file.name);
    setProgress({ msg: "Reading file\u2026", pct: 0 });
    try {
      const buffer = await file.arrayBuffer();
      setProgress({ msg: "Starting parser\u2026", pct: 2 });

      const worker = new Worker(
        new URL("./hprof.worker.ts", import.meta.url),
        { type: "module" },
      );

      const { proxy: p, overview: ov } = await makeWorkerProxy(
        worker,
        buffer,
        (msg: string, pct: number) => setProgress({ msg, pct }),
      );

      setProxy(p);
      setOverview(ov);

      // Parse initial URL to determine starting view
      const initial = urlToState(new URL(window.location.href));
      setView(initial.view);
      setParams(initial.params);
      // Replace current history entry with proper state
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
  }, [proxy]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  // ── Landing page ──
  if (!proxy && !loading) {
    return (
      <div
        className="min-h-screen bg-stone-50 flex items-center justify-center p-8"
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
          {error && (
            <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>
          )}
        </div>
      </div>
    );
  }

  // ── Loading screen ──
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white border border-stone-200 p-8">
          <h2 className="text-lg font-semibold text-stone-800 mb-4">Parsing {fileName || "Heap Dump"}&hellip;</h2>
          <div className="w-full h-2 bg-stone-100 overflow-hidden mb-3">
            <div className="h-full bg-sky-500 transition-all duration-300" style={{ width: progress.pct + "%" }} />
          </div>
          <p className="text-sm text-stone-500">{progress.msg}</p>
        </div>
      </div>
    );
  }

  // ── Main app with nav ──
  const navItems = [
    { view: "overview", label: "Overview", params: {} },
    { view: "rooted", label: "Rooted", params: {} },
    { view: "site", label: "Allocations", params: { id: 0 } },
    { view: "bitmaps", label: "Bitmaps", params: {} },
    { view: "search", label: "Search", params: {} },
  ];

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-stone-800 text-white px-4 py-2 flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-sky-600 flex items-center justify-center text-white font-bold text-xs">A</div>
          <span className="font-bold tracking-tight text-sm">ahat<span className="text-stone-400 font-normal">.web</span></span>
        </div>
        <nav className="flex gap-0.5 ml-4">
          {navItems.map(n => (
            <button
              key={n.view}
              className={`px-3 py-1 text-sm transition-colors ${
                view === n.view ? "bg-stone-600 text-white" : "text-stone-300 hover:bg-stone-700 hover:text-white"
              }`}
              onClick={() => navigate(n.view, n.params)}
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
          <button
            className="text-stone-400 hover:text-white text-xs border border-stone-600 px-2 py-0.5"
            onClick={() => { proxy?.terminate(); setProxy(null); setOverview(null); setError(null); navigate("overview", {}); }}
          >
            New File
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-7xl mx-auto w-full text-sm">
        {view === "overview" && overview && <OverviewView overview={overview} />}
        {view === "rooted"   && proxy    && <RootedView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} />}
        {view === "object"   && proxy    && <ObjectView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} params={params as unknown as ObjectParams} />}
        {view === "objects"  && proxy    && <ObjectsView proxy={proxy} navigate={navigate} params={params as unknown as ObjectsParams} />}
        {view === "site"     && proxy    && <SiteView proxy={proxy} heaps={overview?.heaps ?? []} navigate={navigate} params={params as unknown as SiteParams} />}
        {view === "search"   && proxy    && <SearchView proxy={proxy} navigate={navigate} initialQuery={params.q as string | undefined} />}
        {view === "bitmaps"  && proxy    && <BitmapGalleryView proxy={proxy} navigate={navigate} />}
      </main>
    </div>
  );
}
