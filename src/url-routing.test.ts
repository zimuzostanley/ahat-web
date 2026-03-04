import { describe, it, expect } from 'vitest';
import { stateToUrl, urlToState } from './routing';

describe('URL routing', () => {
  describe('stateToUrl', () => {
    it('generates / for overview', () => {
      expect(stateToUrl("overview", {})).toBe("/");
    });

    it('generates /rooted', () => {
      expect(stateToUrl("rooted", {})).toBe("/rooted");
    });

    it('generates /object?id=0x... with hex id', () => {
      expect(stateToUrl("object", { id: 0x12345678 })).toBe("/object?id=0x12345678");
    });

    it('generates /object?id=0x0 for zero id', () => {
      expect(stateToUrl("object", { id: 0 })).toBe("/object?id=0x0");
    });

    it('generates /objects with site id, class, and heap', () => {
      const url = stateToUrl("objects", { siteId: 42, className: "java.lang.String", heap: "app" });
      expect(url).toContain("/objects?");
      expect(url).toContain("id=42");
      expect(url).toContain("class=java.lang.String");
      expect(url).toContain("heap=app");
    });

    it('generates /objects without heap when null', () => {
      const url = stateToUrl("objects", { siteId: 5, className: "int[]", heap: null });
      expect(url).toContain("id=5");
      expect(url).toContain("class=int");
      expect(url).not.toContain("heap=");
    });

    it('generates /site?id=N with decimal id', () => {
      expect(stateToUrl("site", { id: 123 })).toBe("/site?id=123");
    });

    it('generates /search with query', () => {
      expect(stateToUrl("search", { q: "String" })).toBe("/search?q=String");
    });

    it('generates /search without query', () => {
      expect(stateToUrl("search", {})).toBe("/search");
    });

    it('generates /bitmaps', () => {
      expect(stateToUrl("bitmaps", {})).toBe("/bitmaps");
    });

    it('generates /bitmaps?id=0x... with selected bitmap', () => {
      expect(stateToUrl("bitmaps", { id: 0xABC })).toBe("/bitmaps?id=0xabc");
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
      expect(state.params.id).toBe(0x12345678);
    });

    it('parses /object?id=305419896 (decimal)', () => {
      const state = urlToState(u("/object?id=305419896"));
      expect(state.view).toBe("object");
      expect(state.params.id).toBe(305419896);
    });

    it('parses /objects?id=42&class=java.lang.String&heap=app', () => {
      const state = urlToState(u("/objects?id=42&class=java.lang.String&heap=app"));
      expect(state.view).toBe("objects");
      expect(state.params.siteId).toBe(42);
      expect(state.params.className).toBe("java.lang.String");
      expect(state.params.heap).toBe("app");
    });

    it('parses /objects without heap', () => {
      const state = urlToState(u("/objects?id=5&class=int[]"));
      expect(state.view).toBe("objects");
      expect(state.params.siteId).toBe(5);
      expect(state.params.className).toBe("int[]");
      expect(state.params.heap).toBeNull();
    });

    it('parses /site?id=123', () => {
      const state = urlToState(u("/site?id=123"));
      expect(state.view).toBe("site");
      expect(state.params.id).toBe(123);
    });

    it('parses /search?q=String', () => {
      const state = urlToState(u("/search?q=String"));
      expect(state.view).toBe("search");
      expect(state.params.q).toBe("String");
    });

    it('parses /bitmaps', () => {
      expect(urlToState(u("/bitmaps"))).toEqual({ view: "bitmaps", params: {} });
    });

    it('parses /bitmaps?id=0xabc with selected bitmap', () => {
      const state = urlToState(u("/bitmaps?id=0xabc"));
      expect(state.view).toBe("bitmaps");
      expect(state.params.id).toBe(0xABC);
    });

    it('parses /bitmaps?id=2748 (decimal) with selected bitmap', () => {
      const state = urlToState(u("/bitmaps?id=2748"));
      expect(state.view).toBe("bitmaps");
      expect(state.params.id).toBe(2748);
    });

    it('parses unknown paths as overview', () => {
      expect(urlToState(u("/unknown"))).toEqual({ view: "overview", params: {} });
    });
  });

  describe('roundtrip', () => {
    it('overview roundtrips', () => {
      const url = stateToUrl("overview", {});
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("overview");
    });

    it('object roundtrips', () => {
      const id = 0xDEADBEEF;
      const url = stateToUrl("object", { id });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("object");
      expect(state.params.id).toBe(id);
    });

    it('site roundtrips', () => {
      const url = stateToUrl("site", { id: 999 });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("site");
      expect(state.params.id).toBe(999);
    });

    it('objects roundtrips', () => {
      const params = { siteId: 7, className: "android.view.View", heap: "app" };
      const url = stateToUrl("objects", params);
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("objects");
      expect(state.params.siteId).toBe(7);
      expect(state.params.className).toBe("android.view.View");
      expect(state.params.heap).toBe("app");
    });

    it('search roundtrips', () => {
      const url = stateToUrl("search", { q: "java.lang" });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("search");
      expect(state.params.q).toBe("java.lang");
    });

    it('bitmaps roundtrips', () => {
      const url = stateToUrl("bitmaps", {});
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("bitmaps");
    });

    it('bitmaps with selected id roundtrips', () => {
      const id = 0xDEAD;
      const url = stateToUrl("bitmaps", { id });
      const state = urlToState(new URL(url, "http://localhost"));
      expect(state.view).toBe("bitmaps");
      expect(state.params.id).toBe(id);
    });
  });
});
