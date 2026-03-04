import { useState, useCallback, useMemo, useRef } from "react";
import { fmtSize } from "../format";
import { downloadBlob } from "../utils";

const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 20;
const OVERSCAN = 10;
const MIN_STRING_LEN = 4;
const MAX_DISPLAYED_STRINGS = 5000;

// ─── Region mapping ───────────────────────────────────────────────────────────

export interface RegionSpan {
  offsetStart: number;
  offsetEnd: number;
  vmaBase: number;
}

export function buildRegionMap(regions: { addrStart: string; addrEnd: string }[]): RegionSpan[] {
  const map: RegionSpan[] = [];
  let offset = 0;
  for (const r of regions) {
    const start = parseInt(r.addrStart, 16);
    const end = parseInt(r.addrEnd, 16);
    const size = end - start;
    map.push({ offsetStart: offset, offsetEnd: offset + size, vmaBase: start });
    offset += size;
  }
  return map;
}

export function offsetToVmaAddr(offset: number, regionMap: RegionSpan[]): number | undefined {
  for (const r of regionMap) {
    if (offset >= r.offsetStart && offset < r.offsetEnd) {
      return r.vmaBase + (offset - r.offsetStart);
    }
  }
  return undefined;
}

// ─── String extraction ────────────────────────────────────────────────────────

export function extractStrings(data: Uint8Array, minLen = MIN_STRING_LEN): { offset: number; str: string }[] {
  const results: { offset: number; str: string }[] = [];
  let current = "";
  let startOffset = 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b >= 0x20 && b < 0x7f) {
      if (current.length === 0) startOffset = i;
      current += String.fromCharCode(b);
    } else {
      if (current.length >= minLen) {
        results.push({ offset: startOffset, str: current });
      }
      current = "";
    }
  }
  if (current.length >= minLen) {
    results.push({ offset: startOffset, str: current });
  }
  return results;
}

// ─── Row formatting ───────────────────────────────────────────────────────────

/** Format a single row: [vma_addr]  offset  hex bytes (two groups of 8)  ASCII. */
export function formatRow(
  data: Uint8Array, offset: number, totalLen: number,
  vmaAddr?: number, addrWidth?: number,
): string {
  const hex: string[] = [];
  const ascii: string[] = [];
  for (let j = 0; j < BYTES_PER_ROW; j++) {
    const pos = offset + j;
    if (pos < totalLen) {
      const b = data[pos];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
    } else {
      hex.push("  ");
      ascii.push(" ");
    }
  }
  const fileOffset = offset.toString(16).padStart(8, "0");
  const hexStr = `${hex.slice(0, 8).join(" ")}  ${hex.slice(8).join(" ")}`;
  const asciiStr = `|${ascii.join("")}|`;
  if (vmaAddr !== undefined) {
    const w = addrWidth ?? 12;
    const addr = vmaAddr.toString(16).padStart(w, "0");
    return `${addr}  ${fileOffset}  ${hexStr}  ${asciiStr}`;
  }
  return `${fileOffset}  ${hexStr}  ${asciiStr}`;
}

/** Generate full hex dump text (for copy). */
export function formatHexDump(
  data: Uint8Array, maxRows = 1_000_000,
  regionMap?: RegionSpan[], addrWidth?: number,
): string {
  const totalRows = Math.min(Math.ceil(data.byteLength / BYTES_PER_ROW), maxRows);
  const lines: string[] = [];
  for (let i = 0; i < totalRows; i++) {
    const offset = i * BYTES_PER_ROW;
    const vmaAddr = regionMap ? offsetToVmaAddr(offset, regionMap) : undefined;
    lines.push(formatRow(data, offset, data.byteLength, vmaAddr, addrWidth));
  }
  if (totalRows < Math.ceil(data.byteLength / BYTES_PER_ROW)) {
    lines.push(`... (truncated at ${totalRows} rows)`);
  }
  return lines.join("\n");
}

// ─── Diff row formatting ─────────────────────────────────────────────────────

export interface RowSegment {
  text: string;
  diff: boolean;
}

/**
 * Format a row as segments with per-byte diff markers.
 * Adjacent segments with the same diff status are merged for efficient rendering.
 */
