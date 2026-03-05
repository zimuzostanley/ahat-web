// ─── proguard.ts ──────────────────────────────────────────────────────────────
//
// TypeScript port of Android ahat's ProguardMap.java.
// Parses R8/ProGuard mapping files and deobfuscates class names, field names,
// and stack frame information (method name, signature, filename, line number).

const ARRAY_SYMBOL = "[]";

interface Version {
  major: number;
  minor: number;
  build: number;
}

function compareVersions(a: Version, b: Version): number {
  let c = a.major - b.major;
  if (c !== 0) return c;
  c = a.minor - b.minor;
  if (c !== 0) return c;
  return a.build - b.build;
}

const LINE_MAPPING_BEHAVIOR_CHANGE_VERSION: Version = { major: 3, minor: 1, build: 4 };

interface LineRange {
  start: number;
  end: number;
}

interface LineNumberMapping {
  obfuscatedRange: LineRange;
  clearRange: LineRange;
}

function hasObfuscatedLine(mapping: LineNumberMapping, line: number): boolean {
  return line >= mapping.obfuscatedRange.start && line <= mapping.obfuscatedRange.end;
}

function mapObfuscatedLine(mapping: LineNumberMapping, line: number): number {
  const mapped = mapping.clearRange.start + line - mapping.obfuscatedRange.start;
  if (mapped < mapping.clearRange.start || mapped > mapping.clearRange.end) {
    return mapping.clearRange.end;
  }
  return mapped;
}

interface FrameData {
  clearMethodName: string;
  /** Sorted by obfuscated line start (ascending). */
  lineNumbers: [number, LineNumberMapping][];
}

function getClearLine(frame: FrameData, obfuscatedLine: number): number {
  // Binary search for the floor entry (largest key <= obfuscatedLine)
  const entries = frame.lineNumbers;
  let lo = 0, hi = entries.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid][0] <= obfuscatedLine) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (best >= 0) {
    const mapping = entries[best][1];
    if (hasObfuscatedLine(mapping, obfuscatedLine)) {
      return mapObfuscatedLine(mapping, obfuscatedLine);
    }
  }
  return obfuscatedLine;
}

interface ClassData {
  clearName: string;
  fields: Map<string, string>;           // obfuscated → clear
  frames: Map<string, FrameData>;        // obfuscatedMethod + clearSig → FrameData
}

export interface Frame {
  method: string;
  signature: string;
  filename: string;
  line: number;
}

/** Converts a ProGuard-formatted type/signature to JVMS format. */
function fromProguardSignature(sig: string): string {
  if (sig.startsWith("(")) {
    const end = sig.indexOf(")");
    if (end === -1) throw new Error("Error parsing signature: " + sig);
    let converted = "(";
    if (end > 1) {
      for (const arg of sig.substring(1, end).split(",")) {
        converted += fromProguardSignature(arg);
      }
    }
    converted += ")";
    converted += fromProguardSignature(sig.substring(end + 1));
    return converted;
  }
  if (sig.endsWith(ARRAY_SYMBOL)) {
    return "[" + fromProguardSignature(sig.substring(0, sig.length - 2));
  }
  switch (sig) {
    case "boolean": return "Z";
    case "byte":    return "B";
    case "char":    return "C";
    case "short":   return "S";
    case "int":     return "I";
    case "long":    return "J";
    case "float":   return "F";
    case "double":  return "D";
    case "void":    return "V";
    default:        return "L" + sig.replace(/\./g, "/") + ";";
  }
}

/** Derives source filename from clear class name (e.g. com.example.Foo$Bar → Foo.java). */
function getFileName(clearClass: string): string {
  let filename = clearClass;
  const dot = filename.lastIndexOf(".");
  if (dot !== -1) filename = filename.substring(dot + 1);
  const dollar = filename.indexOf("$");
  if (dollar !== -1) filename = filename.substring(0, dollar);
  return filename + ".java";
}

export class ProguardMap {
  private classesFromClear = new Map<string, ClassData>();
  private classesFromObfuscated = new Map<string, ClassData>();

  /** Parse a mapping.txt file contents. */
  parse(text: string): void {
    let compilerVersion: Version = { major: 0, minor: 0, build: 0 };
    const lines = text.split("\n");

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Skip comments
      if (line.trimStart().startsWith("#")) {
        compilerVersion = this.tryParseVersion(line, compilerVersion);
        i++;
        continue;
      }

      // Skip blank lines
      if (line.trim() === "") { i++; continue; }

      // Class line: 'clear.class.name -> obfuscated_class_name:'
      const sep = line.indexOf(" -> ");
      if (sep === -1 || sep + 5 >= line.length) { i++; continue; }
      const clearClassName = line.substring(0, sep);
      const obfuscatedClassName = line.substring(sep + 4, line.length - 1);

      const classData: ClassData = {
        clearName: clearClassName,
        fields: new Map(),
        frames: new Map(),
      };
      this.classesFromClear.set(clearClassName, classData);
      this.classesFromObfuscated.set(obfuscatedClassName, classData);

      i++;
      // Field/method lines (indented with 4 spaces or comment)
      while (i < lines.length && (lines[i].startsWith("    ") || lines[i].trimStart().startsWith("#"))) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith("#")) { i++; continue; }

        const ws = trimmed.indexOf(" ");
        const memberSep = trimmed.indexOf(" -> ");
        if (ws === -1 || memberSep === -1) { i++; continue; }

        let type = trimmed.substring(0, ws);
        let clearName = trimmed.substring(ws + 1, memberSep);
        const obfuscatedName = trimmed.substring(memberSep + 4);

