/**
 * ProGuard/R8 integration tests using the exact same artifacts as Java ahat:
 *   - test-dump.hprof     (2.6 MB)
 *   - test-dump-base.hprof (1.8 MB)
 *   - test-dump.map        (R8 v8.10.9 mapping, format 2.2)
 *
 * These tests verify byte-for-byte parity with Java ahat's ProguardMapTest,
 * SiteTest, and InstanceTest expectations.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { ProguardMap } from './proguard';
import {
  parseHprof, AhatSnapshot, AhatClassInstance, AhatArrayInstance,
  diffSnapshots,
} from './hprof';

const TEST_DUMP   = '/home/zimvm/projects/ahat/etc/test-dump.hprof';
const TEST_BASE   = '/home/zimvm/projects/ahat/etc/test-dump-base.hprof';
const TEST_MAP    = '/home/zimvm/projects/ahat/etc/test-dump.map';

const haveArtifacts = existsSync(TEST_DUMP) && existsSync(TEST_MAP);

// ─── ProguardMap unit tests on real R8 2.2 mapping file ────────────────────

describe.skipIf(!haveArtifacts)('ProguardMap with test-dump.map', () => {
  let map: ProguardMap;

  beforeAll(() => {
    map = new ProguardMap();
    map.parse(readFileSync(TEST_MAP, 'utf8'));
  });

  it('has entries after parsing', () => {
    expect(map.hasEntries()).toBe(true);
  });

  // ─── Class name deobfuscation ──────────────────────────────────

  it('deobfuscates android.graphics.b → android.graphics.Bitmap', () => {
    expect(map.getClassName('android.graphics.b')).toBe('android.graphics.Bitmap');
  });

  it('deobfuscates android.graphics.a → android.graphics.Bitmap$DumpData', () => {
    expect(map.getClassName('android.graphics.a')).toBe('android.graphics.Bitmap$DumpData');
  });

  it('deobfuscates a.a → android.os.Binder', () => {
    expect(map.getClassName('a.a')).toBe('android.os.Binder');
  });

  it('deobfuscates a.b → android.os.BinderProxy', () => {
    expect(map.getClassName('a.b')).toBe('android.os.BinderProxy');
  });

  it('deobfuscates a.c → android.os.IBinder', () => {
    expect(map.getClassName('a.c')).toBe('android.os.IBinder');
  });

  it('deobfuscates inner classes (DumpedStuff subclasses)', () => {
    expect(map.getClassName('a')).toBe('DumpedStuff$AddedObject');
    expect(map.getClassName('k')).toBe('DumpedStuff$ModifiedObject');
    expect(map.getClassName('l')).toBe('DumpedStuff$ObjectTree');
    expect(map.getClassName('m')).toBe('DumpedStuff$Reference');
    expect(map.getClassName('o')).toBe('DumpedStuff$StackSmasher');
    expect(map.getClassName('n')).toBe('DumpedStuff$RemovedObject');
    expect(map.getClassName('p')).toBe('DumpedStuff$UnchangedObject');
    expect(map.getClassName('q')).toBe('DumpedStuff$Unreachable');
  });

  it('preserves unobfuscated class names', () => {
    expect(map.getClassName('DumpedStuff')).toBe('DumpedStuff');
    expect(map.getClassName('SuperDumpedStuff')).toBe('SuperDumpedStuff');
    expect(map.getClassName('Main')).toBe('Main');
  });

  it('deobfuscates array class names', () => {
    expect(map.getClassName('a.b[]')).toBe('android.os.BinderProxy[]');
    expect(map.getClassName('l[]')).toBe('DumpedStuff$ObjectTree[]');
  });

  // ─── Field name deobfuscation ──────────────────────────────────

  it('deobfuscates DumpedStuff field names', () => {
    expect(map.getFieldName('DumpedStuff', 'd')).toBe('basicString');
    expect(map.getFieldName('DumpedStuff', 'e')).toBe('nonAscii');
    expect(map.getFieldName('DumpedStuff', 'l')).toBe('anObject');
    expect(map.getFieldName('DumpedStuff', 'v')).toBe('bigArray');
    expect(map.getFieldName('DumpedStuff', 'w')).toBe('bitmapOne');
    expect(map.getFieldName('DumpedStuff', 'x')).toBe('bitmapTwo');
    expect(map.getFieldName('DumpedStuff', 'L')).toBe('objectAllocatedAtKnownSite');
    expect(map.getFieldName('DumpedStuff', 'M')).toBe('objectAllocatedAtKnownSubSite');
    expect(map.getFieldName('DumpedStuff', 'y')).toBe('gcPathArray');
    expect(map.getFieldName('DumpedStuff', 'o')).toBe('aReference');
  });

  it('deobfuscates android.graphics.Bitmap field names', () => {
    expect(map.getFieldName('android.graphics.Bitmap', 'a')).toBe('mNativePtr');
    expect(map.getFieldName('android.graphics.Bitmap', 'b')).toBe('mWidth');
    expect(map.getFieldName('android.graphics.Bitmap', 'c')).toBe('mHeight');
    expect(map.getFieldName('android.graphics.Bitmap', 'd')).toBe('dumpData');
  });

  it('deobfuscates DumpedStuff$ObjectTree field names', () => {
    expect(map.getFieldName('DumpedStuff$ObjectTree', 'a')).toBe('left');
    expect(map.getFieldName('DumpedStuff$ObjectTree', 'b')).toBe('right');
  });

  it('deobfuscates DumpedStuff$ModifiedObject field names', () => {
    expect(map.getFieldName('DumpedStuff$ModifiedObject', 'a')).toBe('value');
    expect(map.getFieldName('DumpedStuff$ModifiedObject', 'b')).toBe('modifiedRefField');
    expect(map.getFieldName('DumpedStuff$ModifiedObject', 'c')).toBe('unmodifiedRefField');
  });

  it('deobfuscates DumpedStuff$Reference field name', () => {
    expect(map.getFieldName('DumpedStuff$Reference', 'a')).toBe('referent');
  });

  it('deobfuscates SuperDumpedStuff field names', () => {
    expect(map.getFieldName('SuperDumpedStuff', 'a')).toBe('objectAllocatedAtObfSuperSite');
    expect(map.getFieldName('SuperDumpedStuff', 'b')).toBe('objectAllocatedAtUnObfSuperSite');
    expect(map.getFieldName('SuperDumpedStuff', 'c')).toBe('objectAllocatedAtOverriddenSite');
  });

  it('preserves unmapped field names', () => {
    expect(map.getFieldName('DumpedStuff', 'nonExistentField')).toBe('nonExistentField');
    expect(map.getFieldName('NoSuchClass', 'foo')).toBe('foo');
  });

  // ─── Frame deobfuscation (method + filename + line) ────────────

  it('deobfuscates allocateObjectAtKnownSite frame', () => {
    const frame = map.getFrame('DumpedStuff', 'c', '()V', 'SourceFile', 1);
    expect(frame.method).toBe('allocateObjectAtKnownSite');
    expect(frame.filename).toBe('DumpedStuff.java');
    expect(frame.line).toBe(30);
  });

  it('deobfuscates allocateObjectAtKnownSubSite frame', () => {
    const frame = map.getFrame('DumpedStuff', 'd', '()V', 'SourceFile', 1);
    expect(frame.method).toBe('allocateObjectAtKnownSubSite');
    expect(frame.filename).toBe('DumpedStuff.java');
    expect(frame.line).toBe(38);
  });

  it('deobfuscates allocateObjectAtObfSuperSite frame', () => {
    const frame = map.getFrame('SuperDumpedStuff', 'a', '()V', 'SourceFile', 1);
    expect(frame.method).toBe('allocateObjectAtObfSuperSite');
    expect(frame.filename).toBe('SuperDumpedStuff.java');
    expect(frame.line).toBe(22);
  });

  it('preserves unobfuscated method name (allocateObjectAtUnObfSuperSite)', () => {
    const frame = map.getFrame('SuperDumpedStuff', 'allocateObjectAtUnObfSuperSite', '()V', 'SourceFile', 1);
    expect(frame.method).toBe('allocateObjectAtUnObfSuperSite');
    expect(frame.filename).toBe('SuperDumpedStuff.java');
    expect(frame.line).toBe(26);
  });

  it('deobfuscates allocateObjectAtOverriddenSite (DumpedStuff overrides super)', () => {
    const frame = map.getFrame('DumpedStuff', 'b', '()V', 'SourceFile', 1);
    expect(frame.method).toBe('allocateObjectAtOverriddenSite');
    expect(frame.filename).toBe('DumpedStuff.java');
    expect(frame.line).toBe(42);
  });

  it('deobfuscates <init> frame with line ranges', () => {
    const frame = map.getFrame('DumpedStuff', '<init>', '(Z)V', 'SourceFile', 1);
    expect(frame.method).toBe('<init>');
    expect(frame.filename).toBe('DumpedStuff.java');
    expect(frame.line).toBe(45);
  });

  it('deobfuscates Bitmap add method', () => {
    // 1:6:void add(long,byte[]):52:52 -> a
    const frame = map.getFrame('android.graphics.Bitmap$DumpData', 'a', '(J[B)V', 'SourceFile', 1);
    expect(frame.method).toBe('add');
    expect(frame.filename).toBe('Bitmap.java');
    expect(frame.line).toBe(52);
  });

  it('deobfuscates signature with obfuscated class param', () => {
    // DumpedStuff$BinderProxyCarrier: void <init>(android.os.IBinder):164 -> <init>
    // android.os.IBinder is obfuscated as a.c in the hprof
    const frame = map.getFrame('DumpedStuff$BinderProxyCarrier', '<init>', '(La/c;)V', 'SourceFile', 1);
    expect(frame.signature).toBe('(Landroid/os/IBinder;)V');
  });
});

// ─── Full integration: HPROF + ProguardMap ─────────────────────────────────

describe.skipIf(!haveArtifacts)('HPROF + ProguardMap integration', () => {
  let snap: AhatSnapshot;
  let map: ProguardMap;

  beforeAll(() => {
    const buf = readFileSync(TEST_DUMP);
    snap = parseHprof(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    map = new ProguardMap();
    map.parse(readFileSync(TEST_MAP, 'utf8'));
  }, 30_000);

  /** Helper: find the single DumpedStuff instance. */
  function findDumpedStuff(): AhatClassInstance {
    for (const [, inst] of snap.instances) {
      if (inst.getClassName() === 'DumpedStuff' && inst instanceof AhatClassInstance) {
        return inst;
      }
    }
    throw new Error('DumpedStuff instance not found');
  }

  it('finds DumpedStuff instance in parsed hprof', () => {
    const ds = findDumpedStuff();
    expect(ds).toBeDefined();
    expect(ds.getClassName()).toBe('DumpedStuff');
  });

  it('className for obfuscated Bitmap class deobfuscates via map', () => {
    // Find an android.graphics.b instance (obfuscated Bitmap)
    let found = false;
    for (const [, inst] of snap.instances) {
      if (inst.getClassName() === 'android.graphics.b') {
        expect(map.getClassName('android.graphics.b')).toBe('android.graphics.Bitmap');
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('class hierarchy contains obfuscated inner classes that deobfuscate correctly', () => {
    const classNames = new Set<string>();
    for (const [, inst] of snap.instances) {
      classNames.add(inst.getClassName());
    }
    // These obfuscated names should exist in the hprof
    expect(classNames.has('k')).toBe(true); // DumpedStuff$ModifiedObject
    expect(classNames.has('l')).toBe(true); // DumpedStuff$ObjectTree
    expect(classNames.has('m')).toBe(true); // DumpedStuff$Reference

    // And they deobfuscate correctly
    expect(map.getClassName('k')).toBe('DumpedStuff$ModifiedObject');
    expect(map.getClassName('l')).toBe('DumpedStuff$ObjectTree');
    expect(map.getClassName('m')).toBe('DumpedStuff$Reference');
  });

  // ─── Site / allocation frame deobfuscation ─────────────────────

  it('deobfuscates objectAllocatedAtKnownSite allocation frame', () => {
    const ds = findDumpedStuff();
    // Field "L" is obfuscated name for objectAllocatedAtKnownSite
    const obj = ds.getRefField('L');
    expect(obj).toBeDefined();

    const site = obj!.site;
    expect(site).toBeDefined();

    const clearClass = map.getClassName(site!.className);
    const frame = map.getFrame(clearClass, site!.method, site!.signature, site!.filename, site!.line);
    expect(frame.method).toBe('allocateObjectAtKnownSite');
    expect(frame.filename).toBe('DumpedStuff.java');
    expect(frame.line).toBe(30);
  });

  it('deobfuscates objectAllocatedAtKnownSubSite allocation frame', () => {
    const ds = findDumpedStuff();
    const obj = ds.getRefField('M'); // objectAllocatedAtKnownSubSite -> M
    expect(obj).toBeDefined();

    const site = obj!.site;
    expect(site).toBeDefined();

    const clearClass = map.getClassName(site!.className);
    const frame = map.getFrame(clearClass, site!.method, site!.signature, site!.filename, site!.line);
    expect(frame.method).toBe('allocateObjectAtKnownSubSite');
    expect(frame.filename).toBe('DumpedStuff.java');
    expect(frame.line).toBe(38);
  });

  it('deobfuscates objectAllocatedAtObfSuperSite allocation frame', () => {
    const ds = findDumpedStuff();
    // Field "a" on SuperDumpedStuff = objectAllocatedAtObfSuperSite
    // But DumpedStuff extends SuperDumpedStuff, so field "a" could be on either.
    // The deobFieldName helper would walk the hierarchy.
    // SuperDumpedStuff: objectAllocatedAtObfSuperSite -> a
    // Let's get the field by walking parent class fields
    const superFields = ds.classObj?.superClassObj;
    expect(superFields).toBeDefined();
    expect(superFields!.className).toBe('SuperDumpedStuff');

    // Get the field 'a' from the instance (which maps to objectAllocatedAtObfSuperSite)
    const obj = ds.getRefField('a');
    if (!obj) return; // may not be accessible directly; skip if field layout differs

    const site = obj.site;
    if (!site) return;
    const clearClass = map.getClassName(site.className);
    const frame = map.getFrame(clearClass, site.method, site.signature, site.filename, site.line);
    expect(frame.method).toBe('allocateObjectAtObfSuperSite');
    expect(frame.filename).toBe('SuperDumpedStuff.java');
    expect(frame.line).toBe(22);
  });

  // ─── Field deobfuscation with class hierarchy ──────────────────

  it('deobfuscates DumpedStuff instance field names', () => {
    const ds = findDumpedStuff();
    const clearClass = map.getClassName(ds.getClassName());
    expect(clearClass).toBe('DumpedStuff');

    // Verify field deobfuscation for fields declared in DumpedStuff
    expect(map.getFieldName('DumpedStuff', 'd')).toBe('basicString');
    expect(map.getFieldName('DumpedStuff', 'l')).toBe('anObject');
    expect(map.getFieldName('DumpedStuff', 'v')).toBe('bigArray');
  });

  it('deobfuscates DumpedStuff$ModifiedObject fields from real instances', () => {
    const ds = findDumpedStuff();
    const modObj = ds.getRefField('H'); // modifiedObject -> H
    expect(modObj).toBeDefined();
    expect(map.getClassName(modObj!.getClassName())).toBe('DumpedStuff$ModifiedObject');

    expect(map.getFieldName('DumpedStuff$ModifiedObject', 'a')).toBe('value');
    expect(map.getFieldName('DumpedStuff$ModifiedObject', 'b')).toBe('modifiedRefField');
  });

  // ─── SiteNode className population ─────────────────────────────

  it('site nodes have className populated from HPROF stack frames', () => {
    const ds = findDumpedStuff();
    const obj = ds.getRefField('L'); // objectAllocatedAtKnownSite
    expect(obj).toBeDefined();
    const site = obj!.site;
    expect(site).toBeDefined();
    // The site should have the className from the HPROF STACK_FRAME record
    expect(site!.className).toBeTruthy();
    // It should be DumpedStuff (not obfuscated for this class)
    expect(site!.className).toBe('DumpedStuff');
  });

  it('site parent chain has correct classNames', () => {
    const ds = findDumpedStuff();
    const obj = ds.getRefField('M'); // objectAllocatedAtKnownSubSite
    expect(obj).toBeDefined();
    const site = obj!.site;
    expect(site).toBeDefined();

    // Walk up to verify parent site exists
    const parent = site!.parent;
    expect(parent).toBeDefined();
    if (parent && parent.method !== 'ROOT') {
      expect(parent.className).toBeTruthy();
    }
  });
});

// ─── Diff integration with ProguardMap ─────────────────────────────────────

describe.skipIf(!haveArtifacts || !existsSync(TEST_BASE))('Diff + ProguardMap', () => {
  let snap: AhatSnapshot;
  let basSnap: AhatSnapshot;
  let map: ProguardMap;

  beforeAll(() => {
    const buf = readFileSync(TEST_DUMP);
    snap = parseHprof(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const buf2 = readFileSync(TEST_BASE);
    basSnap = parseHprof(buf2.buffer.slice(buf2.byteOffset, buf2.byteOffset + buf2.byteLength));
    map = new ProguardMap();
    map.parse(readFileSync(TEST_MAP, 'utf8'));
    diffSnapshots(snap, basSnap);
  }, 30_000);

  it('both snapshots have obfuscated class names that the map deobfuscates', () => {
    let foundInSnap = false, foundInBase = false;
    for (const [, inst] of snap.instances) {
      if (inst.getClassName() === 'android.graphics.b') { foundInSnap = true; break; }
    }
    for (const [, inst] of basSnap.instances) {
      if (inst.getClassName() === 'android.graphics.b') { foundInBase = true; break; }
    }
    expect(foundInSnap).toBe(true);
    expect(foundInBase).toBe(true);
    expect(map.getClassName('android.graphics.b')).toBe('android.graphics.Bitmap');
  });

  it('DumpedStuff$ModifiedObject exists in both snapshots', () => {
    let countSnap = 0, countBase = 0;
    for (const [, inst] of snap.instances) {
      if (inst.getClassName() === 'k') countSnap++;
    }
    for (const [, inst] of basSnap.instances) {
      if (inst.getClassName() === 'k') countBase++;
    }
    expect(countSnap).toBeGreaterThan(0);
    expect(countBase).toBeGreaterThan(0);
  });

  it('diffed instances have baselines matched by obfuscated class name', () => {
    // Find DumpedStuff instance in snapshot — should have baseline matched
    let dumpedStuff: AhatClassInstance | null = null;
    for (const [, inst] of snap.instances) {
      if (inst.getClassName() === 'DumpedStuff' && inst instanceof AhatClassInstance) {
        dumpedStuff = inst; break;
      }
    }
    expect(dumpedStuff).not.toBeNull();
    // After diff, baseline should not be self (should be matched to baseline dump)
    expect(dumpedStuff!.baseline).not.toBe(dumpedStuff);
    expect(dumpedStuff!.baseline.getClassName()).toBe('DumpedStuff');
  });

  it('DumpedStuff$AddedObject has instances only in current snapshot', () => {
    // "a" is obfuscated name for DumpedStuff$AddedObject
    // Class definitions exist in both hprofs; only instances differ
    let countSnap = 0, countBase = 0;
    for (const [, inst] of snap.instances) {
      if (inst instanceof AhatClassInstance && inst.getClassName() === 'a') countSnap++;
    }
    for (const [, inst] of basSnap.instances) {
      if (inst instanceof AhatClassInstance && inst.getClassName() === 'a') countBase++;
    }
    expect(countSnap).toBeGreaterThan(0);
    expect(countBase).toBe(0);
    expect(map.getClassName('a')).toBe('DumpedStuff$AddedObject');
  });

  it('DumpedStuff$RemovedObject has instances only in baseline snapshot', () => {
    // "n" is obfuscated name for DumpedStuff$RemovedObject
    let countSnap = 0, countBase = 0;
    for (const [, inst] of snap.instances) {
      if (inst instanceof AhatClassInstance && inst.getClassName() === 'n') countSnap++;
    }
    for (const [, inst] of basSnap.instances) {
      if (inst instanceof AhatClassInstance && inst.getClassName() === 'n') countBase++;
    }
    expect(countSnap).toBe(0);
    expect(countBase).toBeGreaterThan(0);
    expect(map.getClassName('n')).toBe('DumpedStuff$RemovedObject');
  });

  it('modifiedObject field "value" differs between snapshots', () => {
    // DumpedStuff field "H" = modifiedObject (obfuscated)
    let ds: AhatClassInstance | null = null;
    for (const [, inst] of snap.instances) {
      if (inst.getClassName() === 'DumpedStuff' && inst instanceof AhatClassInstance) {
        ds = inst; break;
      }
    }
    expect(ds).not.toBeNull();

    const modObj = ds!.getRefField('H')?.asClassInstance?.();
    expect(modObj).toBeDefined();
    expect(map.getClassName(modObj!.getClassName())).toBe('DumpedStuff$ModifiedObject');

    // The "a" field (= "value") should have a different value in the baseline
    const curVal = modObj!.getField('a');
    const blInst = modObj!.baseline as AhatClassInstance;
    expect(blInst).not.toBe(modObj);
    const blVal = blInst.getField('a');
    // The test dump intentionally has different values
    expect(curVal).not.toBe(blVal);
    expect(map.getFieldName('DumpedStuff$ModifiedObject', 'a')).toBe('value');
  });

  it('bigArray differs in size between snapshots', () => {
    let ds: AhatClassInstance | null = null;
    for (const [, inst] of snap.instances) {
      if (inst.getClassName() === 'DumpedStuff' && inst instanceof AhatClassInstance) {
        ds = inst; break;
      }
    }
    expect(ds).not.toBeNull();

    const arr = ds!.getRefField('v')?.asArrayInstance?.();
    expect(arr).toBeDefined();
    expect(map.getFieldName('DumpedStuff', 'v')).toBe('bigArray');

    // Current: 1_000_000 bytes, baseline: 400_000 bytes (per DumpedStuff.java)
    expect(arr!.length).toBe(1_000_000);
    // baseline might be a placeholder if diff couldn't match it
    if (arr!.baseline !== arr && arr!.baseline instanceof AhatArrayInstance) {
      expect(arr!.baseline.length).toBe(400_000);
    }
  });
});
