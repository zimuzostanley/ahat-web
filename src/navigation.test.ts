// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { nav, trail, trailIndex, navigate, navigateTop, onBreadcrumbNavigate, resetToOverview, resetToUrl } from "./navigation";

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
  // Reset navigation state to overview before each test
  resetToOverview();
  replaceStateCalls = [];
});

describe("navigation module", () => {
  it("starts at overview with single-item trail", () => {
    expect(nav).toEqual({ view: "overview", params: {} });
    expect(trail).toHaveLength(1);
    expect(trail[0].label).toBe("Overview");
    expect(trailIndex).toBe(0);
  });

  it("navigate appends to trail and pushes history", () => {
    navigate("object", { id: 0x1234 });

    expect(nav).toEqual({ view: "object", params: { id: 0x1234 } });
    expect(trail).toHaveLength(2);
    expect(trail[0].label).toBe("Overview");
    expect(trail[1].label).toBe("Object 0x1234");
    expect(trailIndex).toBe(1);
    expect(pushStateCalls).toHaveLength(1);
    expect(pushStateCalls[0].url).toBe("/object?id=0x1234");
  });

  it("navigateTop resets trail to single item", () => {
    navigate("object", { id: 0x1234 });
    navigateTop("rooted");

    expect(nav).toEqual({ view: "rooted", params: {} });
    expect(trail).toHaveLength(1);
    expect(trail[0].label).toBe("Rooted");
    expect(trailIndex).toBe(0);
  });

  it("navigate truncates trail after current index", () => {
    // Build trail: Overview -> Object A -> Object B
    navigate("object", { id: 1 });
    navigate("object", { id: 2 });
    expect(trail).toHaveLength(3);

    // Go back to index 1 (Object A)
    onBreadcrumbNavigate(1);
    expect(trailIndex).toBe(1);
    expect(trail).toHaveLength(3); // trail preserved

    // Navigate to Object C — should truncate after index 1, then append
    navigate("object", { id: 3 });
    expect(trail).toHaveLength(3); // Overview, Object A, Object C
    expect(trail[2].label).toBe("Object 0x3");
    expect(trailIndex).toBe(2);
  });

  it("onBreadcrumbNavigate keeps full trail but changes active index", () => {
    navigate("object", { id: 1 });
    navigate("object", { id: 2 });
    expect(trail).toHaveLength(3);

    // Click breadcrumb at index 0 (Overview)
    onBreadcrumbNavigate(0);
    expect(nav).toEqual({ view: "overview", params: {} });
    expect(trailIndex).toBe(0);
    expect(trail).toHaveLength(3); // full trail preserved

    // Click breadcrumb at index 2 (Object 2)
    onBreadcrumbNavigate(2);
    expect(nav).toEqual({ view: "object", params: { id: 2 } });
    expect(trailIndex).toBe(2);
    expect(trail).toHaveLength(3); // still preserved
  });

  it("onBreadcrumbNavigate pushes to history", () => {
    navigate("rooted");
    pushStateCalls = [];

    onBreadcrumbNavigate(0);
    expect(pushStateCalls).toHaveLength(1);
    expect(pushStateCalls[0].url).toBe("/");
    expect(pushStateCalls[0].state).toHaveProperty("trailIndex", 0);
  });

  it("resetToOverview resets to overview with replaceState", () => {
    navigate("object", { id: 1 });
    replaceStateCalls = [];

    resetToOverview();
    expect(nav).toEqual({ view: "overview", params: {} });
    expect(trail).toHaveLength(1);
    expect(trailIndex).toBe(0);
    expect(replaceStateCalls).toHaveLength(1);
    expect(replaceStateCalls[0].url).toBe("/");
  });

  it("resetToUrl reads from window.location", () => {
    // jsdom defaults to about:blank, urlToState will parse as overview
    resetToUrl();
    expect(nav.view).toBe("overview");
    expect(trail).toHaveLength(1);
    expect(trailIndex).toBe(0);
    expect(replaceStateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("popstate restores nav state from history", () => {
    const popTrail = [
      { state: { view: "overview" as const, params: {} }, label: "Overview" },
      { state: { view: "rooted" as const, params: {} }, label: "Rooted" },
    ];

    window.dispatchEvent(new PopStateEvent("popstate", {
      state: { view: "rooted", params: {}, trail: popTrail, trailIndex: 1 },
    }));

    expect(nav).toEqual({ view: "rooted", params: {} });
    expect(trail).toHaveLength(2);
    expect(trailIndex).toBe(1);
  });

  it("popstate with missing trail creates single-item trail", () => {
    window.dispatchEvent(new PopStateEvent("popstate", {
      state: { view: "search", params: { q: "test" } },
    }));

    expect(nav).toEqual({ view: "search", params: { q: "test" } });
    expect(trail).toHaveLength(1);
    expect(trail[0].label).toBe("Search");
  });

  it("popstate with null state is ignored", () => {
    navigate("rooted");
    const beforeNav = { ...nav };
    const beforeTrail = trail;

    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));

    expect(nav).toEqual(beforeNav);
    expect(trail).toBe(beforeTrail);
  });

  it("navigate with label preserves it in breadcrumb", () => {
    navigate("object", { id: 0xABC, label: "Bitmap 640\u00d7480" });
    expect(trail[1].label).toBe("Bitmap 640\u00d7480");
  });

  it("multiple navigations build correct trail", () => {
    navigate("site", { id: 0 });
    navigate("objects", { siteId: 1, className: "android.view.View", heap: "app" });
    navigate("object", { id: 0xDEAD });

    expect(trail).toHaveLength(4);
    expect(trail.map((t: { label: string }) => t.label)).toEqual([
      "Overview", "Allocations", "View", "Object 0xdead",
    ]);
    expect(trailIndex).toBe(3);
  });

  it("navigate scrolls to top", () => {
    navigate("rooted");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("pushState includes trail and trailIndex", () => {
    navigate("rooted");

    const pushed = pushStateCalls[0].state as Record<string, unknown>;
    expect(pushed).toHaveProperty("trail");
    expect(pushed).toHaveProperty("trailIndex", 1);
    expect(Array.isArray(pushed.trail)).toBe(true);
  });

  it("navigateTop after deep navigation resets completely", () => {
    navigate("object", { id: 1 });
    navigate("object", { id: 2 });
    navigate("object", { id: 3 });
    expect(trail).toHaveLength(4);

    navigateTop("search", { q: "test" });
    expect(trail).toHaveLength(1);
    expect(trail[0].label).toBe("Search");
    expect(trailIndex).toBe(0);
    expect(nav).toEqual({ view: "search", params: { q: "test" } });
  });
});