        if (clearName.indexOf("(") === -1) {
          // Field
          classData.fields.set(obfuscatedName, clearName);
        } else {
          // Method: type is [#:[#:]]<returnType>
          let obfuscatedLineStart = 0;
          let obfuscatedLineEnd = 0;
          let colon = type.indexOf(":");
          if (colon !== -1) {
            obfuscatedLineStart = parseInt(type.substring(0, colon), 10);
            obfuscatedLineEnd = obfuscatedLineStart;
            type = type.substring(colon + 1);
          }
          colon = type.indexOf(":");
          if (colon !== -1) {
            obfuscatedLineEnd = parseInt(type.substring(0, colon), 10);
            type = type.substring(colon + 1);
          }
          const obfuscatedRange: LineRange = { start: obfuscatedLineStart, end: obfuscatedLineEnd };

          const op = clearName.indexOf("(");
          const cp = clearName.indexOf(")");
          if (op === -1 || cp === -1) { i++; continue; }

          const sig = clearName.substring(op, cp + 1);

          let clearLineStart = obfuscatedRange.start;
          let clearLineEnd = obfuscatedRange.end;
          colon = clearName.lastIndexOf(":");
          if (colon !== -1) {
            if (compareVersions(compilerVersion, LINE_MAPPING_BEHAVIOR_CHANGE_VERSION) < 0) {
              clearLineStart = parseInt(clearName.substring(colon + 1), 10);
              clearLineEnd = clearLineStart + obfuscatedRange.end - obfuscatedRange.start;
            } else {
              clearLineEnd = parseInt(clearName.substring(colon + 1), 10);
              clearLineStart = clearLineEnd;
            }
            clearName = clearName.substring(0, colon);
          }
          colon = clearName.lastIndexOf(":");
          if (colon !== -1) {
            clearLineStart = parseInt(clearName.substring(colon + 1), 10);
            clearName = clearName.substring(0, colon);
          }
          const clearRange: LineRange = { start: clearLineStart, end: clearLineEnd };

          clearName = clearName.substring(0, op);

          const clearSig = fromProguardSignature(sig + type);
          const key = obfuscatedName + clearSig;

          let frameData = classData.frames.get(key);
          if (!frameData) {
            frameData = { clearMethodName: clearName, lineNumbers: [] };
            classData.frames.set(key, frameData);
          }
          // Insert maintaining sort order by obfuscated line start
          const entry: [number, LineNumberMapping] = [
            obfuscatedRange.start,
            { obfuscatedRange, clearRange },
          ];
          // Simple insertion (mapping files are typically already ordered)
          let inserted = false;
          for (let j = 0; j < frameData.lineNumbers.length; j++) {
            if (frameData.lineNumbers[j][0] > obfuscatedRange.start) {
              frameData.lineNumbers.splice(j, 0, entry);
              inserted = true;
              break;
            }
          }
          if (!inserted) frameData.lineNumbers.push(entry);
        }
        i++;
      }
    }
  }

  private tryParseVersion(line: string, old: Version): Version {
    const m = line.match(/#\s*compiler_version:\s*(\d+)\.(\d+)(?:\.(\d+))?/);
    if (m) {
      return {
        major: parseInt(m[1], 10),
        minor: parseInt(m[2], 10),
        build: m[3] ? parseInt(m[3], 10) : 0,
      };
    }
    return old;
  }

  /** Returns true if this mapping has any entries. */
  hasEntries(): boolean {
    return this.classesFromObfuscated.size > 0;
  }

  /** Deobfuscate a class name, handling array suffixes. */
  getClassName(obfuscatedClassName: string): string {
    let baseName = obfuscatedClassName;
    let arraySuffix = "";
    while (baseName.endsWith(ARRAY_SYMBOL)) {
      arraySuffix += ARRAY_SYMBOL;
      baseName = baseName.substring(0, baseName.length - ARRAY_SYMBOL.length);
    }
    const classData = this.classesFromObfuscated.get(baseName);
    const clearBaseName = classData ? classData.clearName : baseName;
    return clearBaseName + arraySuffix;
  }

  /** Deobfuscate a field name given the clear class name. */
  getFieldName(clearClass: string, obfuscatedField: string): string {
    const classData = this.classesFromClear.get(clearClass);
    if (!classData) return obfuscatedField;
    return classData.fields.get(obfuscatedField) ?? obfuscatedField;
  }

  /** Deobfuscate a stack frame. */
  getFrame(
    clearClassName: string,
    obfuscatedMethodName: string,
    obfuscatedSignature: string,
    obfuscatedFilename: string,
    obfuscatedLine: number,
  ): Frame {
    const clearSignature = this.getSignature(obfuscatedSignature);
    const classData = this.classesFromClear.get(clearClassName);
    if (!classData) {
      return { method: obfuscatedMethodName, signature: clearSignature, filename: obfuscatedFilename, line: obfuscatedLine };
    }
    const key = obfuscatedMethodName + clearSignature;
    const frame = classData.frames.get(key);
    if (!frame) {
      return { method: obfuscatedMethodName, signature: clearSignature, filename: getFileName(clearClassName), line: obfuscatedLine };
    }
    return {
      method: frame.clearMethodName,
      signature: clearSignature,
      filename: getFileName(clearClassName),
      line: getClearLine(frame, obfuscatedLine),
    };
  }

  /** Deobfuscate class names within a JVMS signature. */
  private getSignature(obfuscatedSig: string): string {
    let result = "";
    for (let i = 0; i < obfuscatedSig.length; i++) {
      if (obfuscatedSig[i] === "L") {
        const e = obfuscatedSig.indexOf(";", i);
        if (e === -1) break;
        result += "L";
        const cls = obfuscatedSig.substring(i + 1, e).replace(/\//g, ".");
        result += this.getClassName(cls).replace(/\./g, "/");
        result += ";";
        i = e;
      } else {
        result += obfuscatedSig[i];
      }
    }
    return result;
  }
}
