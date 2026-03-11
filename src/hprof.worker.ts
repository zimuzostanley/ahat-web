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
  SuperRoot, SiteNode, Reachability,
  TypeName, ReachabilityName,
  diffSnapshots, resetBaselines,
} from "./hprof";
import { ProguardMap } from "./proguard";

type FieldVal = number | boolean | string | AhatInstance | null;

type WorkerMessage =
  | { type: "parse"; buffer: ArrayBuffer }
  | { type: "query"; id: number; name: string; params: Record<string, unknown> }
  | { type: "diffWithBaseline"; buffer: ArrayBuffer }
  | { type: "clearBaseline" }
  | { type: "loadProguardMap"; text: string };

// ─── Shared display types (must match worker-protocol.ts on main side) ────────

export interface HeapInfo { name: string; java: number; native_: number }

export interface DuplicateBitmapGroup {
  key: string;
  width: number;
  height: number;
  count: number;
  totalBytes: number;
  wastedBytes: number;
}

export interface OverviewData {
  instanceCount: number;
  heaps: HeapInfo[];
  isDiffed?: boolean;
  baselineHeaps?: HeapInfo[];
  baselineInstanceCount?: number;
  duplicateBitmaps?: DuplicateBitmapGroup[];
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
  // Diff fields (only when baseline loaded)
  isPlaceHolder?: boolean;
  baselineRetainedTotal?: number;
  baselineShallowJava?: number;
  baselineShallowNative?: number;
  baselineRetainedByHeap?: { heap: string; java: number; native_: number }[];
}

export type DiffedField = {
  name: string;
  typeName: string;
  value: PrimOrRef | null;          // null when status === "deleted"
  status: "added" | "matched" | "deleted";
  baselineValue?: PrimOrRef;        // present for "matched" (changed) and "deleted"
};

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
  arrayElems: { idx: number; value: PrimOrRef; baselineValue?: PrimOrRef }[];
  // Bitmap
  bitmap: { width: number; height: number; format: string; data: Uint8Array } | null;
  // Relations
  reverseRefs: InstanceRow[];
  dominated: InstanceRow[];
  pathFromRoot: { row: InstanceRow; field: string; isDominator: boolean }[] | null;
  isUnreachablePath?: boolean;  // true when path is a sample path (not from GC root)
  siteId: number;
  // Diff fields
  diffedStaticFields?: DiffedField[];
  diffedInstanceFields?: DiffedField[];
}

export interface SiteChildRow {
  id: number;
  method: string; signature: string; filename: string; line: number;
  totalJava: number; totalNative: number;
  byHeap: { heap: string; java: number; native_: number }[];
  // Diff fields
  baselineTotalJava?: number;
  baselineTotalNative?: number;
}

