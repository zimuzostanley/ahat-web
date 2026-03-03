// ─── hprof.worker.ts ─────────────────────────────────────────────────────────
//
// The snapshot LIVES IN THE WORKER.  The main thread never holds AhatInstance
// objects — it only receives small, display-ready plain-JS records.
//
// Protocol
// ────────
//   Main → Worker   { type: "parse", buffer: ArrayBuffer }   (transferred)
//   Worker → Main   { type: "progress", msg, pct }
//   Worker → Main   { type: "ready", overview: OverviewData }
//   Worker → Main   { type: "error", message }
//
//   Main → Worker   { type: "query", id: number, name: QueryName, params: any }
//   Worker → Main   { type: "result", id: number, data: any }
//   Worker → Main   { type: "queryError", id: number, message: string }

import {
  parseHprof,
  AhatSnapshot, AhatInstance, AhatClassInstance, AhatArrayInstance, AhatClassObj,
  SuperRoot, SiteNode,
  TypeName, ReachabilityName,
} from "./hprof";

type FieldVal = number | boolean | string | AhatInstance | null;

type WorkerMessage =
  | { type: "parse"; buffer: ArrayBuffer }
  | { type: "query"; id: number; name: string; params: Record<string, unknown> };

// ─── Shared display types (must match worker-protocol.ts on main side) ────────

export interface HeapInfo { name: string; java: number; native_: number }

export interface OverviewData {
  instanceCount: number;
  heaps: HeapInfo[];
}

export type PrimOrRef =
  | { kind: "prim"; v: string }
  | { kind: "ref"; id: number; display: string; str: string | null };

export interface InstanceRow {
  id: number;
  display: string;          // inst.toString()
  className: string;
  isRoot: boolean;
  rootTypeNames: string[] | null;
  reachabilityName: string;
  heap: string;
  shallowJava: number;
  shallowNative: number;
  retainedTotal: number;
  retainedByHeap: { heap: string; java: number; native_: number }[];
  str: string | null;
  referent: InstanceRow | null;
}

export interface InstanceDetail {
  row: InstanceRow;
  isClassObj: boolean;
  isArrayInstance: boolean;
  isClassInstance: boolean;
  // ClassObj
  classObjRow: InstanceRow | null;
  // ClassObj specific
  forClassName: string | null;
  superClassObjId: number | null;
  instanceSize: number;
  staticFields: { name: string; typeName: string; value: PrimOrRef }[];
  // ClassInstance
  instanceFields: { name: string; typeName: string; value: PrimOrRef }[];
  // Array
  elemTypeName: string | null;
  arrayLength: number;
  arrayElems: { idx: number; value: PrimOrRef }[];   // first 200
  // Bitmap
  bitmap: { width: number; height: number; format: string; data: Uint8Array } | null;
  // Relations
  reverseRefs: InstanceRow[];
  dominated: InstanceRow[];
  pathFromRoot: { row: InstanceRow; field: string; isDominator: boolean }[] | null;
  siteId: number;
}

export interface SiteChildRow {
  id: number;
  method: string; signature: string; filename: string; line: number;
  totalJava: number; totalNative: number;
  byHeap: { heap: string; java: number; native_: number }[];
}

export interface SiteObjectsRow {
  heap: string;
  className: string;
  classObjId: number | null;
  numInstances: number;
  java: number;
  native_: number;
}

export interface SiteData {
  id: number;
  method: string; signature: string; filename: string; line: number;
  chain: { id: number; method: string; signature: string; filename: string; line: number }[];
  children: SiteChildRow[];
  objectsInfos: SiteObjectsRow[];
}

