import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import {
  parseHprof,
  AhatSnapshot,
  AhatClassInstance,
  AhatArrayInstance,
  AhatClassObj,
  SuperRoot,
  SiteNode,
  Type,
  TypeName,
  Reachability,
  ReachabilityName,
  Size,
  ZERO_SIZE,
} from './hprof';

const HPROF_PATH = '/home/zimvm/systemui.hprof';
const haveFile = existsSync(HPROF_PATH);

// Parse once, reuse across all tests
let snap: AhatSnapshot;

beforeAll(() => {
  if (!haveFile) return;
  const buf = readFileSync(HPROF_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  snap = parseHprof(ab, (_msg, _pct) => {
    // silent
  });
}, 600_000); // 10 minute timeout for parsing

describe.skipIf(!haveFile)('hprof parser (systemui.hprof)', () => {
  describe('snapshot basics', () => {
    it('has instances', () => {
      expect(snap.instances.size).toBeGreaterThan(0);
    });

    it('has heaps', () => {
      expect(snap.heaps.length).toBeGreaterThan(0);
      for (const h of snap.heaps) {
        expect(h.name).toBeTruthy();
        expect(h.index).toBeGreaterThanOrEqual(0);
      }
    });

    it('has a superRoot', () => {
      expect(snap.superRoot).toBeInstanceOf(SuperRoot);
      expect(snap.superRoot.dominated.length).toBeGreaterThan(0);
    });

    it('has a rootSite', () => {
      expect(snap.rootSite).toBeInstanceOf(SiteNode);
      expect(snap.rootSite.id).toBe(0);
    });

    it('getHeap returns correct heap', () => {
      for (const h of snap.heaps) {
        expect(snap.getHeap(h.name)).toBe(h);
      }
      expect(snap.getHeap("nonexistent")).toBeNull();
    });
  });

  describe('instance types', () => {
    it('has AhatClassObj instances', () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj) { count++; break; }
      }
      expect(count).toBeGreaterThan(0);
    });

    it('has AhatClassInstance instances', () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance) { count++; break; }
      }
      expect(count).toBeGreaterThan(0);
    });

    it('has AhatArrayInstance instances', () => {
      let count = 0;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatArrayInstance) { count++; break; }
      }
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('reachability', () => {
    it('rooted objects are strongly reachable', () => {
      for (const inst of snap.superRoot.dominated.slice(0, 100)) {
        expect(inst.reachability).toBeLessThanOrEqual(Reachability.SOFT);
      }
    });

    it('all instances have a reachability level', () => {
      let checked = 0;
      for (const [, inst] of snap.instances) {
        expect(inst.reachability).toBeGreaterThanOrEqual(Reachability.STRONG);
        expect(inst.reachability).toBeLessThanOrEqual(Reachability.UNREACHABLE);
        if (++checked >= 10000) break; // sample to avoid timeout
      }
      expect(checked).toBe(10000);
    });
  });

  describe('dominator tree', () => {
    it('every non-root instance has an immediate dominator', () => {
      let checked = 0;
      for (const [, inst] of snap.instances) {
        if (inst.immediateDominator === null) {
          // Instance is unreachable
          expect(inst.reachability).toBe(Reachability.UNREACHABLE);
        } else {
          checked++;
        }
        if (checked > 1000) break;
      }
      expect(checked).toBeGreaterThan(0);
    });

    it('retained sizes are non-negative', () => {
      for (const inst of snap.superRoot.dominated.slice(0, 100)) {
        const retained = inst.getTotalRetainedSize();
        expect(retained.total).toBeGreaterThanOrEqual(0);
      }
    });

    it('retained size >= shallow size for reachable instances', () => {
      for (const inst of snap.superRoot.dominated.slice(0, 100)) {
        const shallow = inst.getSize();
        const retained = inst.getTotalRetainedSize();
        expect(retained.total).toBeGreaterThanOrEqual(shallow.total);
      }
    });

    it('superRoot retained size = sum of all heap sizes', () => {
      const rootRetained = snap.superRoot.getTotalRetainedSize();
      let heapTotal = 0;
      for (const h of snap.heaps) {
        heapTotal += h.size.total;
      }
      // These should be equal
      expect(rootRetained.total).toBe(heapTotal);
    });
  });

  describe('findInstance', () => {
    it('finds existing instances by id', () => {
      const firstEntry = snap.instances.entries().next().value;
      if (firstEntry) {
        const [id, inst] = firstEntry;
        const found = snap.findInstance(id);
        expect(found).toBe(inst);
      }
    });

    it('returns null for non-existing id', () => {
      expect(snap.findInstance(0xFFFFFFFF)).toBeNull();
    });
  });

  describe('toString format', () => {
    it('formats as ClassName@hexId', () => {
      for (const [, inst] of snap.instances) {
        const str = inst.toString();
        expect(str).toMatch(/.+@[0-9a-f]{8,}/);
        break;
      }
    });
  });

  describe('class objects', () => {
    it('java.lang.String class exists', () => {
      let found = false;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj && inst.className === "java.lang.String") {
          found = true;
          expect(inst.instanceSize).toBeGreaterThan(0);
          break;
        }
      }
      expect(found).toBe(true);
    });

    it('class objects have className', () => {
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassObj) {
          expect(inst.className).toBeTruthy();
          break;
        }
      }
    });
  });

  describe('strings', () => {
    it('can extract string values from java.lang.String instances', () => {
      let found = false;
      for (const [, inst] of snap.instances) {
        if (inst instanceof AhatClassInstance && inst.getClassName() === "java.lang.String") {
          const str = inst.asString(100);
          if (str !== null) {
            found = true;
            expect(typeof str).toBe("string");
            break;
          }
        }
      }
      expect(found).toBe(true);
    });
  });

  describe('path from GC root', () => {
    it('rooted instances have a path from GC root', () => {
      const inst = snap.superRoot.dominated[0];
      const path = inst.getPathFromGcRoot();
      expect(path).toBeTruthy();
      expect(path!.length).toBeGreaterThan(0);
    });
  });

  describe('sites', () => {
    it('root site has id 0', () => {
      expect(snap.rootSite.id).toBe(0);
    });

    it('getSite returns root for id 0', () => {
      expect(snap.getSite(0)).toBe(snap.rootSite);
    });

    it('root site has children or objects', () => {
      expect(
        snap.rootSite.children.length > 0 || snap.rootSite.objects.length > 0
      ).toBe(true);
    });

    it('sites have unique ids', () => {
      const ids = new Set<number>();
      const queue: SiteNode[] = [snap.rootSite];
      while (queue.length > 0) {
        const s = queue.pop()!;
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        queue.push(...s.children);
      }
    });
  });

  describe('sort order parity', () => {
    it('rooted objects with app heap should sort by app heap first', () => {
      const appHeap = snap.getHeap("app");
      if (!appHeap) return; // skip if no app heap

      const items = [...snap.superRoot.dominated];
      items.sort((a, b) => {
        const cmp = b.getRetainedSize(appHeap).total - a.getRetainedSize(appHeap).total;
        if (cmp !== 0) return cmp;
        return b.getTotalRetainedSize().total - a.getTotalRetainedSize().total;
      });

      // Verify first item has largest app-heap retained size
      if (items.length >= 2) {
        const first = items[0].getRetainedSize(appHeap).total;
        const second = items[1].getRetainedSize(appHeap).total;
        expect(first).toBeGreaterThanOrEqual(second);
      }
    });
  });
});

