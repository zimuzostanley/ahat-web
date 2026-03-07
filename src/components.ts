import m from "mithril";
import type { InstanceRow, PrimOrRef } from "./hprof.worker";
import { type NavState, navLabel } from "./routing";

// ─── Navigation types ─────────────────────────────────────────────────────────

export type NavFn = (view: string, params?: Record<string, unknown>) => void;

// ─── Reusable components ──────────────────────────────────────────────────────

export const SHOW_LIMIT = 200;

/** Minimal shape for rendering a clickable object link. */
export type ObjLinkRef = { id: number; display: string; str?: string | null };

interface InstanceLinkAttrs { row: InstanceRow | ObjLinkRef | null; navigate: NavFn }
export function InstanceLink(): m.Component<InstanceLinkAttrs> {
  return {
    view(vnode) {
      const { row, navigate } = vnode.attrs;
      if (!row || row.id === 0) return m("span", { className: "ah-badge-referent" }, "ROOT");
      const full = "className" in row ? row : null;
      return m("span", null,
        full && full.reachabilityName !== "unreachable" && full.reachabilityName !== "strong" && (
          m("span", { className: "ah-badge-reachability" }, full.reachabilityName)
        ),
        full?.isRoot && m("span", { className: "ah-badge-root" }, "root"),
        m("button", {
          className: "ah-link",
          onclick: () => navigate("object", { id: row.id, label: row.display }),
        }, row.display),
        row.str != null && (
          m("span", { className: "ah-badge-string", title: row.str.length > 80 ? row.str : undefined },
            "\"", row.str.length > 80 ? row.str.slice(0, 80) + "\u2026" : row.str, "\"")
        ),
        full?.referent && (
          m("span", { className: "ah-badge-referent" },
            " ", "for ", m(InstanceLink, { row: full.referent, navigate }))
        )
      );
    },
  };
}

interface SiteLinkRawAttrs {
  id: number; method: string; signature: string; filename: string; line: number; navigate: NavFn;
}
export function SiteLinkRaw(): m.Component<SiteLinkRawAttrs> {
  return {
    view(vnode) {
      const { id, method, signature, filename, line, navigate } = vnode.attrs;
      const text = `${method}${signature} - ${filename}${line > 0 ? ":" + line : ""}`;
      return m("button", {
        className: "ah-link",
        onclick: () => navigate("site", { id }),
      }, text);
    },
  };
}

interface SectionAttrs { title: string; defaultOpen?: boolean }
export function Section(): m.Component<SectionAttrs> {
  let open = true;
  return {
    oninit(vnode) { open = vnode.attrs.defaultOpen !== false; },
    view(vnode) {
      return m("div", { className: "ah-section" },
        m("button", {
          className: "ah-section__toggle",
          onclick: () => { open = !open; },
          "aria-expanded": open,
        },
          m("span", { className: "ah-section__title" }, vnode.attrs.title),
          m("svg", { className: `ah-section__chevron${open ? " ah-section__chevron--open" : ""}`, viewBox: "0 0 20 20", fill: "currentColor" },
            m("path", { fillRule: "evenodd", d: "M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z", clipRule: "evenodd" })
          )
        ),
        open && m("div", { className: "ah-section__body" }, vnode.children)
      );
    },
  };
}

interface SortableTableColumn<T> {
  label: string;
  align?: string;
  minWidth?: string;
  sortKey?: (row: T) => number;
  render: (row: T, idx: number) => m.Children;
}

interface SortableTableAttrs<T> {
  columns: SortableTableColumn<T>[];
  data: T[];
  limit?: number;
  rowKey?: (row: T, idx: number) => string | number;
  onRowClick?: (row: T) => void;
}

