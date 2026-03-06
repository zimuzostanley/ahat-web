import { useState, useRef, useMemo, useEffect } from "react";
import type { InstanceRow, PrimOrRef } from "./hprof.worker";

// ─── Navigation types ─────────────────────────────────────────────────────────

export type NavFn = (view: string, params?: Record<string, unknown>) => void;

// ─── Reusable components ──────────────────────────────────────────────────────

export const SHOW_LIMIT = 200;

/** Minimal shape for rendering a clickable object link. */
export type ObjLinkRef = { id: number; display: string; str?: string | null };

export function InstanceLink({ row, navigate }: { row: InstanceRow | ObjLinkRef | null; navigate: NavFn }) {
  if (!row || row.id === 0) return <span className="text-stone-500 dark:text-stone-400">ROOT</span>;
  const full = "className" in row ? row : null;
  return (
    <span>
      {full && full.reachabilityName !== "unreachable" && full.reachabilityName !== "strong" && (
        <span className="text-amber-600 dark:text-amber-400 text-xs mr-1">{full.reachabilityName}</span>
      )}
      {full?.isRoot && <span className="text-rose-500 dark:text-rose-400 text-xs mr-1">root</span>}
      <button
        className="text-sky-700 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300 underline decoration-sky-300 hover:decoration-sky-500 dark:decoration-sky-600 dark:hover:decoration-sky-400"
        onClick={() => navigate("object", { id: row.id })}
      >
        {row.display}
      </button>
      {row.str != null && (
        <span className="text-emerald-700 dark:text-emerald-400 ml-1" title={row.str.length > 80 ? row.str : undefined}>
          "{row.str.length > 80 ? row.str.slice(0, 80) + "\u2026" : row.str}"
        </span>
      )}
      {full?.referent && (
        <span className="text-stone-500 dark:text-stone-400 ml-1">
          {" "}for <InstanceLink row={full.referent} navigate={navigate} />
        </span>
      )}
    </span>
  );
}

export function SiteLinkRaw({ id, method, signature, filename, line, navigate }: {
  id: number; method: string; signature: string; filename: string; line: number; navigate: NavFn;
}) {
  const text = `${method}${signature} - ${filename}${line > 0 ? ":" + line : ""}`;
  return (
    <button
      className="text-sky-700 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300 underline decoration-sky-300 hover:decoration-sky-500 dark:decoration-sky-600 dark:hover:decoration-sky-400"
      onClick={() => navigate("site", { id })}
    >{text}</button>
  );
}

export function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700">
      <button
        className="w-full px-4 py-2 flex justify-between items-center text-left hover:bg-stone-50 dark:hover:bg-stone-800"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">{title}</span>
        <svg className={`w-3 h-3 text-stone-400 dark:text-stone-500 transition-transform ${open ? "rotate-90" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
      </button>
      {open && <div className="px-4 pb-3 border-t border-stone-100 dark:border-stone-800 pt-3 overflow-x-auto">{children}</div>}
    </div>
  );
}

export function SortableTable<T>({ columns, data, limit = SHOW_LIMIT, rowKey }: {
  columns: {
    label: string;
    align?: string;
    minWidth?: string;
    sortKey?: (row: T) => number;
    render: (row: T, idx: number) => React.ReactNode;
  }[];
  data: T[];
  limit?: number;
  rowKey?: (row: T, idx: number) => string | number;
}) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [showCount, setShowCount] = useState(limit);

  const sorted = useMemo(() => {
    if (sortCol === null || !columns[sortCol].sortKey) return data;
    const key = columns[sortCol].sortKey!;
    const copy = [...data];
    copy.sort((a, b) => sortAsc ? key(a) - key(b) : key(b) - key(a));
    return copy;
  }, [data, sortCol, sortAsc, columns]);

  const visible = sorted.slice(0, showCount);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-2 py-1.5 ${c.align === "right" ? "text-right" : "text-left"} bg-stone-700 dark:bg-stone-700 text-stone-200 text-xs font-medium cursor-pointer select-none whitespace-nowrap border-b border-stone-600`}
                style={c.minWidth ? { minWidth: c.minWidth } : undefined}
                onClick={() => { if (sortCol === i) setSortAsc(!sortAsc); else { setSortCol(i); setSortAsc(false); } }}
              >
                {c.label} {sortCol === i ? (sortAsc ? "\u25B2" : "\u25BC") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, ri) => (
            <tr key={rowKey ? rowKey(row, ri) : ri} className="border-b border-stone-200 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800">
              {columns.map((c, ci) => (
                <td key={ci} className={`px-2 py-1 ${c.align === "right" ? "text-right font-mono whitespace-nowrap" : ""}`} style={c.minWidth ? { minWidth: c.minWidth } : undefined}>
                  {c.render(row, ri)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > showCount && (
        <div className="text-xs text-stone-500 dark:text-stone-400 py-2">
          Showing {showCount} of {sorted.length}
          {" \u2014 "}
          <button className="text-sky-600 dark:text-sky-400 ml-1 hover:underline" onClick={() => setShowCount(Math.min(showCount + 500, sorted.length))}>show more</button>
          {" "}
          <button className="text-sky-600 dark:text-sky-400 ml-2 hover:underline" onClick={() => setShowCount(sorted.length)}>show all</button>
        </div>
      )}
    </div>
  );
}

export function PrimOrRefCell({ v, navigate }: { v: PrimOrRef; navigate: NavFn }) {
  if (v.kind === "ref") {
    return <InstanceLink row={{ id: v.id, display: v.display, str: v.str }} navigate={navigate} />;
  }
  return <span className="font-mono">{v.v}</span>;
}

/** Renders a bitmap from either raw RGBA data or a compressed image blob. */
export function BitmapImage({ width, height, format, data }: {
  width: number; height: number; format: string; data: Uint8Array;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (format === "rgba") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const clamped = new Uint8ClampedArray(data.length);
      clamped.set(data);
      ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
      return;
    }
    const mimeMap: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
    const copy = new Uint8Array(data.length);
    copy.set(data);
    const blob = new Blob([copy], { type: mimeMap[format] ?? "image/png" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [width, height, format, data]);

  if (format === "rgba") {
    return <canvas ref={canvasRef} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", imageRendering: "pixelated" }} />;
  }
  if (!blobUrl) return null;
  return <img src={blobUrl} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", imageRendering: "pixelated" }} />;
}
