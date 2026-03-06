// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNavigation } from "./use-navigation";

// Mock history.pushState / replaceState / scrollTo
let pushStateCalls: Array<{ state: unknown; url: string }> = [];
let replaceStateCalls: Array<{ state: unknown; url: string }> = [];

beforeEach(() => {
  pushStateCalls = [];
  replaceStateCalls = [];
  vi.spyOn(window.history, "pushState").mockImplementation((state, _, url) => {
    pushStateCalls.push({ state, url: String(url) });
  });
  vi.spyOn(window.history, "replaceState").mockImplementation((state, _, url) => {
    replaceStateCalls.push({ state, url: String(url) });
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

describe("useNavigation", () => {
  it("starts at overview with single-item trail", () => {
    const { result } = renderHook(() => useNavigation());
    expect(result.current.nav).toEqual({ view: "overview", params: {} });
    expect(result.current.trail).toHaveLength(1);
    expect(result.current.trail[0].label).toBe("Overview");
    expect(result.current.trailIndex).toBe(0);
  });

  it("navigate appends to trail and pushes history", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("object", { id: 0x1234 }));

    expect(result.current.nav).toEqual({ view: "object", params: { id: 0x1234 } });
    expect(result.current.trail).toHaveLength(2);
    expect(result.current.trail[0].label).toBe("Overview");
    expect(result.current.trail[1].label).toBe("Object 0x1234");
    expect(result.current.trailIndex).toBe(1);
    expect(pushStateCalls).toHaveLength(1);
    expect(pushStateCalls[0].url).toBe("/object?id=0x1234");
  });

  it("navigateTop resets trail to single item", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("object", { id: 0x1234 }));
    act(() => result.current.navigateTop("rooted"));

    expect(result.current.nav).toEqual({ view: "rooted", params: {} });
    expect(result.current.trail).toHaveLength(1);
    expect(result.current.trail[0].label).toBe("Rooted");
    expect(result.current.trailIndex).toBe(0);
  });

  it("navigate truncates trail after current index", () => {
    const { result } = renderHook(() => useNavigation());
    // Build trail: Overview -> Object A -> Object B
    act(() => result.current.navigate("object", { id: 1 }));
    act(() => result.current.navigate("object", { id: 2 }));
    expect(result.current.trail).toHaveLength(3);

    // Go back to index 1 (Object A)
    act(() => result.current.onBreadcrumbNavigate(1));
    expect(result.current.trailIndex).toBe(1);
    expect(result.current.trail).toHaveLength(3); // trail preserved

    // Navigate to Object C — should truncate after index 1, then append
    act(() => result.current.navigate("object", { id: 3 }));
    expect(result.current.trail).toHaveLength(3); // Overview, Object A, Object C
    expect(result.current.trail[2].label).toBe("Object 0x3");
    expect(result.current.trailIndex).toBe(2);
  });

  it("onBreadcrumbNavigate keeps full trail but changes active index", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("object", { id: 1 }));
    act(() => result.current.navigate("object", { id: 2 }));
    expect(result.current.trail).toHaveLength(3);

    // Click breadcrumb at index 0 (Overview)
    act(() => result.current.onBreadcrumbNavigate(0));
    expect(result.current.nav).toEqual({ view: "overview", params: {} });
    expect(result.current.trailIndex).toBe(0);
    expect(result.current.trail).toHaveLength(3); // full trail preserved

    // Click breadcrumb at index 2 (Object 2)
    act(() => result.current.onBreadcrumbNavigate(2));
    expect(result.current.nav).toEqual({ view: "object", params: { id: 2 } });
    expect(result.current.trailIndex).toBe(2);
    expect(result.current.trail).toHaveLength(3); // still preserved
  });

  it("onBreadcrumbNavigate pushes to history", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("rooted"));
    pushStateCalls = [];

    act(() => result.current.onBreadcrumbNavigate(0));
    expect(pushStateCalls).toHaveLength(1);
    expect(pushStateCalls[0].url).toBe("/");
    expect(pushStateCalls[0].state).toHaveProperty("trailIndex", 0);
  });

  it("resetToOverview resets to overview with replaceState", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("object", { id: 1 }));
    replaceStateCalls = [];

    act(() => result.current.resetToOverview());
    expect(result.current.nav).toEqual({ view: "overview", params: {} });
    expect(result.current.trail).toHaveLength(1);
    expect(result.current.trailIndex).toBe(0);
    expect(replaceStateCalls).toHaveLength(1);
    expect(replaceStateCalls[0].url).toBe("/");
  });

  it("resetToUrl reads from window.location", () => {
    const { result } = renderHook(() => useNavigation());
    // jsdom defaults to about:blank, urlToState will parse as overview
    act(() => result.current.resetToUrl());
    expect(result.current.nav.view).toBe("overview");
    expect(result.current.trail).toHaveLength(1);
    expect(result.current.trailIndex).toBe(0);
    expect(replaceStateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("popstate restores nav state from history", () => {
    const { result } = renderHook(() => useNavigation());
    const trail = [
      { state: { view: "overview" as const, params: {} }, label: "Overview" },
      { state: { view: "rooted" as const, params: {} }, label: "Rooted" },
    ];

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", {
        state: { view: "rooted", params: {}, trail, trailIndex: 1 },
      }));
    });

    expect(result.current.nav).toEqual({ view: "rooted", params: {} });
    expect(result.current.trail).toHaveLength(2);
    expect(result.current.trailIndex).toBe(1);
  });

  it("popstate with missing trail creates single-item trail", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", {
        state: { view: "search", params: { q: "test" } },
      }));
    });

    expect(result.current.nav).toEqual({ view: "search", params: { q: "test" } });
    expect(result.current.trail).toHaveLength(1);
    expect(result.current.trail[0].label).toBe("Search");
  });

  it("popstate with null state is ignored", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("rooted"));
    const before = { nav: result.current.nav, trail: result.current.trail };

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });

    expect(result.current.nav).toEqual(before.nav);
    expect(result.current.trail).toBe(before.trail);
  });

  it("navigate with label preserves it in breadcrumb", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("object", { id: 0xABC, label: "Bitmap 640×480" }));

    expect(result.current.trail[1].label).toBe("Bitmap 640×480");
  });

  it("multiple navigations build correct trail", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("site", { id: 0 }));
    act(() => result.current.navigate("objects", { siteId: 1, className: "android.view.View", heap: "app" }));
    act(() => result.current.navigate("object", { id: 0xDEAD }));

    expect(result.current.trail).toHaveLength(4);
    expect(result.current.trail.map(t => t.label)).toEqual([
      "Overview", "Allocations", "View", "Object 0xdead",
    ]);
    expect(result.current.trailIndex).toBe(3);
  });

  it("navigate scrolls to top", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("rooted"));
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("pushState includes trail and trailIndex", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("rooted"));

    const pushed = pushStateCalls[0].state as Record<string, unknown>;
    expect(pushed).toHaveProperty("trail");
    expect(pushed).toHaveProperty("trailIndex", 1);
    expect(Array.isArray(pushed.trail)).toBe(true);
  });

  it("navigateTop after deep navigation resets completely", () => {
    const { result } = renderHook(() => useNavigation());
    act(() => result.current.navigate("object", { id: 1 }));
    act(() => result.current.navigate("object", { id: 2 }));
    act(() => result.current.navigate("object", { id: 3 }));
    expect(result.current.trail).toHaveLength(4);

    act(() => result.current.navigateTop("search", { q: "test" }));
    expect(result.current.trail).toHaveLength(1);
    expect(result.current.trail[0].label).toBe("Search");
    expect(result.current.trailIndex).toBe(0);
    expect(result.current.nav).toEqual({ view: "search", params: { q: "test" } });
  });
});
