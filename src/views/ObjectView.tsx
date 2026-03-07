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

      if (detail === "loading") return <div className="ah-loading">Loading&hellip;</div>;
      if (!detail) return <div className="ah-error-text">No object with id {fmtHex(params.id)}</div>;

      const { row } = detail;

      return (
        <div className="ah-view-stack">
          <div>
            <h2 className="ah-view-heading" style={{ marginBottom: "0.25rem" }}>Object {fmtHex(row.id)}</h2>
            <div><InstanceLink row={row} navigate={navigate} /></div>
          </div>

          {detail.bitmap && (
            <Section title="Bitmap Image">
              <BitmapImage width={detail.bitmap.width} height={detail.bitmap.height} format={detail.bitmap.format} data={detail.bitmap.data} />
              <div className="ah-mt-1" style={{ fontSize: "0.75rem", lineHeight: "1rem", color: "var(--ah-text-muted)" }}>{detail.bitmap.width} x {detail.bitmap.height} px ({detail.bitmap.format.toUpperCase()})</div>
            </Section>
          )}

          {detail.siteId > 0 && (
            <Section title="Allocation Site">
              <div className="ah-view-stack" style={{ gap: "0.125rem" }}>
                <SiteChainView siteId={detail.siteId} proxy={proxy} navigate={navigate} />
              </div>
            </Section>
          )}

          {detail.pathFromRoot && (
            <Section title={detail.isUnreachablePath ? "Sample Path" : "Sample Path from GC Root"}>
              <div className="ah-view-stack" style={{ gap: "0.125rem" }}>
                {detail.pathFromRoot.map((pe, i) => (
                  <div key={i} className={`ah-path-entry${pe.isDominator ? " ah-semibold" : ""}`} style={{ paddingLeft: Math.min(i, 20) * 12 }}>
                    <span className="ah-path-arrow">{i === 0 ? "" : "\u2192"}</span>
                    <InstanceLink row={pe.row} navigate={navigate} />
                    {pe.field && <span className="ah-path-field">{pe.field}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Object Info">
            <div className="ah-info-grid">
              <span className="ah-info-grid__label">Class:</span>
              <span>{detail.classObjRow ? <InstanceLink row={detail.classObjRow} navigate={navigate} /> : "???"}</span>
              <span className="ah-info-grid__label">Heap:</span>
              <span>{row.heap}</span>
              {row.isRoot && (
                <><span className="ah-info-grid__label">Root Types:</span><span>{row.rootTypeNames?.join(", ")}</span></>
              )}
            </div>
          </Section>

          <Section title="Object Size">
            <div className="ah-info-grid">
              <span className="ah-info-grid__label">Shallow Size:</span>
              <span className="ah-mono">
                {fmtSize(row.shallowJava + row.shallowNative)}
                {row.shallowNative > 0 && <span style={{ color: "var(--ah-text-faint)" }}> (java: {fmtSize(row.shallowJava)}, native: {fmtSize(row.shallowNative)})</span>}
                {row.baselineShallowJava !== undefined && (() => {
                  const d = (row.shallowJava + row.shallowNative) - ((row.baselineShallowJava ?? 0) + (row.baselineShallowNative ?? 0));
                  return d !== 0 ? <span className={`ah-ml-2 ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}`}>{fmtSizeDelta(d)}</span> : null;
                })()}
              </span>
              <span className="ah-info-grid__label">Retained Size:</span>
              <span className="ah-mono ah-semibold">
                {fmtSize(row.retainedTotal)}
                {row.baselineRetainedTotal !== undefined && (() => {
                  const d = row.retainedTotal - row.baselineRetainedTotal;
                  return d !== 0 ? <span className={`ah-ml-2 ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}`} style={{ fontWeight: "normal" }}>{fmtSizeDelta(d)}</span> : null;
                })()}
              </span>
            </div>
          </Section>

          {detail.isClassObj && (
            <>
              <Section title="Class Info">
                <div className="ah-info-grid ah-mb-3">
                  <span className="ah-info-grid__label">Super Class:</span>
                  <span>{detail.superClassObjId != null
                    ? <InstanceLink row={{ id: detail.superClassObjId, display: fmtHex(detail.superClassObjId) }} navigate={navigate} />
                    : "none"}</span>
                  <span className="ah-info-grid__label">Instance Size:</span>
                  <span className="ah-mono">{detail.instanceSize}</span>
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
                  { label: "Retained", align: "right", sortKey: (r: InstanceRow) => r.retainedTotal, render: (r: InstanceRow) => <span className="ah-mono">{fmtSize(r.retainedTotal)}</span> },
                  ...heaps.filter(h => h.java + h.native_ > 0).map(h => ({
                    label: h.name, align: "right",
                    sortKey: (r: InstanceRow) => {
                      const s = r.retainedByHeap.find(x => x.heap === h.name);
                      return (s?.java ?? 0) + (s?.native_ ?? 0);
                    },
                    render: (r: InstanceRow) => {
                      const s = r.retainedByHeap.find(x => x.heap === h.name);
                      return <span className="ah-mono">{fmtSize((s?.java ?? 0) + (s?.native_ ?? 0))}</span>;
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
      if (!chain) return <span style={{ color: "var(--ah-text-faint)" }}>&hellip;</span>;
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
        <div className="ah-table-wrap">
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th className="ah-fields-th">Type</th>
                <th className="ah-fields-th">Name</th>
                <th className="ah-fields-th">Value</th>
                <th className="ah-fields-th">{"\u0394"}</th>
              </tr>
            </thead>
            <tbody>
              {diffedFields.map((f, i) => (
                <tr key={i} className={`ah-fields-tr${f.status === "deleted" ? " ah-opacity-60" : ""}`}>
                  <td className="ah-fields-td--type">{f.typeName}</td>
                  <td className="ah-fields-td--name">{f.name}</td>
                  <td className="ah-fields-td">
                    {f.value ? <PrimOrRefCell v={f.value} navigate={navigate} /> : <span style={{ color: "var(--ah-text-faint)" }}>{"\u2014"}</span>}
                  </td>
                  <td className="ah-fields-td--delta">
                    {f.status === "added" && <span className="ah-delta-neg ah-medium">new</span>}
                    {f.status === "deleted" && (
                      <span className="ah-delta-pos">
                        <span className="ah-medium">del</span>
                        {f.baselineValue && <>{" was "}<PrimOrRefCell v={f.baselineValue} navigate={navigate} /></>}
                      </span>
                    )}
                    {f.status === "matched" && f.baselineValue && (
                      <span className="ah-status-changed">was <PrimOrRefCell v={f.baselineValue} navigate={navigate} /></span>
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
      <div className="ah-table-wrap">
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th className="ah-fields-th">Type</th>
              <th className="ah-fields-th">Name</th>
              <th className="ah-fields-th">Value</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="ah-fields-tr">
                <td className="ah-fields-td--type">{f.typeName}</td>
                <td className="ah-fields-td--name">{f.name}</td>
                <td className="ah-fields-td"><PrimOrRefCell v={f.value} navigate={navigate} /></td>
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
            <div className="ah-mb-2">
              <button className="ah-download-link" onclick={onDownloadBytes}>Download bytes</button>
            </div>
          )}
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th className="ah-fields-th" style={{ textAlign: "right", width: "4rem" }}>Index</th>
                <th className="ah-fields-th">Value ({elemTypeName})</th>
                {hasDiff && <th className="ah-fields-th">{"\u0394"}</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(e => (
                <tr key={e.idx} className="ah-fields-tr">
                  <td className="ah-fields-td--index">{e.idx}</td>
                  <td className="ah-fields-td"><PrimOrRefCell v={e.value} navigate={navigate} /></td>
                  {hasDiff && (
                    <td className="ah-fields-td--delta">
                      {e.baselineValue && <span className="ah-status-changed">was <PrimOrRefCell v={e.baselineValue} navigate={navigate} /></span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {elems.length > showCount && (
            <div className="ah-table__more">
              Showing {showCount.toLocaleString()} of {elems.length.toLocaleString()}
              {" \u2014 "}
              <button className="ah-more-link" onclick={() => { showCount = Math.min(showCount + 5_000, elems.length); }}>show more</button>
              {" "}
              <button className="ah-more-link" onclick={() => { showCount = elems.length; }}>show all</button>
            </div>
          )}
          {vnode.attrs.total > elems.length && (
            <div className="ah-table__more ah-mt-2">
              Showing first {elems.length.toLocaleString()} of {vnode.attrs.total.toLocaleString()} elements
            </div>
          )}
        </div>
      );
    },
  };
}

export default ObjectView;
