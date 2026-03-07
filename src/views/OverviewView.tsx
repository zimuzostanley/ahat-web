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
      if (d === 0) return <td className="ah-overview-td--right" />;
      return (
        <td className={`ah-overview-td--right ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"} ${deltaBgClassBytes(d)}`}>
          {fmtSizeDelta(d)}
        </td>
      );
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

    return (
      <div>
        <h2 className="ah-view-heading">Overview</h2>

        <div className="ah-card ah-mb-4">
          <h3 className="ah-sub-heading">General Information</h3>
          <div className="ah-info-grid--wide">
            <span className="ah-info-grid__label">Heap Dump:</span>
            <span>{name}</span>
            <span className="ah-info-grid__label">Total Instances:</span>
            <span className="ah-mono">
              {overview.instanceCount.toLocaleString()}
              {diffed && overview.baselineInstanceCount != null && overview.instanceCount !== overview.baselineInstanceCount && (
                <span className={`ah-ml-2 ah-nowrap ${overview.instanceCount - overview.baselineInstanceCount > 0 ? "ah-delta-pos" : "ah-delta-neg"}`}>
                  {(overview.instanceCount - overview.baselineInstanceCount > 0 ? "+" : "\u2212") + Math.abs(overview.instanceCount - overview.baselineInstanceCount).toLocaleString()}
                </span>
              )}
            </span>
            <span className="ah-info-grid__label">Heaps:</span>
            <span>{heaps.map(h => h.name).join(", ")}</span>
          </div>
        </div>
        <div className="ah-card">
          <h3 className="ah-sub-heading">Bytes Retained by Heap</h3>
          <table className="ah-overview-table">
            <thead>
              <tr>
                <th className="ah-overview-th">Heap</th>
                <th className="ah-overview-th--right">Java Size</th>
                {diffed && <th className="ah-overview-th--right">{"\u0394"}</th>}
                <th className="ah-overview-th--right">Native Size</th>
                {diffed && <th className="ah-overview-th--right">{"\u0394"}</th>}
                <th className="ah-overview-th--right">Total Size</th>
                {diffed && <th className="ah-overview-th--right">{"\u0394"}</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="ah-overview-total">
                <td className="ah-overview-td">Total</td>
                <td className="ah-overview-td--right">{fmtSize(totalJava)}</td>
                {diffed && <DeltaCell current={totalJava} baseline={baseTotalJava} />}
                <td className="ah-overview-td--right">{fmtSize(totalNative)}</td>
                {diffed && <DeltaCell current={totalNative} baseline={baseTotalNative} />}
                <td className="ah-overview-td--right">{fmtSize(totalJava + totalNative)}</td>
                {diffed && <DeltaCell current={totalJava + totalNative} baseline={baseTotalJava + baseTotalNative} />}
              </tr>
              {heapIndices.map(i => {
                const h = overview.heaps[i];
                const bh = baseHeaps?.[i];
                return (
                  <tr key={h.name} className="ah-overview-row">
                    <td className="ah-overview-td">{h.name}</td>
                    <td className="ah-overview-td--right">{fmtSize(h.java)}</td>
                    {diffed && <DeltaCell current={h.java} baseline={bh ? bh.java : 0} />}
                    <td className="ah-overview-td--right">{fmtSize(h.native_)}</td>
                    {diffed && <DeltaCell current={h.native_} baseline={bh ? bh.native_ : 0} />}
                    <td className="ah-overview-td--total">{fmtSize(h.java + h.native_)}</td>
                    {diffed && <DeltaCell current={h.java + h.native_} baseline={bh ? bh.java + bh.native_ : 0} />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {overview.duplicateBitmaps && overview.duplicateBitmaps.length > 0 && (
          <div className="ah-card ah-mt-4">
            <h3 className="ah-sub-heading">Heap Analysis Results</h3>
            <p style={{ fontSize: "0.875rem", lineHeight: "1.25rem", color: "var(--ah-text-secondary)", marginBottom: "0.5rem" }}>
              {overview.duplicateBitmaps.length} group{overview.duplicateBitmaps.length > 1 ? "s" : ""} of duplicate bitmaps detected, wasting{" "}
              <span className="ah-mono ah-semibold">{fmtSize(overview.duplicateBitmaps.reduce((a, g) => a + g.wastedBytes, 0))}</span>.{" "}
              <button className="ah-link--alt" onclick={() => navigate("bitmaps")}>View Bitmaps</button>
            </p>
            <table className="ah-overview-table" style={{ fontSize: "0.875rem", lineHeight: "1.25rem" }}>
              <thead>
                <tr>
                  <th className="ah-overview-th">Dimensions</th>
                  <th className="ah-overview-th--right">Copies</th>
                  <th className="ah-overview-th--right">Total</th>
                  <th className="ah-overview-th--right">Wasted</th>
                </tr>
              </thead>
              <tbody>
                {overview.duplicateBitmaps.map((g, i) => (
                  <tr key={i} className="ah-overview-row">
                    <td className="ah-overview-td ah-mono">{g.width} {"\u00d7"} {g.height}</td>
                    <td className="ah-overview-td--right">{g.count}</td>
                    <td className="ah-overview-td--right">{fmtSize(g.totalBytes)}</td>
                    <td className="ah-overview-td--right ah-delta-pos">{fmtSize(g.wastedBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  } };
}

export default OverviewView;
