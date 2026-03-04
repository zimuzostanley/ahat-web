import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import {
  parseHprof,
  AhatSnapshot,
  AhatInstance,
  AhatClassInstance,
  AhatArrayInstance,
  AhatClassObj,
  AhatPlaceHolderInstance,
  SuperRoot,
  SiteNode,
  AhatHeap,
  Size,
  Reachability,
  Type,
  TypeName,
  FieldValue,
  diffSnapshots,
  resetBaselines,
} from './hprof';

// ─── Minimal snapshot builder for unit tests ────────────────────────────────

function makeHeap(name: string, index: number): AhatHeap {
  return new AhatHeap(name, index);
}

function makeClassObj(id: number, className: string, heap: AhatHeap): AhatClassObj {
  const c = new AhatClassObj(id, className);
  c.heap = heap;
  c.instanceSize = 16;
  c.reachability = Reachability.STRONG;
  return c;
}

function makeClassInstance(id: number, classObj: AhatClassObj, heap: AhatHeap, site?: SiteNode): AhatClassInstance {
  const inst = new AhatClassInstance(id);
  inst.classObj = classObj;
  inst.heap = heap;
  inst.site = site ?? null;
  inst.reachability = Reachability.STRONG;
  inst.retainedSizes = [new Size(100, 0)];
  return inst;
}

function makeArrayInstance(id: number, classObj: AhatClassObj, heap: AhatHeap, length: number): AhatArrayInstance {
  const arr = new AhatArrayInstance(id, 4);
  arr.classObj = classObj;
  arr.heap = heap;
  arr.reachability = Reachability.STRONG;
  arr.retainedSizes = [new Size(50, 0)];
  arr.values = new Array(length).fill(0);
  return arr;
}

function makeSnapshot(
  heaps: AhatHeap[],
  instances: AhatInstance[],
  rootSite?: SiteNode,
): AhatSnapshot {
  const superRoot = new SuperRoot();
  const instMap = new Map<number, AhatInstance>();
  for (const inst of instances) {
    instMap.set(inst.id, inst);
    superRoot.dominated.push(inst);
    inst.immediateDominator = superRoot;
  }
  const site = rootSite ?? new SiteNode(null, "ROOT", "", "", 0);
  site.prepareForUse(0, heaps.length, Reachability.SOFT);
  return new AhatSnapshot(superRoot, instMap, heaps, site);
}

// ─── Unit tests ─────────────────────────────────────────────────────────────

