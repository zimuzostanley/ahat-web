export type NavState =
  | { view: "overview"; params: Record<string, never> }
  | { view: "rooted"; params: Record<string, never> }
  | { view: "object"; params: { id: number; label?: string } }
  | { view: "objects"; params: { siteId: number; className: string; heap: string | null } }
  | { view: "site"; params: { id: number } }
  | { view: "search"; params: { q: string } }
  | { view: "bitmaps"; params: { id?: number; dupKey?: string } }
  | { view: "strings"; params: { q?: string; exact?: boolean; heap?: string } };

/** Short human-readable label for a nav state (used in breadcrumbs). */
export function navLabel(state: NavState): string {
  switch (state.view) {
    case "overview": return "Overview";
    case "rooted": return "Rooted";
    case "object": return state.params.label ?? `Object 0x${state.params.id.toString(16)}`;
    case "objects": {
      const cls = state.params.className;
      const short = cls.includes(".") ? cls.slice(cls.lastIndexOf(".") + 1) : cls;
      return short || "Objects";
    }
    case "site": return state.params.id === 0 ? "Allocations" : `Site ${state.params.id}`;
    case "search": return "Search";
    case "bitmaps": return "Bitmaps";
    case "strings": return "Strings";
  }
}

export function stateToUrl(state: NavState): string {
  switch (state.view) {
    case "overview": return "/";
    case "rooted": return "/rooted";
    case "object": return `/object?id=0x${state.params.id.toString(16)}`;
    case "objects": {
      const sp = new URLSearchParams();
      sp.set("id", String(state.params.siteId));
      sp.set("class", state.params.className);
      if (state.params.heap) sp.set("heap", state.params.heap);
      return `/objects?${sp.toString()}`;
    }
    case "site": return `/site?id=${state.params.id}`;
    case "search": {
      const q = state.params.q;
      return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
    }
    case "bitmaps": {
      const sp = new URLSearchParams();
      if (state.params.id) sp.set("id", `0x${state.params.id.toString(16)}`);
      if (state.params.dupKey) sp.set("dup", state.params.dupKey);
      const qs = sp.toString();
      return qs ? `/bitmaps?${qs}` : "/bitmaps";
    }
    case "strings": {
      const sp = new URLSearchParams();
      if (state.params.q) sp.set("q", state.params.q);
      if (state.params.exact) sp.set("exact", "1");
      if (state.params.heap) sp.set("heap", state.params.heap);
      const qs = sp.toString();
      return qs ? `/strings?${qs}` : "/strings";
    }
  }
}

export function urlToState(url: URL): NavState {
  const path = url.pathname.replace(/\/$/, "") || "/";
  const sp = url.searchParams;

  switch (path) {
    case "/":
      return { view: "overview", params: {} };
    case "/rooted":
      return { view: "rooted", params: {} };
    case "/object": {
      const raw = sp.get("id") ?? "0";
      const id = raw.startsWith("0x") ? parseInt(raw.slice(2), 16) : parseInt(raw, 10);
      return { view: "object", params: { id: id || 0 } };
    }
    case "/objects": {
      const siteId = parseInt(sp.get("id") ?? "0", 10) || 0;
      const className = sp.get("class") ?? "";
      const heap = sp.get("heap") || null;
      return { view: "objects", params: { siteId, className, heap } };
    }
    case "/site": {
      const id = parseInt(sp.get("id") ?? "0", 10) || 0;
      return { view: "site", params: { id } };
    }
    case "/search": {
      const q = sp.get("q") ?? "";
      return { view: "search", params: { q } };
    }
    case "/bitmaps": {
      const raw = sp.get("id") ?? "";
      const selectedId = raw.startsWith("0x") ? parseInt(raw.slice(2), 16) : (raw ? parseInt(raw, 10) : 0);
      const dupKey = sp.get("dup") ?? undefined;
      const params: { id?: number; dupKey?: string } = {};
      if (selectedId) params.id = selectedId;
      if (dupKey) params.dupKey = dupKey;
      return { view: "bitmaps", params };
    }
    case "/strings": {
      const q = sp.get("q") ?? "";
      const exact = sp.get("exact") === "1";
      const heap = sp.get("heap") ?? undefined;
      const params: { q?: string; exact?: boolean; heap?: string } = {};
      if (q) params.q = q;
      if (exact) params.exact = true;
      if (heap) params.heap = heap;
      return { view: "strings", params };
    }
    default:
      return { view: "overview", params: {} };
  }
}
