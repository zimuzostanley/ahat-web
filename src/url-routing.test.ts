import { describe, it, expect } from 'vitest';
import { stateToUrl, urlToState } from './routing';

describe('URL routing', () => {
  describe('stateToUrl', () => {
    it('generates / for overview', () => {
      expect(stateToUrl({ view: "overview", params: {} })).toBe("/");
    });

    it('generates /rooted', () => {
      expect(stateToUrl({ view: "rooted", params: {} })).toBe("/rooted");
    });

    it('generates /object?id=0x... with hex id', () => {
      expect(stateToUrl({ view: "object", params: { id: 0x12345678 } })).toBe("/object?id=0x12345678");
    });

    it('generates /object?id=0x0 for zero id', () => {
      expect(stateToUrl({ view: "object", params: { id: 0 } })).toBe("/object?id=0x0");
    });

    it('generates /objects with site id, class, and heap', () => {
      const url = stateToUrl({ view: "objects", params: { siteId: 42, className: "java.lang.String", heap: "app" } });
      expect(url).toContain("/objects?");
      expect(url).toContain("id=42");
      expect(url).toContain("class=java.lang.String");
      expect(url).toContain("heap=app");
    });

    it('generates /objects without heap when null', () => {
      const url = stateToUrl({ view: "objects", params: { siteId: 5, className: "int[]", heap: null } });
      expect(url).toContain("id=5");
      expect(url).toContain("class=int");
      expect(url).not.toContain("heap=");
    });

    it('generates /site?id=N with decimal id', () => {
      expect(stateToUrl({ view: "site", params: { id: 123 } })).toBe("/site?id=123");
    });

    it('generates /search with query', () => {
      expect(stateToUrl({ view: "search", params: { q: "String" } })).toBe("/search?q=String");
    });

    it('generates /search without query', () => {
      expect(stateToUrl({ view: "search", params: { q: "" } })).toBe("/search");
    });

    it('generates /bitmaps', () => {
      expect(stateToUrl({ view: "bitmaps", params: {} })).toBe("/bitmaps");
    });

    it('generates /bitmaps?id=0x... with selected bitmap', () => {
      expect(stateToUrl({ view: "bitmaps", params: { id: 0xABC } })).toBe("/bitmaps?id=0xabc");
    });

    it('generates /strings', () => {
      expect(stateToUrl({ view: "strings", params: {} })).toBe("/strings");
    });

    it('generates /strings?q=... with query', () => {
      expect(stateToUrl({ view: "strings", params: { q: "hello" } })).toBe("/strings?q=hello");
    });

    it('generates /strings without query when empty', () => {
      expect(stateToUrl({ view: "strings", params: {} })).toBe("/strings");
    });
  });

  describe('urlToState', () => {
    const u = (s: string) => new URL(s, "http://localhost");

    it('parses / as overview', () => {
      expect(urlToState(u("/"))).toEqual({ view: "overview", params: {} });
    });

    it('parses /rooted', () => {
      expect(urlToState(u("/rooted"))).toEqual({ view: "rooted", params: {} });
    });

    it('parses /object?id=0x12345678', () => {
      const state = urlToState(u("/object?id=0x12345678"));
      expect(state.view).toBe("object");
      expect(state.params).toEqual({ id: 0x12345678 });
    });

    it('parses /object?id=305419896 (decimal)', () => {
      const state = urlToState(u("/object?id=305419896"));
      expect(state.view).toBe("object");
      expect(state.params).toEqual({ id: 305419896 });
    });

    it('parses /objects?id=42&class=java.lang.String&heap=app', () => {
      const state = urlToState(u("/objects?id=42&class=java.lang.String&heap=app"));
      expect(state.view).toBe("objects");
      expect(state.params).toEqual({ siteId: 42, className: "java.lang.String", heap: "app" });
    });

    it('parses /objects without heap', () => {
      const state = urlToState(u("/objects?id=5&class=int[]"));
      expect(state.view).toBe("objects");
      expect(state.params).toEqual({ siteId: 5, className: "int[]", heap: null });
    });

    it('parses /site?id=123', () => {
      const state = urlToState(u("/site?id=123"));
      expect(state.view).toBe("site");
      expect(state.params).toEqual({ id: 123 });
    });

    it('parses /search?q=String', () => {
      const state = urlToState(u("/search?q=String"));
      expect(state.view).toBe("search");
      expect(state.params).toEqual({ q: "String" });
    });

    it('parses /bitmaps', () => {
      expect(urlToState(u("/bitmaps"))).toEqual({ view: "bitmaps", params: {} });
    });

    it('parses /bitmaps?id=0xabc with selected bitmap', () => {
      const state = urlToState(u("/bitmaps?id=0xabc"));
      expect(state.view).toBe("bitmaps");
      expect(state.params).toEqual({ id: 0xABC });
    });

    it('parses /bitmaps?id=2748 (decimal) with selected bitmap', () => {
      const state = urlToState(u("/bitmaps?id=2748"));
      expect(state.view).toBe("bitmaps");
      expect(state.params).toEqual({ id: 2748 });
    });

    it('parses unknown paths as overview', () => {
      expect(urlToState(u("/unknown"))).toEqual({ view: "overview", params: {} });
    });

    it('handles invalid hex chars in object id (falls back to 0)', () => {
      const state = urlToState(u("/object?id=0xZZZZ"));
      expect(state.view).toBe("object");
      expect(state.params).toEqual({ id: 0 });
    });

    it('handles missing id param on /object', () => {
      const state = urlToState(u("/object"));
      expect(state.view).toBe("object");
      expect(state.params).toEqual({ id: 0 });
    });

    it('handles trailing slash', () => {
      expect(urlToState(u("/rooted/"))).toEqual({ view: "rooted", params: {} });
    });

    it('handles non-ASCII search query', () => {
      const url = stateToUrl({ view: "search", params: { q: "日本語" } });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("search");
      expect(state.params).toEqual({ q: "日本語" });
    });

    it('handles empty id on /bitmaps', () => {
      const state = urlToState(u("/bitmaps?id="));
      expect(state.view).toBe("bitmaps");
      expect(state.params).toEqual({});
    });

    it('parses /strings', () => {
      expect(urlToState(u("/strings"))).toEqual({ view: "strings", params: {} });
    });

    it('parses /strings?q=hello', () => {
      const state = urlToState(u("/strings?q=hello"));
      expect(state.view).toBe("strings");
      expect(state.params).toEqual({ q: "hello" });
    });

    it('parses /strings without query param as empty params', () => {
      const state = urlToState(u("/strings"));
      expect(state.view).toBe("strings");
      expect(state.params).toEqual({});
    });
  });

  describe('roundtrip', () => {
    it('overview roundtrips', () => {
      const url = stateToUrl({ view: "overview", params: {} });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("overview");
    });

    it('object roundtrips', () => {
      const id = 0xDEADBEEF;
      const url = stateToUrl({ view: "object", params: { id } });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("object");
      expect(state.params).toEqual({ id });
    });

    it('site roundtrips', () => {
      const url = stateToUrl({ view: "site", params: { id: 999 } });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("site");
      expect(state.params).toEqual({ id: 999 });
    });

    it('objects roundtrips', () => {
      const params = { siteId: 7, className: "android.view.View", heap: "app" as string | null };
      const url = stateToUrl({ view: "objects", params });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("objects");
      expect(state.params).toEqual(params);
    });

    it('search roundtrips', () => {
      const url = stateToUrl({ view: "search", params: { q: "java.lang" } });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("search");
      expect(state.params).toEqual({ q: "java.lang" });
    });

    it('bitmaps roundtrips', () => {
      const url = stateToUrl({ view: "bitmaps", params: {} });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("bitmaps");
    });

    it('bitmaps with selected id roundtrips', () => {
      const id = 0xDEAD;
      const url = stateToUrl({ view: "bitmaps", params: { id } });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("bitmaps");
      expect(state.params).toEqual({ id });
    });

    it('strings roundtrips', () => {
      const url = stateToUrl({ view: "strings", params: {} });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("strings");
    });

    it('strings with query roundtrips', () => {
      const url = stateToUrl({ view: "strings", params: { q: "android.view" } });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("strings");
      expect(state.params).toEqual({ q: "android.view" });
    });
  });
});