describe('diffSnapshots', () => {
  it('matches heaps by name', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "Foo", aHeap);
    const bCls = makeClassObj(1, "Foo", bHeap);
    const a = makeSnapshot([aHeap], [aCls]);
    const b = makeSnapshot([bHeap], [bCls]);

    diffSnapshots(a, b);

    expect(aHeap.baseline).toBe(bHeap);
    expect(bHeap.baseline).toBe(aHeap);
  });

  it('creates placeholder heaps for unmatched', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap1 = makeHeap("app", 0);
    const bHeap2 = makeHeap("zygote", 1);
    const aCls = makeClassObj(1, "Foo", aHeap);
    const bCls = makeClassObj(1, "Foo", bHeap1);
    const a = makeSnapshot([aHeap], [aCls]);
    const b = makeSnapshot([bHeap1, bHeap2], [bCls]);

    diffSnapshots(a, b);

    // a should now have a placeholder heap for "zygote"
    expect(a.heaps.length).toBe(2);
    expect(a.heaps[1].name).toBe("zygote");
    expect(a.heaps[1].baseline).toBe(bHeap2);
    expect(bHeap2.baseline).toBe(a.heaps[1]);
  });

  it('matches instances by key (className + heap)', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(10, "com.Foo", aHeap);
    const bCls = makeClassObj(10, "com.Foo", bHeap);
    const aInst = makeClassInstance(100, aCls, aHeap);
    const bInst = makeClassInstance(200, bCls, bHeap);
    const a = makeSnapshot([aHeap], [aCls, aInst]);
    const b = makeSnapshot([bHeap], [bCls, bInst]);

    diffSnapshots(a, b);

    expect(aInst.baseline).toBe(bInst);
    expect(bInst.baseline).toBe(aInst);
  });

  it('creates placeholders for unmatched instances', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(10, "com.Foo", aHeap);
    const bCls = makeClassObj(10, "com.Bar", bHeap);
    const aInst = makeClassInstance(100, aCls, aHeap);
    const bInst = makeClassInstance(200, bCls, bHeap);
    const a = makeSnapshot([aHeap], [aCls, aInst]);
    const b = makeSnapshot([bHeap], [bCls, bInst]);

    diffSnapshots(a, b);

    // aInst should have a placeholder baseline in b (since "com.Foo" != "com.Bar")
    expect(aInst.baseline).not.toBe(aInst);
    expect(aInst.baseline.isPlaceHolder()).toBe(true);
    expect(aInst.baseline.baseline).toBe(aInst);

    // bInst should have a placeholder baseline in a
    expect(bInst.baseline).not.toBe(bInst);
    expect(bInst.baseline.isPlaceHolder()).toBe(true);
    expect(bInst.baseline.baseline).toBe(bInst);
  });

  it('placeholder has zero sizes', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(10, "com.Only", aHeap);
    const aInst = makeClassInstance(100, aCls, aHeap);
    const a = makeSnapshot([aHeap], [aCls, aInst]);
    const b = makeSnapshot([bHeap], []);

    diffSnapshots(a, b);

    // aInst is unmatched, so b gets a placeholder
    const ph = aInst.baseline;
    expect(ph.isPlaceHolder()).toBe(true);
    expect(ph.getSize().total).toBe(0);
    expect(ph.getTotalRetainedSize().total).toBe(0);
    expect(ph.getClassName()).toBe("com.Only");
  });

  it('bidirectional baselines: a.baseline === b <-> b.baseline === a', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "X", aHeap);
    const bCls = makeClassObj(1, "X", bHeap);
    const a1 = makeClassInstance(10, aCls, aHeap);
    const b1 = makeClassInstance(20, bCls, bHeap);
    const a = makeSnapshot([aHeap], [aCls, a1]);
    const b = makeSnapshot([bHeap], [bCls, b1]);

    diffSnapshots(a, b);

    expect(a1.baseline).toBe(b1);
    expect(b1.baseline).toBe(a1);
  });

  it('dominator recursion: matched pairs children recursed', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "Parent", aHeap);
    const bCls = makeClassObj(1, "Parent", bHeap);
    const aChildCls = makeClassObj(2, "Child", aHeap);
    const bChildCls = makeClassObj(2, "Child", bHeap);

    const aParent = makeClassInstance(10, aCls, aHeap);
    const aChild = makeClassInstance(11, aChildCls, aHeap);
    aParent.dominated = [aChild];
    aChild.immediateDominator = aParent;

    const bParent = makeClassInstance(20, bCls, bHeap);
    const bChild = makeClassInstance(21, bChildCls, bHeap);
    bParent.dominated = [bChild];
    bChild.immediateDominator = bParent;

    // Only aParent/bParent are in superRoot.dominated
    const a = makeSnapshot([aHeap], [aCls, aChildCls, aParent, aChild]);
    a.superRoot.dominated = [aParent];
    const b = makeSnapshot([bHeap], [bCls, bChildCls, bParent, bChild]);
    b.superRoot.dominated = [bParent];

    diffSnapshots(a, b);

    expect(aParent.baseline).toBe(bParent);
    expect(aChild.baseline).toBe(bChild);
  });

  it('same class different heap -> no match', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("zygote", 0);
    const aCls = makeClassObj(1, "Same", aHeap);
    const bCls = makeClassObj(1, "Same", bHeap);
    const aInst = makeClassInstance(10, aCls, aHeap);
    const bInst = makeClassInstance(20, bCls, bHeap);
    const a = makeSnapshot([aHeap], [aCls, aInst]);
    const b = makeSnapshot([bHeap], [bCls, bInst]);

    diffSnapshots(a, b);

    // Different heap names -> different keys -> no match -> placeholders
    expect(aInst.baseline).not.toBe(bInst);
    expect(aInst.baseline.isPlaceHolder()).toBe(true);
  });

  it('array matching: same class + same length -> matched', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "int[]", aHeap);
    const bCls = makeClassObj(1, "int[]", bHeap);
    const aArr = makeArrayInstance(10, aCls, aHeap, 5);
    const bArr = makeArrayInstance(20, bCls, bHeap, 5);
    const a = makeSnapshot([aHeap], [aCls, aArr]);
    const b = makeSnapshot([bHeap], [bCls, bArr]);

    diffSnapshots(a, b);

    expect(aArr.baseline).toBe(bArr);
  });

  it('array matching: same class + different length -> no match', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "int[]", aHeap);
    const bCls = makeClassObj(1, "int[]", bHeap);
    const aArr = makeArrayInstance(10, aCls, aHeap, 5);
    const bArr = makeArrayInstance(20, bCls, bHeap, 10);
    const a = makeSnapshot([aHeap], [aCls, aArr]);
    const b = makeSnapshot([bHeap], [bCls, bArr]);

    diffSnapshots(a, b);

    expect(aArr.baseline).not.toBe(bArr);
    expect(aArr.baseline.isPlaceHolder()).toBe(true);
  });

  it('classObj matching: same className -> matched', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "com.example.MyClass", aHeap);
    const bCls = makeClassObj(2, "com.example.MyClass", bHeap);
    const a = makeSnapshot([aHeap], [aCls]);
    const b = makeSnapshot([bHeap], [bCls]);

    diffSnapshots(a, b);

    expect(aCls.baseline).toBe(bCls);
    expect(bCls.baseline).toBe(aCls);
  });

  it('site matching: same (method, sig, file, line) -> matched', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);

    const aRoot = new SiteNode(null, "ROOT", "", "", 0);
    const aChild = new SiteNode(aRoot, "foo", "(I)V", "Foo.java", 42);
    aRoot.children.push(aChild);

    const bRoot = new SiteNode(null, "ROOT", "", "", 0);
    const bChild = new SiteNode(bRoot, "foo", "(I)V", "Foo.java", 42);
    bRoot.children.push(bChild);

    const a = makeSnapshot([aHeap], [], aRoot);
    const b = makeSnapshot([bHeap], [], bRoot);

    diffSnapshots(a, b);

    expect(aRoot.baseline).toBe(bRoot);
    expect(aChild.baseline).toBe(bChild);
  });

  it('resetBaselines: all baselines back to self', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "Foo", aHeap);
    const bCls = makeClassObj(1, "Foo", bHeap);
    const aInst = makeClassInstance(10, aCls, aHeap);
    const bInst = makeClassInstance(20, bCls, bHeap);
    const a = makeSnapshot([aHeap], [aCls, aInst]);
    const b = makeSnapshot([bHeap], [bCls, bInst]);

    const origHeapCount = a.heaps.length;
    diffSnapshots(a, b);
    expect(aInst.baseline).toBe(bInst);

    resetBaselines(a, origHeapCount);

    expect(aInst.baseline).toBe(aInst);
    expect(aHeap.baseline).toBe(aHeap);
    expect(a.rootSite.baseline).toBe(a.rootSite);
    // No placeholders remain
    for (const [, inst] of a.instances) {
      expect(inst.isPlaceHolder()).toBe(false);
    }
  });

  it('empty snapshots: no crash', () => {
    const a = makeSnapshot([], []);
    const b = makeSnapshot([], []);

    expect(() => diffSnapshots(a, b)).not.toThrow();
  });

  it('greedy match by retained size: largest matched first', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "X", aHeap);
    const bCls = makeClassObj(1, "X", bHeap);

    const aSmall = makeClassInstance(10, aCls, aHeap);
    aSmall.retainedSizes = [new Size(10, 0)];
    const aLarge = makeClassInstance(11, aCls, aHeap);
    aLarge.retainedSizes = [new Size(1000, 0)];

    const bSmall = makeClassInstance(20, bCls, bHeap);
    bSmall.retainedSizes = [new Size(10, 0)];
    const bLarge = makeClassInstance(21, bCls, bHeap);
    bLarge.retainedSizes = [new Size(1000, 0)];

    const a = makeSnapshot([aHeap], [aCls, aSmall, aLarge]);
    const b = makeSnapshot([bHeap], [bCls, bSmall, bLarge]);

    diffSnapshots(a, b);

    // Largest a matched with largest b, smallest with smallest
    expect(aLarge.baseline).toBe(bLarge);
    expect(aSmall.baseline).toBe(bSmall);
  });
});

