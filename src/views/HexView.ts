import m from "mithril";
import { Fragment } from "../mithril-helpers";
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

// ─── Diff navigation ────────────────────────────────────────────────────────

/** Return sorted row indices that contain at least one differing byte. */
export function buildDiffRows(data: Uint8Array, baseData: Uint8Array): number[] {
  const rows: number[] = [];
  const cmpLen = Math.min(data.byteLength, baseData.byteLength);
  const totalRows = Math.ceil(cmpLen / BYTES_PER_ROW);
  for (let r = 0; r < totalRows; r++) {
    const start = r * BYTES_PER_ROW;
    const end = Math.min(start + BYTES_PER_ROW, cmpLen);
    for (let i = start; i < end; i++) {
      if (data[i] !== baseData[i]) { rows.push(r); break; }
    }
  }
  return rows;
}

/**
 * Binary search for the next or previous diff row relative to targetRow.
 * "next": first index where diffRows[i] > targetRow.
 * "prev": last index where diffRows[i] < targetRow.
 * Returns -1 if none found.
 */
export function findDiffIndex(
  diffRows: number[], targetRow: number, direction: "next" | "prev",
): number {
  if (diffRows.length === 0) return -1;
  if (direction === "next") {
    let lo = 0, hi = diffRows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (diffRows[mid] <= targetRow) lo = mid + 1; else hi = mid;
    }
    return lo < diffRows.length ? lo : -1;
  } else {
    let lo = 0, hi = diffRows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (diffRows[mid] < targetRow) lo = mid + 1; else hi = mid;
    }
    return lo > 0 ? lo - 1 : -1;
  }
}

/** Compute row positions of VMA region boundaries (for separators). */
export interface RegionSeparator {
  row: number;
  vmaBase: number;
  offsetStart: number;
  offsetEnd: number;
}

