import m from "mithril";
import type { SiteData, SiteChildRow, SiteObjectsRow, HeapInfo } from "../hprof.worker";
import type { WorkerProxy } from "../worker-proxy";
import { fmtSize, fmtSizeDelta } from "../format";
import { type NavFn, SiteLinkRaw, Section, SortableTable, InstanceLink } from "../components";

export interface SiteParams { id: number }

interface SiteViewAttrs { proxy: WorkerProxy; heaps: HeapInfo[]; navigate: NavFn; params: SiteParams; isDiffed: boolean }

function SiteView(): m.Component<SiteViewAttrs> {
  let data: SiteData | null = null;
  let prevId: number | undefined;
  let cancelRef = { value: false };

  function fetchData(attrs: SiteViewAttrs) {
    cancelRef.value = true;
    const localCancelled = { value: false };
    cancelRef = localCancelled;
    data = null;
    prevId = attrs.params.id;
    const capturedCancel = localCancelled;
    attrs.proxy.query<SiteData>("getSite", { id: attrs.params.id ?? 0 })
      .then(d => { if (!capturedCancel.value) { data = d; m.redraw(); } })
      .catch(console.error);
    // Store cancel ref for cleanup
    (fetchData as any)._cancel = () => { capturedCancel.value = true; };
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
      if ((fetchData as any)._cancel) (fetchData as any)._cancel();
    },
    view(vnode) {
      const { heaps, navigate, isDiffed } = vnode.attrs;

      if (!data) return m("div", { className: "ah-loading" }, "Loading\u2026");
      const heapCols = heaps.filter(h => h.java + h.native_ > 0);
      const childDiffed = isDiffed && data.children.some(c => c.baselineTotalJava !== undefined);
      const objDiffed = isDiffed && data.objectsInfos.some(o => o.baselineNumInstances !== undefined);

      // Build child site columns
      type ChildCol = { label: string; align?: string; minWidth?: string; sortKey?: (r: SiteChildRow) => number; render: (r: SiteChildRow, idx: number) => m.Children };
      const childCols: ChildCol[] = [
        { label: "Total Size", align: "right", minWidth: "5rem", sortKey: r => r.totalJava + r.totalNative, render: r => m("span", { className: "ah-mono" }, fmtSize(r.totalJava + r.totalNative)) },
      ];
      if (childDiffed) {
        childCols.push({
          label: "\u0394", align: "right", minWidth: "5rem",
          sortKey: r => (r.totalJava + r.totalNative) - ((r.baselineTotalJava ?? r.totalJava) + (r.baselineTotalNative ?? r.totalNative)),
          render: r => {
            const d = (r.totalJava + r.totalNative) - ((r.baselineTotalJava ?? r.totalJava) + (r.baselineTotalNative ?? r.totalNative));
            if (d === 0) return null;
            return m("span", { className: `ah-mono ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}` }, fmtSizeDelta(d));
          },
        });
      }
      for (const h of heapCols) {
        childCols.push({
          label: h.name, align: "right",
          sortKey: (r: SiteChildRow) => { const s = r.byHeap.find(x => x.heap === h.name); return (s?.java ?? 0) + (s?.native_ ?? 0); },
          render: (r: SiteChildRow) => { const s = r.byHeap.find(x => x.heap === h.name); return m("span", { className: "ah-mono" }, fmtSize((s?.java ?? 0) + (s?.native_ ?? 0))); },
        });
      }
      childCols.push({ label: "Child Site", render: r => m(SiteLinkRaw, { ...r, navigate }) });

      // Build objects allocated columns
      type ObjCol = { label: string; align?: string; minWidth?: string; sortKey?: (r: SiteObjectsRow) => number; render: (r: SiteObjectsRow, idx: number) => m.Children };
      const objCols: ObjCol[] = [
        { label: "Size", align: "right", minWidth: "5rem", sortKey: r => r.java + r.native_, render: r => m("span", { className: "ah-mono" }, fmtSize(r.java + r.native_)) },
      ];
      if (objDiffed) {
        objCols.push({
          label: "\u0394 Size", align: "right", minWidth: "5rem",
          sortKey: r => (r.java + r.native_) - ((r.baselineJava ?? r.java) + (r.baselineNative ?? r.native_)),
          render: r => {
            const d = (r.java + r.native_) - ((r.baselineJava ?? r.java) + (r.baselineNative ?? r.native_));
            if (d === 0) return null;
            return m("span", { className: `ah-mono ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}` }, fmtSizeDelta(d));
          },
        });
      }
      objCols.push({
        label: "Instances", align: "right", minWidth: "4rem",
        sortKey: r => r.numInstances,
        render: r => m("button", {
          className: "ah-link ah-mono",
          onclick: () => navigate("objects", { siteId: data!.id, className: r.className, heap: r.heap }),
        }, r.numInstances.toLocaleString()),
      });
      if (objDiffed) {
        objCols.push({
          label: "\u0394 #", align: "right", minWidth: "4rem",
          sortKey: r => r.numInstances - (r.baselineNumInstances ?? r.numInstances),
          render: r => {
            const d = r.numInstances - (r.baselineNumInstances ?? r.numInstances);
            if (d === 0) return null;
            return m("span", { className: `ah-mono ah-nowrap ${d > 0 ? "ah-delta-pos" : "ah-delta-neg"}` }, d > 0 ? "+" : "\u2212", Math.abs(d).toLocaleString());
          },
        });
      }
      objCols.push({ label: "Heap", render: r => m("span", null, r.heap) });
      objCols.push({
        label: "Class", render: r => r.classObjId != null
          ? m(InstanceLink, { row: { id: r.classObjId, display: r.className }, navigate })
          : m("span", null, r.className),
      });

      return m("div", { className: "ah-view-stack" },
        m("div", null,
          m("h2", { className: "ah-view-heading", style: { marginBottom: "0.25rem" } }, "Site"),
          m(SiteLinkRaw, { ...data, navigate })
        ),

        m(Section, { title: "Allocation Site" },
          m("div", { className: "ah-view-stack", style: { gap: "0.125rem" } },
            data.chain.map((s, i) =>
              m("div", { key: i, style: { paddingLeft: Math.min(i, 20) * 16 } }, i > 0 && "\u2192 ", m(SiteLinkRaw, { ...s, navigate }))
            )
          )
        ),

        data.children.length > 0 && (
          m(Section, { title: "Sites Called from Here" },
            m(SortableTable, { columns: childCols, data: data.children })
          )
        ),

        m(Section, { title: "Objects Allocated" },
          m(SortableTable, { columns: objCols, data: data.objectsInfos })
        )
      );
    },
  };
}

export default SiteView;
