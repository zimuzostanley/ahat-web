import { useState, useCallback } from "react";
import { fmtSize } from "../format";
import { downloadBlob } from "../utils";

const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 20;
const OVERSCAN = 10;

/** Format a single row: offset, hex bytes (two groups of 8), ASCII. */
export function formatRow(data: Uint8Array, offset: number, totalLen: number): string {
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
  const addr = offset.toString(16).padStart(8, "0");
  return `${addr}  ${hex.slice(0, 8).join(" ")}  ${hex.slice(8).join(" ")}  |${ascii.join("")}|`;
}

/** Generate full hex dump text (for copy). Caps at ~16MB of text output. */
export function formatHexDump(data: Uint8Array, maxRows = 1_000_000): string {
  const totalRows = Math.min(Math.ceil(data.byteLength / BYTES_PER_ROW), maxRows);
  const lines: string[] = [];
  for (let i = 0; i < totalRows; i++) {
    lines.push(formatRow(data, i * BYTES_PER_ROW, data.byteLength));
  }
  if (totalRows < Math.ceil(data.byteLength / BYTES_PER_ROW)) {
    lines.push(`... (truncated at ${totalRows} rows)`);
  }
  return lines.join("\n");
}

export default function HexView({ buffer, name }: { buffer: ArrayBuffer; name: string }) {
  const data = new Uint8Array(buffer);
  const totalRows = Math.ceil(data.byteLength / BYTES_PER_ROW);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [copied, setCopied] = useState(false);

  const measuredRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const h = Math.min(window.innerHeight - 160, totalRows * ROW_HEIGHT);
    setContainerHeight(Math.max(200, h));
  }, [totalRows]);

  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endRow = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);

  const lines: string[] = [];
  for (let i = startRow; i < endRow; i++) {
    lines.push(formatRow(data, i * BYTES_PER_ROW, data.byteLength));
  }

  const handleCopy = () => {
    const text = formatHexDump(data);
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
      <div
        ref={measuredRef}
        className="overflow-auto border border-stone-200 bg-white"
        style={{ height: containerHeight }}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: totalRows * ROW_HEIGHT, position: "relative" }}>
          <pre
            className="font-mono text-xs text-stone-800 leading-5 select-text whitespace-pre"
            style={{ position: "absolute", top: startRow * ROW_HEIGHT, left: 0, padding: "0 8px" }}
          >
            {lines.join("\n")}
          </pre>
        </div>
      </div>
    </div>
  );
}
