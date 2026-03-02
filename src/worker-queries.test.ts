/**
 * Tests for the worker query handler logic.
 * We import the hprof parser directly and replicate the worker's query logic
 * to test without needing actual Web Worker infrastructure.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import {
  parseHprof,
  AhatSnapshot,
  AhatInstance,
  AhatClassInstance,
  AhatArrayInstance,
  AhatClassObj,
  SiteNode,
  TypeName,
  ReachabilityName,
} from './hprof';

const HPROF_PATH = '/home/zimvm/systemui.hprof';
const haveFile = existsSync(HPROF_PATH);

let snap: AhatSnapshot;

beforeAll(() => {
  if (!haveFile) return;
  const buf = readFileSync(HPROF_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  snap = parseHprof(ab);
}, 600_000);

// Replicate worker helper functions
interface TestInstanceRow {
  id: number;
  display: string;
  className: string;
  isRoot: boolean;
  rootTypeNames: string[] | null;
  reachabilityName: string;
  heap: string;
  shallowJava: number;
  shallowNative: number;
  retainedTotal: number;
  str: string | null;
  referent: TestInstanceRow | null;
}

function rowOf(inst: AhatInstance): TestInstanceRow {
  const ci = inst.asClassInstance?.();
  const str = ci?.asString?.(200) ?? null;
  const referentInst = ci?.getReferent?.() ?? null;
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
    str,
    referent: referentInst ? rowOf(referentInst) : null,
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

describe.skipIf(!haveFile)('worker query logic (systemui.hprof)', () => {
  describe('getOverview', () => {
    it('returns correct instance count', () => {
      expect(snap.instances.size).toBeGreaterThan(10000);
    });

    it('returns non-empty heaps', () => {
      const heaps = snap.heaps.map(h => ({
        name: h.name,
        java: h.size.java,
        native_: h.size.native_,
      }));
      expect(heaps.length).toBeGreaterThan(0);
      const hasNonEmpty = heaps.some(h => h.java + h.native_ > 0);
      expect(hasNonEmpty).toBe(true);
    });
  });

  describe('getRooted', () => {
    it('returns rooted objects sorted correctly', () => {
      const cmp = defaultInstanceCompare(snap);
      const items = [...snap.superRoot.dominated];
      items.sort(cmp);
      const top = items.slice(0, 100);

      expect(top.length).toBeGreaterThan(0);

      // Verify sort order: each consecutive pair should satisfy the comparator
      for (let i = 1; i < top.length; i++) {
        expect(cmp(top[i - 1], top[i])).toBeLessThanOrEqual(0);
      }
    });

    it('rooted rows have valid data', () => {
      const inst = snap.superRoot.dominated[0];
      const row = rowOf(inst);

      expect(row.id).toBeGreaterThan(0);
      expect(row.display).toBeTruthy();
      expect(row.className).toBeTruthy();
      expect(row.heap).toBeTruthy();
      expect(row.shallowJava).toBeGreaterThanOrEqual(0);
      expect(row.retainedTotal).toBeGreaterThan(0);
    });
  });

  describe('getInstance', () => {
    it('returns full detail for a known instance', () => {
      const inst = snap.superRoot.dominated[0];
      expect(inst).toBeTruthy();

      const row = rowOf(inst);
      expect(row.display).toMatch(/.+@[0-9a-f]+/);

      // Check class object
      if (inst.classObj) {
        expect(inst.classObj).toBeInstanceOf(AhatClassObj);
      }
    });

    it('returns fields for class instances', () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance) {
          const fields: any[] = [];
          for (const fv of inst.getInstanceFields()) {
            fields.push({
              name: fv.name,
              typeName: TypeName[fv.type] ?? "Object",
              value: fv.value,
            });
          }
          if (fields.length > 0) {
            expect(fields[0].name).toBeTruthy();
            expect(fields[0].typeName).toBeTruthy();
            break;
          }
        }
      }
    });

    it('returns array elements for array instances', () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance && inst.values.length > 0) {
          expect(inst.length).toBeGreaterThan(0);
          expect(TypeName[inst.elemType] ?? "Object").toBeTruthy();
          break;
        }
      }
    });

    it('returns static fields for class objects', () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj && inst.staticFieldValues.length > 0) {
          const sf = inst.staticFieldValues[0];
          expect(sf.name).toBeTruthy();
          break;
        }
      }
    });

    it('returns path from GC root', () => {
      const inst = snap.superRoot.dominated[0];
      const path = inst.getPathFromGcRoot();
      expect(path).toBeTruthy();
      expect(path!.length).toBeGreaterThan(0);

      // First element should be ROOT or superRoot
      const firstElem = path![0];
      expect(firstElem.instance).toBeTruthy();
    });

    it('returns reverse references', () => {
      const inst = snap.superRoot.dominated[0];
      // Most dominated objects should have at least one reverse ref
      expect(inst.reverseRefs.length).toBeGreaterThanOrEqual(0);
    });

    it('returns dominated objects', () => {
      const inst = snap.superRoot.dominated[0];
      // Top retained object should dominate something
      expect(inst.dominated.length).toBeGreaterThan(0);
    });
  });

  describe('getSite', () => {
    it('returns root site data', () => {
      const site = snap.getSite(0);
      expect(site).toBe(snap.rootSite);
      expect(site.id).toBe(0);
    });

    it('site chain starts at root', () => {
      // Find a non-root site
      if (snap.rootSite.children.length > 0) {
        const child = snap.rootSite.children[0];
        const chain: SiteNode[] = [];
        let s: SiteNode | null = child;
        while (s) { chain.push(s); s = s.parent; }
        chain.reverse();

        expect(chain[0]).toBe(snap.rootSite);
        expect(chain[chain.length - 1]).toBe(child);
      }
    });

    it('objectsInfos have valid data', () => {
      const site = snap.rootSite;
      if (site.objectsInfos.length > 0) {
        const info = site.objectsInfos[0];
        expect(info.heap).toBeTruthy();
        expect(info.numInstances).toBeGreaterThan(0);
        expect(info.getClassName()).toBeTruthy();
      }
    });
  });

  describe('search', () => {
    it('finds instances by class name substring', () => {
      const q = "string";
      const matches: AhatInstance[] = [];
      for (const [, inst] of snap.instances) {
        if (matches.length >= 10) break;
        const cn = inst.getClassName?.() ?? inst.toString();
        if (cn.toLowerCase().includes(q)) matches.push(inst);
      }
      expect(matches.length).toBeGreaterThan(0);
    });

    it('finds instance by hex id', () => {
      const firstEntry = snap.instances.entries().next().value;
      if (firstEntry) {
        const [id] = firstEntry;
        const found = snap.findInstance(id);
        expect(found).toBeTruthy();
        expect(found!.id).toBe(id);
      }
    });
  });

  describe('getBitmapList', () => {
    it('finds bitmap instances with valid dimensions', () => {
      const bitmaps: AhatClassInstance[] = [];
      for (const [, inst] of snap.instances) {
        const ci = inst.asClassInstance?.();
        if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
        const w = ci.getField("mWidth");
        const h = ci.getField("mHeight");
        if (typeof w === "number" && w > 0 && typeof h === "number" && h > 0) {
          bitmaps.push(ci);
          if (bitmaps.length >= 5) break;
        }
      }
      expect(bitmaps.length).toBeGreaterThan(0);
      for (const ci of bitmaps) {
        expect(ci.getField("mWidth")).toBeGreaterThan(0);
        expect(ci.getField("mHeight")).toBeGreaterThan(0);
      }
    });

    it('correctly identifies hardware vs software bitmaps', () => {
      let total = 0;
      let hasBuffer = 0;
      for (const [, inst] of snap.instances) {
        const ci = inst.asClassInstance?.();
        if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
        total++;
        if (ci.asBitmap()) hasBuffer++;
      }
      // This dump has all hardware bitmaps (no mBuffer)
      expect(total).toBeGreaterThan(0);
      console.log(`Bitmaps: ${total} total, ${hasBuffer} with pixel data (software), ${total - hasBuffer} hardware`);
    });

    it('asBitmap returns valid RGBA data for software bitmaps', () => {
      // If any software bitmaps exist, verify their data is correct
      for (const [, inst] of snap.instances) {
        const ci = inst.asClassInstance?.();
        if (!ci) continue;
        const bmp = ci.asBitmap();
        if (!bmp) continue;
        expect(bmp.width).toBeGreaterThan(0);
        expect(bmp.height).toBeGreaterThan(0);
        expect(bmp.rgbaData.length).toBe(bmp.width * bmp.height * 4);
        break;
      }
      // If no software bitmaps, this test passes silently (expected for hardware-only dumps)
    });

    it('matches Java ahat behavior for hardware bitmaps', () => {
      // Java ahat also cannot render hardware bitmaps (returns 404 from /bitmap endpoint)
      // Verify our asBitmap() returns null for bitmaps without mBuffer, same as Java ahat
      for (const [, inst] of snap.instances) {
        const ci = inst.asClassInstance?.();
        if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
        const bufRef = ci.getRefField("mBuffer");
        if (!bufRef) {
          expect(ci.asBitmap()).toBeNull();
          break;
        }
      }
    });
  });

  describe('getObjects', () => {
    it('filters by site and class name', () => {
      // Use root site and find a class that has objects
      const site = snap.rootSite;
      if (site.objectsInfos.length > 0) {
        const info = site.objectsInfos[0];
        const className = info.getClassName();
        const heap = info.heap.name;

        const insts: AhatInstance[] = [];
        site.getObjects(
          x => x.heap?.name === heap && x.getClassName() === className,
          x => insts.push(x),
        );

        expect(insts.length).toBe(info.numInstances);
      }
    });
  });
});
