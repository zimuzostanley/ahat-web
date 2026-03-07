import m from "mithril";
import { Fragment } from "../mithril-helpers";
import type { BitmapListRow, InstanceDetail } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize } from "../format";
import { type NavFn, InstanceLink, Section, SortableTable, BitmapImage } from "../components";
import { consumePendingScroll } from "../navigation";
import { stateToUrl, type NavState } from "../routing";

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

      return m("div", { className: "ah-bitmap-card" },
        // Image area
        m("div", {
          className: "ah-bitmap-card__image",
          style: deviceScale
            ? { maxWidth: dpW, maxHeight: "45vh", aspectRatio: `${row.width} / ${row.height}`, margin: "0 auto" }
            : { width: "100%", maxHeight: "45vh", aspectRatio: `${row.width} / ${row.height}` },
        },
          bitmap && typeof bitmap === "object" ? (
            m(BitmapImage, { width: bitmap.width, height: bitmap.height, format: bitmap.format, data: bitmap.data })
          ) : bitmap === "loading" ? (
            m("span", { style: { color: "var(--ah-text-fainter)" } }, "\u2026")
          ) : bitmap === "error" ? (
            m("span", { style: { color: "var(--ah-text-fainter)", fontSize: "0.875rem" } }, "no data")
          ) : !row.hasPixelData ? (
            m("span", { style: { color: "var(--ah-text-fainter)", fontSize: "0.875rem" } }, "no pixel data")
          ) : null
        ),
        // Info bar
        m("div", { className: "ah-bitmap-card__info" },
          m("div", null,
            m("span", { className: "ah-bitmap-card__dim" }, row.width, "\u00d7", row.height, " px"),
            m("span", { className: "ah-bitmap-card__meta" }, dpW, "\u00d7", dpH, " dp"),
            m("span", { className: "ah-bitmap-card__meta" }, "@", dpi, "dpi"),
            m("span", { className: "ah-bitmap-card__meta" }, fmtSize(row.row.retainedTotal))
          ),
          m("button", {
            className: "ah-bitmap-card__link",
            onclick: () => navigate("object", { id: row.row.id, label: `Bitmap ${row.width}\u00d7${row.height}` }),
          }, "Details")
        )
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

interface BitmapGalleryViewAttrs { proxy: WorkerProxy; navigate: NavFn; initialDupKey?: string }

function BitmapGalleryView(): m.Component<BitmapGalleryViewAttrs> {
  let rows: BitmapListRow[] | null = null;
  let deviceScale = false;
  let expandedHash: string | null = null;
  let dupSectionOpen = false;
  let scrollToDup = false;

  return {
    oninit(vnode) {
      const dupKey = vnode.attrs.initialDupKey;
      if (dupKey) {
        expandedHash = dupKey;
        dupSectionOpen = true;
        scrollToDup = true;
      }
      vnode.attrs.proxy.query<BitmapListRow[]>("getBitmapList")
        .then(r => { rows = r; m.redraw(); consumePendingScroll(); })
        .catch(console.error);
    },
    view(vnode) {
      const { proxy, navigate } = vnode.attrs;

      if (!rows) return m("div", { className: "ah-loading" }, "Loading\u2026");

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

      return m("div", null,
        m("h2", { className: "ah-view-heading" }, "Bitmaps"),

        rows.length === 0 ? (
          m("div", { className: "ah-info-grid__label" }, "No bitmaps found in this heap dump.")
        ) : (
          m(Fragment, null,
            m("div", { className: "ah-card ah-mb-4" },
              m("div", { className: "ah-info-grid" },
                m("span", { className: "ah-info-grid__label" }, "Total bitmaps:"),
                m("span", { className: "ah-mono" }, rows.length),
                m("span", { className: "ah-info-grid__label" }, "With pixel data:"),
                m("span", { className: "ah-mono" }, withPixels.length, withPixels.length === 0 && m("span", { style: { color: "var(--ah-text-faint)", marginLeft: "0.5rem" } }, "(dump with ", m("code", null, "-b"), " to include pixel data)")),
                dupCount > 0 && m(Fragment, null, m("span", { className: "ah-info-grid__label" }, "Duplicates:"), m("span", { className: "ah-mono", style: { color: "var(--ah-badge-warning)" } }, dupCount)),
                m("span", { className: "ah-info-grid__label" }, "Total retained:"),
                m("span", { className: "ah-mono" }, fmtSize(totalRetained))
              )
            ),

            // Duplicate bitmaps
            dupGroups.length > 0 && (
              m("div", { className: "ah-mb-4" },
                m(Section, { title: `Duplicate bitmaps (${dupGroups.length} groups, ${fmtSize(totalDupWasted)} wasted)`, defaultOpen: dupSectionOpen },
                  m(SortableTable, {
                    columns: [
                      { label: "Wasted", align: "right", sortKey: (r: DupBitmapGroup) => r.wastedBytes, render: (r: DupBitmapGroup) => m("span", { className: "ah-mono" }, fmtSize(r.wastedBytes)) },
                      { label: "Count", align: "right", sortKey: (r: DupBitmapGroup) => r.count, render: (r: DupBitmapGroup) => m("span", { className: "ah-mono" }, r.count) },
                      { label: "Size", render: (r: DupBitmapGroup) => m("span", { className: "ah-mono" }, r.width, "\u00d7", r.height) },
                      { label: "Hash", render: (r: DupBitmapGroup) => m("span", { className: "ah-mono", style: { color: "var(--ah-text-muted)" } }, r.hash.slice(0, 12)) },
                    ],
                    data: dupGroups,
                    onRowClick: (r: DupBitmapGroup) => {
                      expandedHash = expandedHash === r.hash ? null : r.hash;
                      if (expandedHash) scrollToDup = true;
                      // Save expanded state to history so back-nav restores it
                      const prev = window.history.state;
                      const params: Record<string, unknown> = {};
                      if (expandedHash) params.dupKey = expandedHash;
                      const navState: NavState = { view: "bitmaps", params };
                      window.history.replaceState({ ...prev, params }, "", stateToUrl(navState));
                    },
                  }),
                  expandedHash && hashGroups.has(expandedHash) && (
                    m("div", {
                      style: { marginTop: "0.5rem", borderTop: "1px solid var(--ah-border)", paddingTop: "0.5rem" },
                      oncreate: (vnode: m.VnodeDOM) => {
                        if (scrollToDup) {
                          scrollToDup = false;
                          (vnode.dom as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                      },
                      onupdate: (vnode: m.VnodeDOM) => {
                        if (scrollToDup) {
                          scrollToDup = false;
                          (vnode.dom as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
                        }
                      },
                    },
                      m("div", { style: { fontSize: "0.75rem", lineHeight: "1rem", color: "var(--ah-text-muted)", marginBottom: "0.5rem" } },
                        hashGroups.get(expandedHash)!.length, " allocations of this bitmap:"),
                      m(SortableTable, {
                        columns: [
                          { label: "Retained", align: "right", sortKey: (r: BitmapListRow) => r.row.retainedTotal, render: (r: BitmapListRow) => m("span", { className: "ah-mono" }, fmtSize(r.row.retainedTotal)) },
                          { label: "Heap", render: (r: BitmapListRow) => m("span", { className: "ah-info-grid__label" }, r.row.heap) },
                          { label: "Object", render: (r: BitmapListRow) => m(InstanceLink, { row: r.row, navigate }) },
                        ],
                        data: hashGroups.get(expandedHash)!,
                        rowKey: (r: BitmapListRow) => r.row.id,
                      })
                    )
                  )
                )
              )
            ),

            // Vertical bitmap feed
            withPixels.length > 0 && (
              m("div", { className: "ah-mb-4" },
                m("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" } },
                  m("h3", { className: "ah-sub-heading", style: { marginBottom: 0 } },
                    withPixels.length, " bitmap", withPixels.length > 1 ? "s" : "", " with pixel data"),
                  m("div", { className: "ah-bitmap-scale-toggle" },
                    m("button", {
                      className: `ah-bitmap-scale-toggle__btn${deviceScale ? " ah-bitmap-scale-toggle__btn--active" : ""}`,
                      onclick: () => { deviceScale = true; },
                    }, "Device size"),
                    m("button", {
                      className: `ah-bitmap-scale-toggle__btn${!deviceScale ? " ah-bitmap-scale-toggle__btn--active" : ""}`,
                      onclick: () => { deviceScale = false; },
                    }, "Full width")
                  )
                ),
                m("div", { className: "ah-bitmap-feed" },
                  withPixels.map(r =>
                    m(BitmapCard, { key: r.row.id, row: r, proxy, navigate, density: r.density, deviceScale })
                  )
                )
              )
            ),

            // Table for bitmaps without pixel data
            withoutPixels.length > 0 && (
              m(Section, { title: `Bitmaps without pixel data (${withoutPixels.length})`, defaultOpen: withPixels.length === 0 },
                m(SortableTable, {
                  columns: [
                    { label: "Size", render: (r: BitmapListRow) => m("span", { className: "ah-mono" }, r.width, "\u00d7", r.height) },
                    { label: "Retained", align: "right", sortKey: (r: BitmapListRow) => r.row.retainedTotal, render: (r: BitmapListRow) => m("span", { className: "ah-mono" }, fmtSize(r.row.retainedTotal)) },
                    { label: "Object", render: (r: BitmapListRow) => m(InstanceLink, { row: r.row, navigate }) },
                  ],
                  data: withoutPixels,
                })
              )
            )
          )
        )
      );
    },
  };
}

export default BitmapGalleryView;
