// ─── Enums & Constants ───────────────────────────────────────────────────────
// NOTE: parseHprof is intentionally synchronous and CPU-heavy.
// Call it from a Web Worker (see hprof.worker.ts) so the UI stays responsive.


export const Type = {
  OBJECT: 0, BOOLEAN: 1, CHAR: 2, FLOAT: 3, DOUBLE: 4,
  BYTE: 5, SHORT: 6, INT: 7, LONG: 8,
} as const;
export type TypeId = (typeof Type)[keyof typeof Type];

export const TypeName: Record<number, string> = {
  0: "Object", 1: "boolean", 2: "char", 3: "float", 4: "double",
  5: "byte", 6: "short", 7: "int", 8: "long",
};

const TypeSize = [0, 1, 2, 4, 8, 1, 2, 4, 8];
function typeSize(t: number, idSize: number): number {
  return t === Type.OBJECT ? idSize : TypeSize[t];
}

export const Reachability = {
  STRONG: 0, SOFT: 1, FINALIZER: 2, WEAK: 3, PHANTOM: 4, UNREACHABLE: 5,
} as const;

export const ReachabilityName: Record<number, string> = {
  0: "strong", 1: "soft", 2: "finalizer", 3: "weak", 4: "phantom", 5: "unreachable",
};

export const RootTypeNames = [
  "JNI_GLOBAL", "JNI_LOCAL", "JAVA_FRAME", "NATIVE_STACK", "STICKY_CLASS",
  "THREAD_BLOCK", "MONITOR", "THREAD", "INTERNED_STRING", "DEBUGGER",
  "VM_INTERNAL", "UNKNOWN", "JNI_MONITOR", "FINALIZING",
];

const HPROF_TYPES: (number | null)[] = [
  null, null, Type.OBJECT, null,
  Type.BOOLEAN, Type.CHAR, Type.FLOAT, Type.DOUBLE,
  Type.BYTE, Type.SHORT, Type.INT, Type.LONG,
];

// ─── Size ────────────────────────────────────────────────────────────────────

export class Size {
  constructor(public java: number = 0, public native_: number = 0) {}
  get total(): number { return this.java + this.native_; }
  plus(o: Size): Size { return new Size(this.java + o.java, this.native_ + o.native_); }
  isZero(): boolean { return this.java === 0 && this.native_ === 0; }
}

export const ZERO_SIZE = new Size(0, 0);

// ─── HprofBuffer ─────────────────────────────────────────────────────────────

class HprofBuffer {
  private view: DataView;
  private pos = 0;
  private idSize8 = false;

  constructor(private buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }

  setIdSize8() { this.idSize8 = true; }
  hasRemaining(): boolean { return this.pos < this.buf.byteLength; }
  size(): number { return this.buf.byteLength; }
  tell(): number { return this.pos; }
  seek(p: number) { this.pos = p; }
  skip(n: number) { this.pos += n; }

