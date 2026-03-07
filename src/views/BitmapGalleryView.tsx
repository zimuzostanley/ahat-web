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
        <div className="ah-bitmap-card">
          {/* Image area */}
          <div
            className="ah-bitmap-card__image"
            style={deviceScale
              ? { maxWidth: dpW, maxHeight: "45vh", aspectRatio: `${row.width} / ${row.height}`, margin: "0 auto" }
              : { width: "100%", maxHeight: "45vh", aspectRatio: `${row.width} / ${row.height}` }
            }
          >
            {bitmap && typeof bitmap === "object" ? (
              <BitmapImage width={bitmap.width} height={bitmap.height} format={bitmap.format} data={bitmap.data} />
            ) : bitmap === "loading" ? (
              <span style={{ color: "var(--ah-text-fainter)" }}>&hellip;</span>
            ) : bitmap === "error" ? (
              <span style={{ color: "var(--ah-text-fainter)", fontSize: "0.875rem" }}>no data</span>
            ) : !row.hasPixelData ? (
              <span style={{ color: "var(--ah-text-fainter)", fontSize: "0.875rem" }}>no pixel data</span>
            ) : null}
          </div>
          {/* Info bar */}
          <div className="ah-bitmap-card__info">
            <div>
              <span className="ah-bitmap-card__dim">{row.width}&times;{row.height} px</span>
              <span className="ah-bitmap-card__meta">{dpW}&times;{dpH} dp</span>
              <span className="ah-bitmap-card__meta">@{dpi}dpi</span>
              <span className="ah-bitmap-card__meta">{fmtSize(row.row.retainedTotal)}</span>
            </div>
            <button
              className="ah-bitmap-card__link"
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

      if (!rows) return <div className="ah-loading">Loading&hellip;</div>;

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
          <h2 className="ah-view-heading">Bitmaps</h2>

          {rows.length === 0 ? (
            <div className="ah-info-grid__label">No bitmaps found in this heap dump.</div>
          ) : (
            <>
              <div className="ah-card ah-mb-4">
                <div className="ah-info-grid">
                  <span className="ah-info-grid__label">Total bitmaps:</span>
                  <span className="ah-mono">{rows.length}</span>
                  <span className="ah-info-grid__label">With pixel data:</span>
                  <span className="ah-mono">{withPixels.length}{withPixels.length === 0 && <span style={{ color: "var(--ah-text-faint)", marginLeft: "0.5rem" }}>(dump with <code>-b</code> to include pixel data)</span>}</span>
                  {dupCount > 0 && (<><span className="ah-info-grid__label">Duplicates:</span><span className="ah-mono" style={{ color: "var(--ah-badge-warning)" }}>{dupCount}</span></>)}
                  <span className="ah-info-grid__label">Total retained:</span>
                  <span className="ah-mono">{fmtSize(totalRetained)}</span>
                </div>
              </div>

              {/* Duplicate bitmaps */}
              {dupGroups.length > 0 && (
                <div className="ah-mb-4">
                  <Section title={`Duplicate bitmaps (${dupGroups.length} groups, ${fmtSize(totalDupWasted)} wasted)`} defaultOpen={false}>
                    <SortableTable<DupBitmapGroup>
                      columns={[
                        { label: "Wasted", align: "right", sortKey: (r: DupBitmapGroup) => r.wastedBytes, render: (r: DupBitmapGroup) => <span className="ah-mono">{fmtSize(r.wastedBytes)}</span> },
                        { label: "Count", align: "right", sortKey: (r: DupBitmapGroup) => r.count, render: (r: DupBitmapGroup) => <span className="ah-mono">{r.count}</span> },
                        { label: "Size", render: (r: DupBitmapGroup) => <span className="ah-mono">{r.width}&times;{r.height}</span> },
                        { label: "Hash", render: (r: DupBitmapGroup) => <span className="ah-mono" style={{ color: "var(--ah-text-muted)" }}>{r.hash.slice(0, 12)}</span> },
                      ]}
                      data={dupGroups}
                      onRowClick={(r: DupBitmapGroup) => { expandedHash = expandedHash === r.hash ? null : r.hash; }}
                    />
                    {expandedHash && hashGroups.has(expandedHash) && (
                      <div style={{ marginTop: "0.5rem", borderTop: "1px solid var(--ah-border)", paddingTop: "0.5rem" }}>
                        <div style={{ fontSize: "0.75rem", lineHeight: "1rem", color: "var(--ah-text-muted)", marginBottom: "0.5rem" }}>
                          {hashGroups.get(expandedHash)!.length} allocations of this bitmap:
                        </div>
                        <SortableTable<BitmapListRow>
                          columns={[
                            { label: "Retained", align: "right", sortKey: (r: BitmapListRow) => r.row.retainedTotal, render: (r: BitmapListRow) => <span className="ah-mono">{fmtSize(r.row.retainedTotal)}</span> },
                            { label: "Heap", render: (r: BitmapListRow) => <span className="ah-info-grid__label">{r.row.heap}</span> },
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
                <div className="ah-mb-4">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <h3 className="ah-sub-heading" style={{ marginBottom: 0 }}>
                      {withPixels.length} bitmap{withPixels.length > 1 ? "s" : ""} with pixel data
                    </h3>
                    <div className="ah-bitmap-scale-toggle">
                      <button
                        className={`ah-bitmap-scale-toggle__btn${deviceScale ? " ah-bitmap-scale-toggle__btn--active" : ""}`}
                        onclick={() => { deviceScale = true; }}
                      >Device size</button>
                      <button
                        className={`ah-bitmap-scale-toggle__btn${!deviceScale ? " ah-bitmap-scale-toggle__btn--active" : ""}`}
                        onclick={() => { deviceScale = false; }}
                      >Full width</button>
                    </div>
                  </div>
                  <div className="ah-bitmap-feed">
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
                      { label: "Size", render: (r: BitmapListRow) => <span className="ah-mono">{r.width}&times;{r.height}</span> },
                      { label: "Retained", align: "right", sortKey: (r: BitmapListRow) => r.row.retainedTotal, render: (r: BitmapListRow) => <span className="ah-mono">{fmtSize(r.row.retainedTotal)}</span> },
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
