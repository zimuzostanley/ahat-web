import m from "mithril";
import { Fragment } from "../mithril-helpers";
import type { BitmapListRow, InstanceDetail } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, InstanceLink, Section, SortableTable, BitmapImage } from "../components";

interface BitmapCardAttrs {
  row: BitmapListRow; proxy: WorkerProxy; navigate: NavFn; density: number; deviceScale: boolean;
}

function BitmapCard(): m.Component<BitmapCardAttrs> {
  let obs: IntersectionObserver | null = null;
  let bitmap: InstanceDetail["bitmap"] | null | "loading" | "error" = null;

  function load(proxy: WorkerProxy, id: number) {
    if (bitmap !== null) return;
    bitmap = "loading";
    proxy.query<InstanceDetail | null>("getInstance", { id })
      .then(detail => { bitmap = detail?.bitmap ?? "error"; m.redraw(); })
      .catch(() => { bitmap = "error"; m.redraw(); });
  }

  return {
    oncreate(vnode) {
      if (!vnode.attrs.row.hasPixelData) return;
      obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          load(vnode.attrs.proxy, vnode.attrs.row.row.id);
          obs!.disconnect();
        }
      }, { rootMargin: "400px" });
      obs.observe(vnode.dom as Element);
    },
    onremove() {
      obs?.disconnect();
    },
    view(vnode) {
      const { row, navigate, deviceScale } = vnode.attrs;
      const density = vnode.attrs.density;

      // dp = px / (dpi / 160). mDensity is the bitmap's target DPI.
      const dpi = density > 0 ? density : 420;
      const scale = dpi / 160;
      const dpW = Math.round(row.width / scale);
      const dpH = Math.round(row.height / scale);

      return (
        <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700">
          {/* Image area */}
          <div
            className="bg-stone-50 dark:bg-stone-800 flex items-center justify-center overflow-hidden"
            style={deviceScale
              ? { maxWidth: dpW, maxHeight: "45vh", aspectRatio: `${row.width} / ${row.height}`, margin: "0 auto" }
              : { width: "100%", maxHeight: "45vh", aspectRatio: `${row.width} / ${row.height}` }
            }
          >
            {bitmap && typeof bitmap === "object" ? (
              <BitmapImage width={bitmap.width} height={bitmap.height} format={bitmap.format} data={bitmap.data} />
            ) : bitmap === "loading" ? (
              <span className="text-stone-300 dark:text-stone-600">&hellip;</span>
            ) : bitmap === "error" ? (
              <span className="text-stone-300 text-sm">no data</span>
            ) : !row.hasPixelData ? (
              <span className="text-stone-300 text-sm">no pixel data</span>
            ) : null}
          </div>
          {/* Info bar */}
          <div className="px-3 py-2 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between">
            <div>
              <span className="text-xs font-mono text-stone-600 dark:text-stone-300">{row.width}&times;{row.height} px</span>
              <span className="text-xs text-stone-400 dark:text-stone-500 ml-2">{dpW}&times;{dpH} dp</span>
              <span className="text-xs text-stone-400 dark:text-stone-500 ml-2">@{dpi}dpi</span>
              <span className="text-xs text-stone-400 dark:text-stone-500 ml-2">{fmtSize(row.row.retainedTotal)}</span>
            </div>
            <button
              className="text-xs text-sky-700 dark:text-sky-400 underline decoration-sky-300 dark:decoration-sky-600 hover:decoration-sky-500 dark:hover:decoration-sky-400"
              onclick={() => navigate("object", { id: row.row.id, label: `Bitmap ${row.width}\u00d7${row.height}` })}
            >Details</button>
          </div>
        </div>
      );
    },
  };
}

interface DupBitmapGroup {
  hash: string;
  width: number;
  height: number;
  count: number;
  wastedBytes: number;
}

interface BitmapGalleryViewAttrs { proxy: WorkerProxy; navigate: NavFn }

