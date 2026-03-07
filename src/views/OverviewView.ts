import m from "mithril";
import type { OverviewData } from "../hprof.worker";
import { fmtSize, fmtSizeDelta, deltaBgClassBytes } from "../format";
import type { NavFn } from "../components";

interface DeltaCellAttrs { current: number; baseline: number }
function DeltaCell(): m.Component<DeltaCellAttrs> {
  return {
    view(vnode) {
      const { current, baseline } = vnode.attrs;
      const d = current - baseline;
      if (d === 0) return m("td", { className: "ah-overview-td--right" });
      return m("td", { className: `ah-overview-td--right ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"} ${deltaBgClassBytes(d)}` },
        fmtSizeDelta(d));
    },
  };
}

interface OverviewViewAttrs { overview: OverviewData; name: string; navigate: NavFn }
function OverviewView(): m.Component<OverviewViewAttrs> {
  return { view(vnode) {
    const { overview, name, navigate } = vnode.attrs;
    const diffed = overview.isDiffed ?? false;
    const baseHeaps = overview.baselineHeaps;
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

    return m("div", null,
      m("h2", { className: "ah-view-heading" }, "Overview"),

      m("div", { className: "ah-card ah-mb-4" },
        m("h3", { className: "ah-sub-heading" }, "General Information"),
        m("div", { className: "ah-info-grid--wide" },
          m("span", { className: "ah-info-grid__label" }, "Heap Dump:"),
          m("span", null, name),
          m("span", { className: "ah-info-grid__label" }, "Total Instances:"),
          m("span", { className: "ah-mono" },
            overview.instanceCount.toLocaleString(),
            diffed && overview.baselineInstanceCount != null && overview.instanceCount !== overview.baselineInstanceCount && (
              m("span", { className: `ah-ml-2 ah-nowrap ${overview.instanceCount - overview.baselineInstanceCount > 0 ? "ah-delta-pos" : "ah-delta-neg"}` },
                (overview.instanceCount - overview.baselineInstanceCount > 0 ? "+" : "\u2212") + Math.abs(overview.instanceCount - overview.baselineInstanceCount).toLocaleString())
            )
          ),
          m("span", { className: "ah-info-grid__label" }, "Heaps:"),
          m("span", null, heaps.map(h => h.name).join(", "))
        )
      ),
      m("div", { className: "ah-card" },
        m("h3", { className: "ah-sub-heading" }, "Bytes Retained by Heap"),
        m("table", { className: "ah-overview-table" },
          m("thead", null,
            m("tr", null,
              m("th", { className: "ah-overview-th" }, "Heap"),
              m("th", { className: "ah-overview-th--right" }, "Java Size"),
              diffed && m("th", { className: "ah-overview-th--right" }, "\u0394"),
              m("th", { className: "ah-overview-th--right" }, "Native Size"),
              diffed && m("th", { className: "ah-overview-th--right" }, "\u0394"),
              m("th", { className: "ah-overview-th--right" }, "Total Size"),
              diffed && m("th", { className: "ah-overview-th--right" }, "\u0394")
            )
          ),
          m("tbody", null,
            m("tr", { className: "ah-overview-total" },
              m("td", { className: "ah-overview-td" }, "Total"),
              m("td", { className: "ah-overview-td--right" }, fmtSize(totalJava)),
              diffed && m(DeltaCell, { current: totalJava, baseline: baseTotalJava }),
              m("td", { className: "ah-overview-td--right" }, fmtSize(totalNative)),
              diffed && m(DeltaCell, { current: totalNative, baseline: baseTotalNative }),
              m("td", { className: "ah-overview-td--right" }, fmtSize(totalJava + totalNative)),
              diffed && m(DeltaCell, { current: totalJava + totalNative, baseline: baseTotalJava + baseTotalNative })
            ),
            heapIndices.map(i => {
              const h = overview.heaps[i];
              const bh = baseHeaps?.[i];
              return m("tr", { key: h.name, className: "ah-overview-row" },
                m("td", { className: "ah-overview-td" }, h.name),
                m("td", { className: "ah-overview-td--right" }, fmtSize(h.java)),
                diffed && m(DeltaCell, { current: h.java, baseline: bh ? bh.java : 0 }),
                m("td", { className: "ah-overview-td--right" }, fmtSize(h.native_)),
                diffed && m(DeltaCell, { current: h.native_, baseline: bh ? bh.native_ : 0 }),
                m("td", { className: "ah-overview-td--total" }, fmtSize(h.java + h.native_)),
                diffed && m(DeltaCell, { current: h.java + h.native_, baseline: bh ? bh.java + bh.native_ : 0 })
              );
            })
          )
        )
      ),
      overview.duplicateBitmaps && overview.duplicateBitmaps.length > 0 && (
        m("div", { className: "ah-card ah-mt-4" },
          m("h3", { className: "ah-sub-heading" }, "Heap Analysis Results"),
          m("p", { style: { fontSize: "0.875rem", lineHeight: "1.25rem", color: "var(--ah-text-secondary)", marginBottom: "0.5rem" } },
            overview.duplicateBitmaps.length, " group", overview.duplicateBitmaps.length > 1 ? "s" : "", " of duplicate bitmaps detected, wasting",
            " ",
            m("span", { className: "ah-mono ah-semibold" }, fmtSize(overview.duplicateBitmaps.reduce((a, g) => a + g.wastedBytes, 0))),
            ".",
            " ",
            m("button", { className: "ah-link--alt", onclick: () => navigate("bitmaps") }, "View Bitmaps")
          ),
          m("table", { className: "ah-overview-table", style: { fontSize: "0.875rem", lineHeight: "1.25rem" } },
            m("thead", null,
              m("tr", null,
                m("th", { className: "ah-overview-th" }, "Dimensions"),
                m("th", { className: "ah-overview-th--right" }, "Copies"),
                m("th", { className: "ah-overview-th--right" }, "Total"),
                m("th", { className: "ah-overview-th--right" }, "Wasted")
              )
            ),
            m("tbody", null,
              overview.duplicateBitmaps.map((g, i) =>
                m("tr", { key: i, className: "ah-overview-row ah-tr--clickable", onclick: () => navigate("bitmaps", { dupKey: g.key }) },
                  m("td", { className: "ah-overview-td ah-mono" }, g.width, " ", "\u00d7", " ", g.height),
                  m("td", { className: "ah-overview-td--right" }, g.count),
                  m("td", { className: "ah-overview-td--right" }, fmtSize(g.totalBytes)),
                  m("td", { className: "ah-overview-td--right ah-delta-pos" }, fmtSize(g.wastedBytes))
                )
              )
            )
          )
        )
      )
    );
  } };
}

export default OverviewView;