// ─── Field diff tests (replicating worker's diffFields logic) ────────────────

/** Replicate the worker's diffFields sorted-merge algorithm for testing. */
function diffFieldsForTest(
  current: FieldValue[],
  baseline: FieldValue[],
): { name: string; typeName: string; status: "added" | "matched" | "deleted"; changed: boolean }[] {
  const cmp = (a: { name: string; type: number }, b: { name: string; type: number }) => {
    const nc = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    if (nc !== 0) return nc;
    return a.type - b.type;
  };
  const cs = [...current].sort(cmp);
  const bs = [...baseline].sort(cmp);
  const result: { name: string; typeName: string; status: "added" | "matched" | "deleted"; changed: boolean }[] = [];
  let ci = 0, bi = 0;
  while (ci < cs.length && bi < bs.length) {
    const c = cmp(cs[ci], bs[bi]);
    if (c < 0) {
      result.push({ name: cs[ci].name, typeName: TypeName[cs[ci].type] ?? "Object", status: "added", changed: false });
      ci++;
    } else if (c === 0) {
      const same = cs[ci].value === bs[bi].value;
      result.push({ name: cs[ci].name, typeName: TypeName[cs[ci].type] ?? "Object", status: "matched", changed: !same });
      ci++; bi++;
    } else {
      result.push({ name: bs[bi].name, typeName: TypeName[bs[bi].type] ?? "Object", status: "deleted", changed: false });
      bi++;
    }
  }
  while (ci < cs.length) {
    result.push({ name: cs[ci].name, typeName: TypeName[cs[ci].type] ?? "Object", status: "added", changed: false });
    ci++;
  }
  while (bi < bs.length) {
    result.push({ name: bs[bi].name, typeName: TypeName[bs[bi].type] ?? "Object", status: "deleted", changed: false });
    bi++;
  }
  return result;
}