function BitmapGalleryView(): m.Component<BitmapGalleryViewAttrs> {
  let rows: BitmapListRow[] | null = null;
  let deviceScale = false;
  let expandedHash: string | null = null;

  return {
    oninit(vnode) {
      vnode.attrs.proxy.query<BitmapListRow[]>("getBitmapList")
        .then(r => { rows = r; m.redraw(); })
        .catch(console.error);
    },
    view(vnode) {
      const { proxy, navigate } = vnode.attrs;

      if (!rows) return <div className="text-stone-400 dark:text-stone-500 p-4">Loading&hellip;</div>;

      // Duplicate detection — group by buffer hash
      const hashGroups = new Map<string, BitmapListRow[]>();
      for (const r of rows) {
        if (!r.hasPixelData) continue;
        const list = hashGroups.get(r.bufferHash);
        if (list) list.push(r); else hashGroups.set(r.bufferHash, [r]);
      }
      const dupGroups: DupBitmapGroup[] = [];
      for (const [hash, items] of hashGroups) {
        if (items.length < 2) continue;
        const minRetained = Math.min(...items.map(i => i.row.retainedTotal));
        dupGroups.push({
          hash,
          width: items[0].width,
          height: items[0].height,
          count: items.length,
          wastedBytes: items.reduce((s, i) => s + i.row.retainedTotal, 0) - minRetained,
        });
      }
      dupGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);
      const totalDupWasted = dupGroups.reduce((s, g) => s + g.wastedBytes, 0);

      const totalRetained = rows.reduce((sum, r) => sum + r.row.retainedTotal, 0);
      const withPixels = rows.filter(r => r.hasPixelData);
      const withoutPixels = rows.filter(r => !r.hasPixelData);
      const dupCount = dupGroups.reduce((s, g) => s + g.count, 0);

      return (
        <div>
          <h2 className="text-lg font-semibold mb-3 text-stone-800 dark:text-stone-100">Bitmaps</h2>

          {rows.length === 0 ? (
            <div className="text-stone-500 dark:text-stone-400">No bitmaps found in this heap dump.</div>
          ) : (
            <>
              <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 p-3 mb-4">
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <span className="text-stone-500 dark:text-stone-400">Total bitmaps:</span>
                  <span className="font-mono">{rows.length}</span>
                  <span className="text-stone-500 dark:text-stone-400">With pixel data:</span>
                  <span className="font-mono">{withPixels.length}{withPixels.length === 0 && <span className="text-stone-400 dark:text-stone-500 ml-2">(dump with <code className="bg-stone-100 dark:bg-stone-700 px-1">-b</code> to include pixel data)</span>}</span>
                  {dupCount > 0 && (<><span className="text-stone-500 dark:text-stone-400">Duplicates:</span><span className="font-mono text-amber-600 dark:text-amber-400">{dupCount}</span></>)}
                  <span className="text-stone-500 dark:text-stone-400">Total retained:</span>
                  <span className="font-mono">{fmtSize(totalRetained)}</span>
                </div>
              </div>

              {/* Duplicate bitmaps */}
              {dupGroups.length > 0 && (
                <div className="mb-4">
                  <Section title={`Duplicate bitmaps (${dupGroups.length} groups, ${fmtSize(totalDupWasted)} wasted)`} defaultOpen={false}>
                    <SortableTable<DupBitmapGroup>
                      columns={[
                        { label: "Wasted", align: "right", sortKey: (r: DupBitmapGroup) => r.wastedBytes, render: (r: DupBitmapGroup) => <span className="font-mono">{fmtSize(r.wastedBytes)}</span> },
                        { label: "Count", align: "right", sortKey: (r: DupBitmapGroup) => r.count, render: (r: DupBitmapGroup) => <span className="font-mono">{r.count}</span> },
                        { label: "Size", render: (r: DupBitmapGroup) => <span className="font-mono">{r.width}&times;{r.height}</span> },
                        { label: "Hash", render: (r: DupBitmapGroup) => <span className="font-mono text-stone-500 dark:text-stone-400">{r.hash.slice(0, 12)}</span> },
                      ]}
                      data={dupGroups}
                      onRowClick={(r: DupBitmapGroup) => { expandedHash = expandedHash === r.hash ? null : r.hash; }}
                    />
                    {expandedHash && hashGroups.has(expandedHash) && (
                      <div className="mt-2 border-t border-stone-200 dark:border-stone-700 pt-2">
                        <div className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                          {hashGroups.get(expandedHash)!.length} allocations of this bitmap:
                        </div>
                        <SortableTable<BitmapListRow>
                          columns={[
                            { label: "Retained", align: "right", sortKey: (r: BitmapListRow) => r.row.retainedTotal, render: (r: BitmapListRow) => <span className="font-mono">{fmtSize(r.row.retainedTotal)}</span> },
                            { label: "Heap", render: (r: BitmapListRow) => <span className="text-stone-500 dark:text-stone-400">{r.row.heap}</span> },
                            { label: "Object", render: (r: BitmapListRow) => <InstanceLink row={r.row} navigate={navigate} /> },
                          ]}
                          data={hashGroups.get(expandedHash)!}
                          rowKey={(r: BitmapListRow) => r.row.id}
                        />
                      </div>
                    )}
                  </Section>
                </div>
              )}

              {/* Vertical bitmap feed */}
              {withPixels.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wider">
                      {withPixels.length} bitmap{withPixels.length > 1 ? "s" : ""} with pixel data
                    </h3>
                    <div className="inline-flex text-xs border border-stone-200 dark:border-stone-700 divide-x divide-stone-200 dark:divide-stone-700">
                      <button
                        className={`px-2 py-0.5 ${deviceScale ? "bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 font-medium" : "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300"}`}
                        onclick={() => { deviceScale = true; }}
                      >Device size</button>
                      <button
                        className={`px-2 py-0.5 ${!deviceScale ? "bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 font-medium" : "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300"}`}
                        onclick={() => { deviceScale = false; }}
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
                      { label: "Size", render: (r: BitmapListRow) => <span className="font-mono">{r.width}&times;{r.height}</span> },
                      { label: "Retained", align: "right", sortKey: (r: BitmapListRow) => r.row.retainedTotal, render: (r: BitmapListRow) => <span className="font-mono">{fmtSize(r.row.retainedTotal)}</span> },
                      { label: "Object", render: (r: BitmapListRow) => <InstanceLink row={r.row} navigate={navigate} /> },
                    ]}
                    data={withoutPixels}
                  />
                </Section>
              )}
            </>
          )}
        </div>
      );
    },
  };
}

export default BitmapGalleryView;
