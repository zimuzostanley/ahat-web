/**
 * Tests for BitmapDumpData extraction and asBitmap() with compressed pixel data.
 * Requires systemui_bitmap.hprof (dumped with `am dumpheap -b png`).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import {
  parseHprof,
  AhatSnapshot,
  AhatClassInstance,
} from './hprof';

const HPROF_PATH = '/home/zimvm/projects/systemui_bitmap.hprof';
const haveFile = existsSync(HPROF_PATH);

let snap: AhatSnapshot;

beforeAll(() => {
  if (!haveFile) return;
  const buf = readFileSync(HPROF_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  snap = parseHprof(ab);
}, 600_000);

describe.skipIf(!haveFile)('BitmapDumpData (systemui_bitmap.hprof)', () => {
  it('snapshot has non-null bitmapDumpData', () => {
    expect(snap.bitmapDumpData).not.toBeNull();
  });

  it('bitmapDumpData has PNG format (1)', () => {
    expect(snap.bitmapDumpData!.format).toBe(1);
  });

  it('bitmapDumpData has buffers', () => {
    expect(snap.bitmapDumpData!.buffers.size).toBeGreaterThan(0);
  });

  it('asBitmap with DumpData returns compressed PNG data', () => {
    let found = 0;
    for (const [, inst] of snap.instances) {
      const ci = inst.asClassInstance?.();
      if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
      const bmp = ci.asBitmap(snap.bitmapDumpData);
      if (!bmp) continue;
      found++;
      expect(bmp.format).toBe("png");
      expect(bmp.width).toBeGreaterThan(0);
      expect(bmp.height).toBeGreaterThan(0);
      expect(bmp.data.length).toBeGreaterThan(0);
      // PNG magic bytes: 0x89 0x50 0x4E 0x47
      expect(bmp.data[0]).toBe(0x89);
      expect(bmp.data[1]).toBe(0x50); // P
      expect(bmp.data[2]).toBe(0x4E); // N
      expect(bmp.data[3]).toBe(0x47); // G
      if (found >= 3) break;
    }
    expect(found).toBeGreaterThan(0);
  });

  it('asBitmap without DumpData returns null for all bitmaps (no mBuffer)', () => {
    let checked = 0;
    for (const [, inst] of snap.instances) {
      const ci = inst.asClassInstance?.();
      if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
      // Without DumpData, should be null (these are all native bitmaps)
      expect(ci.asBitmap()).toBeNull();
      checked++;
      if (checked >= 5) break;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('mNativePtr maps to DumpData buffer', () => {
    const dd = snap.bitmapDumpData!;
    let matched = 0;
    for (const [, inst] of snap.instances) {
      const ci = inst.asClassInstance?.();
      if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
      const nativePtr = ci.getField("mNativePtr");
      if (typeof nativePtr !== "bigint" && typeof nativePtr !== "number") continue;
      const key = typeof nativePtr === "bigint" ? nativePtr : BigInt(nativePtr);
      if (dd.buffers.has(key)) {
        matched++;
        const buf = dd.buffers.get(key)!;
        expect(buf.length).toBeGreaterThan(0);
      }
      if (matched >= 5) break;
    }
    expect(matched).toBeGreaterThan(0);
  });

  it('counts bitmaps with and without pixel data', () => {
    const dd = snap.bitmapDumpData!;
    let total = 0, withData = 0;
    for (const [, inst] of snap.instances) {
      const ci = inst.asClassInstance?.();
      if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
      total++;
      if (ci.asBitmap(dd)) withData++;
    }
    expect(total).toBeGreaterThan(0);
    expect(withData).toBeGreaterThan(0);
    // The bitmap dump should have a significant number with pixel data
    expect(withData).toBeGreaterThanOrEqual(dd.buffers.size - 5); // some slack for mismatched pointers
  });

  it('bitmap dimensions match mWidth/mHeight fields', () => {
    const dd = snap.bitmapDumpData!;
    let checked = 0;
    for (const [, inst] of snap.instances) {
      const ci = inst.asClassInstance?.();
      if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
      const bmp = ci.asBitmap(dd);
      if (!bmp) continue;
      const w = ci.getField("mWidth");
      const h = ci.getField("mHeight");
      expect(bmp.width).toBe(w);
      expect(bmp.height).toBe(h);
      checked++;
      if (checked >= 10) break;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('density field is a valid positive integer', () => {
    let checked = 0;
    for (const [, inst] of snap.instances) {
      const ci = inst.asClassInstance?.();
      if (!ci || !ci.isInstanceOfClass("android.graphics.Bitmap")) continue;
      const density = ci.getField("mDensity");
      if (typeof density === "number" && density > 0) {
        // Common Android densities: 120, 160, 240, 320, 420, 480, 560, 640
        expect(density).toBeGreaterThanOrEqual(72);
        expect(density).toBeLessThanOrEqual(640);
        checked++;
      }
      if (checked >= 5) break;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