  getU1(): number { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  getU2(): number { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  getU4(): number { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  getU4Unsigned(): number { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }

  getId(): number {
    if (this.idSize8) {
      const hi = this.view.getUint32(this.pos);
      const lo = this.view.getUint32(this.pos + 4);
      this.pos += 8;
      return hi * 0x100000000 + lo;
    }
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }

  getBool(): boolean { return this.getU1() !== 0; }
  getChar(): string { const v = this.view.getUint16(this.pos); this.pos += 2; return String.fromCharCode(v); }
  getFloat(): number { const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
  getDouble(): number { const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }
  getByte(): number { const v = this.view.getInt8(this.pos); this.pos += 1; return v; }
  getShort(): number { const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  getInt(): number { const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  getLong(): number {
    const hi = this.view.getInt32(this.pos);
    const lo = this.view.getUint32(this.pos + 4);
    this.pos += 8;
    return hi * 0x100000000 + lo;
  }
  getBytes(n: number): Uint8Array {
    const arr = new Uint8Array(this.buf, this.pos, n);
    this.pos += n;
    return arr;
  }

  getType(): number {
    const id = this.getU1();
    if (id >= HPROF_TYPES.length || HPROF_TYPES[id] === null) throw new Error("Invalid type id: " + id);
    return HPROF_TYPES[id]!;
  }

  getPrimitiveType(): number {
    const t = this.getType();
    if (t === Type.OBJECT) throw new Error("Expected primitive type, got Object");
    return t;
  }
}

// ─── Type aliases ────────────────────────────────────────────────────────────

/** A primitive value stored in a heap dump field or array element. */
export type PrimVal = number | boolean | string;

/** A resolved field value: primitive, object reference, or null. */
export type FieldVal = PrimVal | AhatInstance | null;

/** An unresolved object reference, used during initial parsing before instance resolution. */
interface DeferredRef { _deferred: true; id: number }

/** A field value that may contain a deferred object reference (pre-resolution). */
type DeferredFieldVal = PrimVal | DeferredRef;

/** Temp data attached to AhatClassInstance during parsing. */
interface ClassInstanceTempData { position: number }

/** A field value that may contain a deferred object reference (pre-resolution). */
interface DeferredFieldValue { name: string; type: number; value: DeferredFieldVal }

/** Temp data attached to AhatClassObj during parsing. */
interface ClassObjTempData { classLoaderId: number; staticFields: DeferredFieldValue[] }

/** Temp data attached to AhatArrayInstance during parsing. */
interface ArrayInstanceTempData { length: number; position: number }

/** Union of all temp data shapes used during parsing. */
type TempData = ClassInstanceTempData | ClassObjTempData | ArrayInstanceTempData;

// ─── Field descriptors ───────────────────────────────────────────────────────

export interface Field {
  name: string;
  type: number;
}

export interface FieldValue {
  name: string;
  type: number;
  value: FieldVal;
}

interface Reference {
  src: AhatInstance;
  field: string;
  ref: AhatInstance;
  reachability: number;
}

// ─── Heap ────────────────────────────────────────────────────────────────────

export class AhatHeap {
  public size: Size = ZERO_SIZE;
  public baseline: AhatHeap = this;

  constructor(public name: string, public index: number) {}

  addToSize(s: Size) { this.size = this.size.plus(s); }
  getBaseline(): AhatHeap { return this.baseline; }
}

// ─── Instance hierarchy ──────────────────────────────────────────────────────

export class AhatInstance {
  public heap: AhatHeap | null = null;
  public classObj: AhatClassObj | null = null;
  public site: SiteNode | null = null;
  public rootTypes = 0;
  public registeredNativeSize = 0;
  public reachability: number = Reachability.UNREACHABLE;
  public nextToGcRoot: AhatInstance | null = null;
  public nextToGcRootField = "";
  public reverseRefs: AhatInstance[] = [];
  public immediateDominator: AhatInstance | null = null;
  public dominated: AhatInstance[] = [];
  public retainedSizes: Size[] | null = null;
  public baseline: AhatInstance = this;
  public tempData: TempData | null = null;

  constructor(public id: number) {}

  init(heap: AhatHeap, site: SiteNode | null, classObj: AhatClassObj | null) {
    this.heap = heap; this.site = site; this.classObj = classObj;
  }

  getSize(): Size {
    const base = this.classObj ? this.classObj.instanceSize : 0;
    return new Size(base + this.getExtraJavaSize(), this.registeredNativeSize);
  }

  getExtraJavaSize(): number { return 0; }

  getRetainedSize(heap: AhatHeap): Size {
    if (this.retainedSizes && heap.index >= 0 && heap.index < this.retainedSizes.length)
      return this.retainedSizes[heap.index];
    return ZERO_SIZE;
  }

  getTotalRetainedSize(): Size {
    if (!this.retainedSizes) return ZERO_SIZE;
    let s = ZERO_SIZE;
    for (const rs of this.retainedSizes) s = s.plus(rs);
    return s;
  }

  isRoot(): boolean { return this.rootTypes !== 0; }
  addRootType(mask: number) { this.rootTypes |= mask; }
  getRootTypeNames(): string[] | null {
    if (!this.isRoot()) return null;
    const names: string[] = [];
    for (let i = 0; i < 14; i++) if (this.rootTypes & (1 << i)) names.push(RootTypeNames[i]);
    return names;
  }

  getClassName(): string { return this.classObj ? this.classObj.className : "???"; }

  isInstanceOfClass(name: string): boolean {
    let cls = this.classObj;
    while (cls) { if (cls.className === name) return true; cls = cls.superClassObj; }
    return false;
  }

  isClassObj(): this is AhatClassObj { return false; }
  isArrayInstance(): this is AhatArrayInstance { return false; }
  isClassInstance(): this is AhatClassInstance { return false; }
  asClassObj(): AhatClassObj | null { return null; }
  asArrayInstance(): AhatArrayInstance | null { return null; }
  asClassInstance(): AhatClassInstance | null { return null; }
  isPlaceHolder(): boolean { return false; }
  getReferences(): Reference[] { return []; }
  getField(_name: string): FieldVal | undefined { return undefined; }
  getRefField(_name: string): AhatInstance | undefined { return undefined; }
  asString(_maxChars?: number): string | null { return null; }
  getReferent(): AhatInstance | null { return null; }

  getPathFromGcRoot(): { instance: AhatInstance; field: string; isDominator: boolean }[] | null {
    // Unreachable instances may still have sample paths (via id-ordered refs)
    if (this.reachability === Reachability.UNREACHABLE && !this.nextToGcRoot) return null;
    const path: { instance: AhatInstance; field: string; isDominator: boolean }[] = [];
    let inst: AhatInstance | null = this;
    while (inst) {
      path.push({ instance: inst, field: "", isDominator: false });
      if (inst.isRoot() || !inst.nextToGcRoot) break;
      path[path.length - 1].field = inst.nextToGcRootField;
      inst = inst.nextToGcRoot;
    }
    let dom: AhatInstance | null = this;
    for (let i = 0; i < path.length; i++) {
      if (path[i].instance === dom) {
        path[i].isDominator = true;
        dom = dom.immediateDominator;
      }
    }
    path.reverse();
    return path;
  }

  toString(): string {
    return `${this.getClassName()}@${this.id.toString(16).padStart(8, "0")}`;
  }
}

export class AhatClassInstance extends AhatInstance {
  private fields: FieldVal[] = [];

  isClassInstance(): this is AhatClassInstance { return true; }
  asClassInstance() { return this; }
  getExtraJavaSize() { return 0; }

  initFields(values: FieldVal[]) { this.fields = values; }

  *getInstanceFields(): Generator<FieldValue> {
    let cls = this.classObj;
    let idx = 0;
    while (cls) {
      for (const f of cls.instanceFields) {
        yield { name: f.name, type: f.type, value: this.fields[idx++] };
      }
      cls = cls.superClassObj;
    }
  }

  getField(name: string): FieldVal | undefined {
    for (const f of this.getInstanceFields()) if (f.name === name) return f.value;
    return undefined;
  }

  getRefField(name: string): AhatInstance | undefined {
    const v = this.getField(name);
    return (v instanceof AhatInstance) ? v : undefined;
  }

  getReferences(): Reference[] {
    const refs: Reference[] = [];
    const refType = this._getJavaLangRefType();
    for (const f of this.getInstanceFields()) {
      if (f.value instanceof AhatInstance) {
        const reach: number = (refType !== Reachability.STRONG && f.name === "referent") ? refType : Reachability.STRONG;
        refs.push({ src: this, field: "." + f.name, ref: f.value, reachability: reach });
      }
    }
    return refs;
  }

  private _getJavaLangRefType(): number {
    let cls = this.classObj;
    while (cls) {
      switch (cls.className) {
        case "java.lang.ref.PhantomReference": return Reachability.PHANTOM;
        case "java.lang.ref.WeakReference": return Reachability.WEAK;
        case "java.lang.ref.FinalizerReference":
        case "java.lang.ref.Finalizer": return Reachability.FINALIZER;
        case "java.lang.ref.SoftReference": return Reachability.SOFT;
      }
      cls = cls.superClassObj;
    }
    return Reachability.STRONG;
  }

  getReferent(): AhatInstance | null {
    if (this.isInstanceOfClass("java.lang.ref.Reference")) return this.getRefField("referent") ?? null;
    return null;
  }

  asString(maxChars = -1): string | null {
    if (!this.isInstanceOfClass("java.lang.String")) return null;
    const val = this.getField("value");
    if (!(val instanceof AhatInstance) || !val.isArrayInstance()) return null;
    const arr = val.asArrayInstance()!;
    const count = (() => { const v = this.getField("count"); return typeof v === "number" ? v : arr.length; })();
    const offset = (() => { const v = this.getField("offset"); return typeof v === "number" ? v : 0; })();
    return arr.asStringSlice(offset, count, maxChars);
  }

  /**
   * Returns bitmap data if this is an android.graphics.Bitmap with available pixel data.
   * Checks legacy mBuffer first, then DumpData (from `am dumpheap -b`).
   */
  asBitmap(dumpData?: BitmapDumpData | null): BitmapData | null {
    if (!this.isInstanceOfClass("android.graphics.Bitmap")) return null;
    const w = this.getField("mWidth");
    if (typeof w !== "number" || w <= 0) return null;
    const h = this.getField("mHeight");
    if (typeof h !== "number" || h <= 0) return null;

    // Legacy path: raw BGRA pixels in mBuffer
    const bufRef = this.getRefField("mBuffer");
    if (bufRef && bufRef.isArrayInstance()) {
      const arr = bufRef.asArrayInstance()!;
      if (arr.elemType === Type.BYTE) {
        const buf = arr.values as number[];
        if (buf.length >= 4 * h * w) {
          const rgba = new Uint8ClampedArray(4 * w * h);
          for (let i = 0; i < w * h; i++) {
            rgba[i * 4 + 0] = buf[i * 4 + 2] & 0xFF; // R
            rgba[i * 4 + 1] = buf[i * 4 + 1] & 0xFF; // G
            rgba[i * 4 + 2] = buf[i * 4 + 0] & 0xFF; // B
            rgba[i * 4 + 3] = buf[i * 4 + 3] & 0xFF; // A
          }
          return { width: w, height: h, format: "rgba", data: new Uint8Array(rgba.buffer) };
        }
      }
    }

    // DumpData path: compressed image keyed by mNativePtr
    if (dumpData && dumpData.buffers.size > 0) {
      const nativePtr = this.getField("mNativePtr");
      if (typeof nativePtr === "bigint" || typeof nativePtr === "number") {
        const key = typeof nativePtr === "bigint" ? nativePtr : BigInt(nativePtr);
        const compressedBuf = dumpData.buffers.get(key);
        if (compressedBuf && compressedBuf.length > 0) {
          const fmtNames: Record<number, BitmapData["format"]> = {
            0: "jpeg", 1: "png", 2: "webp", 3: "webp", 4: "webp",
          };
          const format = fmtNames[dumpData.format] ?? "png";
          return { width: w, height: h, format, data: compressedBuf };
        }
      }
    }

    return null;
  }

  /**
   * If this is a sun.misc.Cleaner with a NativeAllocationRegistry chain,
   * returns { referent, size }. Otherwise null.
   *
   * Chain: sun.misc.Cleaner
   *   .thunk → libcore.util.NativeAllocationRegistry$CleanerThunk
   *     .this$0 → libcore.util.NativeAllocationRegistry
   *       .size → long (the native size)
   *   .referent → AhatInstance (the target object)
   */
  asRegisteredNativeAllocation(): { referent: AhatInstance; size: number } | null {
    if (!this.isInstanceOfClass("sun.misc.Cleaner")) return null;

    const thunk = this.getRefField("thunk")?.asClassInstance?.();
    if (!thunk || !thunk.isInstanceOfClass("libcore.util.NativeAllocationRegistry$CleanerThunk")) return null;

    const registry = thunk.getRefField("this$0")?.asClassInstance?.();
    if (!registry || !registry.isInstanceOfClass("libcore.util.NativeAllocationRegistry")) return null;

    const size = registry.getField("size");
    if (typeof size !== "number" && typeof size !== "bigint") return null;

    const referent = this.getRefField("referent");
    if (!referent) return null;

    return { referent, size: Number(size) };
  }

  toString(): string {
    return `${this.getClassName()}@${this.id.toString(16).padStart(8, "0")}`;
  }
}

export class AhatArrayInstance extends AhatInstance {
  public values: FieldVal[] = [];
  public elemType: number = Type.OBJECT;

  constructor(id: number, public refSize: number) { super(id); }

  isArrayInstance(): this is AhatArrayInstance { return true; }
  asArrayInstance() { return this; }
  get length() { return this.values.length; }

  getExtraJavaSize(): number {
    if (this.values.length === 0) return 0;
    return typeSize(this.elemType, this.refSize) * this.values.length;
  }

  initPrimitive(type: number, data: PrimVal[]) { this.elemType = type; this.values = data; }
  initObjects(objects: (AhatInstance | null)[]) { this.elemType = Type.OBJECT; this.values = objects; }

  getReferences(): Reference[] {
    if (this.elemType !== Type.OBJECT) return [];
    const refs: Reference[] = [];
    for (let i = 0; i < this.values.length; i++) {
      const v = this.values[i];
      if (v instanceof AhatInstance) {
        refs.push({ src: this, field: `[${i}]`, ref: v, reachability: Reachability.STRONG });
      }
    }
    return refs;
  }

  asString(maxChars = -1): string | null {
    return this.asStringSlice(0, this.length, maxChars);
  }

  asStringSlice(offset: number, count: number, maxChars: number): string | null {
    if (this.elemType === Type.CHAR) {
      if (maxChars >= 0 && maxChars < count) count = maxChars;
      let s = "";
      for (let i = offset; i < offset + count && i < this.values.length; i++) s += this.values[i];
      return s;
    }
    if (this.elemType === Type.BYTE) {
      if (maxChars >= 0 && maxChars < count) count = maxChars;
      let s = "";
      for (let i = offset; i < offset + count && i < this.values.length; i++)
        s += String.fromCharCode((this.values[i] as number) & 0xFF);
      return s;
    }
    return null;
  }

  toString(): string {
    let cn = this.getClassName();
    if (cn.endsWith("[]")) cn = cn.slice(0, -2);
    return `${cn}[${this.values.length}]@${this.id.toString(16).padStart(8, "0")}`;
  }
}

export class AhatClassObj extends AhatInstance {
  public superClassObj: AhatClassObj | null = null;
  public classLoader: AhatInstance | null = null;
  public staticFieldValues: FieldValue[] = [];
  public instanceFields: Field[] = [];
  public staticFieldsSize = 0;
  public instanceSize = 0;

  constructor(id: number, public className: string) { super(id); }

  isClassObj(): this is AhatClassObj { return true; }
  asClassObj() { return this; }
  getExtraJavaSize() { return this.staticFieldsSize; }
  getName() { return this.className; }
  getClassName() { return "java.lang.Class"; }

  getReferences(): Reference[] {
    const refs: Reference[] = [];
    for (const f of this.staticFieldValues) {
      if (f.value instanceof AhatInstance) {
        refs.push({ src: this, field: "." + f.name, ref: f.value, reachability: Reachability.STRONG });
      }
    }
    return refs;
  }

  toString() { return `class ${this.className}`; }
}

export class SuperRoot extends AhatInstance {
  public roots: AhatInstance[] = [];
  constructor() { super(0); }
  addRoot(inst: AhatInstance) { this.roots.push(inst); }
  getExtraJavaSize() { return 0; }
  getReferences(): Reference[] {
    return this.roots.map((r, i) => ({
      src: this as AhatInstance, field: `.roots[${i}]`, ref: r, reachability: Reachability.STRONG,
    }));
  }
}

export class AhatPlaceHolderInstance extends AhatInstance {
  constructor(baseline: AhatInstance) {
    super(-1);
    this.baseline = baseline;
    baseline.baseline = this;
    this.heap = baseline.heap?.baseline ?? baseline.heap;
    this.classObj = baseline.classObj;
  }
  isPlaceHolder() { return true; }
  getSize() { return ZERO_SIZE; }
  getExtraJavaSize() { return 0; }
  getRetainedSize(_heap: AhatHeap) { return ZERO_SIZE; }
  getTotalRetainedSize() { return ZERO_SIZE; }
  getClassName() { return this.baseline.getClassName(); }
  asString(mc?: number) { return this.baseline.asString?.(mc) ?? null; }
  toString() { return this.baseline.toString(); }
  getReferences(): Reference[] { return []; }
}

// ─── Site ────────────────────────────────────────────────────────────────────

export interface ObjectsInfo {
  heap: AhatHeap;
  classObj: AhatClassObj | null;
  numInstances: number;
  numBytes: Size;
  baseline: ObjectsInfo;
  getClassName(): string;
}

interface StackFrame {
  method: string;
  signature: string;
  filename: string;
  line: number;
  className: string;
}

export class SiteNode {
  public id = -1;
  public children: SiteNode[] = [];
  public objects: AhatInstance[] = [];
  public objectsInfos: ObjectsInfo[] = [];
  private objectsInfoMap = new Map<string, ObjectsInfo>();
  public sizesByHeap: Size[] | null = null;
  public baseline: SiteNode = this;

  constructor(
    public parent: SiteNode | null,
    public method: string,
    public signature: string,
    public filename: string,
    public line: number,
    public className: string = "",
  ) {}

  getSite(frames: StackFrame[]): SiteNode {
    if (!frames) return this;
    let site: SiteNode = this;
    for (let s = frames.length - 1; s >= 0; s--) {
      const f = frames[s];
      let child: SiteNode | null = null;
      for (const c of site.children) {
        if (c.line === f.line && c.method === f.method && c.signature === f.signature && c.filename === f.filename && c.className === f.className) {
          child = c; break;
        }
      }
      if (!child) {
        child = new SiteNode(site, f.method, f.signature, f.filename, f.line, f.className);
        site.children.push(child);
      }
      site = child;
    }
    return site;
  }

  addInstance(inst: AhatInstance) { this.objects.push(inst); }

  prepareForUse(id: number, numHeaps: number, retained: number): number {
    this.id = id++;
    this.sizesByHeap = new Array(numHeaps).fill(null).map(() => ZERO_SIZE);
    for (const inst of this.objects) {
      if (inst.reachability <= retained) {
        const heap = inst.heap!;
        const size = inst.getSize();
        const info = this.getObjectsInfo(heap, inst.classObj);
        info.numInstances++;
        info.numBytes = info.numBytes.plus(size);
        this.sizesByHeap[heap.index] = this.sizesByHeap[heap.index].plus(size);
      }
    }
    for (const child of this.children) {
      id = child.prepareForUse(id, numHeaps, retained);
      for (const ci of child.objectsInfos) {
        const info = this.getObjectsInfo(ci.heap, ci.classObj);
        info.numInstances += ci.numInstances;
        info.numBytes = info.numBytes.plus(ci.numBytes);
      }
      if (child.sizesByHeap) {
        for (let i = 0; i < numHeaps; i++) {
          this.sizesByHeap[i] = this.sizesByHeap[i].plus(child.sizesByHeap[i]);
        }
      }
    }
    return id;
  }

  getObjectsInfo(heap: AhatHeap, classObj: AhatClassObj | null): ObjectsInfo {
    const key = `${heap.index}:${classObj ? classObj.id : 0}`;
    let info = this.objectsInfoMap.get(key);
    if (!info) {
      info = {
        heap, classObj, numInstances: 0, numBytes: ZERO_SIZE,
        getClassName() { return this.classObj?.className ?? "???"; },
        baseline: null!,
      };
      info.baseline = info;
      this.objectsInfos.push(info);
      this.objectsInfoMap.set(key, info);
    }
    return info;
  }

  getSizeForHeap(heap: AhatHeap): Size { return this.sizesByHeap ? this.sizesByHeap[heap.index] : ZERO_SIZE; }

  getTotalSize(): Size {
    if (!this.sizesByHeap) return ZERO_SIZE;
    return this.sizesByHeap.reduce((a, b) => a.plus(b), ZERO_SIZE);
  }

  findSite(id: number): SiteNode | null {
    if (id === this.id) return this;
    let start = 0, end = this.children.length;
    while (start < end) {
      const mid = start + ((end - start) >> 1);
      const midSite = this.children[mid];
      if (id < midSite.id) { end = mid; }
      else if (mid + 1 === end) { return midSite.findSite(id); }
      else if (id < this.children[mid + 1].id) { return midSite.findSite(id); }
      else { start = mid + 1; }
    }
    return null;
  }

  getObjects(predicate: (i: AhatInstance) => boolean, consumer: (i: AhatInstance) => void) {
    for (const inst of this.objects) if (predicate(inst)) consumer(inst);
    for (const child of this.children) child.getObjects(predicate, consumer);
  }
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

/** Bitmap pixel data extracted from Bitmap$DumpData or legacy mBuffer. */
export interface BitmapData {
  width: number;
  height: number;
  /** "rgba" = raw BGRA→RGBA pixels (legacy mBuffer), else compressed image */
  format: "rgba" | "png" | "jpeg" | "webp";
  data: Uint8Array;
}

/**
 * Maps mNativePtr → compressed pixel buffer for bitmaps dumped with `am dumpheap -b`.
 * Format codes: 0=JPEG, 1=PNG, 2/3/4=WebP, -1=legacy raw BGRA.
 */
export interface BitmapDumpData {
  format: number; // android.graphics.Bitmap.CompressFormat ordinal, or -1
  buffers: Map<bigint, Uint8Array>;
}

export class AhatSnapshot {
  /** null if dump didn't include bitmap data (no `-b` flag) */
  bitmapDumpData: BitmapDumpData | null = null;

  constructor(
    public superRoot: SuperRoot,
    public instances: Map<number, AhatInstance>,
    public heaps: AhatHeap[],
    public rootSite: SiteNode,
  ) {}

  findInstance(id: number): AhatInstance | null { return this.instances.get(id) ?? null; }
  getRooted(): AhatInstance[] { return this.superRoot.dominated; }
  getSite(id: number): SiteNode { return this.rootSite.findSite(id) ?? this.rootSite; }
  getHeap(name: string): AhatHeap | null { return this.heaps.find(h => h.name === name) ?? null; }
}

// ─── Diff Algorithm ──────────────────────────────────────────────────────────
// Port of Android ahat Diff.java — key-based equivalence matching.

function instanceDiffKey(inst: AhatInstance): string {
  // Exact port of Diff.Key from Java ahat
  const cls = inst.getClassName();
  const heap = inst.heap?.name ?? "";
  const str = inst.asString?.() ?? "";
  const classObjName = inst.isClassObj() ? inst.className : "";
  const arrLen = inst.isArrayInstance() ? inst.asArrayInstance()!.length : 0;
  return `${cls}\0${heap}\0${str}\0${classObjName}\0${arrLen}`;
}

function diffHeaps(aHeaps: AhatHeap[], bHeaps: AhatHeap[]): void {
  // Exact port of Diff.heaps from Java ahat
  const asize = aHeaps.length;
  const bsize = bHeaps.length;

  // Mark b heaps as unmatched (use a Set since we can't set baseline to null)
  const bUnmatched = new Set<AhatHeap>(bHeaps);

  for (let i = 0; i < asize; i++) {
    const ah = aHeaps[i];
    let matched = false;
    for (let j = 0; j < bsize; j++) {
      const bh = bHeaps[j];
      if (bUnmatched.has(bh) && ah.name === bh.name) {
        ah.baseline = bh;
        bh.baseline = ah;
        bUnmatched.delete(bh);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // No match for ah in B — create placeholder in B
      const ph = new AhatHeap(ah.name, bHeaps.length);
      bHeaps.push(ph);
      ph.baseline = ah;
      ah.baseline = ph;
    }
  }
  // Create placeholder in A for unmatched B heaps
  for (const bh of bUnmatched) {
    const ph = new AhatHeap(bh.name, aHeaps.length);
    aHeaps.push(ph);
    ph.baseline = bh;
    bh.baseline = ph;
  }
}

function createPlaceHolders(
  inst: AhatInstance,
  placeholders: AhatPlaceHolderInstance[],
): AhatPlaceHolderInstance {
  // Exact port of Diff.createPlaceHolders — iterative, not recursive
  const result = new AhatPlaceHolderInstance(inst);
  placeholders.push(result);
  const deque: AhatInstance[] = [inst];
  while (deque.length > 0) {
    const cur = deque.pop()!;
    for (const child of cur.dominated) {
      const childPh = new AhatPlaceHolderInstance(child);
      placeholders.push(childPh);
      deque.push(child);
    }
  }
  return result;
}

const RETAINED_SIZE_DESC = (a: AhatInstance, b: AhatInstance) =>
  b.getTotalRetainedSize().total - a.getTotalRetainedSize().total;

function diffInstances(
  aDom: AhatInstance[],
  bDom: AhatInstance[],
  placeholders: AhatPlaceHolderInstance[],
): void {
  // Exact port of Diff.instances from Java ahat — iterative stack
  const deque: { a: AhatInstance[]; b: AhatInstance[] }[] = [{ a: aDom, b: bDom }];

  while (deque.length > 0) {
    const p = deque.pop()!;

    // Group instances of the same equivalence class together
    const byKey = new Map<string, { a: AhatInstance[]; b: AhatInstance[] }>();
    for (const inst of p.a) {
      const key = instanceDiffKey(inst);
      let pair = byKey.get(key);
      if (!pair) { pair = { a: [], b: [] }; byKey.set(key, pair); }
      pair.a.push(inst);
    }
    for (const inst of p.b) {
      const key = instanceDiffKey(inst);
      let pair = byKey.get(key);
      if (!pair) { pair = { a: [], b: [] }; byKey.set(key, pair); }
      pair.b.push(inst);
    }

    // Diff objects from the same key class
    for (const pair of byKey.values()) {
      // Sort by total retained size desc, match positionally
      pair.a.sort(RETAINED_SIZE_DESC);
      pair.b.sort(RETAINED_SIZE_DESC);

      const common = Math.min(pair.a.length, pair.b.length);
      for (let i = 0; i < common; i++) {
        const ainst = pair.a[i];
        const binst = pair.b[i];
        ainst.baseline = binst;
        binst.baseline = ainst;
        deque.push({ a: ainst.dominated, b: binst.dominated });
      }

      // Create placeholders for leftovers
      for (let i = common; i < pair.a.length; i++) {
        p.b.push(createPlaceHolders(pair.a[i], placeholders));
      }
      for (let i = common; i < pair.b.length; i++) {
        p.a.push(createPlaceHolders(pair.b[i], placeholders));
      }
    }
  }
}

function setSitesBaseline(site: SiteNode, baseline: SiteNode): void {
  site.baseline = baseline;
  for (const child of site.children) setSitesBaseline(child, baseline);
}

function diffSites(aSite: SiteNode, bSite: SiteNode): void {
  // Exact port of Diff.sites from Java ahat
  aSite.baseline = bSite;
  bSite.baseline = aSite;

  // Match ObjectsInfos: a → b (uses classObj.baseline to find corresponding class in other snap)
  for (const aInfo of aSite.objectsInfos) {
    const baseClassObj = aInfo.classObj ? aInfo.classObj.baseline as AhatClassObj : null;
    const bInfo = bSite.getObjectsInfo(aInfo.heap.baseline, baseClassObj);
    aInfo.baseline = bInfo;
    bInfo.baseline = aInfo;
  }
  // Match ObjectsInfos: b → a
  for (const bInfo of bSite.objectsInfos) {
    const baseClassObj = bInfo.classObj ? bInfo.classObj.baseline as AhatClassObj : null;
    const aInfo = aSite.getObjectsInfo(bInfo.heap.baseline, baseClassObj);
    bInfo.baseline = aInfo;
    aInfo.baseline = bInfo;
  }

  // Mark b children as unmatched
  const bUnmatched = new Set<SiteNode>(bSite.children);

  for (const achild of aSite.children) {
    let matched = false;
    for (const bchild of bSite.children) {
      if (bUnmatched.has(bchild)
          && achild.line === bchild.line
          && achild.method === bchild.method
          && achild.signature === bchild.signature
          && achild.filename === bchild.filename) {
        bUnmatched.delete(bchild);
        diffSites(achild, bchild);
        matched = true;
        break;
      }
    }
    if (!matched) {
      setSitesBaseline(achild, bSite);
    }
  }

  for (const bchild of bUnmatched) {
    setSitesBaseline(bchild, aSite);
  }
}

/**
 * Diff two snapshots. Exact port of Diff.snapshots() from Java ahat.
 * After calling, every instance/heap/site in `a` has its `.baseline` pointing
 * to the corresponding object in `b`, and vice versa. Unmatched objects get
 * `AhatPlaceHolderInstance` placeholders.
 */
export function diffSnapshots(a: AhatSnapshot, b: AhatSnapshot): void {
  // Diff heaps
  diffHeaps(a.heaps, b.heaps);

  // Diff instances
  const placeholders: AhatPlaceHolderInstance[] = [];
  diffInstances(a.superRoot.dominated, b.superRoot.dominated, placeholders);

  // Diff sites (requires instances already diffed)
  diffSites(a.rootSite, b.rootSite);

  // Add placeholders to their corresponding sites (requires sites already diffed)
  for (const ph of placeholders) {
    if (ph.baseline.site) {
      const targetSite = ph.baseline.site.baseline;
      if (targetSite) {
        ph.site = targetSite;
        targetSite.addInstance(ph);
      }
    }
  }

  // Register placeholders in snap instance maps for lookup
  let phId = -1;
  for (const ph of placeholders) {
    // Determine which snapshot this placeholder belongs to
    // Placeholders created for unmatched A instances go into B (and vice versa)
    // We add to both for simplicity — each ph already has baseline set
    const targetSnap = a.instances.has(ph.baseline.id) ? b : a;
    targetSnap.instances.set(phId--, ph);
  }
}

/**
 * Reset all baselines in a snapshot back to `this` (self-referencing).
 * Also removes any placeholder instances and heaps added during diffing.
 */
export function resetBaselines(snap: AhatSnapshot, originalHeapCount: number): void {
  // Reset heaps, remove placeholders
  for (const h of snap.heaps) h.baseline = h;
  snap.heaps.length = originalHeapCount;

  // Reset instances, remove placeholders
  const toRemove: number[] = [];
  for (const [id, inst] of snap.instances) {
    if (inst instanceof AhatPlaceHolderInstance) {
      toRemove.push(id);
    } else {
      inst.baseline = inst;
      // Remove placeholders that diffInstances pushed into dominated arrays
      if (inst.dominated.length > 0) {
        inst.dominated = inst.dominated.filter(d => !(d instanceof AhatPlaceHolderInstance));
      }
    }
  }
  for (const id of toRemove) snap.instances.delete(id);
  // Also clean superRoot's dominated array
  snap.superRoot.dominated = snap.superRoot.dominated.filter(d => !(d instanceof AhatPlaceHolderInstance));

  // Reset sites
  resetSiteBaselines(snap.rootSite);
}

function resetSiteBaselines(site: SiteNode): void {
  site.baseline = site;
  for (const info of site.objectsInfos) info.baseline = info;
  // Remove placeholder objects from site
  site.objects = site.objects.filter(o => !(o instanceof AhatPlaceHolderInstance));
  for (const child of site.children) resetSiteBaselines(child);
}

// ─── normalizeClassName ──────────────────────────────────────────────────────

function normalizeClassName(name: string): string {
  let numDim = 0;
  while (name.startsWith("[")) { numDim++; name = name.substring(1); }
  if (numDim > 0) {
    switch (name.charAt(0)) {
      case 'Z': name = "boolean"; break; case 'B': name = "byte"; break;
      case 'C': name = "char"; break; case 'S': name = "short"; break;
      case 'I': name = "int"; break; case 'J': name = "long"; break;
      case 'F': name = "float"; break; case 'D': name = "double"; break;
      case 'L': name = name.substring(1, name.length - 1); break;
      default: throw new Error("Invalid type sig in class name: " + name);
    }
  }
  name = name.replace(/\//g, ".");
  for (let i = 0; i < numDim; i++) name += "[]";
  return name;
}

// ─── Dominators ──────────────────────────────────────────────────────────────

// Proper dominator computation matching the Android ahat Java implementation
// (com.android.ahat.dominators.Dominators).
//
// Algorithm:
// 1. DFS traversal, assign IDs in DFS order, set initial candidate dominators.
// 2. When a node is re-visited (non-tree edge), refine candidate dominator.
// 3. Iteratively revisit nodes until all dominators stabilise.

interface NodeS {
  node: AhatInstance;
  id: number;
  maxReachableId: number;
  inRefIds: number[];   // incoming reference source ids
  domS: NodeS;
  oldDomS: NodeS;
  dominated: NodeS[];
  revisit: NodeS[] | null;
  depth: number;
}

interface DomLink {
  srcS: NodeS;
  dst: AhatInstance | null; // null = marker for "DFS done for srcS"
}

function computeDominators(
  root: AhatInstance,
  getRefs: (node: AhatInstance) => AhatInstance[],
  setDominator: (node: AhatInstance, dominator: AhatInstance) => void,
  onProgress?: (msg: string, pct: number) => void,
) {
  let nextId = 0;
  const stateMap = new Map<AhatInstance, NodeS>();
  const revisitQueue: NodeS[] = [];

  // Set up root
  const rootS: NodeS = {
    node: root,
    id: nextId++,
    maxReachableId: 0,
    inRefIds: [],
    domS: null!,
    oldDomS: null!,
    dominated: [],
    revisit: null,
    depth: 0,
  };
  rootS.domS = rootS;
  rootS.oldDomS = rootS;
  stateMap.set(root, rootS);

  // Phase 1: DFS traversal, assign IDs, initial candidate dominators
  const t0 = Date.now();
  onProgress?.("Dominators: DFS traversal...", 70);
  const dfs: DomLink[] = [];
  // Push marker first, then children (stack = reverse order)
  dfs.push({ srcS: rootS, dst: null }); // marker
  const rootRefs = getRefs(root);
  for (let i = rootRefs.length - 1; i >= 0; i--) {
    dfs.push({ srcS: rootS, dst: rootRefs[i] });
  }

  let dfsOps = 0;
  while (dfs.length > 0) {
    const link = dfs.pop()!;

    if (link.dst === null) {
      // Marker: DFS done for this node
      link.srcS.maxReachableId = nextId - 1;
      continue;
    }

    let dstS = stateMap.get(link.dst);
    if (dstS === undefined) {
      // First time seeing this node - DFS tree edge
      dstS = {
        node: link.dst,
        id: nextId++,
        maxReachableId: 0,
        inRefIds: [link.srcS.id],
        domS: link.srcS,
        oldDomS: link.srcS,
        dominated: [],
        revisit: null,
        depth: link.srcS.depth + 1,
      };
      link.srcS.dominated.push(dstS);
      stateMap.set(link.dst, dstS);

      // Push marker then children
      dfs.push({ srcS: dstS, dst: null });
      const refs = getRefs(link.dst);
      for (let i = refs.length - 1; i >= 0; i--) {
        dfs.push({ srcS: dstS, dst: refs[i] });
      }
    } else {
      // Already visited - non-tree edge, refine dominator
      const seenId = dstS.inRefIds[dstS.inRefIds.length - 1];
      dstS.inRefIds.push(link.srcS.id);

      // Walk up dominator chain from source until we find a node
      // already known to reach dstS
      let xS = link.srcS;
      while (xS.id > seenId) {
        xS = xS.domS;
      }

      const domId = xS.id;
      if (dstS.domS.id > domId) {
        // Need to move dstS's dominator up
        if (dstS.domS === dstS.oldDomS) {
          if (dstS.oldDomS.revisit === null) {
            dstS.oldDomS.revisit = [];
            revisitQueue.push(dstS.oldDomS);
          }
          dstS.oldDomS.revisit.push(dstS);
        }

        // Remove from old dominator's dominated list
        const idx = dstS.domS.dominated.indexOf(dstS);
        if (idx >= 0) {
          dstS.domS.dominated[idx] = dstS.domS.dominated[dstS.domS.dominated.length - 1];
          dstS.domS.dominated.pop();
        }

        // Walk up to find new dominator
        while (dstS.domS.id > domId) {
          dstS.domS = dstS.domS.domS;
        }
        dstS.domS.dominated.push(dstS);
      }
    }

    if (++dfsOps % 100000 === 0) {
      onProgress?.(`Dominators: DFS traversal (${nextId} nodes)...`, 70);
    }
  }

  const t1 = Date.now();
  onProgress?.(`Dominators: DFS done (${((t1 - t0) / 1000).toFixed(1)}s), ${nextId} nodes. Resolving...`, 75);

  // Helper: check if there's a path of ascending ids from srcS to dstS
  function isReachableAscending(srcS: NodeS, dstS: NodeS): boolean {
    if (dstS.id < srcS.id) {
      // dstS was seen before srcS. Check if srcS is on the DFS subtree
      // of any node with a direct reference to dstS.
      for (const refId of dstS.inRefIds) {
        if (refId >= srcS.id && refId <= srcS.maxReachableId) return true;
      }
      return false;
    }
    return dstS.id <= srcS.maxReachableId;
  }

  // Phase 2: Iteratively revisit until stable
  let head = 0;
  let revisitOps = 0;
  while (head < revisitQueue.length) {
    const oldDomS = revisitQueue[head++];
    const nodes = oldDomS.revisit!;
    oldDomS.revisit = null;

    for (let i = 0; i < oldDomS.dominated.length; i++) {
      const xS = oldDomS.dominated[i];
      for (let j = 0; j < nodes.length; j++) {
        const nodeS = nodes[j];
        if (isReachableAscending(nodeS, xS)) {
          // Update dominator for xS
          if (xS.domS === xS.oldDomS) {
            if (xS.oldDomS.revisit === null) {
              xS.oldDomS.revisit = [];
              revisitQueue.push(xS.oldDomS);
            }
            xS.oldDomS.revisit.push(xS);
          }
          // Remove xS from oldDomS.dominated
          oldDomS.dominated[i] = oldDomS.dominated[oldDomS.dominated.length - 1];
          oldDomS.dominated.pop();
          i--;
          xS.domS = nodeS.domS;
          xS.domS.dominated.push(xS);
          break;
        }
      }
    }

    for (const nodeS of nodes) {
      nodeS.oldDomS = oldDomS.oldDomS;
      if (nodeS.oldDomS !== nodeS.domS) {
        if (nodeS.oldDomS.revisit === null) {
          nodeS.oldDomS.revisit = [];
          revisitQueue.push(nodeS.oldDomS);
        }
        nodeS.oldDomS.revisit.push(nodeS);
      }
    }

    if (++revisitOps % 10000 === 0) {
      onProgress?.(`Dominators: resolving (${head}/${revisitQueue.length})...`, 75 + Math.min(8, (head / revisitQueue.length) * 8));
    }
  }

  const t2 = Date.now();
  onProgress?.(`Dominators: resolve done (${((t2 - t1) / 1000).toFixed(1)}s). Emitting...`, 83);

  // Phase 3: Emit results via BFS of the dominator tree
  const emitQueue: NodeS[] = [rootS];
  let emitHead = 0;
  while (emitHead < emitQueue.length) {
    const nodeS = emitQueue[emitHead++];
    stateMap.delete(nodeS.node);
    for (const xS of nodeS.dominated) {
      setDominator(xS.node, nodeS.node);
      emitQueue.push(xS);
    }
  }
}

// ─── Parser helpers ──────────────────────────────────────────────────────────

function readDeferredValue(hprof: HprofBuffer, type: number): DeferredFieldVal {
  switch (type) {
    case Type.OBJECT: return { _deferred: true, id: hprof.getId() };
    case Type.BOOLEAN: return hprof.getBool();
    case Type.CHAR: return hprof.getChar();
    case Type.FLOAT: return hprof.getFloat();
    case Type.DOUBLE: return hprof.getDouble();
    case Type.BYTE: return hprof.getByte();
    case Type.SHORT: return hprof.getShort();
    case Type.INT: return hprof.getInt();
    case Type.LONG: return hprof.getLong();
    default: throw new Error("Unsupported type: " + type);
  }
}

function readValue(hprof: HprofBuffer, type: number, instances: Map<number, AhatInstance>): FieldVal {
  switch (type) {
    case Type.OBJECT: return instances.get(hprof.getId()) ?? null;
    case Type.BOOLEAN: return hprof.getBool();
    case Type.CHAR: return hprof.getChar();
    case Type.FLOAT: return hprof.getFloat();
    case Type.DOUBLE: return hprof.getDouble();
    case Type.BYTE: return hprof.getByte();
    case Type.SHORT: return hprof.getShort();
    case Type.INT: return hprof.getInt();
    case Type.LONG: return hprof.getLong();
    default: throw new Error("Unsupported type: " + type);
  }
}

function readPrimitiveArray(hprof: HprofBuffer, type: number, length: number): PrimVal[] {
  const a: PrimVal[] = new Array(length);
  switch (type) {
    case Type.BOOLEAN: for (let i = 0; i < length; i++) a[i] = hprof.getBool(); break;
    case Type.CHAR: for (let i = 0; i < length; i++) a[i] = hprof.getChar(); break;
    case Type.FLOAT: for (let i = 0; i < length; i++) a[i] = hprof.getFloat(); break;
    case Type.DOUBLE: for (let i = 0; i < length; i++) a[i] = hprof.getDouble(); break;
    case Type.BYTE: for (let i = 0; i < length; i++) a[i] = hprof.getByte(); break;
    case Type.SHORT: for (let i = 0; i < length; i++) a[i] = hprof.getShort(); break;
    case Type.INT: for (let i = 0; i < length; i++) a[i] = hprof.getInt(); break;
    case Type.LONG: for (let i = 0; i < length; i++) a[i] = hprof.getLong(); break;
    default: throw new Error("Unsupported primitive type: " + type);
  }
  return a;
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

export type ProgressCallback = (msg: string, pct: number) => void;

export function parseHprof(buffer: ArrayBuffer, onProgress?: ProgressCallback): AhatSnapshot {
  const hprof = new HprofBuffer(buffer);
  let idSizeVal: number;

  // Read header
  while (hprof.getU1() !== 0) { /* consume format string */ }
  idSizeVal = hprof.getU4();
  if (idSizeVal === 8) hprof.setIdSize8();
  else if (idSizeVal !== 4) throw new Error("Unsupported id size: " + idSizeVal);
  hprof.getU4(); hprof.getU4(); // timestamps

  const rootSite = new SiteNode(null, "ROOT", "", "", 0);
  const instances: AhatInstance[] = [];
  const roots: { id: number; type: number }[] = [];

  // Heap management
  const heapsList: AhatHeap[] = [];
  let currentHeap: AhatHeap | null = null;
  function getCurrentHeap(): AhatHeap {
    if (!currentHeap) setCurrentHeap("default");
    return currentHeap!;
  }
  function setCurrentHeap(name: string) {
    for (const h of heapsList) if (h.name === name) { currentHeap = h; return; }
    currentHeap = new AhatHeap(name, heapsList.length);
    heapsList.push(currentHeap);
  }

  const strings = new Map<number, string>(); strings.set(0, "???");
  const frames = new Map<number, StackFrame>();
  const sites = new Map<number, SiteNode>();
  const classNamesBySerial = new Map<number, string>();
  let javaLangClass: AhatClassObj | null = null;
  const primArrayClasses: (AhatClassObj | null)[] = new Array(9).fill(null);
  const classes: AhatClassObj[] = [];
  let classById: Map<number, AhatClassObj> | null = null;

  onProgress?.("Reading HPROF file...", 0);
  const totalSize = hprof.size();
  let lastPct = 0;

  while (hprof.hasRemaining()) {
    const pct = Math.floor((hprof.tell() / totalSize) * 100);
    if (pct > lastPct + 4) { onProgress?.("Reading HPROF...", pct); lastPct = pct; }

    const tag = hprof.getU1();
    hprof.getU4(); // time
    const recordLength = hprof.getU4Unsigned();

    switch (tag) {
      case 0x01: { // STRING
        const sid = hprof.getId();
        const bytes = hprof.getBytes(recordLength - idSizeVal);
        strings.set(sid, new TextDecoder().decode(bytes));
        break;
      }
      case 0x02: { // LOAD CLASS
        const serial = hprof.getU4(); const objId = hprof.getId();
        hprof.getU4(); const nameId = hprof.getId();
        const className = normalizeClassName(strings.get(nameId) || "???");
        const classObj = new AhatClassObj(objId, className);
        classNamesBySerial.set(serial, className);
        classes.push(classObj);
        if (className === "java.lang.Class") javaLangClass = classObj;
        const tn = ["boolean[]","char[]","float[]","double[]","byte[]","short[]","int[]","long[]"];
        const tv = [Type.BOOLEAN,Type.CHAR,Type.FLOAT,Type.DOUBLE,Type.BYTE,Type.SHORT,Type.INT,Type.LONG];
        for (let i = 0; i < tn.length; i++) if (className === tn[i]) primArrayClasses[tv[i]] = classObj;
        break;
      }
      case 0x04: { // STACK FRAME
        const fid = hprof.getId();
        const mn = hprof.getId(); const ms = hprof.getId(); const fn = hprof.getId();
        const cs = hprof.getU4(); const ln = hprof.getU4();
        frames.set(fid, { method: strings.get(mn)||"???", signature: strings.get(ms)||"", filename: strings.get(fn)||"???", line: ln, className: classNamesBySerial.get(cs) || "" });
        break;
      }
      case 0x05: { // STACK TRACE
        const ss = hprof.getU4(); hprof.getU4(); const nf = hprof.getU4();
        const trace: StackFrame[] = [];
        for (let i = 0; i < nf; i++) { const f = frames.get(hprof.getId()); if (f) trace.push(f); }
        sites.set(ss, rootSite.getSite(trace));
        break;
      }
      case 0x0C: case 0x1C: { // HEAP DUMP / SEGMENT
        const end = hprof.tell() + recordLength;
        if (!classById) { classById = new Map(); for (const c of classes) classById.set(c.id, c); }
        while (hprof.tell() < end) {
          const st = hprof.getU1();
          switch (st) {
            case 0x01: { const o=hprof.getId(); hprof.getId(); roots.push({id:o,type:1<<0}); break; }
            case 0x02: { const o=hprof.getId(); hprof.getU4(); hprof.getU4(); roots.push({id:o,type:1<<1}); break; }
            case 0x03: { const o=hprof.getId(); hprof.getU4(); hprof.getU4(); roots.push({id:o,type:1<<2}); break; }
            case 0x04: { const o=hprof.getId(); hprof.getU4(); roots.push({id:o,type:1<<3}); break; }
            case 0x05: { roots.push({id:hprof.getId(),type:1<<4}); break; }
            case 0x06: { const o=hprof.getId(); hprof.getU4(); roots.push({id:o,type:1<<5}); break; }
            case 0x07: { roots.push({id:hprof.getId(),type:1<<6}); break; }
            case 0x08: { const o=hprof.getId(); hprof.getU4(); hprof.getU4(); roots.push({id:o,type:1<<7}); break; }
            case 0x20: { // CLASS DUMP
              const oid=hprof.getId(); const ss=hprof.getU4(); const superId=hprof.getId();
              const clId=hprof.getId(); hprof.getId(); hprof.getId(); hprof.getId(); hprof.getId();
              const is_=hprof.getU4(); const cps=hprof.getU2();
              for(let i=0;i<cps;i++){hprof.getU2();const t=hprof.getType();hprof.skip(typeSize(t,idSizeVal));}
              const ns=hprof.getU2(); const sfs:DeferredFieldValue[]=[]; const obj=classById!.get(oid); let sfz=0;
              for(let i=0;i<ns;i++){
                const fn=strings.get(hprof.getId())||"???"; const t=hprof.getType();
                const v=readDeferredValue(hprof,t); sfz+=typeSize(t,idSizeVal);
                sfs.push({name:fn,type:t,value:v});
              }
              const sup=classById!.get(superId)||null; const ni=hprof.getU2(); const ifs:Field[]=[];
              for(let i=0;i<ni;i++) ifs.push({name:strings.get(hprof.getId())||"???",type:hprof.getType()});
              const site=sites.get(ss)||rootSite;
              if(obj && javaLangClass){
                obj.init(getCurrentHeap(),site,javaLangClass);
                obj.superClassObj=sup; obj.instanceSize=is_; obj.instanceFields=ifs; obj.staticFieldsSize=sfz;
                obj.tempData={classLoaderId:clId,staticFields:sfs};
              }
              break;
            }
            case 0x21: { // INSTANCE DUMP
              const oid=hprof.getId(); const ss=hprof.getU4(); const cid=hprof.getId(); const nb=hprof.getU4();
              const pos=hprof.tell(); hprof.skip(nb);
              const o=new AhatClassInstance(oid);
              o.init(getCurrentHeap(),sites.get(ss)||rootSite,classById!.get(cid)||null);
              o.tempData={position:pos}; instances.push(o);
              break;
            }
            case 0x22: { // OBJ ARRAY
              const oid=hprof.getId(); const ss=hprof.getU4(); const len=hprof.getU4(); const cid=hprof.getId();
              const pos=hprof.tell(); hprof.skip(len*idSizeVal);
              const o=new AhatArrayInstance(oid,idSizeVal);
              o.init(getCurrentHeap(),sites.get(ss)||rootSite,classById!.get(cid)||null);
              o.tempData={length:len,position:pos}; instances.push(o);
              break;
            }
            case 0x23: { // PRIM ARRAY
              const oid=hprof.getId(); const ss=hprof.getU4(); const len=hprof.getU4(); const type=hprof.getPrimitiveType();
              const pc=primArrayClasses[type]; if(!pc) throw new Error("No class for "+TypeName[type]+"[]");
              const o=new AhatArrayInstance(oid,idSizeVal);
              o.init(getCurrentHeap(),sites.get(ss)||rootSite,pc);
              o.initPrimitive(type,readPrimitiveArray(hprof,type,len)); instances.push(o);
              break;
            }
            case 0x89: { roots.push({id:hprof.getId(),type:1<<8}); break; }
            case 0x8a: { roots.push({id:hprof.getId(),type:1<<13}); break; }
            case 0x8b: { roots.push({id:hprof.getId(),type:1<<9}); break; }
            case 0x8d: { roots.push({id:hprof.getId(),type:1<<10}); break; }
            case 0x8e: { const o=hprof.getId(); hprof.getU4(); hprof.getU4(); roots.push({id:o,type:1<<12}); break; }
            case 0xfe: { hprof.getU4(); const si=hprof.getId(); setCurrentHeap(strings.get(si)||"default"); break; }
            case 0xff: { roots.push({id:hprof.getId(),type:1<<11}); break; }
            default: throw new Error(`Unsupported heap sub tag 0x${st.toString(16)}`);
          }
        }
        break;
      }
      default: hprof.skip(recordLength); break;
    }
  }

  onProgress?.("Resolving references...", 50);

  // Build instance map
  const allInst = [...instances, ...classes];
  const instMap = new Map<number, AhatInstance>();
  for (const i of allInst) instMap.set(i.id, i);

  // Sort & process roots (merge-walk sorted roots against sorted instances)
  roots.sort((a, b) => a.id - b.id);

  const superRoot = new SuperRoot();
  let ri = 0;
  const sorted = [...allInst].sort((a, b) => a.id - b.id);

  for (const inst of sorted) {
    while (ri < roots.length && roots[ri].id < inst.id) ri++;
    if (ri < roots.length && roots[ri].id === inst.id) {
      superRoot.addRoot(inst);
      while (ri < roots.length && roots[ri].id === inst.id) { inst.addRootType(roots[ri].type); ri++; }
    }

    if (inst instanceof AhatClassInstance && inst.tempData) {
      const d = inst.tempData as ClassInstanceTempData; inst.tempData = null;
      const vals: FieldVal[] = [];
      hprof.seek(d.position);
      let cls = inst.classObj;
      while (cls) {
        for (const f of cls.instanceFields) vals.push(readValue(hprof, f.type, instMap));
        cls = cls.superClassObj;
      }
      inst.initFields(vals);
    } else if (inst instanceof AhatClassObj && inst.tempData) {
      const d = inst.tempData as ClassObjTempData; inst.tempData = null;
      inst.classLoader = instMap.get(d.classLoaderId) ?? null;
      for (const sf of d.staticFields) {
        const dv = sf.value;
        const val: FieldVal = (typeof dv === "object") ? (instMap.get(dv.id) ?? null) : dv;
        inst.staticFieldValues.push({ name: sf.name, type: sf.type, value: val });
      }
    } else if (inst instanceof AhatArrayInstance && inst.tempData) {
      const d = inst.tempData as ArrayInstanceTempData; inst.tempData = null;
      hprof.seek(d.position);
      const arr: (AhatInstance | null)[] = new Array(d.length);
      for (let i = 0; i < d.length; i++) arr[i] = instMap.get(hprof.getId()) ?? null;
      inst.initObjects(arr);
    }
  }

  // Attribute registered native sizes from NativeAllocationRegistry chains
  onProgress?.("Computing native sizes...", 55);
  let nativeCount = 0;
  for (const inst of allInst) {
    if (inst instanceof AhatClassInstance) {
      const nra = inst.asRegisteredNativeAllocation();
      if (nra) {
        nra.referent.registeredNativeSize += nra.size;
        nativeCount++;
      }
    }
  }
  if (nativeCount > 0) {
    console.log(`[hprof] Attributed native sizes from ${nativeCount} NativeAllocationRegistry entries`);
  }

  // ── Extract Bitmap DumpData (from `am dumpheap -b`) ───────────────────────
  let bitmapDumpData: BitmapDumpData | null = null;
  for (const [, inst] of instMap) {
    if (!(inst instanceof AhatClassObj) || inst.className !== "android.graphics.Bitmap") continue;
    const ddField = inst.staticFieldValues.find(f => f.name === "dumpData");
    if (!ddField) break;
    const ddInst = (ddField.value as AhatInstance | null)?.asClassInstance?.();
    if (!ddInst || !ddInst.isInstanceOfClass("android.graphics.Bitmap$DumpData")) break;
    const count = ddInst.getField("count");
    const format = ddInst.getField("format");
    if (typeof count !== "number" || typeof format !== "number" || count === 0) break;
    const nativesArr = ddInst.getRefField("natives")?.asArrayInstance?.();
    const buffersArr = ddInst.getRefField("buffers")?.asArrayInstance?.();
    if (!nativesArr || !buffersArr) break;

    const buffers = new Map<bigint, Uint8Array>();
    for (let i = 0; i < count; i++) {
      const nativeVal = nativesArr.values[i];
      const bufInst = buffersArr.values[i];
      if (nativeVal == null || !(bufInst instanceof AhatArrayInstance)) continue;
      const key = typeof nativeVal === "bigint" ? nativeVal : BigInt(nativeVal as number);
      const bytes = bufInst.values as number[];
      const u8 = new Uint8Array(bytes.length);
      for (let j = 0; j < bytes.length; j++) u8[j] = bytes[j] & 0xFF;
      buffers.set(key, u8);
    }
    bitmapDumpData = { format, buffers };
    console.log(`[hprof] Found BitmapDumpData: ${buffers.size} bitmaps, format=${format === 1 ? "PNG" : format === 0 ? "JPEG" : "WebP"}`);
    break;
  }

  onProgress?.("Computing reachability...", 60);

  // Reachability BFS
  const queues: Reference[][] = [];
  for (let r = 0; r <= 5; r++) queues.push([]);
  for (const ref of superRoot.getReferences()) queues[Reachability.STRONG].push(ref);

  for (let reach = 0; reach <= 5; reach++) {
    const q = queues[reach];
    let qi = 0;
    while (qi < q.length) {
      const ref = q[qi++];
      if (ref.ref.reachability === Reachability.UNREACHABLE) {
        ref.ref.reachability = reach;
        ref.ref.nextToGcRoot = ref.src;
        ref.ref.nextToGcRootField = ref.field;
        ref.ref.reverseRefs = [];
        for (const cr of ref.ref.getReferences()) {
          if (cr.reachability <= reach) q.push(cr);
          else queues[cr.reachability].push(cr);
        }
      }
      if (ref.src !== superRoot) ref.ref.reverseRefs.push(ref.src);
    }
  }

  // Post-process unreachable instances: compute reverse refs and sample paths
  // (ported from Java AhatSnapshot.java — "Compute references for unreachable instances too")
  for (const inst of allInst) {
    if (inst.reachability !== Reachability.UNREACHABLE) continue;
    for (const ref of inst.getReferences()) {
      if (!ref.ref.reverseRefs) ref.ref.reverseRefs = [];
      ref.ref.reverseRefs.push(ref.src);
      // Build sample paths with id-ordering to prevent cycles
      if (!ref.ref.nextToGcRoot && ref.src.id < ref.ref.id) {
        ref.ref.nextToGcRoot = ref.src;
        ref.ref.nextToGcRootField = ref.field;
      }
    }
  }

  onProgress?.("Computing dominators...", 70);

  const retained = Reachability.SOFT;
  for (const i of allInst) if (i.site) i.site.addInstance(i);

  computeDominators(
    superRoot,
    (node) => {
      const refs = node.getReferences();
      const result: AhatInstance[] = [];
      for (const r of refs) if (r.reachability <= retained) result.push(r.ref);
      return result;
    },
    (node, dominator) => { node.immediateDominator = dominator; dominator.dominated.push(node); },
    onProgress,
  );

  onProgress?.("Computing retained sizes...", 85);

  const numHeaps = heapsList.length;
  const stack: AhatInstance[] = [superRoot];
  while (stack.length > 0) {
    const i = stack[stack.length - 1];
    if (!i.retainedSizes) {
      i.retainedSizes = new Array(numHeaps).fill(null).map(() => ZERO_SIZE);
      if (!(i instanceof SuperRoot) && i.heap) {
        i.retainedSizes[i.heap.index] = i.retainedSizes[i.heap.index].plus(i.getSize());
      }
      for (const d of i.dominated) stack.push(d);
    } else {
      stack.pop();
      if (i.immediateDominator?.retainedSizes) {
        for (let h = 0; h < numHeaps; h++) {
          i.immediateDominator.retainedSizes[h] = i.immediateDominator.retainedSizes[h].plus(i.retainedSizes[h]);
        }
      }
    }
  }

  for (const heap of heapsList) heap.addToSize(superRoot.getRetainedSize(heap));
  rootSite.prepareForUse(0, numHeaps, retained);

  onProgress?.("Done!", 100);
  const snapshot = new AhatSnapshot(superRoot, instMap, heapsList, rootSite);
  snapshot.bitmapDumpData = bitmapDumpData;
  return snapshot;
}