describe('hprof types', () => {
  it('Type constants are correct', () => {
    expect(Type.OBJECT).toBe(0);
    expect(Type.BOOLEAN).toBe(1);
    expect(Type.CHAR).toBe(2);
    expect(Type.INT).toBe(7);
    expect(Type.LONG).toBe(8);
  });

  it('TypeName maps correctly', () => {
    expect(TypeName[Type.OBJECT]).toBe("Object");
    expect(TypeName[Type.INT]).toBe("int");
    expect(TypeName[Type.LONG]).toBe("long");
  });

  it('Reachability constants are ordered', () => {
    expect(Reachability.STRONG).toBeLessThan(Reachability.SOFT);
    expect(Reachability.SOFT).toBeLessThan(Reachability.FINALIZER);
    expect(Reachability.FINALIZER).toBeLessThan(Reachability.WEAK);
    expect(Reachability.WEAK).toBeLessThan(Reachability.PHANTOM);
    expect(Reachability.PHANTOM).toBeLessThan(Reachability.UNREACHABLE);
  });

  it('ReachabilityName maps correctly', () => {
    expect(ReachabilityName[Reachability.STRONG]).toBe("strong");
    expect(ReachabilityName[Reachability.UNREACHABLE]).toBe("unreachable");
  });

  it('Size arithmetic works', () => {
    const a = new Size(100, 50);
    const b = new Size(200, 30);
    const c = a.plus(b);
    expect(c.java).toBe(300);
    expect(c.native_).toBe(80);
    expect(c.total).toBe(380);
  });

  it('Size.isZero works', () => {
    expect(new Size(0, 0).isZero()).toBe(true);
    expect(new Size(1, 0).isZero()).toBe(false);
    expect(ZERO_SIZE.isZero()).toBe(true);
  });
});
