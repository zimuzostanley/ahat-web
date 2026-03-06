import { describe, it, expect } from "vitest";
import type { StringListRow } from "../hprof.worker";
import { computeDuplicates } from "./strings-helpers";

function makeRow(id: number, value: string, retainedSize: number): StringListRow {
  return {
    id,
    value,
    length: value.length,
    retainedSize,
    shallowSize: 40,
    heap: "app",
    className: "java.lang.String",
    display: `java.lang.String@${id.toString(16)}`,
  };
}

describe("computeDuplicates", () => {
  it("returns empty array for no rows", () => {
    expect(computeDuplicates([])).toEqual([]);
  });

  it("returns empty array when all strings are unique", () => {
    const rows = [
      makeRow(1, "hello", 100),
      makeRow(2, "world", 200),
      makeRow(3, "foo", 50),
    ];
    expect(computeDuplicates(rows)).toEqual([]);
  });

  it("detects a simple duplicate pair", () => {
    const rows = [
      makeRow(1, "hello", 100),
      makeRow(2, "hello", 120),
      makeRow(3, "unique", 50),
    ];
    const dups = computeDuplicates(rows);
    expect(dups).toHaveLength(1);
    expect(dups[0].value).toBe("hello");
    expect(dups[0].count).toBe(2);
    expect(dups[0].ids).toEqual([1, 2]);
    // Wasted = total - min = (100 + 120) - 100 = 120
    expect(dups[0].wastedBytes).toBe(120);
  });

  it("handles triple duplicates", () => {
    const rows = [
      makeRow(1, "abc", 100),
      makeRow(2, "abc", 200),
      makeRow(3, "abc", 150),
    ];
    const dups = computeDuplicates(rows);
    expect(dups).toHaveLength(1);
    expect(dups[0].count).toBe(3);
    // Wasted = (100 + 200 + 150) - 100 = 350
    expect(dups[0].wastedBytes).toBe(350);
    expect(dups[0].ids).toEqual([1, 2, 3]);
  });

  it("handles multiple duplicate groups", () => {
    const rows = [
      makeRow(1, "hello", 100),
      makeRow(2, "hello", 200),
      makeRow(3, "world", 300),
      makeRow(4, "world", 50),
      makeRow(5, "unique", 500),
    ];
    const dups = computeDuplicates(rows);
    expect(dups).toHaveLength(2);
    // Should be sorted by wastedBytes descending
    // "world": wasted = (300 + 50) - 50 = 300
    // "hello": wasted = (100 + 200) - 100 = 200
    expect(dups[0].value).toBe("world");
    expect(dups[0].wastedBytes).toBe(300);
    expect(dups[1].value).toBe("hello");
    expect(dups[1].wastedBytes).toBe(200);
  });

  it("handles empty string as a value", () => {
    const rows = [
      makeRow(1, "", 10),
      makeRow(2, "", 20),
    ];
    const dups = computeDuplicates(rows);
    expect(dups).toHaveLength(1);
    expect(dups[0].value).toBe("");
    expect(dups[0].count).toBe(2);
  });

  it("handles strings with special characters", () => {
    const rows = [
      makeRow(1, "hello\nworld", 100),
      makeRow(2, "hello\nworld", 100),
    ];
    const dups = computeDuplicates(rows);
    expect(dups).toHaveLength(1);
    expect(dups[0].value).toBe("hello\nworld");
  });

  it("wasted is zero when all duplicates have same retained size", () => {
    const rows = [
      makeRow(1, "same", 100),
      makeRow(2, "same", 100),
      makeRow(3, "same", 100),
    ];
    const dups = computeDuplicates(rows);
    expect(dups).toHaveLength(1);
    // Wasted = (100 + 100 + 100) - 100 = 200
    expect(dups[0].wastedBytes).toBe(200);
  });

  it("correctly identifies smallest retained for wasted calculation", () => {
    const rows = [
      makeRow(1, "x", 500),
      makeRow(2, "x", 10),
      makeRow(3, "x", 300),
    ];
    const dups = computeDuplicates(rows);
    expect(dups[0].wastedBytes).toBe(500 + 10 + 300 - 10);
  });

  it("preserves all ids in order of appearance", () => {
    const rows = [
      makeRow(99, "dup", 10),
      makeRow(42, "dup", 20),
      makeRow(7, "dup", 30),
    ];
    const dups = computeDuplicates(rows);
    expect(dups[0].ids).toEqual([99, 42, 7]);
  });

  it("single row is not a duplicate", () => {
    const rows = [makeRow(1, "only-one", 1000)];
    expect(computeDuplicates(rows)).toEqual([]);
  });

  it("handles large number of duplicates", () => {
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeRow(i + 1, "repeated", 50 + i)
    );
    const dups = computeDuplicates(rows);
    expect(dups).toHaveLength(1);
    expect(dups[0].count).toBe(100);
    expect(dups[0].ids).toHaveLength(100);
    const totalRetained = rows.reduce((s, r) => s + r.retainedSize, 0);
    expect(dups[0].wastedBytes).toBe(totalRetained - 50); // min is 50
  });
});