export interface BitmapListRow {
  row: InstanceRow;
  width: number;
  height: number;
  pixelCount: number;
  bufferHash: string;
  hasPixelData: boolean;
  density: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let snap: AhatSnapshot | null = null;

function rowOf(inst: AhatInstance, snap: AhatSnapshot): InstanceRow {
  const str = inst.asString?.(200) ?? null;
  const referentInst = inst.getReferent?.() ?? null;
  return {
    id: inst.id,
    display: inst.toString(),
    className: inst instanceof AhatClassObj ? inst.className : inst.getClassName(),
    isRoot: inst.isRoot(),
    rootTypeNames: inst.getRootTypeNames(),
    reachabilityName: ReachabilityName[inst.reachability] ?? "?",
    heap: inst.heap?.name ?? "?",
    shallowJava: inst.getSize().java,
    shallowNative: inst.getSize().native_,
    retainedTotal: inst.getTotalRetainedSize().total,
    retainedByHeap: snap.heaps.map(h => ({
      heap: h.name,
      java: inst.getRetainedSize(h).java,
      native_: inst.getRetainedSize(h).native_,
    })),
    str,
    referent: referentInst ? rowOf(referentInst, snap) : null,
  };
}

function primOrRef(v: FieldVal, _snap: AhatSnapshot): PrimOrRef {
  if (v instanceof AhatInstance) {
    return { kind: "ref", id: v.id, display: v.toString(), str: v.asString?.(80) ?? null };
  }
  if (v == null) return { kind: "prim", v: "null" };
  return { kind: "prim", v: String(v) };
}

function siteChain(site: SiteNode): { id: number; method: string; signature: string; filename: string; line: number }[] {
  const chain: SiteNode[] = [];
  let s: SiteNode | null = site;
  while (s) { chain.push(s); s = s.parent; }
  chain.reverse();
  return chain.map(s => ({ id: s.id, method: s.method, signature: s.signature, filename: s.filename, line: s.line }));
}

// ─── Query handlers ───────────────────────────────────────────────────────────

function handleGetOverview(): OverviewData {
  if (!snap) throw new Error("no snapshot");
  return {
    instanceCount: snap.instances.size,
    heaps: snap.heaps.map(h => ({ name: h.name, java: h.size.java, native_: h.size.native_ })),
  };
}

function defaultInstanceCompare(snapshot: AhatSnapshot) {
  const appHeap = snapshot.getHeap("app");
  return (a: AhatInstance, b: AhatInstance): number => {
    if (appHeap) {
      const cmp = b.getRetainedSize(appHeap).total - a.getRetainedSize(appHeap).total;
      if (cmp !== 0) return cmp;
    }
    return b.getTotalRetainedSize().total - a.getTotalRetainedSize().total;
  };
}

function defaultSiteCompare(snapshot: AhatSnapshot) {
  const appHeap = snapshot.getHeap("app");
  return (a: SiteNode, b: SiteNode): number => {
    if (appHeap) {
      const cmp = b.getSizeForHeap(appHeap).total - a.getSizeForHeap(appHeap).total;
      if (cmp !== 0) return cmp;
    }
    return b.getTotalSize().total - a.getTotalSize().total;
  };
}

function handleGetRooted(): InstanceRow[] {
  if (!snap) throw new Error("no snapshot");
  const items = [...snap.superRoot.dominated];
  items.sort(defaultInstanceCompare(snap));
  return items.slice(0, 5000).map(i => rowOf(i, snap!));
}

function handleGetInstance(id: number, arrayLimit = 200): InstanceDetail | null {
  if (!snap) throw new Error("no snapshot");
  const inst = snap.findInstance(id);
  if (!inst) return null;

  const row = rowOf(inst, snap);
  const classObjRow = inst.classObj ? rowOf(inst.classObj, snap) : null;

  let staticFields: InstanceDetail["staticFields"] = [];
  let instanceFields: InstanceDetail["instanceFields"] = [];
  let elemTypeName: string | null = null;
  let arrayLength = 0;
  let arrayElems: InstanceDetail["arrayElems"] = [];
  let forClassName: string | null = null;
  let superClassObjId: number | null = null;
  let instanceSize = 0;

  if (inst instanceof AhatClassObj) {
    forClassName = inst.className;
    superClassObjId = inst.superClassObj?.id ?? null;
    instanceSize = inst.instanceSize;
    staticFields = inst.staticFieldValues.map(f => ({
      name: f.name,
      typeName: TypeName[f.type] ?? "Object",
      value: primOrRef(f.value, snap!),
    }));
  } else if (inst instanceof AhatClassInstance) {
    for (const fv of inst.getInstanceFields()) {
      instanceFields.push({
        name: fv.name,
        typeName: TypeName[fv.type] ?? "Object",
        value: primOrRef(fv.value, snap!),
      });
    }
  } else if (inst instanceof AhatArrayInstance) {
    elemTypeName = TypeName[inst.elemType] ?? "Object";
    arrayLength = inst.length;
    const limit = arrayLimit <= 0 ? inst.values.length : Math.min(arrayLimit, inst.values.length);
    for (let i = 0; i < limit; i++) {
      arrayElems.push({ idx: i, value: primOrRef(inst.values[i], snap!) });
    }
  }

  const dominated = [...inst.dominated];
  dominated.sort(defaultInstanceCompare(snap!));

  const pathRaw = inst.getPathFromGcRoot();
  const pathFromRoot = pathRaw
    ? pathRaw.map(pe => ({
        row: pe.instance && !(pe.instance instanceof SuperRoot) ? rowOf(pe.instance, snap!) : {
          id: 0, display: "ROOT", className: "ROOT", isRoot: true,
          rootTypeNames: null, reachabilityName: "strong", heap: "",
          shallowJava: 0, shallowNative: 0, retainedTotal: 0, retainedByHeap: [], str: null, referent: null,
        } as InstanceRow,
        field: pe.field,
        isDominator: pe.isDominator,
      }))
    : null;

  // Bitmap: check the instance itself and its associated bitmap
  let bitmap: InstanceDetail["bitmap"] = null;
  const ci = inst.asClassInstance?.();
  if (ci) {
    const bmp = ci.asBitmap(snap!.bitmapDumpData);
    if (bmp) {
      bitmap = { width: bmp.width, height: bmp.height, format: bmp.format, data: bmp.data };
    }
  }

  return {
    row,
    isClassObj: inst.isClassObj(),
    isArrayInstance: inst.isArrayInstance(),
    isClassInstance: inst.isClassInstance(),
    classObjRow,
    forClassName,
    superClassObjId,
    instanceSize,
    staticFields,
    instanceFields,
    elemTypeName,
    arrayLength,
    arrayElems,
    bitmap,
    reverseRefs: inst.reverseRefs.slice(0, 500).map(r => rowOf(r, snap!)),
    dominated: dominated.slice(0, 500).map(r => rowOf(r, snap!)),
    pathFromRoot,
    siteId: inst.site?.id ?? 0,
  };
}

function handleGetSite(id: number): SiteData {
  if (!snap) throw new Error("no snapshot");
  const site = snap.getSite(id);

  const children = [...site.children];
  children.sort(defaultSiteCompare(snap!));

  // Java ahat sorts objectsInfos by: heap name, then size (desc), then class name
  const infos = [...site.objectsInfos];
  infos.sort((a, b) => {
    const hcmp = a.heap.name.localeCompare(b.heap.name);
    if (hcmp !== 0) return hcmp;
    const scmp = b.numBytes.total - a.numBytes.total;
    if (scmp !== 0) return scmp;
    return a.getClassName().localeCompare(b.getClassName());
  });

  return {
    id: site.id,
    method: site.method, signature: site.signature,
    filename: site.filename, line: site.line,
    chain: siteChain(site),
    children: children.map(c => ({
      id: c.id,
      method: c.method, signature: c.signature, filename: c.filename, line: c.line,
      totalJava: c.getTotalSize().java,
      totalNative: c.getTotalSize().native_,
      byHeap: snap!.heaps.map(h => ({ heap: h.name, java: c.getSizeForHeap(h).java, native_: c.getSizeForHeap(h).native_ })),
    })),
    objectsInfos: infos.map(info => ({
      heap: info.heap.name,
      className: info.getClassName(),
      classObjId: info.classObj?.id ?? null,
      numInstances: info.numInstances,
      java: info.numBytes.java,
      native_: info.numBytes.native_,
    })),
  };
}

function handleSearch(query: string): InstanceRow[] {
  if (!snap) throw new Error("no snapshot");
  if (query.length < 2) return [];
  const q = query.toLowerCase();
  if (q.startsWith("0x")) {
    const id = parseInt(q.slice(2), 16);
    const inst = snap.findInstance(id);
    return inst ? [rowOf(inst, snap)] : [];
  }
  const matches: AhatInstance[] = [];
  for (const [, inst] of snap.instances) {
    if (matches.length >= 500) break;
    const cn = inst.getClassName?.() ?? inst.toString();
    if (cn.toLowerCase().includes(q)) matches.push(inst);
  }
  matches.sort((a, b) => b.getTotalRetainedSize().total - a.getTotalRetainedSize().total);
  return matches.map(i => rowOf(i, snap!));
}

function handleGetObjects(params: { siteId: number; className: string; heap: string | null }): InstanceRow[] {
  if (!snap) throw new Error("no snapshot");
  const site = snap.getSite(params.siteId);
  const insts: AhatInstance[] = [];
  site.getObjects(
    x => (!params.heap || x.heap?.name === params.heap) && x.getClassName() === params.className,
    x => insts.push(x),
  );
  insts.sort(defaultInstanceCompare(snap!));
  return insts.slice(0, 2000).map(i => rowOf(i, snap!));
}

function handleGetBitmapList(): BitmapListRow[] {
  if (!snap) throw new Error("no snapshot");

  const dd = snap.bitmapDumpData;
  const results: { inst: AhatClassInstance; w: number; h: number; bufHash: string; hasPixelData: boolean; density: number }[] = [];

  for (const [, inst] of snap.instances) {
    const ci = inst.asClassInstance?.();
    if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;

    const w = ci.getField("mWidth");
    if (typeof w !== "number" || w <= 0) continue;
    const h = ci.getField("mHeight");
    if (typeof h !== "number" || h <= 0) continue;
    const density = ci.getField("mDensity");

    const bmp = ci.asBitmap(dd);
    const hasPixelData = bmp !== null;

    let bufHash = "no-data";
    if (bmp) {
      // Hash first 32 bytes of pixel data for duplicate detection
      const sample = bmp.data.slice(0, 32);
      bufHash = Array.from(sample).map(b => (b & 0xFF).toString(16).padStart(2, "0")).join("");
    }

    results.push({ inst: ci, w, h, bufHash, hasPixelData, density: typeof density === "number" ? density : 0 });
  }

  results.sort((a, b) => b.inst.getTotalRetainedSize().total - a.inst.getTotalRetainedSize().total);

  return results.slice(0, 500).map(r => ({
    row: rowOf(r.inst, snap!),
    width: r.w,
    height: r.h,
    pixelCount: r.w * r.h,
    bufferHash: `${r.w}x${r.h}:${r.bufHash}`,
    hasPixelData: r.hasPixelData,
    density: r.density,
  }));
}

// ─── Message loop ─────────────────────────────────────────────────────────────

addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as WorkerMessage;

