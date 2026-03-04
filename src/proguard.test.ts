/**
 * ProguardMap tests — exact 1:1 port of Java ahat's ProguardMapTest.java.
 * Uses the exact same test mapping file and expected values.
 *
 * Java source: src/test/com/android/ahat/ProguardMapTest.java
 * Every assertion here corresponds to an assertion in the Java test.
 */
import { describe, it, expect } from 'vitest';
import { ProguardMap } from './proguard';

// Exact replica of TEST_MAP_FORMAT from ProguardMapTest.java
function testMap(version: string): string {
  return [
    "# compiler: richard",
    `# compiler_version: ${version}-dev`,
    "# min_api: 10000",
    "# compiler_hash: b7e25308967a577aa1f05a4b5a745c26",
    "  # indented comment",
    "class.that.is.Empty -> a:",
    "class.that.is.Empty$subclass -> b:",
    "class.with.only.Fields -> c:",
    "  # indented inner comment",
    "    int prim_type_field -> a",
    "    int[] prim_array_type_field -> b",
    "    class.that.is.Empty class_type_field -> c",
    "    class.that.is.Empty[] array_type_field -> d",
    "    int longObfuscatedNameField -> abc",
    "class.with.Methods -> d:",
    "    int some_field -> a",
    "    12:23:void <clinit>() -> <clinit>",
    "    42:43:void boringMethod() -> m",
    "      # indented further inner comment",
    "    45:48:void methodWithPrimArgs(int,float) -> m",
    "    49:50:void methodWithPrimArrArgs(int[],float) -> m",
    "    52:55:void methodWithClearObjArg(class.not.in.Map) -> m",
    "    57:58:void methodWithClearObjArrArg(class.not.in.Map[]) -> m",
    "    59:61:void methodWithObfObjArg(class.with.only.Fields) -> m",
    "    64:66:class.with.only.Fields methodWithObfRes() -> n",
    "    80:80:void lineObfuscatedMethod():8:8 -> o",
    "    100:105:void lineObfuscatedMethod():50 -> o",
    "    90:94:void lineObfuscatedMethod2():9 -> p",
  ].join("\n");
}

