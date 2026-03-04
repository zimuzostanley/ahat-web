export interface NavState { view: string; params: Record<string, unknown> }

export function stateToUrl(view: string, params: Record<string, unknown>): string {
  switch (view) {
    case "overview": return "/";
    case "rooted": return "/rooted";
    case "object": return `/object?id=0x${Number(params.id ?? 0).toString(16)}`;
    case "objects": {
      const sp = new URLSearchParams();
      sp.set("id", String(params.siteId ?? 0));
      sp.set("class", String(params.className ?? ""));
      if (params.heap) sp.set("heap", String(params.heap));
      return `/objects?${sp.toString()}`;
    }
    case "site": return `/site?id=${params.id ?? 0}`;
    case "search": {
      const q = String(params.q ?? "");
      return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
    }
    case "bitmaps": {
      const bid = params.id ? `0x${Number(params.id).toString(16)}` : null;
      return bid ? `/bitmaps?id=${bid}` : "/bitmaps";
    }
    default: return "/";
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
    default:
      return { view: "overview", params: {} };
  }
}
