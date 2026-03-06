export type NavState =
  | { view: "overview"; params: Record<string, never> }
  | { view: "rooted"; params: Record<string, never> }
  | { view: "object"; params: { id: number } }
  | { view: "objects"; params: { siteId: number; className: string; heap: string | null } }
  | { view: "site"; params: { id: number } }
  | { view: "search"; params: { q: string } }
  | { view: "bitmaps"; params: { id?: number } }
  | { view: "strings"; params: { q?: string } };

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
      const id = state.params.id;
      return id ? `/bitmaps?id=0x${id.toString(16)}` : "/bitmaps";
    }
    case "strings": {
      const q = state.params.q;
      return q ? `/strings?q=${encodeURIComponent(q)}` : "/strings";
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
      return { view: "bitmaps", params: selectedId ? { id: selectedId } : {} };
    }
    case "/strings": {
      const q = sp.get("q") ?? "";
      return { view: "strings", params: q ? { q } : {} };
    }
    default:
      return { view: "overview", params: {} };
  }
}
