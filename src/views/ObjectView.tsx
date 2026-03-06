import m from "mithril";
import { Fragment } from "../mithril-helpers";
import type { InstanceRow, InstanceDetail, HeapInfo, DiffedField, SiteData, PrimOrRef } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize, fmtHex, fmtSizeDelta } from "../format";
import { type NavFn, InstanceLink, SiteLinkRaw, Section, SortableTable, PrimOrRefCell, BitmapImage } from "../components";
import { downloadBlob } from "../utils";

export interface ObjectParams { id: number }

interface ObjectViewAttrs { proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn; params: ObjectParams }

function ObjectView(): m.Component<ObjectViewAttrs> {
  let detail: InstanceDetail | null | "loading" = "loading";
  let prevId: number | undefined;
  let cancelledRef = { value: false };

  function fetchData(attrs: ObjectViewAttrs) {
    cancelledRef.value = true;
    const localCancelled = { value: false };
    cancelledRef = localCancelled;
    detail = "loading";
    prevId = attrs.params.id;
    attrs.proxy.query<InstanceDetail | null>("getInstance", { id: attrs.params.id })
      .then(d => { if (!localCancelled.value) { detail = d; m.redraw(); } })
      .catch(err => { console.error(err); if (!localCancelled.value) { detail = null; m.redraw(); } });
  }

  return {
    oninit(vnode) {
      fetchData(vnode.attrs);
    },
    onupdate(vnode) {
      if (vnode.attrs.params.id !== prevId) {
        fetchData(vnode.attrs);
      }
    },
    onremove() {
      cancelledRef.value = true;
    },
    view(vnode) {
      const { proxy, heaps, navigate, params } = vnode.attrs;

      if (detail === "loading") return <div className="text-stone-400 dark:text-stone-500 p-4">Loading&hellip;</div>;
      if (!detail) return <div className="text-rose-600 dark:text-rose-400 p-4">No object with id {fmtHex(params.id)}</div>;

      const { row } = detail;

      return (
        <div className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold mb-1 text-stone-800 dark:text-stone-100">Object {fmtHex(row.id)}</h2>
            <div className="text-base"><InstanceLink row={row} navigate={navigate} /></div>
          </div>

          {detail.bitmap && (
            <Section title="Bitmap Image">
              <BitmapImage width={detail.bitmap.width} height={detail.bitmap.height} format={detail.bitmap.format} data={detail.bitmap.data} />
              <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">{detail.bitmap.width} x {detail.bitmap.height} px ({detail.bitmap.format.toUpperCase()})</div>
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
                    <span className="text-stone-400 dark:text-stone-500">{i === 0 ? "" : "\u2192"}</span>
                    <InstanceLink row={pe.row} navigate={navigate} />
                    {pe.field && <span className="text-stone-500 dark:text-stone-400">{pe.field}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Object Info">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <span className="text-stone-500 dark:text-stone-400">Class:</span>
              <span>{detail.classObjRow ? <InstanceLink row={detail.classObjRow} navigate={navigate} /> : "???"}</span>
              <span className="text-stone-500 dark:text-stone-400">Heap:</span>
              <span>{row.heap}</span>
              {row.isRoot && (
                <><span className="text-stone-500 dark:text-stone-400">Root Types:</span><span>{row.rootTypeNames?.join(", ")}</span></>
              )}
            </div>
          </Section>

          <Section title="Object Size">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <span className="text-stone-500 dark:text-stone-400">Shallow Size:</span>
              <span className="font-mono">
                {fmtSize(row.shallowJava + row.shallowNative)}
                {row.shallowNative > 0 && <span className="text-stone-400 dark:text-stone-500"> (java: {fmtSize(row.shallowJava)}, native: {fmtSize(row.shallowNative)})</span>}
                {row.baselineShallowJava !== undefined && (() => {
                  const d = (row.shallowJava + row.shallowNative) - ((row.baselineShallowJava ?? 0) + (row.baselineShallowNative ?? 0));
                  return d !== 0 ? <span className={`ml-2 whitespace-nowrap ${d > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{fmtSizeDelta(d)}</span> : null;
                })()}
              </span>
              <span className="text-stone-500 dark:text-stone-400">Retained Size:</span>
              <span className="font-mono font-semibold">
                {fmtSize(row.retainedTotal)}
                {row.baselineRetainedTotal !== undefined && (() => {
                  const d = row.retainedTotal - row.baselineRetainedTotal;
                  return d !== 0 ? <span className={`ml-2 font-normal whitespace-nowrap ${d > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{fmtSizeDelta(d)}</span> : null;
                })()}
              </span>
            </div>
          </Section>

          {detail.isClassObj && (
            <>
              <Section title="Class Info">
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mb-3">
                  <span className="text-stone-500 dark:text-stone-400">Super Class:</span>
                  <span>{detail.superClassObjId != null
                    ? <InstanceLink row={{ id: detail.superClassObjId, display: fmtHex(detail.superClassObjId) }} navigate={navigate} />
                    : "none"}</span>
                  <span className="text-stone-500 dark:text-stone-400">Instance Size:</span>
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
                  { label: "Object", render: (r: InstanceRow) => <InstanceLink row={r} navigate={navigate} /> },
                ]}
                data={detail.reverseRefs}
                rowKey={(r: InstanceRow) => r.id}
              />
            </Section>
          )}

          {detail.dominated.length > 0 && (
            <Section title={`Immediately Dominated Objects (${detail.dominated.length})`} defaultOpen={detail.dominated.length < 50}>
              <SortableTable<InstanceRow>
                columns={[
                  { label: "Retained", align: "right", sortKey: (r: InstanceRow) => r.retainedTotal, render: (r: InstanceRow) => <span className="font-mono">{fmtSize(r.retainedTotal)}</span> },
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
                  { label: "Object", render: (r: InstanceRow) => <InstanceLink row={r} navigate={navigate} /> },
                ]}
                data={detail.dominated}
                rowKey={(r: InstanceRow) => r.id}
              />
            </Section>
          )}
        </div>
      );
    },
  };
}

interface SiteChainViewAttrs { siteId: number; proxy: WorkerProxy; navigate: NavFn }

function SiteChainView(): m.Component<SiteChainViewAttrs> {
  let chain: SiteData["chain"] | null = null;
  let prevSiteId: number | undefined;

  function fetchChain(attrs: SiteChainViewAttrs) {
    prevSiteId = attrs.siteId;
    chain = null;
    attrs.proxy.query<SiteData>("getSite", { id: attrs.siteId })
      .then(d => { chain = d.chain; m.redraw(); })
      .catch(console.error);
  }

  return {
    oninit(vnode) {
      fetchChain(vnode.attrs);
    },
    onupdate(vnode) {
      if (vnode.attrs.siteId !== prevSiteId) {
        fetchChain(vnode.attrs);
      }
    },
    view(vnode) {
      const { navigate } = vnode.attrs;
      if (!chain) return <span className="text-stone-400 dark:text-stone-500">&hellip;</span>;
      return <>{chain.map((s, i) => (
        <div key={i} style={{ paddingLeft: Math.min(i, 20) * 16 }}>
          {i > 0 && "\u2192 "}
          <SiteLinkRaw {...s} navigate={navigate} />
        </div>
      ))}</>;
    },
  };
}

interface FieldsTableAttrs {
  fields: { name: string; typeName: string; value: PrimOrRef }[];
  diffedFields?: DiffedField[];
  navigate: NavFn;
}

function FieldsTable(): m.Component<FieldsTableAttrs> {
  return { view(vnode) {
    const { fields, diffedFields, navigate } = vnode.attrs;
    if (diffedFields) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">Type</th>
                <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">Name</th>
                <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">Value</th>
                <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">{"\u0394"}</th>
              </tr>
            </thead>
            <tbody>
              {diffedFields.map((f, i) => (
                <tr key={i} className={`border-t border-stone-100 dark:border-stone-800 ${f.status === "deleted" ? "opacity-60" : ""}`}>
                  <td className="px-2 py-0.5 text-stone-500 dark:text-stone-400 font-mono">{f.typeName}</td>
                  <td className="px-2 py-0.5 font-mono">{f.name}</td>
                  <td className="px-2 py-0.5">
                    {f.value ? <PrimOrRefCell v={f.value} navigate={navigate} /> : <span className="text-stone-400 dark:text-stone-500">{"\u2014"}</span>}
                  </td>
                  <td className="px-2 py-0.5 text-xs whitespace-nowrap">
                    {f.status === "added" && <span className="text-green-700 dark:text-green-400 font-medium">new</span>}
                    {f.status === "deleted" && (
                      <span className="text-red-700 dark:text-red-400">
                        <span className="font-medium">del</span>
                        {f.baselineValue && <>{" was "}<PrimOrRefCell v={f.baselineValue} navigate={navigate} /></>}
                      </span>
                    )}
                    {f.status === "matched" && f.baselineValue && (
                      <span className="text-amber-700 dark:text-amber-400">was <PrimOrRefCell v={f.baselineValue} navigate={navigate} /></span>
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
              <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">Type</th>
              <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">Name</th>
              <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="border-t border-stone-100 dark:border-stone-800">
                <td className="px-2 py-0.5 text-stone-500 dark:text-stone-400 font-mono">{f.typeName}</td>
                <td className="px-2 py-0.5 font-mono">{f.name}</td>
                <td className="px-2 py-0.5"><PrimOrRefCell v={f.value} navigate={navigate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } };
}

const ARRAY_SHOW_LIMIT = 5_000;

interface ArrayViewAttrs {
  elems: { idx: number; value: PrimOrRef; baselineValue?: PrimOrRef }[];
  elemTypeName: string;
  total: number;
  navigate: NavFn;
  onDownloadBytes?: () => void;
}

function ArrayView(): m.Component<ArrayViewAttrs> {
  let showCount = ARRAY_SHOW_LIMIT;

  return {
    view(vnode) {
      const { elems, elemTypeName, navigate, onDownloadBytes } = vnode.attrs;
      const hasDiff = elems.some(e => e.baselineValue !== undefined);
      const visible = elems.slice(0, showCount);
      return (
        <div>
          {onDownloadBytes && (
            <div className="mb-2">
              <button className="text-xs text-sky-600 dark:text-sky-400 hover:underline" onclick={onDownloadBytes}>Download bytes</button>
            </div>
          )}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-right px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium w-16">Index</th>
                <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">Value ({elemTypeName})</th>
                {hasDiff && <th className="text-left px-2 py-1 bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300 text-xs font-medium">{"\u0394"}</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(e => (
                <tr key={e.idx} className="border-t border-stone-100 dark:border-stone-800">
                  <td className="px-2 py-0.5 text-right font-mono text-stone-400 dark:text-stone-500">{e.idx}</td>
                  <td className="px-2 py-0.5"><PrimOrRefCell v={e.value} navigate={navigate} /></td>
                  {hasDiff && (
                    <td className="px-2 py-0.5 text-xs whitespace-nowrap">
                      {e.baselineValue && <span className="text-amber-700 dark:text-amber-400">was <PrimOrRefCell v={e.baselineValue} navigate={navigate} /></span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {elems.length > showCount && (
            <div className="text-xs text-stone-500 dark:text-stone-400 py-2">
              Showing {showCount.toLocaleString()} of {elems.length.toLocaleString()}
              {" \u2014 "}
              <button className="text-sky-600 dark:text-sky-400 ml-1 hover:underline" onclick={() => { showCount = Math.min(showCount + 5_000, elems.length); }}>show more</button>
              {" "}
              <button className="text-sky-600 dark:text-sky-400 ml-2 hover:underline" onclick={() => { showCount = elems.length; }}>show all</button>
            </div>
          )}
          {vnode.attrs.total > elems.length && (
            <div className="text-xs text-stone-500 dark:text-stone-400 pt-2">
              Showing first {elems.length.toLocaleString()} of {vnode.attrs.total.toLocaleString()} elements
            </div>
          )}
        </div>
      );
    },
  };
}

export default ObjectView;