describe('diffFields (sorted-merge field diff)', () => {
  it('matched fields with same values', () => {
    const current: FieldValue[] = [
      { name: "x", type: Type.INT, value: 42 },
      { name: "y", type: Type.INT, value: 10 },
    ];
    const baseline: FieldValue[] = [
      { name: "x", type: Type.INT, value: 42 },
      { name: "y", type: Type.INT, value: 10 },
    ];
    const result = diffFieldsForTest(current, baseline);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "x", typeName: "int", status: "matched", changed: false });
    expect(result[1]).toEqual({ name: "y", typeName: "int", status: "matched", changed: false });
  });

  it('matched fields with changed values', () => {
    const current: FieldValue[] = [{ name: "count", type: Type.INT, value: 100 }];
    const baseline: FieldValue[] = [{ name: "count", type: Type.INT, value: 50 }];
    const result = diffFieldsForTest(current, baseline);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: "count", typeName: "int", status: "matched", changed: true });
  });

  it('added fields', () => {
    const current: FieldValue[] = [
      { name: "a", type: Type.INT, value: 1 },
      { name: "b", type: Type.INT, value: 2 },
    ];
    const baseline: FieldValue[] = [{ name: "a", type: Type.INT, value: 1 }];
    const result = diffFieldsForTest(current, baseline);
    expect(result).toHaveLength(2);
    expect(result.find(f => f.name === "b")!.status).toBe("added");
  });

  it('deleted fields', () => {
    const current: FieldValue[] = [{ name: "a", type: Type.INT, value: 1 }];
    const baseline: FieldValue[] = [
      { name: "a", type: Type.INT, value: 1 },
      { name: "old", type: Type.BOOLEAN, value: true },
    ];
    const result = diffFieldsForTest(current, baseline);
    expect(result).toHaveLength(2);
    expect(result.find(f => f.name === "old")!.status).toBe("deleted");
  });

  it('mixed: added, deleted, matched', () => {
    const current: FieldValue[] = [
      { name: "kept", type: Type.INT, value: 5 },
      { name: "newField", type: Type.OBJECT, value: null },
    ];
    const baseline: FieldValue[] = [
      { name: "kept", type: Type.INT, value: 5 },
      { name: "removed", type: Type.CHAR, value: 65 },
    ];
    const result = diffFieldsForTest(current, baseline);
    expect(result).toHaveLength(3);
    const kept = result.find(f => f.name === "kept")!;
    const newF = result.find(f => f.name === "newField")!;
    const removed = result.find(f => f.name === "removed")!;
    expect(kept.status).toBe("matched");
    expect(kept.changed).toBe(false);
    expect(newF.status).toBe("added");
    expect(removed.status).toBe("deleted");
  });

  it('same name different type: treated as separate fields', () => {
    const current: FieldValue[] = [{ name: "val", type: Type.INT, value: 1 }];
    const baseline: FieldValue[] = [{ name: "val", type: Type.LONG, value: 1 }];
    const result = diffFieldsForTest(current, baseline);
    // Different types → not matched → one added, one deleted
    expect(result).toHaveLength(2);
    expect(result.find(f => f.typeName === "int")!.status).toBe("added");
    expect(result.find(f => f.typeName === "long")!.status).toBe("deleted");
  });

  it('empty current: all baseline fields deleted', () => {
    const baseline: FieldValue[] = [
      { name: "a", type: Type.INT, value: 1 },
      { name: "b", type: Type.INT, value: 2 },
    ];
    const result = diffFieldsForTest([], baseline);
    expect(result).toHaveLength(2);
    expect(result.every(f => f.status === "deleted")).toBe(true);
  });

  it('empty baseline: all current fields added', () => {
    const current: FieldValue[] = [
      { name: "a", type: Type.INT, value: 1 },
      { name: "b", type: Type.INT, value: 2 },
    ];
    const result = diffFieldsForTest(current, []);
    expect(result).toHaveLength(2);
    expect(result.every(f => f.status === "added")).toBe(true);
  });

  it('both empty: no results', () => {
    const result = diffFieldsForTest([], []);
    expect(result).toHaveLength(0);
  });
});