export function formatRowSegments(
  data: Uint8Array, offset: number, totalLen: number,
  baseData: Uint8Array, baseTotalLen: number,
  vmaAddr?: number, addrWidth?: number,
): RowSegment[] {
  const raw: RowSegment[] = [];

  // Address prefix (never diff)
  if (vmaAddr !== undefined) {
    const w = addrWidth ?? 12;
    raw.push({ text: vmaAddr.toString(16).padStart(w, "0") + "  ", diff: false });
  }
  raw.push({ text: offset.toString(16).padStart(8, "0") + "  ", diff: false });

  // Hex bytes: two groups of 8 separated by double space
  for (let j = 0; j < BYTES_PER_ROW; j++) {
    if (j === 8) raw.push({ text: " ", diff: false });
    const pos = offset + j;
    if (pos < totalLen) {
      const b = data[pos];
      const isDiff = pos < baseTotalLen ? b !== baseData[pos] : false;
      raw.push({ text: b.toString(16).padStart(2, "0"), diff: isDiff });
    } else {
      raw.push({ text: "  ", diff: false });
    }
    if (j < BYTES_PER_ROW - 1) raw.push({ text: " ", diff: false });
  }

  raw.push({ text: "  |", diff: false });

  // ASCII column
  for (let j = 0; j < BYTES_PER_ROW; j++) {
    const pos = offset + j;
    if (pos < totalLen) {
      const b = data[pos];
      const ch = b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
      const isDiff = pos < baseTotalLen ? b !== baseData[pos] : false;
      raw.push({ text: ch, diff: isDiff });
    } else {
      raw.push({ text: " ", diff: false });
    }
  }

  raw.push({ text: "|", diff: false });

  // Merge adjacent segments with same diff status
  const merged: RowSegment[] = [];
  for (const s of raw) {
    if (merged.length > 0 && merged[merged.length - 1].diff === s.diff) {
      merged[merged.length - 1].text += s.text;
    } else {
      merged.push({ text: s.text, diff: s.diff });
    }
  }
  return merged;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface DiffTarget {
  id: string;
  name: string;
  buffer: ArrayBuffer;
}

interface HexViewProps {
  buffer: ArrayBuffer;
  name: string;
  regions?: { addrStart: string; addrEnd: string }[];
  availableDiffs?: DiffTarget[];
}

export default function HexView({ buffer, name, regions, availableDiffs }: HexViewProps) {
  const data = useMemo(() => new Uint8Array(buffer), [buffer]);
  const totalRows = Math.ceil(data.byteLength / BYTES_PER_ROW);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [copied, setCopied] = useState(false);
  const [showStrings, setShowStrings] = useState(false);
  const [stringFilter, setStringFilter] = useState("");
  const [highlightRow, setHighlightRow] = useState<number | null>(null);
  const [diffBaselineId, setDiffBaselineId] = useState<string | null>(null);
  const scrollNodeRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const regionMap = useMemo(
    () => regions && regions.length > 0 ? buildRegionMap(regions) : undefined,
    [regions],
  );

  const addrWidth = useMemo(() => {
    if (!regionMap || regionMap.length === 0) return undefined;
    const last = regionMap[regionMap.length - 1];
    const maxAddr = last.vmaBase + (last.offsetEnd - last.offsetStart);
    return maxAddr > 0xFFFFFFFF ? 12 : 8;
  }, [regionMap]);

  // Diff baseline
  const diffBaseline = useMemo(() => {
    if (!diffBaselineId || !availableDiffs) return null;
    const found = availableDiffs.find(d => d.id === diffBaselineId);
    return found ? new Uint8Array(found.buffer) : null;
  }, [diffBaselineId, availableDiffs]);

  const diffStats = useMemo(() => {
    if (!diffBaseline) return null;
    let changed = 0;
    const len = Math.min(data.byteLength, diffBaseline.byteLength);
    for (let i = 0; i < len; i++) {
      if (data[i] !== diffBaseline[i]) changed++;
    }
    return { changed, total: data.byteLength, baseTotal: diffBaseline.byteLength };
  }, [data, diffBaseline]);

  const strings = useMemo(
    () => showStrings ? extractStrings(data) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showStrings, buffer],
  );

  const filteredStrings = useMemo(() => {
    if (!stringFilter) return strings;
    const lower = stringFilter.toLowerCase();
    return strings.filter(s => s.str.toLowerCase().includes(lower));
  }, [strings, stringFilter]);

  const displayStrings = filteredStrings.length > MAX_DISPLAYED_STRINGS
    ? filteredStrings.slice(0, MAX_DISPLAYED_STRINGS) : filteredStrings;

  const measuredRef = useCallback((node: HTMLDivElement | null) => {
    scrollNodeRef.current = node;
    if (!node) return;
    const h = Math.min(window.innerHeight - 160, totalRows * ROW_HEIGHT);
    setContainerHeight(Math.max(200, h));
  }, [totalRows]);

  const scrollToOffset = useCallback((byteOffset: number) => {
    const row = Math.floor(byteOffset / BYTES_PER_ROW);
    const target = Math.max(0, row * ROW_HEIGHT - containerHeight / 3);
    if (scrollNodeRef.current) {
      scrollNodeRef.current.scrollTop = target;
      setScrollTop(target);
    }
    setHighlightRow(row);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightRow(null), 2000);
  }, [containerHeight]);

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);

  // Build visible rows — plain strings for normal mode, segments for diff mode
  const lines: string[] | null = diffBaseline ? null : (() => {
    const result: string[] = [];
    for (let i = startRow; i < endRow; i++) {
      const offset = i * BYTES_PER_ROW;
      const vmaAddr = regionMap ? offsetToVmaAddr(offset, regionMap) : undefined;
      result.push(formatRow(data, offset, data.byteLength, vmaAddr, addrWidth));
    }
    return result;
  })();

  const handleCopy = () => {
    const text = formatHexDump(data, undefined, regionMap, addrWidth);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-lg font-semibold text-stone-800 truncate">{name}</h2>
        <span className="text-sm text-stone-500">{fmtSize(data.byteLength)}</span>
        <span className="text-xs text-stone-400">{totalRows.toLocaleString()} rows</span>
        <div className="ml-auto flex items-center gap-2">
          {availableDiffs && availableDiffs.length > 0 && (
            <select
              className="text-xs border border-stone-200 px-1.5 py-0.5 text-stone-500 bg-white cursor-pointer max-w-[160px] truncate"
              value={diffBaselineId ?? ""}
              onChange={e => setDiffBaselineId(e.target.value || null)}
            >
              <option value="">Compare{"\u2026"}</option>
              {availableDiffs.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          <button
            className={`text-xs px-2 py-0.5 border transition-colors ${
              showStrings
                ? "text-sky-600 border-sky-300 bg-sky-50"
                : "text-stone-500 hover:text-stone-700 border-stone-200 hover:border-stone-400"
            }`}
            onClick={() => setShowStrings(!showStrings)}
          >Strings</button>
          <button
            className="text-xs text-stone-500 hover:text-stone-700 px-2 py-0.5 border border-stone-200 hover:border-stone-400"
            onClick={handleCopy}
          >{copied ? "Copied" : "Copy hex"}</button>
          <button
            className="text-xs text-stone-500 hover:text-stone-700 px-2 py-0.5 border border-stone-200 hover:border-stone-400"
            onClick={() => downloadBlob(name + ".bin", buffer)}
          >Download</button>
        </div>
      </div>
      {regionMap && regionMap.length > 0 && (
        <div className="text-xs text-stone-400 mb-2 font-mono">
          {regionMap.length === 1
            ? <>VMA {regionMap[0].vmaBase.toString(16).padStart(addrWidth ?? 8, "0")}{"\u2013"}{(regionMap[0].vmaBase + regionMap[0].offsetEnd).toString(16).padStart(addrWidth ?? 8, "0")}</>
            : <>{regionMap.length} VMA regions</>}
        </div>
      )}
      {diffStats && (
        <div className="text-xs text-stone-400 mb-2">
          <span className="font-mono text-amber-700">{diffStats.changed.toLocaleString()}</span> bytes differ
          {" "}of {fmtSize(diffStats.total)}
          {diffStats.total !== diffStats.baseTotal && (
            <span className="ml-2 text-stone-400">
              (baseline: {fmtSize(diffStats.baseTotal)})
            </span>
          )}
        </div>
      )}
      <div className="flex">
        {/* Hex dump */}
        <div className="flex-1 min-w-0">
          <div
            ref={measuredRef}
            className="overflow-auto border border-stone-200 bg-white"
            style={{ height: containerHeight }}
            onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
          >
            <div style={{ height: totalRows * ROW_HEIGHT, position: "relative" }}>
              {highlightRow !== null && highlightRow >= startRow && highlightRow < endRow && (
                <div
                  className="absolute left-0 right-0 bg-sky-100 transition-colors"
                  style={{ top: highlightRow * ROW_HEIGHT, height: ROW_HEIGHT }}
                />
              )}
              {diffBaseline ? (
                // Diff mode: per-row divs with per-byte highlighting
                Array.from({ length: endRow - startRow }, (_, idx) => {
                  const i = startRow + idx;
                  const offset = i * BYTES_PER_ROW;
                  const vmaAddr = regionMap ? offsetToVmaAddr(offset, regionMap) : undefined;
                  const segments = formatRowSegments(data, offset, data.byteLength, diffBaseline, diffBaseline.byteLength, vmaAddr, addrWidth);
                  return (
                    <div
                      key={i}
                      className="font-mono text-xs text-stone-800 leading-5 select-text whitespace-pre"
                      style={{ position: "absolute", top: i * ROW_HEIGHT, height: ROW_HEIGHT, padding: "0 8px" }}
                    >
                      {segments.map((s, si) =>
                        s.diff
                          ? <span key={si} className="bg-amber-200 text-amber-900 rounded-sm">{s.text}</span>
                          : <span key={si}>{s.text}</span>
                      )}
                    </div>
                  );
                })
              ) : (
                // Normal mode: single pre block
                <pre
                  className="font-mono text-xs text-stone-800 leading-5 select-text whitespace-pre relative"
                  style={{ position: "absolute", top: startRow * ROW_HEIGHT, left: 0, padding: "0 8px" }}
                >
                  {lines!.join("\n")}
                </pre>
              )}
            </div>
          </div>
        </div>

        {/* Strings panel */}
        {showStrings && (
          <div className="w-80 border border-l-0 border-stone-200 bg-white flex flex-col" style={{ height: containerHeight }}>
            <div className="p-2 border-b border-stone-100">
              <input
                className="w-full text-xs border border-stone-200 px-2 py-1 placeholder:text-stone-300 focus:outline-none focus:border-sky-400"
                placeholder="Filter strings\u2026"
                value={stringFilter}
                onChange={e => setStringFilter(e.target.value)}
                autoFocus
              />
              <div className="text-[10px] text-stone-400 mt-1">
                {filteredStrings.length === strings.length
                  ? `${strings.length.toLocaleString()} strings`
                  : `${filteredStrings.length.toLocaleString()} / ${strings.length.toLocaleString()}`}
                {` (\u2265${MIN_STRING_LEN} chars)`}
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {displayStrings.map((s, i) => {
                const vma = regionMap ? offsetToVmaAddr(s.offset, regionMap) : undefined;
                return (
                  <div
                    key={i}
                    className="px-2 py-0.5 text-xs hover:bg-sky-50 cursor-pointer border-b border-stone-50 flex gap-2 items-baseline"
                    onClick={() => scrollToOffset(s.offset)}
                    title={`Offset: 0x${s.offset.toString(16)}${vma !== undefined ? ` | VMA: 0x${vma.toString(16)}` : ""}`}
                  >
                    <span className="font-mono text-stone-400 shrink-0 text-[10px]">
                      {(vma ?? s.offset).toString(16).padStart(vma !== undefined ? (addrWidth ?? 8) : 8, "0")}
                    </span>
                    <span className="font-mono text-stone-700 truncate">{s.str}</span>
                  </div>
                );
              })}
              {filteredStrings.length > MAX_DISPLAYED_STRINGS && (
                <div className="px-2 py-2 text-[10px] text-stone-400 text-center">
                  Showing first {MAX_DISPLAYED_STRINGS.toLocaleString()} of {filteredStrings.length.toLocaleString()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