export interface SiteObjectsRow {
  heap: string;
  className: string;
  classObjId: number | null;
  numInstances: number;
  java: number;
  native_: number;
  // Diff fields
  baselineNumInstances?: number;
  baselineJava?: number;
  baselineNative?: number;
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

export interface StringListRow {
  id: number;
  value: string;
  length: number;
  retainedSize: number;
  shallowSize: number;
  heap: string;
  className: string;
  display: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let snap: AhatSnapshot | null = null;
let baselineSnap: AhatSnapshot | null = null;
let originalHeapCount = 0;
let proguardMap = new ProguardMap();
let rawBuffer: ArrayBuffer | null = null;

/** Deobfuscate a class name through the ProGuard map. */
function deobClass(name: string | undefined): string {
  if (!name) return "???";
  return proguardMap.getClassName(name);
}

/** Build deobfuscated className and display string for an instance. */
function deobRow(inst: AhatInstance): [className: string, display: string] {
  if (inst instanceof AhatClassObj) {
    const clear = deobClass(inst.className);
    return [clear, `class ${clear}`];
  }
  if (inst instanceof AhatArrayInstance) {
    const raw = inst.getClassName();
    const clear = deobClass(raw);
    if (raw === clear) return [raw, inst.toString()];
    let base = clear;
    if (base.endsWith("[]")) base = base.slice(0, -2);
    return [clear, `${base}[${inst.length}]@${inst.id.toString(16).padStart(8, "0")}`];
  }
  const raw = inst.getClassName();
  const clear = deobClass(raw);
  if (raw === clear) return [raw, inst.toString()];
  return [clear, `${clear}@${inst.id.toString(16).padStart(8, "0")}`];
}

/** Deobfuscate a field name by walking the class hierarchy. */
function deobFieldName(classObj: AhatClassObj | null, obfName: string): string {
  if (!proguardMap.hasEntries()) return obfName;
  let cls = classObj;
  while (cls) {
    const clearClass = deobClass(cls.className);
    const clearField = proguardMap.getFieldName(clearClass, obfName);
    if (clearField !== obfName) return clearField;
    cls = cls.superClassObj;
  }
  return obfName;
}

/** Deobfuscate a site frame (method, signature, filename, line). */
function deobFrame(site: { method: string; signature: string; filename: string; line: number; className: string }): { method: string; signature: string; filename: string; line: number } {
  if (!proguardMap.hasEntries()) {
    return { method: site.method, signature: site.signature, filename: site.filename, line: site.line };
  }
  const clearClass = deobClass(site.className);
  return proguardMap.getFrame(clearClass, site.method, site.signature, site.filename, site.line);
}

function rowOf(inst: AhatInstance, snap: AhatSnapshot): InstanceRow {
  const str = inst.asString?.(200) ?? null;
  const referentInst = inst.getReferent?.() ?? null;
  const [className, display] = deobRow(inst);
  const row: InstanceRow = {
    id: inst.id,
    display,
    className,
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
  // Add baseline fields when diffed
  if (baselineSnap && inst.baseline !== inst) {
    const bl = inst.baseline;
    row.isPlaceHolder = inst.isPlaceHolder();
    row.baselineRetainedTotal = bl.getTotalRetainedSize().total;
    row.baselineShallowJava = bl.getSize().java;
    row.baselineShallowNative = bl.getSize().native_;
    row.baselineRetainedByHeap = snap.heaps.map(h => ({
      heap: h.name,
      java: bl.getRetainedSize(h.baseline).java,
      native_: bl.getRetainedSize(h.baseline).native_,
    }));
  }
  return row;
}

function primOrRef(v: FieldVal, _snap: AhatSnapshot): PrimOrRef {
  if (v instanceof AhatInstance) {
    const [, display] = deobRow(v);
    return { kind: "ref", id: v.id, display, str: v.asString?.(80) ?? null };
  }
  if (v == null) return { kind: "prim", v: "null" };
  return { kind: "prim", v: String(v) };
}

/** Port of Java ahat DiffFields.diff() — sorted merge by (name, typeName). */
function diffFields(
  current: { name: string; type: number; value: FieldVal }[],
  baseline: { name: string; type: number; value: FieldVal }[],
  snapshot: AhatSnapshot,
): DiffedField[] {
  const cmp = (a: { name: string; type: number }, b: { name: string; type: number }) => {
    const nc = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if (nc !== 0) return nc;
    return a.type - b.type;
  };
  const cs = [...current].sort(cmp);
  const bs = [...baseline].sort(cmp);
  const result: DiffedField[] = [];
  let ci = 0, bi = 0;
  while (ci < cs.length && bi < bs.length) {
    const c = cmp(cs[ci], bs[bi]);
    if (c < 0) {
      result.push({ name: cs[ci].name, typeName: TypeName[cs[ci].type] ?? "Object", value: primOrRef(cs[ci].value, snapshot), status: "added" });
      ci++;
    } else if (c === 0) {
      const cur = cs[ci], base = bs[bi];
      const curP = primOrRef(cur.value, snapshot);
      const baseP = primOrRef(base.value, snapshot);
      const same = curP.kind === baseP.kind && (curP.kind === "prim" ? curP.v === (baseP as typeof curP).v : curP.id === (baseP as typeof curP).id);
      const df: DiffedField = { name: cur.name, typeName: TypeName[cur.type] ?? "Object", value: curP, status: "matched" };
      if (!same) df.baselineValue = baseP;
      result.push(df);
      ci++; bi++;
    } else {
      result.push({ name: bs[bi].name, typeName: TypeName[bs[bi].type] ?? "Object", value: null, status: "deleted", baselineValue: primOrRef(bs[bi].value, snapshot) });
      bi++;
    }
  }
  while (ci < cs.length) {
    result.push({ name: cs[ci].name, typeName: TypeName[cs[ci].type] ?? "Object", value: primOrRef(cs[ci].value, snapshot), status: "added" });
    ci++;
  }
  while (bi < bs.length) {
    result.push({ name: bs[bi].name, typeName: TypeName[bs[bi].type] ?? "Object", value: null, status: "deleted", baselineValue: primOrRef(bs[bi].value, snapshot) });
    bi++;
  }
  return result;
}

function siteChain(site: SiteNode): { id: number; method: string; signature: string; filename: string; line: number }[] {
  const chain: SiteNode[] = [];
  let s: SiteNode | null = site;
  while (s) { chain.push(s); s = s.parent; }
  chain.reverse();
  return chain.map(s => {
    const f = deobFrame(s);
    return { id: s.id, method: f.method, signature: f.signature, filename: f.filename, line: f.line };
  });
}

// ─── Query handlers ───────────────────────────────────────────────────────────

/** Simple FNV-1a hash of a Uint8Array, returned as hex string. */
function hashBuffer(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function findDuplicateBitmaps(snapshot: AhatSnapshot): DuplicateBitmapGroup[] {
  const dd = snapshot.bitmapDumpData;
  // Group bitmaps by (width, height, full pixel hash)
  const groups = new Map<string, { width: number; height: number; count: number; retainedPerInstance: number[] }>();

  for (const [, inst] of snapshot.instances) {
    const ci = inst.asClassInstance?.();
    if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
    const w = ci.getField("mWidth");
    if (typeof w !== "number" || w <= 0) continue;
    const h = ci.getField("mHeight");
    if (typeof h !== "number" || h <= 0) continue;
    const bmp = ci.asBitmap(dd);
    if (!bmp) continue;

    const bufHash = hashBuffer(bmp.data);
    const key = `${w}x${h}:${bufHash}`;
    let g = groups.get(key);
    if (!g) {
      g = { width: w, height: h, count: 0, retainedPerInstance: [] };
      groups.set(key, g);
    }
    g.count++;
    g.retainedPerInstance.push(ci.getTotalRetainedSize().total);
  }

  const result: DuplicateBitmapGroup[] = [];
  for (const [key, g] of groups) {
    if (g.count < 2) continue;
    const totalBytes = g.retainedPerInstance.reduce((a, b) => a + b, 0);
    // Wasted = total minus the one copy you need (smallest retained)
    const minRetained = Math.min(...g.retainedPerInstance);
    result.push({ key, width: g.width, height: g.height, count: g.count, totalBytes, wastedBytes: totalBytes - minRetained });
  }
  result.sort((a, b) => b.wastedBytes - a.wastedBytes);
  return result;
}

function handleGetOverview(): OverviewData {
  if (!snap) throw new Error("no snapshot");
  const result: OverviewData = {
    instanceCount: snap.instances.size,
    heaps: snap.heaps.map(h => ({ name: h.name, java: h.size.java, native_: h.size.native_ })),
  };
  if (baselineSnap) {
    result.isDiffed = true;
    result.baselineHeaps = snap.heaps.map(h => {
      const bl = h.baseline;
      return { name: bl.name, java: bl.size.java, native_: bl.size.native_ };
    });
    result.baselineInstanceCount = baselineSnap.instances.size;
  }
  const dups = findDuplicateBitmaps(snap);
  if (dups.length > 0) result.duplicateBitmaps = dups;
  return result;
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
  return items.map(i => rowOf(i, snap!));
}

function handleGetInstance(id: number): InstanceDetail | null {
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

  let diffedStaticFields: DiffedField[] | undefined;
  let diffedInstanceFields: DiffedField[] | undefined;

  if (inst instanceof AhatClassObj) {
    forClassName = deobClass(inst.className);
    superClassObjId = inst.superClassObj?.id ?? null;
    instanceSize = inst.instanceSize;
    const clearCls = deobClass(inst.className);
    staticFields = inst.staticFieldValues.map(f => ({
      name: proguardMap.getFieldName(clearCls, f.name),
      typeName: TypeName[f.type] ?? "Object",
      value: primOrRef(f.value, snap!),
    }));
    if (baselineSnap && inst.baseline !== inst && !inst.baseline.isPlaceHolder()) {
      const blClassObj = inst.baseline as AhatClassObj;
      diffedStaticFields = diffFields(inst.staticFieldValues, blClassObj.staticFieldValues, snap!);
      for (const df of diffedStaticFields) df.name = proguardMap.getFieldName(clearCls, df.name);
    }
  } else if (inst instanceof AhatClassInstance) {
    for (const fv of inst.getInstanceFields()) {
      instanceFields.push({
        name: deobFieldName(inst.classObj, fv.name),
        typeName: TypeName[fv.type] ?? "Object",
        value: primOrRef(fv.value, snap!),
      });
    }
    if (baselineSnap && inst.baseline !== inst && !inst.baseline.isPlaceHolder()) {
      const blInst = inst.baseline as AhatClassInstance;
      diffedInstanceFields = diffFields(
        [...inst.getInstanceFields()],
        [...blInst.getInstanceFields()],
        snap!,
      );
      for (const df of diffedInstanceFields) df.name = deobFieldName(inst.classObj, df.name);
    }
  } else if (inst instanceof AhatArrayInstance) {
    elemTypeName = TypeName[inst.elemType] ?? "Object";
    arrayLength = inst.length;
    const limit = inst.values.length;
    const blArr = (baselineSnap && inst.baseline !== inst && !inst.baseline.isPlaceHolder())
      ? inst.baseline as AhatArrayInstance : null;
    for (let i = 0; i < limit; i++) {
      const elem: InstanceDetail["arrayElems"][number] = { idx: i, value: primOrRef(inst.values[i], snap!) };
      if (blArr && i < blArr.values.length) {
        const curP = elem.value;
        const baseP = primOrRef(blArr.values[i], snap!);
        const same = curP.kind === baseP.kind && (curP.kind === "prim" ? curP.v === (baseP as typeof curP).v : curP.id === (baseP as typeof curP).id);
        if (!same) elem.baselineValue = baseP;
      }
      arrayElems.push(elem);
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
    reverseRefs: inst.reverseRefs.map(r => rowOf(r, snap!)),
    dominated: dominated.map(r => rowOf(r, snap!)),
    pathFromRoot,
    isUnreachablePath: pathFromRoot ? inst.reachability === Reachability.UNREACHABLE : undefined,
    siteId: inst.site?.id ?? 0,
    diffedStaticFields,
    diffedInstanceFields,
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

  const siteDeob = deobFrame(site);
  return {
    id: site.id,
    method: siteDeob.method, signature: siteDeob.signature,
    filename: siteDeob.filename, line: siteDeob.line,
    chain: siteChain(site),
    children: children.map(c => {
      const cDeob = deobFrame(c);
      const row: SiteChildRow = {
        id: c.id,
        method: cDeob.method, signature: cDeob.signature, filename: cDeob.filename, line: cDeob.line,
        totalJava: c.getTotalSize().java,
        totalNative: c.getTotalSize().native_,
        byHeap: snap!.heaps.map(h => ({ heap: h.name, java: c.getSizeForHeap(h).java, native_: c.getSizeForHeap(h).native_ })),
      };
      if (baselineSnap && c.baseline !== c) {
        row.baselineTotalJava = c.baseline.getTotalSize().java;
        row.baselineTotalNative = c.baseline.getTotalSize().native_;
      }
      return row;
    }),
    objectsInfos: infos.map(info => {
      const row: SiteObjectsRow = {
        heap: info.heap.name,
        className: deobClass(info.getClassName()),
        classObjId: info.classObj?.id ?? null,
        numInstances: info.numInstances,
        java: info.numBytes.java,
        native_: info.numBytes.native_,
      };
      if (baselineSnap && info.baseline !== info) {
        row.baselineNumInstances = info.baseline.numInstances;
        row.baselineJava = info.baseline.numBytes.java;
        row.baselineNative = info.baseline.numBytes.native_;
      }
      return row;
    }),
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
    const cn = inst.getClassName?.() ?? inst.toString();
    if (cn.toLowerCase().includes(q) || deobClass(cn).toLowerCase().includes(q)) matches.push(inst);
  }
  matches.sort((a, b) => b.getTotalRetainedSize().total - a.getTotalRetainedSize().total);
  return matches.slice(0, 1000).map(i => rowOf(i, snap!));
}

function handleGetObjects(params: { siteId: number; className: string; heap: string | null }): InstanceRow[] {
  if (!snap) throw new Error("no snapshot");
  const site = snap.getSite(params.siteId);
  const insts: AhatInstance[] = [];
  site.getObjects(
    x => (!params.heap || x.heap?.name === params.heap) && deobClass(x.getClassName()) === params.className,
    x => insts.push(x),
  );
  insts.sort(defaultInstanceCompare(snap!));
  return insts.map(i => rowOf(i, snap!));
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
      // FNV-1a hash of full pixel buffer for duplicate detection
      let h = 0x811c9dc5;
      for (let i = 0; i < bmp.data.length; i++) {
        h ^= bmp.data[i];
        h = Math.imul(h, 0x01000193);
      }
      bufHash = (h >>> 0).toString(16).padStart(8, "0");
    }

    results.push({ inst: ci, w, h, bufHash, hasPixelData, density: typeof density === "number" ? density : 0 });
  }

  results.sort((a, b) => b.inst.getTotalRetainedSize().total - a.inst.getTotalRetainedSize().total);

  return results.map(r => ({
    row: rowOf(r.inst, snap!),
    width: r.w,
    height: r.h,
    pixelCount: r.w * r.h,
    bufferHash: `${r.w}x${r.h}:${r.bufHash}`,
    hasPixelData: r.hasPixelData,
    density: r.density,
  }));
}

function handleGetStringList(): StringListRow[] {
  if (!snap) throw new Error("no snapshot");
  const results: StringListRow[] = [];
  for (const [, inst] of snap.instances) {
    const ci = inst.asClassInstance?.();
    if (!ci || !ci.isInstanceOfClass("java.lang.String")) continue;
    const str = ci.asString(-1);
    if (str === null) continue;
    const [className, display] = deobRow(ci);
    results.push({
      id: ci.id,
      value: str,
      length: str.length,
      retainedSize: ci.getTotalRetainedSize().total,
      shallowSize: ci.getSize().java + ci.getSize().native_,
      heap: ci.heap?.name ?? "?",
      className,
      display,
    });
  }
  results.sort((a, b) => b.retainedSize - a.retainedSize);
  return results;
}

function handleGetByteArray(id: number): ArrayBuffer | null {
  if (!snap) throw new Error("no snapshot");
  const inst = snap.findInstance(id);
  if (!inst || !(inst instanceof AhatArrayInstance)) return null;
  // Only support byte arrays (Type.BYTE = 5)
  if (inst.elemType !== 5) return null;
  const arr = new Uint8Array(inst.values.length);
  for (let i = 0; i < inst.values.length; i++) {
    arr[i] = (inst.values[i] as number) & 0xff;
  }
  return arr.buffer;
}

// ─── Message loop ─────────────────────────────────────────────────────────────

addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as WorkerMessage;

  if (msg.type === "parse") {
    try {
      baselineSnap = null;
      rawBuffer = msg.buffer;
      snap = parseHprof(msg.buffer, (m: string, pct: number) => {
        console.log(`[hprof] ${m} (${pct.toFixed(1)}%)`);
        postMessage({ type: "progress", msg: m, pct });
      });
      originalHeapCount = snap.heaps.length;
      postMessage({ type: "ready", overview: handleGetOverview() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[hprof worker] parse error:", err);
      postMessage({ type: "error", message });
    }
    return;
  }

  if (msg.type === "diffWithBaseline") {
    try {
      if (!snap) throw new Error("no snapshot loaded");
      // Clear any previous diff first
      if (baselineSnap) {
        resetBaselines(snap, originalHeapCount);
        baselineSnap = null;
      }
      postMessage({ type: "diffProgress", msg: "Parsing baseline\u2026", pct: 10 });
      baselineSnap = parseHprof(msg.buffer, (m: string, pct: number) => {
        postMessage({ type: "diffProgress", msg: m, pct: 10 + pct * 0.8 });
      });
      postMessage({ type: "diffProgress", msg: "Diffing snapshots\u2026", pct: 90 });
      diffSnapshots(snap, baselineSnap);
      postMessage({ type: "diffReady", overview: handleGetOverview() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[hprof worker] diff error:", err);
      postMessage({ type: "error", message });
    }
    return;
  }

  if (msg.type === "clearBaseline") {
    if (snap && baselineSnap) {
      resetBaselines(snap, originalHeapCount);
      baselineSnap = null;
    }
    postMessage({ type: "baselineCleared", overview: handleGetOverview() });
    return;
  }

  if (msg.type === "loadProguardMap") {
    proguardMap = new ProguardMap();
    proguardMap.parse(msg.text);
    postMessage({ type: "proguardMapLoaded", hasEntries: proguardMap.hasEntries() });
    return;
  }

  if (msg.type === "query") {
    const { id, name, params } = msg;
    try {
      // getRawBuffer returns the original hprof ArrayBuffer (copy, not transfer — worker keeps its copy)
      if (name === "getRawBuffer") {
        if (rawBuffer) {
          const copy = rawBuffer.slice(0);
          postMessage({ type: "result", id, data: copy }, { transfer: [copy] });
        } else {
          postMessage({ type: "result", id, data: null });
        }
        return;
      }
      // getByteArray returns an ArrayBuffer that must be transferred
      if (name === "getByteArray") {
        const buf = handleGetByteArray(Number(params.id));
        if (buf) {
          postMessage({ type: "result", id, data: buf }, { transfer: [buf] });
        } else {
          postMessage({ type: "result", id, data: null });
        }
        return;
      }
      let data: unknown;
      switch (name) {
        case "getOverview":   data = handleGetOverview(); break;
        case "getRooted":     data = handleGetRooted(); break;
        case "getInstance":   data = handleGetInstance(Number(params.id)); break;
        case "getSite":       data = handleGetSite(Number(params.id)); break;
        case "search":        data = handleSearch(String(params.query)); break;
        case "getObjects":    data = handleGetObjects({ siteId: Number(params.siteId), className: String(params.className), heap: params.heap ? String(params.heap) : null }); break;
        case "getBitmapList": data = handleGetBitmapList(); break;
        case "getStringList": data = handleGetStringList(); break;
        case "getFullString": {
          if (!snap) throw new Error("no snapshot");
          const inst = snap.instances.get(Number(params.id));
          const ci = inst?.asClassInstance?.();
          data = ci?.asString(-1) ?? null;
          break;
        }
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
