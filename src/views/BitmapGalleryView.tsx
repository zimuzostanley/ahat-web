import { useState, useCallback, useRef, useEffect } from "react";
import type { BitmapListRow, InstanceDetail } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, InstanceLink, Section, SortableTable, BitmapImage } from "../components";

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

export default BitmapGalleryView;