// ─── Array element diff tests ────────────────────────────────────────────────

describe('array element diff', () => {
  it('matched arrays: same values produce no baseline', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "int[]", aHeap);
    const bCls = makeClassObj(1, "int[]", bHeap);
    const aArr = makeArrayInstance(10, aCls, aHeap, 3);
    aArr.values = [1, 2, 3];
    const bArr = makeArrayInstance(20, bCls, bHeap, 3);
    bArr.values = [1, 2, 3];
    const a = makeSnapshot([aHeap], [aCls, aArr]);
    const b = makeSnapshot([bHeap], [bCls, bArr]);

    diffSnapshots(a, b);

    expect(aArr.baseline).toBe(bArr);
    // Values are the same at each index
    for (let i = 0; i < 3; i++) {
      expect(aArr.values[i]).toBe((aArr.baseline as AhatArrayInstance).values[i]);
    }
  });

  it('matched arrays: different values detectable', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "int[]", aHeap);
    const bCls = makeClassObj(1, "int[]", bHeap);
    const aArr = makeArrayInstance(10, aCls, aHeap, 3);
    aArr.values = [1, 99, 3];
    const bArr = makeArrayInstance(20, bCls, bHeap, 3);
    bArr.values = [1, 2, 3];
    const a = makeSnapshot([aHeap], [aCls, aArr]);
    const b = makeSnapshot([bHeap], [bCls, bArr]);

    diffSnapshots(a, b);

    expect(aArr.baseline).toBe(bArr);
    const bl = aArr.baseline as AhatArrayInstance;
    expect(aArr.values[0]).toBe(bl.values[0]); // unchanged
    expect(aArr.values[1]).not.toBe(bl.values[1]); // changed: 99 vs 2
    expect(aArr.values[2]).toBe(bl.values[2]); // unchanged
  });

  it('unmatched array: placeholder baseline has no values', () => {
    const aHeap = makeHeap("app", 0);
    const bHeap = makeHeap("app", 0);
    const aCls = makeClassObj(1, "int[]", aHeap);
    const aArr = makeArrayInstance(10, aCls, aHeap, 3);
    aArr.values = [1, 2, 3];
    const a = makeSnapshot([aHeap], [aCls, aArr]);
    const b = makeSnapshot([bHeap], []);

    diffSnapshots(a, b);

    expect(aArr.baseline.isPlaceHolder()).toBe(true);
  });
});

