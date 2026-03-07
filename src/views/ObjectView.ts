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

      if (detail === "loading") return m("div", { className: "ah-loading" }, "Loading\u2026");
      if (!detail) return m("div", { className: "ah-error-text" }, "No object with id ", fmtHex(params.id));

      const { row } = detail;

      return m("div", { className: "ah-view-stack" },
        m("div", null,
          m("h2", { className: "ah-view-heading", style: { marginBottom: "0.25rem" } }, "Object ", fmtHex(row.id)),
          m("div", null, m(InstanceLink, { row, navigate }))
        ),

        detail.bitmap && (
          m(Section, { title: "Bitmap Image" },
            m(BitmapImage, { width: detail.bitmap.width, height: detail.bitmap.height, format: detail.bitmap.format, data: detail.bitmap.data }),
            m("div", { className: "ah-mt-1", style: { fontSize: "0.75rem", lineHeight: "1rem", color: "var(--ah-text-muted)" } }, detail.bitmap.width, " x ", detail.bitmap.height, " px (", detail.bitmap.format.toUpperCase(), ")")
          )
        ),

        detail.siteId > 0 && (
          m(Section, { title: "Allocation Site" },
            m("div", { className: "ah-view-stack", style: { gap: "0.125rem" } },
              m(SiteChainView, { siteId: detail.siteId, proxy, navigate })
            )
          )
        ),

        detail.pathFromRoot && (
          m(Section, { title: detail.isUnreachablePath ? "Sample Path" : "Sample Path from GC Root" },
            m("div", { className: "ah-view-stack", style: { gap: "0.125rem" } },
              detail.pathFromRoot.map((pe, i) =>
                m("div", { key: i, className: `ah-path-entry${pe.isDominator ? " ah-semibold" : ""}`, style: { paddingLeft: Math.min(i, 20) * 12 } },
                  m("span", { className: "ah-path-arrow" }, i === 0 ? "" : "\u2192"),
                  m(InstanceLink, { row: pe.row, navigate }),
                  pe.field && m("span", { className: "ah-path-field" }, pe.field)
                )
              )
            )
          )
        ),

        m(Section, { title: "Object Info" },
          m("div", { className: "ah-info-grid" },
            m("span", { className: "ah-info-grid__label" }, "Class:"),
            m("span", null, detail.classObjRow ? m(InstanceLink, { row: detail.classObjRow, navigate }) : "???"),
            m("span", { className: "ah-info-grid__label" }, "Heap:"),
            m("span", null, row.heap),
            row.isRoot && (
              m(Fragment, null, m("span", { className: "ah-info-grid__label" }, "Root Types:"), m("span", null, row.rootTypeNames?.join(", ")))
            )
          )
        ),

        m(Section, { title: "Object Size" },
          m("div", { className: "ah-info-grid" },
            m("span", { className: "ah-info-grid__label" }, "Shallow Size:"),
            m("span", { className: "ah-mono" },
              fmtSize(row.shallowJava + row.shallowNative),
              row.shallowNative > 0 && m("span", { style: { color: "var(--ah-text-faint)" } }, " (java: ", fmtSize(row.shallowJava), ", native: ", fmtSize(row.shallowNative), ")"),
              row.baselineShallowJava !== undefined && (() => {
                const d = (row.shallowJava + row.shallowNative) - ((row.baselineShallowJava ?? 0) + (row.baselineShallowNative ?? 0));
                return d !== 0 ? m("span", { className: `ah-ml-2 ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}` }, fmtSizeDelta(d)) : null;
              })()
            ),
            m("span", { className: "ah-info-grid__label" }, "Retained Size:"),
            m("span", { className: "ah-mono ah-semibold" },
              fmtSize(row.retainedTotal),
              row.baselineRetainedTotal !== undefined && (() => {
                const d = row.retainedTotal - row.baselineRetainedTotal;
                return d !== 0 ? m("span", { className: `ah-ml-2 ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}`, style: { fontWeight: "normal" } }, fmtSizeDelta(d)) : null;
              })()
            )
          )
        ),

        detail.isClassObj && (
          m(Fragment, null,
            m(Section, { title: "Class Info" },
              m("div", { className: "ah-info-grid ah-mb-3" },
                m("span", { className: "ah-info-grid__label" }, "Super Class:"),
                m("span", null, detail.superClassObjId != null
                  ? m(InstanceLink, { row: { id: detail.superClassObjId, display: fmtHex(detail.superClassObjId) }, navigate })
                  : "none"),
                m("span", { className: "ah-info-grid__label" }, "Instance Size:"),
                m("span", { className: "ah-mono" }, detail.instanceSize)
              )
            ),
            m(Section, { title: "Static Fields" },
              m(FieldsTable, { fields: detail.staticFields, diffedFields: detail.diffedStaticFields, navigate })
            )
          )
        ),

        detail.isClassInstance && (detail.instanceFields.length > 0 || (detail.diffedInstanceFields && detail.diffedInstanceFields.length > 0)) && (
          m(Section, { title: "Fields" },
            m(FieldsTable, { fields: detail.instanceFields, diffedFields: detail.diffedInstanceFields, navigate })
          )
        ),

        detail.isArrayInstance && (
          m(Section, { title: `Array Elements (${detail.arrayLength})` },
            m(ArrayView, {
              elems: detail.arrayElems,
              elemTypeName: detail.elemTypeName ?? "Object",
              total: detail.arrayLength,
              navigate,
              onDownloadBytes: detail.elemTypeName === "byte" ? () => {
                proxy.query<ArrayBuffer | null>("getByteArray", { id: params.id })
                  .then(buf => { if (buf) downloadBlob(`array-${fmtHex(params.id)}.bin`, buf); })
                  .catch(console.error);
              } : undefined,
            })
          )
        ),

        detail.reverseRefs.length > 0 && (
          m(Section, { title: `Objects with References to this Object (${detail.reverseRefs.length})`, defaultOpen: detail.reverseRefs.length < 50 },
            m(SortableTable, {
              columns: [
                { label: "Object", render: (r: InstanceRow) => m(InstanceLink, { row: r, navigate }) },
              ],
              data: detail.reverseRefs,
              rowKey: (r: InstanceRow) => r.id,
            })
          )
        ),

        detail.dominated.length > 0 && (
          m(Section, { title: `Immediately Dominated Objects (${detail.dominated.length})`, defaultOpen: detail.dominated.length < 50 },
            m(SortableTable, {
              columns: [
                { label: "Retained", align: "right", sortKey: (r: InstanceRow) => r.retainedTotal, render: (r: InstanceRow) => m("span", { className: "ah-mono" }, fmtSize(r.retainedTotal)) },
                ...heaps.filter(h => h.java + h.native_ > 0).map(h => ({
                  label: h.name, align: "right",
                  sortKey: (r: InstanceRow) => {
                    const s = r.retainedByHeap.find(x => x.heap === h.name);
                    return (s?.java ?? 0) + (s?.native_ ?? 0);
                  },
                  render: (r: InstanceRow) => {
                    const s = r.retainedByHeap.find(x => x.heap === h.name);
                    return m("span", { className: "ah-mono" }, fmtSize((s?.java ?? 0) + (s?.native_ ?? 0)));
                  },
                })),
                { label: "Object", render: (r: InstanceRow) => m(InstanceLink, { row: r, navigate }) },
              ],
              data: detail.dominated,
              rowKey: (r: InstanceRow) => r.id,
            })
          )
        )
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
      if (!chain) return m("span", { style: { color: "var(--ah-text-faint)" } }, "\u2026");
      return m(Fragment, null, chain.map((s, i) =>
        m("div", { key: i, style: { paddingLeft: Math.min(i, 20) * 16 } },
          i > 0 && "\u2192 ",
          m(SiteLinkRaw, { ...s, navigate })
        )
      ));
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
      return m("div", { className: "ah-table-wrap" },
        m("table", { style: { width: "100%" } },
          m("thead", null,
            m("tr", null,
              m("th", { className: "ah-fields-th" }, "Type"),
              m("th", { className: "ah-fields-th" }, "Name"),
              m("th", { className: "ah-fields-th" }, "Value"),
              m("th", { className: "ah-fields-th" }, "\u0394")
            )
          ),
          m("tbody", null,
            diffedFields.map((f, i) =>
              m("tr", { key: i, className: `ah-fields-tr${f.status === "deleted" ? " ah-opacity-60" : ""}` },
                m("td", { className: "ah-fields-td--type" }, f.typeName),
                m("td", { className: "ah-fields-td--name" }, f.name),
                m("td", { className: "ah-fields-td" },
                  f.value ? m(PrimOrRefCell, { v: f.value, navigate }) : m("span", { style: { color: "var(--ah-text-faint)" } }, "\u2014")
                ),
                m("td", { className: "ah-fields-td--delta" },
                  f.status === "added" && m("span", { className: "ah-delta-neg ah-medium" }, "new"),
                  f.status === "deleted" && (
                    m("span", { className: "ah-delta-pos" },
                      m("span", { className: "ah-medium" }, "del"),
                      f.baselineValue && m(Fragment, null, " was ", m(PrimOrRefCell, { v: f.baselineValue, navigate })))
                  ),
                  f.status === "matched" && f.baselineValue && (
                    m("span", { className: "ah-status-changed" }, "was ", m(PrimOrRefCell, { v: f.baselineValue, navigate }))
                  )
                )
              )
            )
          )
        )
      );
    }
    return m("div", { className: "ah-table-wrap" },
      m("table", { style: { width: "100%" } },
        m("thead", null,
          m("tr", null,
            m("th", { className: "ah-fields-th" }, "Type"),
            m("th", { className: "ah-fields-th" }, "Name"),
            m("th", { className: "ah-fields-th" }, "Value")
          )
        ),
        m("tbody", null,
          fields.map((f, i) =>
            m("tr", { key: i, className: "ah-fields-tr" },
              m("td", { className: "ah-fields-td--type" }, f.typeName),
              m("td", { className: "ah-fields-td--name" }, f.name),
              m("td", { className: "ah-fields-td" }, m(PrimOrRefCell, { v: f.value, navigate }))
            )
          )
        )
      )
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
      return m("div", null,
        onDownloadBytes && (
          m("div", { className: "ah-mb-2" },
            m("button", { className: "ah-download-link", onclick: onDownloadBytes }, "Download bytes"))
        ),
        m("table", { style: { width: "100%" } },
          m("thead", null,
            m("tr", null,
              m("th", { className: "ah-fields-th", style: { textAlign: "right", width: "4rem" } }, "Index"),
              m("th", { className: "ah-fields-th" }, "Value (", elemTypeName, ")"),
              hasDiff && m("th", { className: "ah-fields-th" }, "\u0394")
            )
          ),
          m("tbody", null,
            visible.map(e =>
              m("tr", { key: e.idx, className: "ah-fields-tr" },
                m("td", { className: "ah-fields-td--index" }, e.idx),
                m("td", { className: "ah-fields-td" }, m(PrimOrRefCell, { v: e.value, navigate })),
                hasDiff && (
                  m("td", { className: "ah-fields-td--delta" },
                    e.baselineValue && m("span", { className: "ah-status-changed" }, "was ", m(PrimOrRefCell, { v: e.baselineValue, navigate })))
                )
              )
            )
          )
        ),
        elems.length > showCount && (
          m("div", { className: "ah-table__more" },
            "Showing ", showCount.toLocaleString(), " of ", elems.length.toLocaleString(),
            " \u2014 ",
            m("button", { className: "ah-more-link", onclick: () => { showCount = Math.min(showCount + 5_000, elems.length); } }, "show more"),
            " ",
            m("button", { className: "ah-more-link", onclick: () => { showCount = elems.length; } }, "show all"))
        ),
        vnode.attrs.total > elems.length && (
          m("div", { className: "ah-table__more ah-mt-2" },
            "Showing first ", elems.length.toLocaleString(), " of ", vnode.attrs.total.toLocaleString(), " elements")
        )
      );
    },
  };
}

export default ObjectView;