describe('ProguardMap', () => {
  // ─── Empty map (tested once — behaviour is version-independent) ─────

  describe('empty map', () => {
    const map = new ProguardMap();

    it('does not deobfuscate unknown class names', () => {
      expect(map.getClassName("foo.bar.Sludge")).toBe("foo.bar.Sludge");
      expect(map.getClassName("fooBarSludge")).toBe("fooBarSludge");
    });

    it('does not deobfuscate unknown fields', () => {
      expect(map.getFieldName("foo.bar.Sludge", "myfield")).toBe("myfield");
      expect(map.getFieldName("fooBarSludge", "myfield")).toBe("myfield");
    });

    it('does not deobfuscate unknown frames', () => {
      const frame = map.getFrame("foo.bar.Sludge", "mymethod", "(Lfoo/bar/Sludge;)V", "SourceFile.java", 123);
      expect(frame.method).toBe("mymethod");
      expect(frame.signature).toBe("(Lfoo/bar/Sludge;)V");
      expect(frame.filename).toBe("SourceFile.java");
      expect(frame.line).toBe(123);
    });

    it('hasEntries returns false', () => {
      expect(map.hasEntries()).toBe(false);
    });
  });

  // ─── Shared test body (mirrors Java's runOldProguardMap / runNewProguardMap) ─
  //
  // Java runs the identical assertions for both old (3.0.1, 3.1) and
  // new (3.1.4, 3.2) formats.  Only three expected line numbers differ.
  // We parameterise over all four versions.

  describe.each([
    { version: "3.0.1", label: "old v3.0.1", lineA: 8, lineB: 53, lineC: 13 },
    { version: "3.1",   label: "old v3.1",   lineA: 8, lineB: 53, lineC: 13 },
    { version: "3.1.4", label: "new v3.1.4", lineA: 8, lineB: 50, lineC: 9  },
    { version: "3.2",   label: "new v3.2",   lineA: 8, lineB: 50, lineC: 9  },
  ])('$label', ({ version, lineA, lineB, lineC }) => {
    const map = new ProguardMap();
    map.parse(testMap(version));

    // ── Class names ────────────────────────────────────────────────

    it('deobfuscates class names', () => {
      expect(map.getClassName("a")).toBe("class.that.is.Empty");
      expect(map.getClassName("b")).toBe("class.that.is.Empty$subclass");
      expect(map.getClassName("c")).toBe("class.with.only.Fields");
      expect(map.getClassName("d")).toBe("class.with.Methods");
    });

    it('deobfuscates array class names', () => {
      expect(map.getClassName("d[]")).toBe("class.with.Methods[]");
      expect(map.getClassName("d[][]")).toBe("class.with.Methods[][]");
    });

    it('preserves unknown class names after loading map', () => {
      expect(map.getClassName("foo.bar.Sludge")).toBe("foo.bar.Sludge");
      expect(map.getClassName("fooBarSludge")).toBe("fooBarSludge");
    });

    // ── Fields ─────────────────────────────────────────────────────

    it('deobfuscates field names', () => {
      expect(map.getFieldName("class.with.only.Fields", "a")).toBe("prim_type_field");
      expect(map.getFieldName("class.with.only.Fields", "b")).toBe("prim_array_type_field");
      expect(map.getFieldName("class.with.only.Fields", "c")).toBe("class_type_field");
      expect(map.getFieldName("class.with.only.Fields", "d")).toBe("array_type_field");
      expect(map.getFieldName("class.with.only.Fields", "abc")).toBe("longObfuscatedNameField");
      expect(map.getFieldName("class.with.Methods", "a")).toBe("some_field");
    });

    it('preserves unknown field names after loading map', () => {
      expect(map.getFieldName("foo.bar.Sludge", "myfield")).toBe("myfield");
      expect(map.getFieldName("fooBarSludge", "myfield")).toBe("myfield");
    });

    // ── Unknown frames still pass through after loading map ────────

    it('preserves unknown frames after loading map', () => {
      const frame = map.getFrame("foo.bar.Sludge", "mymethod", "(Lfoo/bar/Sludge;)V", "SourceFile.java", 123);
      expect(frame.method).toBe("mymethod");
      expect(frame.signature).toBe("(Lfoo/bar/Sludge;)V");
      expect(frame.filename).toBe("SourceFile.java");
      expect(frame.line).toBe(123);
    });

    // ── Frame deobfuscation ────────────────────────────────────────

    it('deobfuscates <clinit> frame', () => {
      const frame = map.getFrame("class.with.Methods", "<clinit>", "()V", "SourceFile.java", 13);
      expect(frame.method).toBe("<clinit>");
      expect(frame.signature).toBe("()V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(13);
    });

    it('deobfuscates simple method frame', () => {
      const frame = map.getFrame("class.with.Methods", "m", "()V", "SourceFile.java", 42);
      expect(frame.method).toBe("boringMethod");
      expect(frame.signature).toBe("()V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(42);
    });

    it('deobfuscates method with primitive args', () => {
      const frame = map.getFrame("class.with.Methods", "m", "(IF)V", "SourceFile.java", 45);
      expect(frame.method).toBe("methodWithPrimArgs");
      expect(frame.signature).toBe("(IF)V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(45);
    });

    it('deobfuscates method with primitive array args', () => {
      const frame = map.getFrame("class.with.Methods", "m", "([IF)V", "SourceFile.java", 49);
      expect(frame.method).toBe("methodWithPrimArrArgs");
      expect(frame.signature).toBe("([IF)V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(49);
    });

    it('deobfuscates method with clear object arg', () => {
      const frame = map.getFrame("class.with.Methods", "m", "(Lclass/not/in/Map;)V", "SourceFile.java", 52);
      expect(frame.method).toBe("methodWithClearObjArg");
      expect(frame.signature).toBe("(Lclass/not/in/Map;)V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(52);
    });

    it('deobfuscates method with clear object array arg', () => {
      const frame = map.getFrame("class.with.Methods", "m", "([Lclass/not/in/Map;)V", "SourceFile.java", 57);
      expect(frame.method).toBe("methodWithClearObjArrArg");
      expect(frame.signature).toBe("([Lclass/not/in/Map;)V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(57);
    });

    it('deobfuscates method with obfuscated object arg (signature deobfuscated)', () => {
      const frame = map.getFrame("class.with.Methods", "m", "(Lc;)V", "SourceFile.java", 59);
      expect(frame.method).toBe("methodWithObfObjArg");
      expect(frame.signature).toBe("(Lclass/with/only/Fields;)V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(59);
    });

    it('deobfuscates method with obfuscated return type', () => {
      const frame = map.getFrame("class.with.Methods", "n", "()Lc;", "SourceFile.java", 64);
      expect(frame.method).toBe("methodWithObfRes");
      expect(frame.signature).toBe("()Lclass/with/only/Fields;");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(64);
    });

    // ── Line number deobfuscation (values differ between old/new) ──

    it('deobfuscates line numbers — line 80→lineA', () => {
      const frame = map.getFrame("class.with.Methods", "o", "()V", "SourceFile.java", 80);
      expect(frame.method).toBe("lineObfuscatedMethod");
      expect(frame.signature).toBe("()V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(lineA);
    });

    it('deobfuscates line numbers — line 103→lineB', () => {
      const frame = map.getFrame("class.with.Methods", "o", "()V", "SourceFile.java", 103);
      expect(frame.method).toBe("lineObfuscatedMethod");
      expect(frame.signature).toBe("()V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(lineB);
    });

    it('deobfuscates line numbers — lineObfuscatedMethod2 line 94→lineC', () => {
      const frame = map.getFrame("class.with.Methods", "p", "()V", "SourceFile.java", 94);
      expect(frame.method).toBe("lineObfuscatedMethod2");
      expect(frame.signature).toBe("()V");
      expect(frame.filename).toBe("Methods.java");
      expect(frame.line).toBe(lineC);
    });

    it('computes filename for unobfuscated method', () => {
      const frame = map.getFrame("class.with.Methods", "unObfuscatedMethodName", "()V", "SourceFile.java", 0);
      expect(frame.filename).toBe("Methods.java");
    });
  });

  it('hasEntries returns true after parsing', () => {
    const map = new ProguardMap();
    map.parse(testMap("3.1.4"));
    expect(map.hasEntries()).toBe(true);
  });
});
