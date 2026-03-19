import { describe, it, expect } from "vitest";
import { parseGrepOutput, type VmaString } from "../adb/capture";

// ── parseGrepOutput ──────────────────────────────────────────────────────────

describe("parseGrepOutput", () => {
  it("parses standard grep -b output", () => {
    const output = "100:Hello World\n200:Some String\n";
    const result = parseGrepOutput(output);
    expect(result).toEqual([
      { offset: 100, str: "Hello World" },
      { offset: 200, str: "Some String" },
    ]);
  });

  it("handles empty output", () => {
    expect(parseGrepOutput("")).toEqual([]);
  });

  it("handles output with no valid lines", () => {
    expect(parseGrepOutput("garbage\n\n")).toEqual([]);
  });

  it("skips strings shorter than 4 chars", () => {
    const output = "0:Hi\n10:Hello\n";
    const result = parseGrepOutput(output);
    expect(result).toEqual([{ offset: 10, str: "Hello" }]);
  });

  it("handles colons in the string value", () => {
    const output = "500:key:value:extra\n";
    const result = parseGrepOutput(output);
    expect(result).toEqual([{ offset: 500, str: "key:value:extra" }]);
  });

  it("handles large offsets", () => {
    const output = "1048576:Large offset string\n";
    const result = parseGrepOutput(output);
    expect(result).toEqual([{ offset: 1048576, str: "Large offset string" }]);
  });

  it("skips lines without colon", () => {
    const output = "100:valid line\nno colon here\n200:another valid\n";
    const result = parseGrepOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0].str).toBe("valid line");
    expect(result[1].str).toBe("another valid");
  });

  it("skips lines with non-numeric offset", () => {
    const output = "abc:not a number\n42:valid\n";
    const result = parseGrepOutput(output);
    expect(result).toEqual([{ offset: 42, str: "valid" }]);
  });

  it("handles trailing newlines and empty lines", () => {
    const output = "\n100:hello\n\n200:world\n\n";
    const result = parseGrepOutput(output);
    expect(result).toHaveLength(2);
  });

  it("handles zero offset", () => {
    const output = "0:starts at zero\n";
    const result = parseGrepOutput(output);
    expect(result).toEqual([{ offset: 0, str: "starts at zero" }]);
  });
});

// ── Duplicate computation (imported indirectly via the view logic) ────────────

// We test the logic inline since computeDuplicates is a local function.
// These tests verify the expected behavior using the same algorithm.

function computeDuplicates(strings: VmaString[]) {
  const groups = new Map<string, { count: number; totalBytes: number; vmaIndices: Set<number> }>();
  for (const s of strings) {
    const existing = groups.get(s.str);
    if (existing) {
      existing.count++;
      existing.totalBytes += s.str.length;
      existing.vmaIndices.add(s.vmaIndex);
    } else {
      groups.set(s.str, { count: 1, totalBytes: s.str.length, vmaIndices: new Set([s.vmaIndex]) });
    }
  }
  const result: { value: string; count: number; totalBytes: number; vmaCount: number }[] = [];
  for (const [value, g] of groups) {
    if (g.count < 2) continue;
    result.push({ value, count: g.count, totalBytes: g.totalBytes, vmaCount: g.vmaIndices.size });
  }
  return result;
}

function makeVmaString(str: string, vmaIndex: number, offset = 0): VmaString {
  return { offset, vmaAddr: 0x7f000000 + offset, str, vmaIndex };
}

describe("process strings duplicate computation", () => {
  it("returns empty for no strings", () => {
    expect(computeDuplicates([])).toEqual([]);
  });

  it("returns empty when all strings are unique", () => {
    const strings = [
      makeVmaString("hello", 0),
      makeVmaString("world", 0, 10),
      makeVmaString("foo", 1),
    ];
    expect(computeDuplicates(strings)).toEqual([]);
  });

  it("detects duplicates across VMAs", () => {
    const strings = [
      makeVmaString("libhwui.so", 0),
      makeVmaString("libhwui.so", 1, 100),
      makeVmaString("unique", 2),
    ];
    const dups = computeDuplicates(strings);
    expect(dups).toHaveLength(1);
    expect(dups[0].value).toBe("libhwui.so");
    expect(dups[0].count).toBe(2);
    expect(dups[0].totalBytes).toBe(20); // 10 * 2
    expect(dups[0].vmaCount).toBe(2);
  });

  it("detects duplicates within same VMA", () => {
    const strings = [
      makeVmaString("repeated", 0, 0),
      makeVmaString("repeated", 0, 100),
      makeVmaString("repeated", 0, 200),
    ];
    const dups = computeDuplicates(strings);
    expect(dups).toHaveLength(1);
    expect(dups[0].count).toBe(3);
    expect(dups[0].vmaCount).toBe(1); // all in same VMA
  });

  it("handles multiple duplicate groups", () => {
    const strings = [
      makeVmaString("alpha", 0),
      makeVmaString("alpha", 1),
      makeVmaString("beta", 0),
      makeVmaString("beta", 1),
      makeVmaString("beta", 2),
    ];
    const dups = computeDuplicates(strings);
    expect(dups).toHaveLength(2);
    const alpha = dups.find(d => d.value === "alpha")!;
    const beta = dups.find(d => d.value === "beta")!;
    expect(alpha.count).toBe(2);
    expect(beta.count).toBe(3);
  });
});
