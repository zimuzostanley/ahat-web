import m from "mithril";
import { type NavState, stateToUrl, urlToState } from "./routing";
import { type BreadcrumbEntry, makeCrumb } from "./components";

// ─── Exported mutable state ──────────────────────────────────────────────────

export let nav: NavState = { view: "overview", params: {} };
export let trail: BreadcrumbEntry[] = [makeCrumb(nav)];
export let trailIndex = 0;

// ─── Navigation functions ────────────────────────────────────────────────────

export type NavFn = (view: string, params?: Record<string, unknown>) => void;

/** Navigate from within a view — truncate trail after current position, append new crumb. */
export function navigate(v: string, p: Record<string, unknown> = {}): void {
  const state = { view: v, params: p } as NavState;
  trail = [...trail.slice(0, trailIndex + 1), makeCrumb(state)];
  trailIndex = trail.length - 1;
  nav = state;
  window.history.pushState({ ...state, trail, trailIndex }, "", stateToUrl(state));
  window.scrollTo(0, 0);
  m.redraw();
}

/** Navigate from top-level nav bar — resets breadcrumb trail. */
export function navigateTop(v: string, p: Record<string, unknown> = {}): void {
  const state = { view: v, params: p } as NavState;
  trail = [makeCrumb(state)];
  trailIndex = 0;
  nav = state;
  window.history.pushState({ ...state, trail, trailIndex: 0 }, "", stateToUrl(state));
  window.scrollTo(0, 0);
  m.redraw();
}

/** Breadcrumb click — keep full trail, just change active index. */
export function onBreadcrumbNavigate(i: number): void {
  const crumb = trail[i];
  nav = crumb.state;
  trailIndex = i;
  window.history.pushState({ ...crumb.state, trail, trailIndex: i }, "", stateToUrl(crumb.state));
  window.scrollTo(0, 0);
  m.redraw();
}

/** Reset nav to current URL (used after loading a new session). */
export function resetToUrl(): void {
  const initial = urlToState(new URL(window.location.href));
  trail = [makeCrumb(initial)];
  trailIndex = 0;
  nav = initial;
  window.history.replaceState({ ...initial, trail, trailIndex: 0 }, "", stateToUrl(initial));
}

/** Reset to overview (used when switching tabs). */
export function resetToOverview(): void {
  const state: NavState = { view: "overview", params: {} };
  trail = [makeCrumb(state)];
  trailIndex = 0;
  nav = state;
  window.history.replaceState({ ...state, trail, trailIndex: 0 }, "", stateToUrl(state));
}

// ─── Browser back/forward ────────────────────────────────────────────────────

window.addEventListener("popstate", (e: PopStateEvent) => {
  if (e.state && e.state.view) {
    const { view, params } = e.state;
    nav = { view, params } as NavState;
    trail = Array.isArray(e.state.trail) ? e.state.trail : [makeCrumb(nav)];
    trailIndex = typeof e.state.trailIndex === "number" ? e.state.trailIndex : trail.length - 1;
    m.redraw();
  }
});
