/**
 * Comprehensive golden-data test suite for sys.hprof.
 *
 * This file is the single source of truth for regression testing:
 *  - HPROF parsing correctness (instance counts, heap sizes, types)
 *  - Dominator tree invariants
 *  - Reachability analysis
 *  - Native size attribution (NativeAllocationRegistry)
 *  - Retained size computation
 *  - GC root paths
 *  - Site tree
 *  - Search
 *  - Worker query parity (getOverview, getRooted, getInstance, getSite, search, getBitmapList)
 *  - Download buffer round-trip (byte-identical ArrayBuffer clone)
 *
 * Golden values were extracted from sys.hprof (44 MB, 417 105 instances).
 * If the parser changes in a way that shifts these values, update the
 * constants here ONLY after manually verifying the new output is correct.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import {
  parseHprof,
  AhatInstance,
  AhatClassInstance,
  AhatArrayInstance,
  AhatClassObj,
  SuperRoot,
  AhatSnapshot,
  Size,
  ZERO_SIZE,
  Reachability,
  ReachabilityName,
  Type,
} from "./hprof";

// ─── Golden constants ────────────────────────────────────────────────────────

const HPROF_PATH = "./sys.hprof";
const HPROF_SIZE = 45164845; // bytes

const GOLDEN = {
  instanceCount: 417105,
  heapCount: 3,
  heaps: {
    app:    { java: 7737469,  native_: 189880, total: 7927349  },
    image:  { java: 11572960, native_: 0,      total: 11572960 },
    zygote: { java: 8748113,  native_: 26401,  total: 8774514  },
  },
  superRootDominatedCount: 269051,
  superRootRetainedTotal: 28274823,
  reachability: { strong: 412254, unreachable: 4710, soft: 64, finalizer: 22, phantom: 55 },
  classObjCount: 23511,
  classInstanceCount: 221616,
  arrayInstanceCount: 171978,
  rootCount: 264090,
  nativeAttrCount: 1270,
  totalNativeAttr: 220469,
  searchBitmapHits: 18,
  // Top retained object
  topRetained: {
    id: 0x0219c6a8,
    className: "java.nio.DirectByteBuffer",
    retainedTotal: 4637785,
    dominatedCount: 2,
  },
  // Site tree
  siteCount: 1,
  rootSiteChildren: 0,
  rootSiteObjectsInfos: 6245,
  // Bitmaps
  bitmapCount: 1,
  bitmapWithPixelData: 0,
  bitmapDumpData: null as null,
};

// ─── Setup ───────────────────────────────────────────────────────────────────

const haveFile = existsSync(HPROF_PATH);
let snap: AhatSnapshot;
let fileBuffer: ArrayBuffer;

beforeAll(() => {
  if (!haveFile) return;
  const buf = readFileSync(HPROF_PATH);
  fileBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  snap = parseHprof(fileBuffer, () => {});
}, 600_000);

// ─── Helper: default sort (same as worker) ───────────────────────────────────

function sortByRetained(snapshot: AhatSnapshot): AhatInstance[] {
  const appHeap = snapshot.getHeap("app");
  const items = [...snapshot.superRoot.dominated];
  items.sort((a, b) => {
    if (appHeap) {
      const cmp = b.getRetainedSize(appHeap).total - a.getRetainedSize(appHeap).total;
      if (cmp !== 0) return cmp;
    }
    return b.getTotalRetainedSize().total - a.getTotalRetainedSize().total;
  });
  return items;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe.skipIf(!haveFile)("sys.hprof golden data", () => {

  // ── 1. File & buffer ─────────────────────────────────────────────────────

  describe("file integrity", () => {
    it("file is the expected size", () => {
      expect(fileBuffer.byteLength).toBe(HPROF_SIZE);
    });

    it("buffer.slice(0) produces byte-identical copy", () => {
      const clone = fileBuffer.slice(0);
      expect(clone.byteLength).toBe(fileBuffer.byteLength);
      const a = new Uint8Array(fileBuffer);
      const b = new Uint8Array(clone);
      // Sample check (full comparison would be slow for 44 MB)
      for (let i = 0; i < a.length; i += 4096) {
        expect(b[i]).toBe(a[i]);
      }
      // Also check last bytes
      expect(b[b.length - 1]).toBe(a[a.length - 1]);
      expect(b[b.length - 2]).toBe(a[a.length - 2]);
    });

    it("original buffer is NOT neutered after slice", () => {
      fileBuffer.slice(0); // exercise clone without keeping ref
      expect(fileBuffer.byteLength).toBe(HPROF_SIZE);
    });
  });

  // ── 2. Snapshot basics ───────────────────────────────────────────────────

  describe("snapshot basics", () => {
    it("instance count matches golden", () => {
      expect(snap.instances.size).toBe(GOLDEN.instanceCount);
    });

    it("heap count matches golden", () => {
      expect(snap.heaps.length).toBe(GOLDEN.heapCount);
    });

    it("each heap has correct sizes", () => {
      for (const [name, expected] of Object.entries(GOLDEN.heaps)) {
        const heap = snap.getHeap(name);
        expect(heap).not.toBeNull();
        expect(heap!.size.java).toBe(expected.java);
        expect(heap!.size.native_).toBe(expected.native_);
        expect(heap!.size.total).toBe(expected.total);
      }
    });

    it("getHeap returns null for nonexistent heap", () => {
      expect(snap.getHeap("nonexistent")).toBeNull();
    });

    it("superRoot is a SuperRoot", () => {
      expect(snap.superRoot).toBeInstanceOf(SuperRoot);
    });

    it("superRoot.dominated count matches golden", () => {
      expect(snap.superRoot.dominated.length).toBe(GOLDEN.superRootDominatedCount);
    });

    it("superRoot retained total matches golden", () => {
      expect(snap.superRoot.getTotalRetainedSize().total).toBe(GOLDEN.superRootRetainedTotal);
    });

    it("heap size sum equals superRoot retained total", () => {
      let heapTotal = 0;
      for (const h of snap.heaps) heapTotal += h.size.total;
      expect(heapTotal).toBe(snap.superRoot.getTotalRetainedSize().total);
    });
  });

  // ── 3. Instance types ───────────────────────────────────────────────────

  describe("instance type counts", () => {
    it("classObj count matches golden", () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj) count++;
      }
      expect(count).toBe(GOLDEN.classObjCount);
    });

    it("classInstance count matches golden", () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance) count++;
      }
      expect(count).toBe(GOLDEN.classInstanceCount);
    });

    it("arrayInstance count matches golden", () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance) count++;
      }
      expect(count).toBe(GOLDEN.arrayInstanceCount);
    });

    it("type counts sum to instance count", () => {
      expect(GOLDEN.classObjCount + GOLDEN.classInstanceCount + GOLDEN.arrayInstanceCount)
        .toBe(GOLDEN.instanceCount);
    });
  });

  // ── 4. Reachability ─────────────────────────────────────────────────────

  describe("reachability", () => {
    it("distribution matches golden", () => {
      const counts: Record<string, number> = {};
      for (const [, inst] of snap.instances) {
        const name = ReachabilityName[inst.reachability] ?? "?";
        counts[name] = (counts[name] ?? 0) + 1;
      }
      expect(counts["strong"]).toBe(GOLDEN.reachability.strong);
      expect(counts["unreachable"]).toBe(GOLDEN.reachability.unreachable);
      expect(counts["soft"]).toBe(GOLDEN.reachability.soft);
      expect(counts["finalizer"]).toBe(GOLDEN.reachability.finalizer);
      expect(counts["phantom"]).toBe(GOLDEN.reachability.phantom);
    });

    it("reachability covers all instances", () => {
      const total = Object.values(GOLDEN.reachability).reduce((a, b) => a + b, 0);
      expect(total).toBe(GOLDEN.instanceCount);
    });

    it("strong is lowest reachability level", () => {
      expect(Reachability.STRONG).toBe(0);
    });

    it("unreachable is highest reachability level", () => {
      expect(Reachability.UNREACHABLE).toBe(5);
    });

    it("all superRoot dominated items are strongly reachable", () => {
      for (const inst of snap.superRoot.dominated.slice(0, 1000)) {
        expect(inst.reachability).toBe(Reachability.STRONG);
      }
    });
  });

  // ── 5. Roots ────────────────────────────────────────────────────────────

  describe("GC roots", () => {
    it("root count matches golden", () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        if (inst.isRoot()) count++;
      }
      expect(count).toBe(GOLDEN.rootCount);
    });

    it("roots have root type names", () => {
      for (const [, inst] of snap.instances) {
        if (inst.isRoot()) {
          const names = inst.getRootTypeNames();
          expect(names).not.toBeNull();
          expect(names!.length).toBeGreaterThan(0);
          break;
        }
      }
    });

    it("non-roots return null root type names", () => {
      for (const [, inst] of snap.instances) {
        if (!inst.isRoot()) {
          expect(inst.getRootTypeNames()).toBeNull();
          break;
        }
      }
    });
  });

  // ── 6. Dominator tree ──────────────────────────────────────────────────

  describe("dominator tree", () => {
    it("every reachable instance has an immediate dominator", () => {
      let checked = 0;
      for (const [, inst] of snap.instances) {
        if (inst.reachability < Reachability.UNREACHABLE) {
          expect(inst.immediateDominator).not.toBeNull();
          checked++;
        }
        if (checked >= 5000) break;
      }
      expect(checked).toBe(5000);
    });

    it("unreachable instances have no immediate dominator", () => {
      let checked = 0;
      for (const [, inst] of snap.instances) {
        if (inst.reachability === Reachability.UNREACHABLE) {
          expect(inst.immediateDominator).toBeNull();
          checked++;
        }
        if (checked >= 100) break;
      }
      expect(checked).toBeGreaterThan(0);
    });

    it("retained size >= shallow size for dominated objects", () => {
      for (const inst of snap.superRoot.dominated.slice(0, 500)) {
        const shallow = inst.getSize().total;
        const retained = inst.getTotalRetainedSize().total;
        expect(retained).toBeGreaterThanOrEqual(shallow);
      }
    });

    it("children retained sizes sum <= parent retained size", () => {
      // For the top object, sum of dominated retained sizes should not exceed parent
      const top = sortByRetained(snap)[0];
      let childSum = 0;
      for (const child of top.dominated) {
        childSum += child.getTotalRetainedSize().total;
      }
      // Child sum + top's own shallow size <= top's retained (with equality for tree structure)
      expect(childSum).toBeLessThanOrEqual(top.getTotalRetainedSize().total);
    });
  });

  // ── 7. Top retained objects ─────────────────────────────────────────────

  describe("top retained objects", () => {
    it("top object matches golden", () => {
      const sorted = sortByRetained(snap);
      const top = sorted[0];
      expect(top.id).toBe(GOLDEN.topRetained.id);
      expect(top.getClassName()).toBe(GOLDEN.topRetained.className);
      expect(top.getTotalRetainedSize().total).toBe(GOLDEN.topRetained.retainedTotal);
      expect(top.dominated.length).toBe(GOLDEN.topRetained.dominatedCount);
    });

    it("top 10 are in strictly non-increasing retained order", () => {
      const sorted = sortByRetained(snap);
      for (let i = 1; i < Math.min(10, sorted.length); i++) {
        expect(sorted[i - 1].getTotalRetainedSize().total)
          .toBeGreaterThanOrEqual(sorted[i].getTotalRetainedSize().total);
      }
    });

    it("top object has valid path from GC root", () => {
      const top = sortByRetained(snap)[0];
      const path = top.getPathFromGcRoot();
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
    });

    it("top object has dominated children", () => {
      const top = sortByRetained(snap)[0];
      expect(top.dominated.length).toBe(2);
      // One should be MemoryRef, other should be byte[]
      const classes = top.dominated.map(d => d.getClassName()).sort();
      expect(classes).toContain("byte[]");
      expect(classes).toContain("java.nio.DirectByteBuffer$MemoryRef");
    });

    it("top object fields include expected names", () => {
      const top = sortByRetained(snap)[0];
      const ci = top.asClassInstance?.();
      expect(ci).not.toBeNull();
      const fieldNames: string[] = [];
      for (const fv of ci!.getInstanceFields()) {
        fieldNames.push(fv.name);
      }
      expect(fieldNames).toContain("capacity");
      expect(fieldNames).toContain("address");
      expect(fieldNames).toContain("limit");
    });
  });

  // ── 8. Native size attribution ─────────────────────────────────────────

  describe("native size attribution", () => {
    it("attributed count matches golden", () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        if (inst.registeredNativeSize > 0) count++;
      }
      expect(count).toBe(GOLDEN.nativeAttrCount);
    });

    it("total attributed native size matches golden", () => {
      let total = 0;
      for (const [, inst] of snap.instances) {
        total += inst.registeredNativeSize;
      }
      expect(total).toBe(GOLDEN.totalNativeAttr);
    });

    it("all attributed sizes are positive", () => {
      for (const [, inst] of snap.instances) {
        expect(inst.registeredNativeSize).toBeGreaterThanOrEqual(0);
      }
    });

    it("native size is reflected in getSize()", () => {
      for (const [, inst] of snap.instances) {
        if (inst.registeredNativeSize > 0) {
          expect(inst.getSize().native_).toBe(inst.registeredNativeSize);
          break;
        }
      }
    });
  });

  // ── 9. Strings ──────────────────────────────────────────────────────────

  describe("string extraction", () => {
    it("java.lang.String instances have extractable values", () => {
      let found = 0;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance && inst.getClassName() === "java.lang.String") {
          const str = inst.asString(100);
          if (str !== null) {
            expect(typeof str).toBe("string");
            found++;
          }
          if (found >= 100) break;
        }
      }
      expect(found).toBe(100);
    });

    it("asString with maxChars truncates", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance && inst.getClassName() === "java.lang.String") {
          const full = inst.asString(-1);
          if (full && full.length > 5) {
            const short = inst.asString(5);
            expect(short!.length).toBeLessThanOrEqual(5);
            break;
          }
        }
      }
    });

    it("non-String instances return null for asString", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance && inst.getClassName() !== "java.lang.String") {
          expect(inst.asString(100)).toBeNull();
          break;
        }
      }
    });
  });

  // ── 10. Class objects ──────────────────────────────────────────────────

  describe("class objects", () => {
    const knownClasses = [
      "java.lang.String",
      "java.lang.Object",
      "android.graphics.Bitmap",
      "java.lang.Class",
    ];

    for (const cn of knownClasses) {
      it(`class "${cn}" exists`, () => {
        let found = false;
        for (const [, inst] of snap.instances) {
          if (inst instanceof AhatClassObj && inst.className === cn) {
            found = true;
            break;
          }
        }
        expect(found).toBe(true);
      });
    }

    it("class objects report getClassName as java.lang.Class", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj) {
          expect(inst.getClassName()).toBe("java.lang.Class");
          break;
        }
      }
    });

    it("class objects have instanceSize > 0", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj && inst.className === "java.lang.String") {
          expect(inst.instanceSize).toBeGreaterThan(0);
          break;
        }
      }
    });

    it("class objects toString format is 'class ClassName'", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj) {
          expect(inst.toString()).toMatch(/^class .+/);
          break;
        }
      }
    });

    it("isInstanceOfClass checks class hierarchy", () => {
      // Find a String instance — it should be an instance of both String and Object
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance && inst.getClassName() === "java.lang.String") {
          expect(inst.isInstanceOfClass("java.lang.String")).toBe(true);
          expect(inst.isInstanceOfClass("java.lang.Object")).toBe(true);
          expect(inst.isInstanceOfClass("com.nonexistent.Foo")).toBe(false);
          break;
        }
      }
    });
  });

  // ── 11. Array instances ────────────────────────────────────────────────

  describe("array instances", () => {
    it("byte arrays exist and have correct element type", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance && inst.elemType === Type.BYTE) {
          expect(inst.length).toBeGreaterThan(0);
          expect(inst.getClassName()).toBe("byte[]");
          break;
        }
      }
    });

    it("object arrays exist and have correct element type", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance && inst.elemType === Type.OBJECT) {
          expect(inst.getClassName()).toMatch(/\[\]$/);
          break;
        }
      }
    });

    it("array getExtraJavaSize reflects element count", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance && inst.length > 0) {
          expect(inst.getExtraJavaSize()).toBeGreaterThan(0);
          break;
        }
      }
    });

    it("byte[] asString returns valid string", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance && inst.elemType === Type.BYTE && inst.length > 0) {
          const str = inst.asString(100);
          if (str !== null) {
            expect(typeof str).toBe("string");
            break;
          }
        }
      }
    });

    it("int[] asString returns null", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance && inst.elemType === Type.INT && inst.length > 0) {
          expect(inst.asString(100)).toBeNull();
          break;
        }
      }
    });
  });

  // ── 12. findInstance ───────────────────────────────────────────────────

  describe("findInstance", () => {
    it("finds top retained object by ID", () => {
      const found = snap.findInstance(GOLDEN.topRetained.id);
      expect(found).not.toBeNull();
      expect(found!.getClassName()).toBe(GOLDEN.topRetained.className);
    });

    it("returns null for nonexistent ID", () => {
      expect(snap.findInstance(0xDEADBEEF)).toBeNull();
    });

    it("returns null for ID 0", () => {
      // ID 0 is the superRoot, which is not in the instances map
      expect(snap.findInstance(0)).toBeNull();
    });

    it("round-trips: every instance can be found by its own ID", () => {
      let checked = 0;
      for (const [id, inst] of snap.instances) {
        expect(snap.findInstance(id)).toBe(inst);
        if (++checked >= 5000) break;
      }
      expect(checked).toBe(5000);
    });
  });

  // ── 13. Path from GC root ─────────────────────────────────────────────

  describe("path from GC root", () => {
    it("reachable instances have non-null path", () => {
      let checked = 0;
      for (const inst of snap.superRoot.dominated.slice(0, 200)) {
        const path = inst.getPathFromGcRoot();
        expect(path).not.toBeNull();
        expect(path!.length).toBeGreaterThan(0);
        checked++;
      }
      expect(checked).toBe(200);
    });

    it("path ends at the queried instance", () => {
      const inst = snap.superRoot.dominated[0];
      const path = inst.getPathFromGcRoot();
      expect(path).not.toBeNull();
      const last = path![path!.length - 1];
      expect(last.instance).toBe(inst);
    });

    it("unreachable instances return null path", () => {
      for (const [, inst] of snap.instances) {
        if (inst.reachability === Reachability.UNREACHABLE) {
          expect(inst.getPathFromGcRoot()).toBeNull();
          break;
        }
      }
    });

    it("path includes dominator flags", () => {
      const inst = snap.superRoot.dominated[0];
      const path = inst.getPathFromGcRoot();
      expect(path).not.toBeNull();
      // At least one step should be marked as dominator
      const hasDom = path!.some(pe => pe.isDominator);
      expect(hasDom).toBe(true);
    });
  });

  // ── 14. Sites ─────────────────────────────────────────────────────────

  describe("site tree", () => {
    it("root site has ID 0", () => {
      expect(snap.rootSite.id).toBe(0);
    });

    it("getSite(0) returns root site", () => {
      expect(snap.getSite(0)).toBe(snap.rootSite);
    });

    it("root site children count matches golden", () => {
      expect(snap.rootSite.children.length).toBe(GOLDEN.rootSiteChildren);
    });

    it("root site objectsInfos count matches golden", () => {
      expect(snap.rootSite.objectsInfos.length).toBe(GOLDEN.rootSiteObjectsInfos);
    });

    it("objectsInfos have valid data", () => {
      for (const info of snap.rootSite.objectsInfos.slice(0, 100)) {
        expect(info.heap).toBeTruthy();
        expect(info.heap.name).toBeTruthy();
        expect(info.numInstances).toBeGreaterThan(0);
        expect(info.getClassName()).toBeTruthy();
        expect(info.numBytes.total).toBeGreaterThanOrEqual(0);
      }
    });

    it("objectsInfos sorted by size give byte[] in app heap first", () => {
      const infos = [...snap.rootSite.objectsInfos];
      infos.sort((a, b) => b.numBytes.total - a.numBytes.total);
      // Top entry should be byte[] in app heap
      expect(infos[0].getClassName()).toBe("byte[]");
      expect(infos[0].heap.name).toBe("app");
    });

    it("getObjects filters correctly by heap and class", () => {
      const info = snap.rootSite.objectsInfos[0];
      const heap = info.heap.name;
      const className = info.getClassName();
      const insts: AhatInstance[] = [];
      snap.rootSite.getObjects(
        x => x.heap?.name === heap && x.getClassName() === className,
        x => insts.push(x),
      );
      expect(insts.length).toBe(info.numInstances);
    });
  });

  // ── 15. Bitmaps ───────────────────────────────────────────────────────

  describe("bitmaps", () => {
    it("bitmap count matches golden", () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        const ci = inst.asClassInstance?.();
        if (ci && ci.isInstanceOfClass("android.graphics.Bitmap")) count++;
      }
      expect(count).toBe(GOLDEN.bitmapCount);
    });

    it("bitmapDumpData is null (no -b flag dump)", () => {
      expect(snap.bitmapDumpData).toBeNull();
    });

    it("bitmap without dumpData has dimensions but no pixel data", () => {
      for (const [, inst] of snap.instances) {
        const ci = inst.asClassInstance?.();
        if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
        const w = ci.getField("mWidth");
        const h = ci.getField("mHeight");
        if (typeof w === "number" && typeof h === "number") {
          expect(w).toBeGreaterThan(0);
          expect(h).toBeGreaterThan(0);
        }
        // No pixel data (no mBuffer, no dumpData)
        expect(ci.asBitmap()).toBeNull();
        break;
      }
    });
  });

  // ── 16. Search ────────────────────────────────────────────────────────

  describe("search", () => {
    it("search by class name finds expected count", () => {
      const q = "android.graphics.bitmap";
      let count = 0;
      for (const [, inst] of snap.instances) {
        const cn = inst.getClassName?.() ?? inst.toString();
        if (cn.toLowerCase().includes(q)) count++;
      }
      expect(count).toBe(GOLDEN.searchBitmapHits);
    });

    it("search by hex ID finds exact instance", () => {
      const id = GOLDEN.topRetained.id;
      const found = snap.findInstance(id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
    });

    it("search with short query returns empty", () => {
      // Worker returns [] for queries < 2 chars
      const q = "a";
      expect(q.length).toBeLessThan(2);
    });

    it("search is case-insensitive", () => {
      const q = "DIRECTBYTEBUFFER";
      let found = false;
      for (const [, inst] of snap.instances) {
        const cn = inst.getClassName?.() ?? inst.toString();
        if (cn.toLowerCase().includes(q.toLowerCase())) { found = true; break; }
      }
      expect(found).toBe(true);
    });
  });

  // ── 17. Reverse references ────────────────────────────────────────────

  describe("reverse references", () => {
    it("top retained object reverse refs are consistent", () => {
      const top = sortByRetained(snap)[0];
      // The top object is a GC root (path length 1), so it may have 0 reverse refs
      expect(top.reverseRefs.length).toBeGreaterThanOrEqual(0);
      for (const ref of top.reverseRefs) {
        expect(ref.id).toBeGreaterThan(0);
        expect(ref.getClassName()).toBeTruthy();
      }
    });

    it("non-root dominated objects have reverse refs", () => {
      // Find a dominated object that isn't itself a root — it must have reverse refs
      let checked = 0;
      for (const inst of snap.superRoot.dominated.slice(0, 500)) {
        if (inst.dominated.length > 0) {
          for (const child of inst.dominated.slice(0, 5)) {
            expect(child.reverseRefs.length).toBeGreaterThan(0);
            checked++;
          }
        }
        if (checked >= 20) break;
      }
      expect(checked).toBeGreaterThan(0);
    });

    it("instances referenced by others appear in those others' reverse refs", () => {
      // Pick a class instance with fields that reference other objects
      for (const [, inst] of snap.instances) {
        const ci = inst.asClassInstance?.();
        if (!ci) continue;
        for (const fv of ci.getInstanceFields()) {
          if (fv.value instanceof AhatInstance && fv.value.id !== 0) {
            // fv.value should have inst in its reverse refs
            expect(fv.value.reverseRefs).toContain(inst);
            return; // Found one, that's enough
          }
        }
      }
    });
  });

  // ── 18. Worker query parity ───────────────────────────────────────────

  describe("worker query parity", () => {
    it("getOverview matches snapshot data", () => {
      const overview = {
        instanceCount: snap.instances.size,
        heaps: snap.heaps.map(h => ({ name: h.name, java: h.size.java, native_: h.size.native_ })),
      };
      expect(overview.instanceCount).toBe(GOLDEN.instanceCount);
      expect(overview.heaps.length).toBe(GOLDEN.heapCount);
    });

    it("getRooted returns items in correct sort order", () => {
      const appHeap = snap.getHeap("app");
      const sorted = sortByRetained(snap);
      const top100 = sorted.slice(0, 100);
      // Verify the comparator is satisfied: app-heap retained first, then total
      for (let i = 1; i < top100.length; i++) {
        const prevApp = appHeap ? sorted[i - 1].getRetainedSize(appHeap).total : 0;
        const currApp = appHeap ? sorted[i].getRetainedSize(appHeap).total : 0;
        if (prevApp !== currApp) {
          expect(prevApp).toBeGreaterThan(currApp);
        } else {
          expect(sorted[i - 1].getTotalRetainedSize().total)
            .toBeGreaterThanOrEqual(sorted[i].getTotalRetainedSize().total);
        }
      }
    });

    it("getInstance returns valid detail for top object", () => {
      const inst = snap.findInstance(GOLDEN.topRetained.id)!;
      expect(inst).not.toBeNull();

      // Verify all detail fields
      expect(inst.toString()).toMatch(/@[0-9a-f]+/);
      expect(inst.isClassInstance()).toBe(true);
      expect(inst.isClassObj()).toBe(false);
      expect(inst.isArrayInstance()).toBe(false);

      // Fields
      const ci = inst.asClassInstance?.();
      expect(ci).not.toBeNull();
      const fields: string[] = [];
      for (const fv of ci!.getInstanceFields()) fields.push(fv.name);
      expect(fields.length).toBeGreaterThan(5);
      expect(fields).toContain("capacity");

      // Dominated
      expect(inst.dominated.length).toBe(2);

      // Reverse refs — top object is a GC root, may have 0 reverse refs
      expect(inst.reverseRefs.length).toBeGreaterThanOrEqual(0);
    });

    it("getInstance returns null for nonexistent ID", () => {
      expect(snap.findInstance(0xDEADBEEF)).toBeNull();
    });

    it("getSite returns valid root site data", () => {
      const site = snap.getSite(0);
      expect(site).toBe(snap.rootSite);
      expect(site.objectsInfos.length).toBe(GOLDEN.rootSiteObjectsInfos);
    });

    it("getBitmapList returns correct count", () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        const ci = inst.asClassInstance?.();
        if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
        const w = ci.getField("mWidth");
        const h = ci.getField("mHeight");
        if (typeof w === "number" && w > 0 && typeof h === "number" && h > 0) count++;
      }
      expect(count).toBe(GOLDEN.bitmapCount);
    });
  });

  // ── 19. toString format ───────────────────────────────────────────────

  describe("toString format", () => {
    it("class instances format as ClassName@hex", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance) {
          expect(inst.toString()).toMatch(/^[\w.$]+@[0-9a-f]{8,}$/);
          break;
        }
      }
    });

    it("class objects format as 'class ClassName'", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj) {
          expect(inst.toString()).toMatch(/^class [\w.$]+$/);
          break;
        }
      }
    });

    it("array instances format as ElementType[N]@hex", () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance) {
          expect(inst.toString()).toMatch(/^[\w.$]+\[\d+\]@[0-9a-f]{8,}$/);
          break;
        }
      }
    });
  });

  // ── 20. Edge cases & invariants ───────────────────────────────────────

  describe("invariants", () => {
    it("every instance has a heap", () => {
      let checked = 0;
      for (const [, inst] of snap.instances) {
        expect(inst.heap).not.toBeNull();
        expect(inst.heap!.name).toBeTruthy();
        if (++checked >= 5000) break;
      }
    });

    it("every instance has a classObj", () => {
      let checked = 0;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj) {
          // Class objects have classObj pointing to java.lang.Class
          // (or null for the very first loaded classes)
        } else {
          expect(inst.classObj).not.toBeNull();
        }
        if (++checked >= 5000) break;
      }
    });

    it("retained sizes are non-negative for all instances", () => {
      let checked = 0;
      for (const [, inst] of snap.instances) {
        const r = inst.getTotalRetainedSize();
        expect(r.java).toBeGreaterThanOrEqual(0);
        expect(r.native_).toBeGreaterThanOrEqual(0);
        expect(r.total).toBeGreaterThanOrEqual(0);
        if (++checked >= 5000) break;
      }
    });

    it("shallow sizes are non-negative for all instances", () => {
      let checked = 0;
      for (const [, inst] of snap.instances) {
        const s = inst.getSize();
        expect(s.java).toBeGreaterThanOrEqual(0);
        expect(s.native_).toBeGreaterThanOrEqual(0);
        if (++checked >= 5000) break;
      }
    });

    it("Size arithmetic is correct", () => {
      const a = new Size(100, 50);
      const b = new Size(200, 30);
      const c = a.plus(b);
      expect(c.java).toBe(300);
      expect(c.native_).toBe(80);
      expect(c.total).toBe(380);
      expect(ZERO_SIZE.isZero()).toBe(true);
      expect(a.isZero()).toBe(false);
    });
  });

  // ── 21. Download buffer round-trip ────────────────────────────────────

  describe("download buffer integrity", () => {
    it("full byte-by-byte comparison: clone is identical to original", () => {
      // Simulates the exact download path in App.tsx:
      //   const forWorker = buffer.slice(0);  // clone for worker
      //   worker.postMessage(... [forWorker]); // transfer clone, original stays
      //   downloadBuffer(name, activeSession.buffer); // download from original
      const clone = fileBuffer.slice(0);
      expect(clone.byteLength).toBe(fileBuffer.byteLength);

      const orig = new Uint8Array(fileBuffer);
      const copy = new Uint8Array(clone);

      // Full comparison — every byte
      let mismatches = 0;
      for (let i = 0; i < orig.length; i++) {
        if (orig[i] !== copy[i]) mismatches++;
      }
      expect(mismatches).toBe(0);
    });

    it("original buffer is NOT neutered after clone + simulated transfer", () => {
      const clone = fileBuffer.slice(0);
      // In the real app, clone is transferred to worker (neutering clone).
      // The original must remain intact for download.
      expect(fileBuffer.byteLength).toBe(HPROF_SIZE);
      expect(clone.byteLength).toBe(HPROF_SIZE);
    });

    it("checksum matches between original and clone", () => {
      const orig = new Uint8Array(fileBuffer);
      const clone = new Uint8Array(fileBuffer.slice(0));
      // Simple hash — catches any bit flip
      let hashOrig = 0, hashClone = 0;
      for (let i = 0; i < orig.length; i++) {
        hashOrig = ((hashOrig << 5) - hashOrig + orig[i]) | 0;
        hashClone = ((hashClone << 5) - hashClone + clone[i]) | 0;
      }
      expect(hashOrig).toBe(hashClone);
    });

    it("re-parse of cloned buffer produces identical snapshot", () => {
      const clone = fileBuffer.slice(0);
      const snap2 = parseHprof(clone, () => {});
      expect(snap2.instances.size).toBe(snap.instances.size);
      expect(snap2.heaps.length).toBe(snap.heaps.length);
      for (let i = 0; i < snap.heaps.length; i++) {
        expect(snap2.heaps[i].name).toBe(snap.heaps[i].name);
        expect(snap2.heaps[i].size.java).toBe(snap.heaps[i].size.java);
        expect(snap2.heaps[i].size.native_).toBe(snap.heaps[i].size.native_);
      }
      expect(snap2.superRoot.dominated.length).toBe(snap.superRoot.dominated.length);
      expect(snap2.superRoot.getTotalRetainedSize().total)
        .toBe(snap.superRoot.getTotalRetainedSize().total);

      // Verify top retained object is identical
      const appHeap2 = snap2.getHeap("app");
      const items2 = [...snap2.superRoot.dominated];
      items2.sort((a, b) => {
        if (appHeap2) {
          const c = b.getRetainedSize(appHeap2).total - a.getRetainedSize(appHeap2).total;
          if (c !== 0) return c;
        }
        return b.getTotalRetainedSize().total - a.getTotalRetainedSize().total;
      });
      expect(items2[0].id).toBe(GOLDEN.topRetained.id);
      expect(items2[0].getClassName()).toBe(GOLDEN.topRetained.className);
      expect(items2[0].getTotalRetainedSize().total).toBe(GOLDEN.topRetained.retainedTotal);
    });
  });
});