  if (msg.type === "parse") {
    try {
      snap = parseHprof(msg.buffer, (m: string, pct: number) => {
        console.log(`[hprof] ${m} (${pct.toFixed(1)}%)`);
        postMessage({ type: "progress", msg: m, pct });
      });
      postMessage({ type: "ready", overview: handleGetOverview() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[hprof worker] parse error:", err);
      postMessage({ type: "error", message });
    }
    return;
  }

  if (msg.type === "query") {
    const { id, name, params } = msg;
    try {
      let data: OverviewData | InstanceRow[] | InstanceDetail | null | SiteData | BitmapListRow[];
      switch (name) {
        case "getOverview":   data = handleGetOverview(); break;
        case "getRooted":     data = handleGetRooted(); break;
        case "getInstance":   data = handleGetInstance(params.id as number, params.arrayLimit as number | undefined); break;
        case "getSite":       data = handleGetSite(params.id as number); break;
        case "search":        data = handleSearch(params.query as string); break;
        case "getObjects":    data = handleGetObjects(params as unknown as { siteId: number; className: string; heap: string | null }); break;
        case "getBitmapList": data = handleGetBitmapList(); break;
        default: throw new Error("Unknown query: " + name);
      }
      postMessage({ type: "result", id, data });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[hprof worker] query error:", name, err);
      postMessage({ type: "queryError", id, message });
    }
  }
});