export function regionSeparatorRows(regionMap: RegionSpan[]): RegionSeparator[] {
  const result: RegionSeparator[] = [];
  for (let i = 1; i < regionMap.length; i++) {
    const r = regionMap[i];
    result.push({
      row: Math.floor(r.offsetStart / BYTES_PER_ROW),
      vmaBase: r.vmaBase,
      offsetStart: r.offsetStart,
      offsetEnd: r.offsetEnd,
    });
  }
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface DiffTarget {
  id: string;
  name: string;
  buffer: ArrayBuffer;
}

interface HexViewAttrs {
  buffer: ArrayBuffer;
  name: string;
  regions?: { addrStart: string; addrEnd: string }[];
  availableDiffs?: DiffTarget[];
}

function HexView(): m.Component<HexViewAttrs> {
  let scrollTop = 0;
  let containerHeight = 600;
  let copied = false;
  let showStrings = false;
  let stringFilter = "";
  let highlightRow: number | null = null;
  let diffBaselineId: string | null = null;
  let currentDiffIdx = -1;
  let scrollNode: HTMLDivElement | null = null;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  let diffMinimapCanvas: HTMLCanvasElement | null = null;
  let programmaticScroll = false;
  let stringShowCount = MAX_DISPLAYED_STRINGS;

  // Cached expensive computations with dependency tracking
  let cachedBuffer: ArrayBuffer | undefined;
  let cachedData: Uint8Array | undefined;
  let cachedRegions: { addrStart: string; addrEnd: string }[] | undefined;
  let cachedRegionMap: RegionSpan[] | undefined;
  let cachedDiffBaselineId: string | null | undefined;
  let cachedAvailableDiffs: DiffTarget[] | undefined;
  let cachedDiffBaseline: Uint8Array | null = null;
  let cachedDiffData: Uint8Array | undefined;
  let cachedDiffBaselineForRows: Uint8Array | null | undefined;
  let cachedDiffRows: number[] = [];
  let cachedDiffStatsData: Uint8Array | undefined;
  let cachedDiffStatsBaseline: Uint8Array | null | undefined;
  let cachedDiffStats: { changed: number; total: number; baseTotal: number } | null = null;
  let cachedStringsShow: boolean | undefined;
  let cachedStringsBuffer: ArrayBuffer | undefined;
  let cachedStrings: { offset: number; str: string }[] = [];
  let prevDiffBaselineId: string | null | undefined;

  function getData(buffer: ArrayBuffer): Uint8Array {
    if (buffer !== cachedBuffer) {
      cachedBuffer = buffer;
      cachedData = new Uint8Array(buffer);
    }
    return cachedData!;
  }

  function getRegionMap(regions?: { addrStart: string; addrEnd: string }[]): RegionSpan[] | undefined {
    if (regions !== cachedRegions) {
      cachedRegions = regions;
      cachedRegionMap = regions && regions.length > 0 ? buildRegionMap(regions) : undefined;
    }
    return cachedRegionMap;
  }

  function getAddrWidth(regionMap?: RegionSpan[]): number | undefined {
    if (!regionMap || regionMap.length === 0) return undefined;
    const last = regionMap[regionMap.length - 1];
    const maxAddr = last.vmaBase + (last.offsetEnd - last.offsetStart);
    return maxAddr > 0xFFFFFFFF ? 12 : 8;
  }

  function getDiffBaseline(diffBaselineIdVal: string | null, availableDiffs?: DiffTarget[]): Uint8Array | null {
    if (diffBaselineIdVal !== cachedDiffBaselineId || availableDiffs !== cachedAvailableDiffs) {
      cachedDiffBaselineId = diffBaselineIdVal;
      cachedAvailableDiffs = availableDiffs;
      if (!diffBaselineIdVal || !availableDiffs) {
        cachedDiffBaseline = null;
      } else {
        const found = availableDiffs.find(d => d.id === diffBaselineIdVal);
        cachedDiffBaseline = found ? new Uint8Array(found.buffer) : null;
      }
    }
    return cachedDiffBaseline;
  }

  function getDiffStats(data: Uint8Array, diffBaseline: Uint8Array | null): { changed: number; total: number; baseTotal: number } | null {
    if (data !== cachedDiffStatsData || diffBaseline !== cachedDiffStatsBaseline) {
      cachedDiffStatsData = data;
      cachedDiffStatsBaseline = diffBaseline;
      if (!diffBaseline) {
        cachedDiffStats = null;
      } else {
        let changed = 0;
        const len = Math.min(data.byteLength, diffBaseline.byteLength);
        for (let i = 0; i < len; i++) {
          if (data[i] !== diffBaseline[i]) changed++;
        }
        cachedDiffStats = { changed, total: data.byteLength, baseTotal: diffBaseline.byteLength };
      }
    }
    return cachedDiffStats;
  }

  function getDiffRows(data: Uint8Array, diffBaseline: Uint8Array | null): number[] {
    if (data !== cachedDiffData || diffBaseline !== cachedDiffBaselineForRows) {
      cachedDiffData = data;
      cachedDiffBaselineForRows = diffBaseline;
      cachedDiffRows = diffBaseline ? buildDiffRows(data, diffBaseline) : [];
    }
    return cachedDiffRows;
  }

  function getStrings(show: boolean, buffer: ArrayBuffer, data: Uint8Array): { offset: number; str: string }[] {
    if (show !== cachedStringsShow || buffer !== cachedStringsBuffer) {
      cachedStringsShow = show;
      cachedStringsBuffer = buffer;
      cachedStrings = show ? extractStrings(data) : [];
    }
    return cachedStrings;
  }

  function scrollToRow(row: number) {
    const target = Math.max(0, row * ROW_HEIGHT - containerHeight / 3);
    if (scrollNode) {
      programmaticScroll = true;
      scrollNode.scrollTop = target;
      scrollTop = target;
    }
    highlightRow = row;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => { highlightRow = null; m.redraw(); }, 2000);
  }

  function scrollToOffset(byteOffset: number) {
    scrollToRow(Math.floor(byteOffset / BYTES_PER_ROW));
  }

  function handleCopy(data: Uint8Array, regionMap: RegionSpan[] | undefined, addrWidth: number | undefined) {
    const maxCopyRows = 65_536;
    const text = formatHexDump(data, maxCopyRows, regionMap, addrWidth);
    navigator.clipboard.writeText(text).then(() => {
      copied = true;
      m.redraw();
      setTimeout(() => { copied = false; m.redraw(); }, 1500);
    });
  }

  function handleMinimapClick(e: MouseEvent, diffRows: number[], totalRows: number) {
    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const targetRow = Math.floor((y / containerHeight) * totalRows);
    if (diffRows.length === 0) return;
    let lo = 0, hi = diffRows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (diffRows[mid] < targetRow) lo = mid + 1; else hi = mid;
    }
    let idx = lo;
    if (lo > 0 && lo < diffRows.length && Math.abs(diffRows[lo - 1] - targetRow) < Math.abs(diffRows[lo] - targetRow)) {
      idx = lo - 1;
    }
    if (idx >= 0 && idx < diffRows.length) {
      currentDiffIdx = idx;
      scrollToRow(diffRows[idx]);
    }
  }

  function renderMinimap(diffBaseline: Uint8Array | null, diffRows: number[], totalRows: number) {
    const canvas = diffMinimapCanvas;
    if (!canvas || !diffBaseline || diffRows.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 6;
    const h = containerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ah-diff-marker").trim();
    const markH = Math.max(1, h / totalRows);
    for (const row of diffRows) {
      ctx.fillRect(0, (row / totalRows) * h, w, markH);
    }
    // Viewport indicator
    const vpTop = (scrollTop / (totalRows * ROW_HEIGHT)) * h;
    const vpH = (containerHeight / (totalRows * ROW_HEIGHT)) * h;
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, vpTop + 0.5, w - 1, vpH);
  }

  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  function installKeyHandler(diffBaseline: Uint8Array | null, diffRows: number[]) {
    removeKeyHandler();
    if (!diffBaseline || diffRows.length === 0) return;
    keyHandler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        let idx: number;
        if (currentDiffIdx >= 0 && currentDiffIdx < diffRows.length - 1) {
          idx = currentDiffIdx + 1;
        } else {
          const centerRow = Math.floor((scrollTop + containerHeight / 2) / ROW_HEIGHT);
          idx = findDiffIndex(diffRows, centerRow, "next");
        }
        if (idx >= 0 && idx < diffRows.length) {
          currentDiffIdx = idx;
          scrollToRow(diffRows[idx]);
          m.redraw();
        }
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        let idx: number;
        if (currentDiffIdx >= 0 && currentDiffIdx > 0) {
          idx = currentDiffIdx - 1;
        } else {
          const centerRow = Math.floor((scrollTop + containerHeight / 2) / ROW_HEIGHT);
          idx = findDiffIndex(diffRows, centerRow, "prev");
        }
        if (idx >= 0) {
          currentDiffIdx = idx;
          scrollToRow(diffRows[idx]);
          m.redraw();
        }
      }
    };
    document.addEventListener("keydown", keyHandler);
  }

  function removeKeyHandler() {
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler);
      keyHandler = null;
    }
  }

  return {
    oncreate() {
      // Key handler is installed/updated in view via onupdate-like logic
    },
    onremove() {
      removeKeyHandler();
      if (highlightTimer) clearTimeout(highlightTimer);
    },
    view(vnode) {
      const { buffer, name, regions, availableDiffs } = vnode.attrs;
      const data = getData(buffer);
      const totalRows = Math.ceil(data.byteLength / BYTES_PER_ROW);
      const regionMap = getRegionMap(regions);
      const addrWidth = getAddrWidth(regionMap);
      const diffBaseline = getDiffBaseline(diffBaselineId, availableDiffs);
      const diffStats = getDiffStats(data, diffBaseline);
      const diffRows = getDiffRows(data, diffBaseline);
      const separators = regionMap && regionMap.length > 1 ? regionSeparatorRows(regionMap) : [];
      const strings = getStrings(showStrings, buffer, data);

      // Reset diff navigation when baseline changes
      if (diffBaselineId !== prevDiffBaselineId) {
        prevDiffBaselineId = diffBaselineId;
        currentDiffIdx = -1;
      }

      // Re-install key handler (references closure vars directly, so always current)
      installKeyHandler(diffBaseline, diffRows);

      const filteredStrings = stringFilter
        ? strings.filter(s => s.str.toLowerCase().includes(stringFilter.toLowerCase()))
        : strings;
      const displayStrings = filteredStrings.slice(0, stringShowCount);

      const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
      const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);

      // Build visible rows — plain strings for normal mode
      const lines: string[] | null = diffBaseline ? null : (() => {
        const result: string[] = [];
        for (let i = startRow; i < endRow; i++) {
          const offset = i * BYTES_PER_ROW;
          const vmaAddr = regionMap ? offsetToVmaAddr(offset, regionMap) : undefined;
          result.push(formatRow(data, offset, data.byteLength, vmaAddr, addrWidth));
        }
        return result;
      })();

      // Visible region separators
      const visibleSeparators = separators.filter(s => s.row >= startRow && s.row < endRow);

      // Capture diffRows/totalRows for minimap click closure
      const diffRowsForMinimap = diffRows;
      const totalRowsForMinimap = totalRows;

      return m("div", null,
        m("div", { className: "ah-hex-toolbar" },
          m("h2", { className: "ah-view-heading ah-truncate", style: { marginBottom: 0 } }, name),
          m("span", { style: { fontSize: "0.875rem", color: "var(--ah-text-muted)" } }, fmtSize(data.byteLength)),
          m("span", { style: { fontSize: "0.75rem", color: "var(--ah-text-faint)" } }, totalRows.toLocaleString(), " rows"),
          m("div", { className: "ah-hex-toolbar__actions" },
            availableDiffs && availableDiffs.length > 0 && (
              m("select", {
                className: "ah-hex-select",
                value: diffBaselineId ?? "",
                onchange: (e: Event) => { diffBaselineId = (e.target as HTMLSelectElement).value || null; },
              },
                m("option", { value: "" }, "Compare", "\u2026"),
                availableDiffs.map(d =>
                  m("option", { key: d.id, value: d.id }, d.name)
                )
              )
            ),
            m("button", {
              className: `ah-hex-btn${showStrings ? " ah-hex-btn--active" : ""}`,
              onclick: () => { showStrings = !showStrings; },
            }, "Strings"),
            m("button", {
              className: "ah-hex-btn",
              onclick: () => handleCopy(data, regionMap, addrWidth),
            }, copied ? "Copied" : "Copy"),
            m("button", {
              className: "ah-hex-btn",
              onclick: () => downloadBlob(name + ".bin", buffer),
            }, "Download")
          )
        ),
        regionMap && regionMap.length > 0 && (
          m("div", { className: "ah-hex-vma-info" },
            regionMap.length === 1
              ? m(Fragment, null, "VMA ", regionMap[0].vmaBase.toString(16).padStart(addrWidth ?? 8, "0"), "\u2013", (regionMap[0].vmaBase + regionMap[0].offsetEnd).toString(16).padStart(addrWidth ?? 8, "0"))
              : m(Fragment, null, regionMap.length, " VMA regions"))
        ),
        diffStats && (
          m("div", { className: "ah-hex-stats" },
            m("span", null,
              m("span", { className: "ah-mono", style: { color: "var(--ah-warning-text)" } }, diffStats.changed.toLocaleString()), " bytes differ",
              " ", "of ", fmtSize(diffStats.total),
              diffStats.total !== diffStats.baseTotal && (
                m("span", { className: "ah-ml-2" }, "(baseline: ", fmtSize(diffStats.baseTotal), ")")
              )
            ),
            diffRows.length > 0 && m(Fragment, null,
              m("span", { style: { color: "var(--ah-text-fainter)" } }, "|"),
              m("span", { className: "ah-mono" },
                currentDiffIdx >= 0
                  ? m(Fragment, null, m("span", { style: { color: "var(--ah-warning-text)" } }, currentDiffIdx + 1), " of ", diffRows.length.toLocaleString(), " diff rows")
                  : m(Fragment, null, diffRows.length.toLocaleString(), " diff rows")
              ),
              m("span", { style: { color: "var(--ah-text-fainter)", fontSize: "10px" } }, "n/p to navigate")
            )
          )
        ),
        m("div", { className: "ah-hex-container" },
          // Hex dump
          m("div", { className: "ah-hex-content" },
            m("div", {
              className: "ah-hex-scroll",
              style: { height: containerHeight },
              oncreate: (vn: m.VnodeDOM) => {
                const node = vn.dom as HTMLDivElement;
                scrollNode = node;
                const h = Math.min(window.innerHeight - 160, totalRows * ROW_HEIGHT);
                containerHeight = Math.max(200, h);
                m.redraw();
              },
              onscroll: (e: Event) => {
                scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
                if (programmaticScroll) programmaticScroll = false;
                else currentDiffIdx = -1;
              },
            },
              m("div", { style: { height: totalRows * ROW_HEIGHT, position: "relative" } },
                highlightRow !== null && highlightRow >= startRow && highlightRow < endRow && (
                  m("div", {
                    className: "ah-hex-highlight",
                    style: { top: highlightRow * ROW_HEIGHT, height: ROW_HEIGHT },
                  })
                ),
                // VMA region separators
                visibleSeparators.map(sep =>
                  m("div", {
                    key: `sep-${sep.row}`,
                    className: "ah-hex-separator",
                    style: { top: sep.row * ROW_HEIGHT - 1 },
                  },
                    m("span", { className: "ah-hex-separator__label" },
                      sep.vmaBase.toString(16).padStart(addrWidth ?? 8, "0"))
                  )
                ),
                diffBaseline ? (
                  // Diff mode: per-row divs with per-byte highlighting
                  Array.from({ length: endRow - startRow }, (_, idx) => {
                    const i = startRow + idx;
                    const offset = i * BYTES_PER_ROW;
                    const vmaAddr = regionMap ? offsetToVmaAddr(offset, regionMap) : undefined;
                    const segments = formatRowSegments(data, offset, data.byteLength, diffBaseline, diffBaseline.byteLength, vmaAddr, addrWidth);
                    return m("div", {
                      key: i,
                      className: "ah-hex-row",
                      style: { position: "absolute", top: i * ROW_HEIGHT, height: ROW_HEIGHT, padding: "0 8px" },
                    },
                      segments.map((s, si) =>
                        s.diff
                          ? m("span", { key: si, className: "ah-hex-row--diff" }, s.text)
                          : m("span", { key: si }, s.text)
                      )
                    );
                  })
                ) : (
                  // Normal mode: single pre block
                  m("pre", {
                    className: "ah-hex-row",
                    style: { position: "absolute", top: startRow * ROW_HEIGHT, left: 0, padding: "0 8px" },
                  }, lines!.join("\n"))
                )
              )
            ),
            // Diff minimap gutter
            diffBaseline && diffRows.length > 0 && (
              m("canvas", {
                className: "ah-hex-minimap",
                style: { width: 6, height: containerHeight },
                oncreate: (vn: m.VnodeDOM) => {
                  diffMinimapCanvas = vn.dom as HTMLCanvasElement;
                  renderMinimap(diffBaseline, diffRows, totalRows);
                },
                onupdate: () => {
                  renderMinimap(diffBaseline, diffRows, totalRows);
                },
                onclick: (e: MouseEvent) => handleMinimapClick(e, diffRowsForMinimap, totalRowsForMinimap),
              })
            )
          ),

          // Strings panel
          showStrings && (
            m("div", { className: "ah-hex-strings", style: { height: containerHeight } },
              m("div", { className: "ah-hex-strings__header" },
                m("input", {
                  className: "ah-hex-strings__input",
                  placeholder: "Filter strings\u2026",
                  value: stringFilter,
                  oninput: (e: Event) => { stringFilter = (e.target as HTMLInputElement).value; },
                  oncreate: (vn: m.VnodeDOM) => { (vn.dom as HTMLInputElement).focus(); },
                }),
                m("div", { className: "ah-hex-strings__count" },
                  filteredStrings.length === strings.length
                    ? `${strings.length.toLocaleString()} strings`
                    : `${filteredStrings.length.toLocaleString()} / ${strings.length.toLocaleString()}`,
                  ` (\u2265${MIN_STRING_LEN} chars)`)
              ),
              m("div", { className: "ah-hex-strings__list" },
                displayStrings.map((s, i) => {
                  const vma = regionMap ? offsetToVmaAddr(s.offset, regionMap) : undefined;
                  return m("div", {
                    key: i,
                    className: "ah-hex-strings__row",
                    onclick: () => scrollToOffset(s.offset),
                    title: `Offset: 0x${s.offset.toString(16)}${vma !== undefined ? ` | VMA: 0x${vma.toString(16)}` : ""}`,
                  },
                    m("span", { className: "ah-hex-strings__offset" },
                      (vma ?? s.offset).toString(16).padStart(vma !== undefined ? (addrWidth ?? 8) : 8, "0")),
                    m("span", { className: "ah-hex-strings__value" }, s.str)
                  );
                }),
                filteredStrings.length > stringShowCount && (
                  m("div", { style: { padding: "0.5rem", fontSize: "10px", color: "var(--ah-text-faint)", textAlign: "center" } },
                    "Showing ", stringShowCount.toLocaleString(), " of ", filteredStrings.length.toLocaleString(),
                    " \u2014 ",
                    m("button", { className: "ah-more-link", onclick: () => { stringShowCount = Math.min(stringShowCount + 5_000, filteredStrings.length); } }, "show more"),
                    " ",
                    m("button", { className: "ah-more-link", onclick: () => { stringShowCount = filteredStrings.length; } }, "show all"))
                )
              )
            )
          )
        )
      );
    },
  };
}

export default HexView;
