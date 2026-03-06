import { useState, useCallback, useRef, useEffect } from "react";
import { type NavState, stateToUrl, urlToState } from "./routing";
import { type BreadcrumbEntry, makeCrumb } from "./components";
import type { NavFn } from "./components";

export interface NavigationState {
  nav: NavState;
  trail: BreadcrumbEntry[];
  trailIndex: number;
  navigate: NavFn;
  navigateTop: NavFn;
  onBreadcrumbNavigate: (index: number) => void;
  resetToUrl: () => void;
  resetToOverview: () => void;
}

export function useNavigation(): NavigationState {
  const [nav, setNav] = useState<NavState>({ view: "overview", params: {} });
  const [trail, setTrail] = useState<BreadcrumbEntry[]>([makeCrumb({ view: "overview", params: {} })]);
  const [trailIndex, setTrailIndex] = useState(0);

  // Refs for stable callbacks
  const trailRef = useRef(trail);
  const trailIndexRef = useRef(trailIndex);
  trailRef.current = trail;
  trailIndexRef.current = trailIndex;

  // Navigate from within a view — truncate trail after current position, append new crumb
  const navigate: NavFn = useCallback((v, p = {}) => {
    const state = { view: v, params: p } as NavState;
    const newTrail = [...trailRef.current.slice(0, trailIndexRef.current + 1), makeCrumb(state)];
    const idx = newTrail.length - 1;
    setNav(state);
    setTrail(newTrail);
    setTrailIndex(idx);
    window.history.pushState({ ...state, trail: newTrail, trailIndex: idx }, "", stateToUrl(state));
    window.scrollTo(0, 0);
  }, []);

  // Navigate from top-level nav bar — resets breadcrumb trail
  const navigateTop: NavFn = useCallback((v, p = {}) => {
    const state = { view: v, params: p } as NavState;
    const newTrail = [makeCrumb(state)];
    setNav(state);
    setTrail(newTrail);
    setTrailIndex(0);
    window.history.pushState({ ...state, trail: newTrail, trailIndex: 0 }, "", stateToUrl(state));
    window.scrollTo(0, 0);
  }, []);

  // Breadcrumb click — keep full trail, just change active index
  const onBreadcrumbNavigate = useCallback((i: number) => {
    const crumb = trailRef.current[i];
    setNav(crumb.state);
    setTrailIndex(i);
    window.history.pushState({ ...crumb.state, trail: trailRef.current, trailIndex: i }, "", stateToUrl(crumb.state));
    window.scrollTo(0, 0);
  }, []);

  // Reset nav to current URL (used after loading a new session)
  const resetToUrl = useCallback(() => {
    const initial = urlToState(new URL(window.location.href));
    const newTrail = [makeCrumb(initial)];
    setNav(initial);
    setTrail(newTrail);
    setTrailIndex(0);
    window.history.replaceState({ ...initial, trail: newTrail, trailIndex: 0 }, "", stateToUrl(initial));
  }, []);

  // Reset to overview (used when switching tabs)
  const resetToOverview = useCallback(() => {
    const state: NavState = { view: "overview", params: {} };
    const newTrail = [makeCrumb(state)];
    setNav(state);
    setTrail(newTrail);
    setTrailIndex(0);
    window.history.replaceState({ ...state, trail: newTrail, trailIndex: 0 }, "", stateToUrl(state));
  }, []);

  // Listen for browser back/forward
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (e.state && e.state.view) {
        const { view, params } = e.state;
        const state = { view, params } as NavState;
        const restoredTrail = Array.isArray(e.state.trail) ? e.state.trail : [makeCrumb(state)];
        const idx = typeof e.state.trailIndex === "number" ? e.state.trailIndex : restoredTrail.length - 1;
        setNav(state);
        setTrail(restoredTrail);
        setTrailIndex(idx);
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return { nav, trail, trailIndex, navigate, navigateTop, onBreadcrumbNavigate, resetToUrl, resetToOverview };
}