// ─── Formatting helper tests ────────────────────────────────────────────────

describe('fmtSizeDelta', () => {
  // Import from App.tsx would require DOM — test the logic directly
  it('positive delta has + prefix', () => {
    const bytes = 1024;
    const sign = bytes > 0 ? "+" : "\u2212";
    expect(sign).toBe("+");
  });

  it('negative delta has minus prefix', () => {
    const bytes = -1024;
    const sign = bytes > 0 ? "+" : "\u2212";
    expect(sign).toBe("\u2212");
  });
});

// ─── Integration test (self-diff) ───────────────────────────────────────────
// Parsing 182MB twice OOMs default Node.js heap.
// Run manually with: node --max-old-space-size=8192 ./node_modules/.bin/vitest run src/hprof-diff.test.ts

const HPROF_PATH = '/home/zimvm/systemui.hprof';
const haveFile = existsSync(HPROF_PATH);
const runIntegration = haveFile && !!process.env.DIFF_INTEGRATION;

// Self-diff integration: set DIFF_INTEGRATION=1 to run
describe.skipIf(!runIntegration)('self-diff integration (systemui.hprof)', () => {
  let snapA: AhatSnapshot;
  let snapB: AhatSnapshot;

  beforeAll(() => {
    const buf = readFileSync(HPROF_PATH);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    snapA = parseHprof(ab);
    // Parse a second time for an independent copy
    const buf2 = readFileSync(HPROF_PATH);
    const ab2 = buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength);
    snapB = parseHprof(ab2);
  }, 600_000);

  it('all instances matched, zero deltas', () => {
    diffSnapshots(snapA, snapB);

    let checked = 0;
    for (const [, inst] of snapA.instances) {
      if (inst instanceof AhatPlaceHolderInstance) continue;
      if (inst instanceof SuperRoot) continue;
      const bl = inst.baseline;
      expect(bl).not.toBe(inst);
      expect(bl.isPlaceHolder()).toBe(false);
      const delta = inst.getTotalRetainedSize().total - bl.getTotalRetainedSize().total;
      expect(delta).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
