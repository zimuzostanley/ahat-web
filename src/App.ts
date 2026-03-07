import m from "mithril";
import { Fragment } from "./mithril-helpers";
import type { OverviewData } from "./hprof.worker";
import { AdbConnection } from "./adb/capture";
import HprofWorkerInline from "./hprof.worker.ts?worker&inline";
import { type WorkerProxy, makeWorkerProxy } from "./worker-proxy";
import { Breadcrumbs } from "./components";
import { downloadBuffer, downloadBlob } from "./utils";
import { getTheme, toggleTheme } from "./theme";
import { nav, trail, trailIndex, navigate, navigateTop, onBreadcrumbNavigate, resetToUrl, resetToOverview } from "./navigation";
import CaptureView from "./views/CaptureView";
import HexView from "./views/HexView";
import OverviewView from "./views/OverviewView";
import RootedView from "./views/RootedView";
import ObjectView from "./views/ObjectView";
import SiteView from "./views/SiteView";
import SearchView from "./views/SearchView";
import ObjectsView from "./views/ObjectsView";
import BitmapGalleryView from "./views/BitmapGalleryView";
import StringsView from "./views/StringsView";

// ─── Session type ─────────────────────────────────────────────────────────────

type SessionStatus = "loading" | "ready" | "error";

/** Address region for VMA dumps — used to show real memory addresses. */
export interface VmaRegion { addrStart: string; addrEnd: string }

interface Session {
  id: string;
  name: string;
  kind: "hprof" | "vmadump";
  status: SessionStatus;
  buffer: ArrayBuffer | null;
  proxy: WorkerProxy | null;
  overview: OverviewData | null;
  progress: { msg: string; pct: number };
  worker: Worker | null;
  errorMsg: string | null;
  vmaRegions?: VmaRegion[];
}

let nextSessionId = 1;

// ─── Sun / Moon SVG icons ────────────────────────────────────────────────────
// Must return fresh vnodes each call — Mithril forbids reusing vnode objects.

function SunIcon() {
  return m("svg", { className: "ah-theme-toggle__icon", viewBox: "0 0 20 20", fill: "currentColor" },
    m("path", { fillRule: "evenodd", d: "M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z", clipRule: "evenodd" })
  );
}

function MoonIcon() {
  return m("svg", { className: "ah-theme-toggle__icon", viewBox: "0 0 20 20", fill: "currentColor" },
    m("path", { d: "M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" })
  );
}

// ─── Theme toggle ────────────────────────────────────────────────────────────