export function SortableTable<T>(): m.Component<SortableTableAttrs<T>> {
  let sortCol: number | null = null;
  let sortAsc = false;
  let showCount = SHOW_LIMIT;

  return {
    oninit(vnode) {
      showCount = vnode.attrs.limit ?? SHOW_LIMIT;
    },
    view(vnode) {
      const { columns, data, rowKey, onRowClick } = vnode.attrs;

      let sorted: T[];
      if (sortCol === null || !columns[sortCol].sortKey) {
        sorted = data;
      } else {
        const key = columns[sortCol].sortKey!;
        sorted = [...data].sort((a, b) => sortAsc ? key(a) - key(b) : key(b) - key(a));
      }

      const visible = sorted.slice(0, showCount);

      return m("div", { className: "ah-table-wrap" },
        m("table", { className: "ah-table" },
          m("thead", null,
            m("tr", null,
              columns.map((c, i) =>
                m("th", {
                  key: i,
                  className: `ah-th${c.align === "right" ? " ah-th--right" : ""}`,
                  style: c.minWidth ? { minWidth: c.minWidth } : undefined,
                  onclick: () => { if (sortCol === i) sortAsc = !sortAsc; else { sortCol = i; sortAsc = false; } },
                }, c.label, " ", sortCol === i ? (sortAsc ? "\u25B2" : "\u25BC") : "")
              )
            )
          ),
          m("tbody", null,
            visible.map((row, ri) =>
              m("tr", { key: rowKey ? rowKey(row, ri) : ri, className: `ah-tr${onRowClick ? " ah-tr--clickable" : ""}`, onclick: onRowClick ? () => onRowClick(row) : undefined },
                columns.map((c, ci) =>
                  m("td", { key: ci, className: `ah-td${c.align === "right" ? " ah-td--right" : ""}`, style: c.minWidth ? { minWidth: c.minWidth } : undefined },
                    c.render(row, ri))
                )
              )
            )
          )
        ),
        sorted.length > showCount && (
          m("div", { className: "ah-table__more" },
            "Showing ", showCount, " of ", sorted.length,
            " \u2014 ",
            m("button", { className: "ah-more-link", onclick: () => { showCount = Math.min(showCount + 500, sorted.length); } }, "show more"),
            " ",
            m("button", { className: "ah-more-link", onclick: () => { showCount = sorted.length; } }, "show all"))
        )
      );
    },
  };
}

interface PrimOrRefCellAttrs { v: PrimOrRef; navigate: NavFn }
export function PrimOrRefCell(): m.Component<PrimOrRefCellAttrs> {
  return {
    view(vnode) {
      const { v, navigate } = vnode.attrs;
      if (v.kind === "ref") {
        return m(InstanceLink, { row: { id: v.id, display: v.display, str: v.str }, navigate });
      }
      return m("span", { className: "ah-mono" }, v.v);
    },
  };
}

/** Renders a bitmap from either raw RGBA data or a compressed image blob. */
export function BitmapImage(): m.Component<{ width: number; height: number; format: string; data: Uint8Array }> {
  let blobUrl: string | null = null;

  return {
    oncreate(vnode) {
      const { width, height, format, data } = vnode.attrs;
      if (format === "rgba") {
        const canvas = vnode.dom as HTMLCanvasElement;
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
      blobUrl = URL.createObjectURL(blob);
      m.redraw();
    },
    onremove() {
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    },
    view(vnode) {
      const { format } = vnode.attrs;
      if (format === "rgba") {
        return m("canvas", { style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", imageRendering: "pixelated" } });
      }
      if (!blobUrl) return null;
      return m("img", { src: blobUrl, style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", imageRendering: "pixelated" } });
    },
  };
}

// ─── Breadcrumbs ─────────────────────────────────────────────────────────────

export interface BreadcrumbEntry {
  state: NavState;
  label: string;
}

/** Build a BreadcrumbEntry from a NavState. */
export function makeCrumb(state: NavState): BreadcrumbEntry {
  return { state, label: navLabel(state) };
}

interface BreadcrumbsAttrs {
  trail: BreadcrumbEntry[];
  activeIndex: number;
  onNavigate: (index: number) => void;
}
export function Breadcrumbs(): m.Component<BreadcrumbsAttrs> {
  return {
    view(vnode) {
      const { trail, activeIndex, onNavigate } = vnode.attrs;
      if (trail.length <= 1) return null;
      return m("nav", { className: "ah-breadcrumbs", "aria-label": "Breadcrumb" },
        m("button", {
          className: "ah-breadcrumbs__back",
          onclick: () => history.back(),
          title: "Back",
          "aria-label": "Back",
        },
          m("svg", { className: "ah-breadcrumbs__back-icon", viewBox: "0 0 20 20", fill: "currentColor" },
            m("path", { fillRule: "evenodd", d: "M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z", clipRule: "evenodd" })
          )
        ),
        trail.map((crumb, i) => {
          const isActive = i === activeIndex;
          return m("span", { key: i, className: "ah-breadcrumbs__item" },
            i > 0 && m("span", { className: "ah-breadcrumbs__sep" }, "/"),
            isActive ? (
              m("span", { className: "ah-breadcrumbs__active" }, crumb.label)
            ) : (
              m("button", {
                className: `ah-breadcrumbs__link ${i > activeIndex
                  ? "ah-breadcrumbs__link--future"
                  : "ah-breadcrumbs__link--past"}`,
                onclick: () => onNavigate(i),
              }, crumb.label)
            )
          );
        })
      );
    },
  };
}
