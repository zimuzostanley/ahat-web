import type { OverviewData } from "../hprof.worker";
import { fmtSize, fmtSizeDelta, deltaBgClassBytes } from "../format";
import type { NavFn } from "../components";

function DeltaCell({ current, baseline }: { current: number; baseline: number }) {
  const d = current - baseline;
  if (d === 0) return <td className="py-1 px-2 text-right font-mono" />;
  return (
    <td className={`py-1 px-2 text-right font-mono whitespace-nowrap ${d > 0 ? "text-red-700" : "text-green-700"} ${deltaBgClassBytes(d)}`}>
      {fmtSizeDelta(d)}
    </td>
  );
}

function OverviewView({ overview, name, navigate }: {
  overview: OverviewData;
  name: string;
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
          <span>{name}</span>
          <span className="text-stone-500">Total Instances:</span>
          <span className="font-mono">
            {overview.instanceCount.toLocaleString()}
            {diffed && overview.baselineInstanceCount != null && overview.instanceCount !== overview.baselineInstanceCount && (
              <span className={`ml-2 whitespace-nowrap ${overview.instanceCount - overview.baselineInstanceCount > 0 ? "text-red-700" : "text-green-700"}`}>
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
                <tr key={h.name} className="border-t border-stone-100 hover:bg-stone-50">
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
            <button className="text-sky-600 hover:underline" onClick={() => navigate("bitmaps")}>View Bitmaps</button>
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
                <tr key={i} className="border-t border-stone-100 hover:bg-stone-50">
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

export default OverviewView;