interface ThemeToggleAttrs { variant?: "header" | "landing" }
function ThemeToggle(): m.Component<ThemeToggleAttrs> {
  return { view(vnode) {
    const variant = vnode.attrs.variant ?? "header";
    const theme = getTheme();
    const cls = variant === "header" ? "ah-theme-toggle" : "ah-theme-toggle--landing";
    return m("button", {
      onclick: toggleTheme,
      className: cls,
      "aria-label": `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
      title: `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
    },
      theme === "dark" ? SunIcon() : MoonIcon(),
      m("span", null, theme === "dark" ? "Light" : "Dark")
    );
  } };
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App(): m.Component {
  let sessions: Session[] = [];
  let activeTab: "device" | string = "device";
  let error: string | null = null;
  let captureUsed = false;
  let menuOpen = false;
  let baselineSessionId: string | null = null;
  let diffing = false;
  let diffProgress: { msg: string; pct: number } | null = null;
  let fileEl: HTMLInputElement | null = null;
  let mapFileEl: HTMLInputElement | null = null;
  const adbConn = new AdbConnection();

  // Menu close on outside click
  let menuCloseRaf = 0;
  function menuCloseHandler() { menuOpen = false; m.redraw(); }
  function installMenuClose() {
    removeMenuClose();
    menuCloseRaf = requestAnimationFrame(() => document.addEventListener("click", menuCloseHandler));
  }
  function removeMenuClose() {
    if (menuCloseRaf) { cancelAnimationFrame(menuCloseRaf); menuCloseRaf = 0; }
    document.removeEventListener("click", menuCloseHandler);
  }

  // Helpers
  function getActiveSession(): Session | null {
    return activeTab !== "device" ? sessions.find(s => s.id === activeTab) ?? null : null;
  }
  function getActiveProxy(): WorkerProxy | null {
    const s = getActiveSession();
    return s?.status === "ready" ? s.proxy : null;
  }
  function getActiveOverview(): OverviewData | null {
    const s = getActiveSession();
    return s?.status === "ready" ? s.overview : null;
  }

  // Non-blocking per-tab loading
  async function loadBuffer(name: string, buffer: ArrayBuffer) {
    const sessionId = `session-${nextSessionId++}`;
    const worker = new HprofWorkerInline();
    error = null;

    const newSession: Session = {
      id: sessionId, name, kind: "hprof", status: "loading",
      buffer: null, proxy: null, overview: null,
      progress: { msg: "Starting parser\u2026", pct: 2 },
      worker, errorMsg: null,
    };
    sessions = [...sessions, newSession];
    activeTab = sessionId;
    m.redraw();

    try {
      const { proxy: p, overview: ov } = await makeWorkerProxy(worker, buffer,
        (msg, pct) => {
          const idx = sessions.findIndex(s => s.id === sessionId);
          if (idx >= 0) sessions[idx] = { ...sessions[idx], progress: { msg, pct } };
          m.redraw();
        },
      );
      if (sessions.find(s => s.id === sessionId)) {
        sessions = sessions.map(s => s.id === sessionId
          ? { ...s, status: "ready" as const, buffer: null, proxy: p, overview: ov, worker: null }
          : s);
      }
      resetToUrl();
      m.redraw();
    } catch (err: unknown) {
      console.error(err);
      worker.terminate();
      if (sessions.find(s => s.id === sessionId)) {
        sessions = sessions.map(s => s.id === sessionId
          ? { ...s, status: "error" as const, errorMsg: err instanceof Error ? err.message : "Parse failed", worker: null }
          : s);
      }
      m.redraw();
    }
  }

  async function loadFile(file: File) {
    error = null;
    try {
      const buffer = await file.arrayBuffer();
      await loadBuffer(file.name.replace(/\.hprof$/i, ""), buffer);
    } catch (err: unknown) {
      console.error(err);
      error = err instanceof Error ? err.message : "Failed to read file";
      m.redraw();
    }
  }

  function handleFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) loadFile(file);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  }

  async function handleMapFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    const proxy = getActiveProxy();
    if (!file || !proxy) return;
    try {
      const text = await file.text();
      await proxy.loadProguardMap(text);
      const ov = await proxy.query<OverviewData>("getOverview");
      sessions = sessions.map(s => s.id === activeTab ? { ...s, overview: ov } : s);
      m.redraw();
    } catch (err) {
      console.error("Failed to load mapping:", err);
      error = err instanceof Error ? err.message : "Failed to load ProGuard mapping";
      m.redraw();
    }
    input.value = "";
  }

  function switchToTab(tabId: string) {
    if (tabId === activeTab) return;
    activeTab = tabId;
    if (tabId !== "device") resetToOverview();
  }

  function closeTab(id: string) {
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    if (session.worker) session.worker.terminate();
    if (session.proxy) session.proxy.terminate();
    sessions = sessions.filter(s => s.id !== id);
    if (id === baselineSessionId) {
      baselineSessionId = null;
      const proxy = getActiveProxy();
      if (proxy && activeTab !== id) {
        proxy.clearBaseline().then(ov => {
          sessions = sessions.map(s => s.id === activeTab ? { ...s, overview: ov } : s);
          m.redraw();
        }).catch(() => {});
      }
    }
    if (activeTab === id) {
      const remaining = sessions;
      if (remaining.length > 0) {
        activeTab = remaining[remaining.length - 1].id;
      } else {
        activeTab = "device";
      }
      baselineSessionId = null;
      if (diffing) { diffing = false; diffProgress = null; }
    }
  }

  async function handleBaselineChange(blId: string | null) {
    const proxy = getActiveProxy();
    const activeSession = getActiveSession();
    if (!proxy || !activeSession) return;
    if (!blId) {
      diffing = true;
      diffProgress = { msg: "Clearing diff\u2026", pct: 0 };
      m.redraw();
      try {
        const ov = await proxy.clearBaseline();
        baselineSessionId = null;
        sessions = sessions.map(s => s.id === activeSession.id ? { ...s, overview: ov } : s);
      } finally {
        diffing = false;
        diffProgress = null;
        m.redraw();
      }
      return;
    }
    const readySessions = sessions.filter(s => s.status === "ready");
    const blSession = readySessions.find(s => s.id === blId);
    if (!blSession) return;
    diffing = true;
    diffProgress = { msg: "Fetching baseline\u2026", pct: 0 };
    m.redraw();
    try {
      const blBuffer = blSession.buffer ?? (blSession.proxy
        ? await blSession.proxy.query<ArrayBuffer | null>("getRawBuffer")
        : null);
      if (!blBuffer) { diffing = false; diffProgress = null; m.redraw(); return; }
      const ov = await proxy.diffWithBaseline(
        blBuffer,
        (msg, pct) => { diffProgress = { msg, pct }; m.redraw(); },
      );
      baselineSessionId = blId;
      sessions = sessions.map(s => s.id === activeSession.id ? { ...s, overview: ov } : s);
    } catch (err) {
      console.error("Diff failed:", err);
      baselineSessionId = null;
    } finally {
      diffing = false;
      diffProgress = null;
      m.redraw();
    }
  }

  function loadVmaDump(name: string, buffer: ArrayBuffer, regions?: VmaRegion[]) {
    const sessionId = `session-${nextSessionId++}`;
    const newSession: Session = {
      id: sessionId, name, kind: "vmadump", status: "ready",
      buffer, proxy: null, overview: null,
      progress: { msg: "", pct: 100 },
      worker: null, errorMsg: null,
      vmaRegions: regions,
    };
    sessions = [...sessions, newSession];
    activeTab = sessionId;
  }

  // postMessage handler for opening hprof from opener/parent
  function messageHandler(e: MessageEvent) {
    const d = e.data;
    if (d && typeof d === "object" && d.type === "open-hprof" && d.buffer instanceof ArrayBuffer) {
      const name = typeof d.name === "string" ? d.name : "untitled";
      loadBuffer(name, d.buffer);
    }
  }

  const navItems = [
    { view: "overview", label: "Overview", params: {} },
    { view: "rooted", label: "Rooted", params: {} },
    { view: "site", label: "Allocations", params: { id: 0 } },
    { view: "bitmaps", label: "Bitmaps", params: {} },
    { view: "strings", label: "Strings", params: {} },
    { view: "search", label: "Search", params: {} },
  ];

  return {
    oncreate() {
      window.addEventListener("message", messageHandler);
      try { window.opener?.postMessage({ type: "ahat-ready" }, "*"); } catch {}
      try { window.parent !== window && window.parent.postMessage({ type: "ahat-ready" }, "*"); } catch {}
    },
    onremove() {
      window.removeEventListener("message", messageHandler);
      removeMenuClose();
    },
    view() {
      const activeSession = getActiveSession();
      const activeProxy = getActiveProxy();
      const activeOverview = getActiveOverview();
      const isDiffed = activeOverview?.isDiffed ?? false;
      const readySessions = sessions.filter(s => s.status === "ready");
      const showDeviceTab = captureUsed;
      const showTabs = sessions.length > 1 || showDeviceTab;
      const isLanding = sessions.length === 0 && !captureUsed;

      // Manage menu close listener
      if (menuOpen) installMenuClose();
      else removeMenuClose();

      // Diff controls — shared between single-dump and multi-dump layouts
      const diffControls = readySessions.length > 1 && (
        m("div", { className: "ah-diff-controls" },
          m("span", { className: "ah-diff-controls__label" }, "Diff:"),
          m("select", {
            className: "ah-diff-controls__select",
            value: baselineSessionId ?? "",
            disabled: diffing,
            onchange: (e: Event) => handleBaselineChange((e.target as HTMLSelectElement).value || null),
          },
            m("option", { value: "" }, "None"),
            readySessions.filter(s => s.id !== activeTab).map(s =>
              m("option", { key: s.id, value: s.id }, s.name)
            )
          ),
          diffing && diffProgress && (
            m("span", { className: "ah-diff-controls__status" }, diffProgress.msg)
          )
        )
      );

      return m("div", {
        className: "ah-page",
        ondragover: (e: DragEvent) => e.preventDefault(), ondrop: handleDrop,
      },
        // Hidden file inputs
        m("input", { oncreate: (v: m.VnodeDOM) => { fileEl = v.dom as HTMLInputElement; }, type: "file", accept: ".hprof", className: "ah-hidden", onchange: handleFile }),
        m("input", { oncreate: (v: m.VnodeDOM) => { mapFileEl = v.dom as HTMLInputElement; }, type: "file", accept: ".txt,.map", className: "ah-hidden", onchange: handleMapFile }),

        // Header — shown when we have sessions
        sessions.length > 0 && (
          m("header", { className: "ah-header" },
            m("div", { className: "ah-header__bar" },
              // Logo
              m("button", {
                className: "ah-header__logo",
                onclick: () => {
                  if (captureUsed) switchToTab("device");
                  else if (activeSession) { navigateTop("overview"); }
                },
              },
                m("div", { className: "ah-header__logo-icon" }, "A"),
                m("span", { className: "ah-header__logo-text" }, "ahat", m("span", { className: "ah-header__logo-suffix" }, ".web"))
              ),

              showTabs ? (
                // ── Multi-dump / device layout: tabs ──
                m(Fragment, null,
                  showDeviceTab && (
                    m("button", {
                      className: `ah-tab${activeTab === "device" ? " ah-tab--active" : ""}`,
                      onclick: () => switchToTab("device"),
                      title: "ADB device capture",
                    }, "Device")
                  ),
                  sessions.map(s =>
                    m("div", {
                      key: s.id,
                      className: `ah-tab__group ah-tab${activeTab === s.id ? " ah-tab--active" : ""}`,
                      onclick: () => switchToTab(s.id),
                      title: s.name + (s.kind === "vmadump" ? " (VMA dump)" : " (heap dump)"),
                    },
                      s.status === "loading" && m("span", { className: "ah-tab__dot ah-tab__dot--loading" }),
                      s.status === "error" && m("span", { className: "ah-tab__dot ah-tab__dot--error" }),
                      m("span", { className: "ah-tab__name" }, s.name),
                      m("button", {
                        className: `ah-tab__close ${activeTab === s.id ? "ah-tab__close--visible" : "ah-tab__close--hidden"}`,
                        onclick: (e: MouseEvent) => { e.stopPropagation(); closeTab(s.id); },
                        title: "Close tab",
                        "aria-label": `Close ${s.name}`,
                      }, "\u00d7")
                    )
                  ),
                  m("button", {
                    className: "ah-tab__add",
                    onclick: () => fileEl?.click(),
                    title: "Open file",
                    "aria-label": "Open file",
                  }, "+")
                )
              ) : (
                // ── Single-dump layout: inline nav ──
                m(Fragment, null,
                  activeSession && (
                    m("span", { className: "ah-header__session-name" }, activeSession.name)
                  ),
                  activeSession?.status === "ready" && (
                    m("nav", { className: "ah-nav" },
                      navItems.map(n =>
                        m("button", {
                          key: n.view,
                          className: `ah-nav-btn${nav.view === n.view ? " ah-nav-btn--active" : ""}`,
                          onclick: () => navigateTop(n.view, n.params),
                        }, n.label)
                      )
                    )
                  ),
                  diffControls
                )
              ),

              // Right side: theme + menu
              m("div", { className: "ah-header__actions" },
                m(ThemeToggle, null),
                m("div", { style: { position: "relative" } },
                  m("button", {
                    className: "ah-header__menu-btn",
                    onclick: () => { menuOpen = !menuOpen; },
                    "aria-label": "Menu",
                  }, "\u22EF"),
                  menuOpen && (
                    m("div", { className: "ah-header__menu" },
                      m("button", { className: "ah-header__menu-item", onclick: () => { fileEl?.click(); menuOpen = false; } },
                        "Open File"),
                      !captureUsed && (
                        m("button", { className: "ah-header__menu-item", onclick: () => { captureUsed = true; activeTab = "device"; menuOpen = false; } },
                          "Capture from device")
                      ),
                      activeSession?.status === "ready" && (activeSession.buffer || activeSession.proxy) && (
                        m(Fragment, null,
                          activeSession.kind === "hprof" && (
                            m("button", { className: "ah-header__menu-item", onclick: () => { mapFileEl?.click(); menuOpen = false; } },
                              "Load Mapping")
                          ),
                          m("button", { className: "ah-header__menu-item", onclick: async () => {
                            menuOpen = false;
                            if (activeSession.kind === "vmadump" && activeSession.buffer) {
                              downloadBlob(activeSession.name + ".bin", activeSession.buffer);
                            } else if (activeSession.proxy) {
                              const buf = await activeSession.proxy.query<ArrayBuffer | null>("getRawBuffer");
                              if (buf) downloadBuffer(activeSession.name, buf);
                            }
                          } },
                            "Download")
                        )
                      ),
                      activeSession && !showTabs && (
                        m("button", { className: "ah-header__menu-item--danger", onclick: () => { closeTab(activeSession.id); menuOpen = false; } },
                          "Close")
                      )
                    )
                  )
                )
              )
            ),

            // Sub-bar: dump nav + diff — multi-dump layout only, when active tab is a ready hprof
            showTabs && activeSession?.status === "ready" && activeSession.kind === "hprof" && activeTab !== "device" && (
              m("div", { className: "ah-sub-bar" },
                m("nav", { className: "ah-nav", style: { marginLeft: 0 } },
                  navItems.map(n =>
                    m("button", {
                      key: n.view,
                      className: `ah-nav-btn${nav.view === n.view ? " ah-nav-btn--active" : ""}`,
                      onclick: () => navigateTop(n.view, n.params),
                    }, n.label)
                  )
                ),
                diffControls
              )
            )
          )
        ),

        // Landing page — no sessions, no capture
        isLanding && activeTab === "device" && (
          m("div", { className: "ah-landing" },
            m("div", { className: "ah-landing__theme" },
              m(ThemeToggle, { variant: "landing" })
            ),
            m("div", { className: "ah-landing__content" },
              m("div", { className: "ah-landing__header" },
                m("div", { className: "ah-landing__logo-row" },
                  m("div", { className: "ah-landing__logo-icon" }, "A"),
                  m("h1", { className: "ah-landing__title" },
                    "ahat", m("span", { className: "ah-landing__title-suffix" }, ".web"))
                ),
                m("p", { className: "ah-landing__subtitle" }, "Android Heap Analysis Tool \u2014 runs entirely in your browser")
              ),
              m("div", {
                className: "ah-landing__dropzone",
                onclick: () => fileEl?.click(),
              },
                m("div", { className: "ah-mb-4" },
                  m("svg", { className: "ah-landing__drop-icon", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.5 },
                    m("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" })
                  )
                ),
                m("p", { className: "ah-landing__drop-text" }, "Drop an .hprof file here or click to browse"),
                m("p", { className: "ah-landing__drop-hint" }, "Supports J2SE HPROF format with Android extensions")
              ),
              m("div", { className: "ah-landing__actions" },
                m("button", {
                  className: "ah-landing__capture-btn",
                  onclick: () => { captureUsed = true; },
                },
                  m("span", { className: "ah-landing__capture-inner" },
                    m("svg", { className: "ah-landing__capture-icon", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor", strokeWidth: 1.5 },
                      m("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" })
                    ),
                    "Capture from device"
                  )
                )
              ),
              error && (
                m("div", { className: "ah-error-banner ah-mt-4" }, error)
              )
            )
          )
        ),

        // CaptureView — mounted once captureUsed, stays mounted to preserve USB connection
        captureUsed && (
          m("div", { className: activeTab === "device" ? "" : "ah-hidden" },
            sessions.length === 0 && (
              m("div", { className: "ah-capture-header" },
                m("div", { className: "ah-capture-header__inner" },
                  m("h1", { className: "ah-capture-header__title" }, "Capture from device"),
                  m(ThemeToggle, { variant: "landing" })
                )
              )
            ),
            m("div", { className: sessions.length > 0 ? "ah-capture-wrap--compact" : "ah-capture-wrap" },
              m(CaptureView, { onCaptured: loadBuffer, onVmaDump: loadVmaDump, conn: adbConn })
            )
          )
        ),

        // Active session content
        activeTab !== "device" && activeSession && (
          m(Fragment, null,
            // Loading state — inline in tab
            activeSession.status === "loading" && (
              m("div", { className: "ah-parse-overlay" },
                m("div", { className: "ah-parse-card" },
                  m("h2", { className: "ah-parse-card__title", title: `Parsing ${activeSession.name}` },
                    "Parsing ", activeSession.name, "\u2026"),
                  m("div", { className: "ah-progress-bar" },
                    m("div", { className: "ah-progress-bar__fill", style: { width: activeSession.progress.pct + "%" } })
                  ),
                  m("p", { className: "ah-parse-card__status", title: activeSession.progress.msg }, activeSession.progress.msg),
                  m("button", {
                    className: "ah-parse-card__cancel",
                    onclick: () => closeTab(activeSession.id),
                  }, "Cancel")
                )
              )
            ),

            // Error state
            activeSession.status === "error" && (
              m("div", { className: "ah-parse-overlay" },
                m("div", { className: "ah-parse-card--error" },
                  m("h2", { className: "ah-parse-card__title--error" }, "Failed to parse ", activeSession.name),
                  m("p", { className: "ah-parse-card__body" }, activeSession.errorMsg),
                  m("button", {
                    className: "ah-parse-card__close",
                    onclick: () => closeTab(activeSession.id),
                  }, "Close")
                )
              )
            ),

            // Ready — vmadump hex view
            activeSession.status === "ready" && activeSession.kind === "vmadump" && activeSession.buffer && (
              m("main", { className: "ah-main--vmadump" },
                m(HexView, {
                  buffer: activeSession.buffer,
                  name: activeSession.name,
                  regions: activeSession.vmaRegions,
                  availableDiffs: sessions
                    .filter(s => s.kind === "vmadump" && s.id !== activeSession.id && s.status === "ready" && s.buffer)
                    .map(s => ({ id: s.id, name: s.name, buffer: s.buffer! })),
                })
              )
            ),

            // Ready — hprof content views
            activeSession.status === "ready" && activeSession.kind === "hprof" && activeProxy && activeOverview && (
              m("main", { className: "ah-main" },
                m(Breadcrumbs, { trail, activeIndex: trailIndex, onNavigate: onBreadcrumbNavigate }),
                nav.view === "overview" && m(OverviewView, { overview: activeOverview, name: activeSession.name, navigate }),
                nav.view === "rooted"   && m(RootedView, { proxy: activeProxy, heaps: activeOverview.heaps, navigate, isDiffed }),
                nav.view === "object"   && m(ObjectView, { proxy: activeProxy, heaps: activeOverview.heaps, navigate, params: nav.params }),
                nav.view === "objects"  && m(ObjectsView, { proxy: activeProxy, navigate, params: nav.params }),
                nav.view === "site"     && m(SiteView, { proxy: activeProxy, heaps: activeOverview.heaps, navigate, params: nav.params, isDiffed }),
                nav.view === "search"   && m(SearchView, { proxy: activeProxy, navigate, initialQuery: nav.params.q }),
                nav.view === "bitmaps"  && m(BitmapGalleryView, { proxy: activeProxy, navigate }),
                nav.view === "strings" && m(StringsView, { proxy: activeProxy, navigate, initialQuery: nav.params.q })
              )
            )
          )
        )
      );
    },
  };
}
