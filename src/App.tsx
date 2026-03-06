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

const SunIcon = <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
</svg>;

const MoonIcon = <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
</svg>;

// ─── Theme toggle ────────────────────────────────────────────────────────────

interface ThemeToggleAttrs { variant?: "header" | "landing" }
function ThemeToggle(): m.Component<ThemeToggleAttrs> {
  return { view(vnode) {
    const variant = vnode.attrs.variant ?? "header";
    const theme = getTheme();
    const cls = variant === "header"
      ? "flex items-center gap-1.5 text-stone-400 hover:text-white text-xs h-6 px-2 border border-stone-600 transition-colors"
      : "flex items-center gap-1.5 text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 text-xs h-6 px-2 border border-stone-300 dark:border-stone-600 transition-colors";
    return (
      <button
        onclick={toggleTheme}
        className={cls}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? SunIcon : MoonIcon}
        <span>{theme === "dark" ? "Light" : "Dark"}</span>
      </button>
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
        <div className="flex items-center gap-1.5 border-l border-stone-600 pl-3">
          <span className="text-stone-500 text-xs">Diff:</span>
          <select
            className="text-xs bg-stone-700 text-stone-300 border border-stone-600 px-1.5 py-0.5 cursor-pointer max-w-[120px] truncate"
            value={baselineSessionId ?? ""}
            disabled={diffing}
            onchange={(e: Event) => handleBaselineChange((e.target as HTMLSelectElement).value || null)}
          >
            <option value="">None</option>
            {readySessions.filter(s => s.id !== activeTab).map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {diffing && diffProgress && (
            <span className="text-amber-400 text-xs animate-pulse">{diffProgress.msg}</span>
          )}
        </div>
      );

      return (
        <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex flex-col text-stone-800 dark:text-stone-100"
          ondragover={(e: DragEvent) => e.preventDefault()} ondrop={handleDrop}
        >
          {/* Hidden file inputs */}
          <input oncreate={(v: m.VnodeDOM) => { fileEl = v.dom as HTMLInputElement; }} type="file" accept=".hprof" className="hidden" onchange={handleFile} />
          <input oncreate={(v: m.VnodeDOM) => { mapFileEl = v.dom as HTMLInputElement; }} type="file" accept=".txt,.map" className="hidden" onchange={handleMapFile} />

          {/* Header — shown when we have sessions */}
          {sessions.length > 0 && (
            <header className="bg-stone-800 dark:bg-stone-900 text-white flex-shrink-0">
              <div className="px-4 py-2 flex items-center gap-3">
                {/* Logo */}
                <button
                  className="flex items-center gap-2 flex-shrink-0"
                  onclick={() => {
                    if (captureUsed) switchToTab("device");
                    else if (activeSession) { navigateTop("overview"); }
                  }}
                >
                  <div className="w-6 h-6 bg-sky-600 flex items-center justify-center text-white font-bold text-xs">A</div>
                  <span className="font-bold tracking-tight text-sm">ahat<span className="text-stone-400 font-normal">.web</span></span>
                </button>

                {showTabs ? (
                  /* ── Multi-dump / device layout: tabs ── */
                  <Fragment>
                    {showDeviceTab && (
                      <button
                        className={`px-3 py-1.5 text-xs transition-colors border-b-2 ${
                          activeTab === "device"
                            ? "border-sky-400 text-white bg-stone-700/50"
                            : "border-transparent text-stone-400 hover:text-stone-200 hover:bg-stone-700/30"
                        }`}
                        onclick={() => switchToTab("device")}
                        title="ADB device capture"
                      >Device</button>
                    )}
                    {sessions.map(s => (
                      <div
                        key={s.id}
                        className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer transition-colors border-b-2 ${
                          activeTab === s.id
                            ? "border-sky-400 text-white bg-stone-700/50"
                            : "border-transparent text-stone-400 hover:text-stone-200 hover:bg-stone-700/30"
                        }`}
                        onclick={() => switchToTab(s.id)}
                        title={s.name + (s.kind === "vmadump" ? " (VMA dump)" : " (heap dump)")}
                      >
                        {s.status === "loading" && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse shrink-0" />}
                        {s.status === "error" && <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />}
                        <span className="truncate max-w-[140px]">{s.name}</span>
                        <button
                          className={`text-xs leading-none hover:text-rose-400 shrink-0 ${
                            activeTab === s.id ? "text-stone-400" : "opacity-0 group-hover:opacity-100 text-stone-500"
                          }`}
                          onclick={(e: MouseEvent) => { e.stopPropagation(); closeTab(s.id); }}
                          title="Close tab"
                          aria-label={`Close ${s.name}`}
                        >{"\u00d7"}</button>
                      </div>
                    ))}
                    <button
                      className="text-stone-500 hover:text-stone-300 text-xs px-2 py-1.5 transition-colors"
                      onclick={() => fileEl?.click()}
                      title="Open file"
                      aria-label="Open file"
                    >+</button>
                  </Fragment>
                ) : (
                  /* ── Single-dump layout: inline nav ── */
                  <Fragment>
                    {activeSession && (
                      <span className="text-stone-400 text-xs border-l border-stone-600 pl-3 truncate max-w-[200px]">{activeSession.name}</span>
                    )}
                    {activeSession?.status === "ready" && (
                      <nav className="flex gap-0.5 ml-2">
                        {navItems.map(n => (
                          <button
                            key={n.view}
                            className={`px-3 py-1 text-sm transition-colors ${
                              nav.view === n.view ? "bg-stone-600 text-white" : "text-stone-300 hover:bg-stone-700 hover:text-white"
                            }`}
                            onclick={() => navigateTop(n.view, n.params)}
                          >{n.label}</button>
                        ))}
                      </nav>
                    )}
                    {diffControls}
                  </Fragment>
                )}

                {/* Right side: theme + menu */}
                <div className="ml-auto flex items-center gap-2">
                  <ThemeToggle />
                  <div className="relative">
                    <button
                      className="text-stone-400 hover:text-white text-xs border border-stone-600 h-6 px-2"
                      onclick={() => { menuOpen = !menuOpen; }}
                      aria-label="Menu"
                    >{"\u22EF"}</button>
                    {menuOpen && (
                      <div className="absolute right-0 top-full mt-1 bg-stone-800 dark:bg-stone-900 border border-stone-600 shadow-lg z-50 min-w-[140px]">
                        <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onclick={() => { fileEl?.click(); menuOpen = false; }}>
                          Open File
                        </button>
                        {!captureUsed && (
                          <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onclick={() => { captureUsed = true; activeTab = "device"; menuOpen = false; }}>
                            Capture from device
                          </button>
                        )}
                        {activeSession?.status === "ready" && (activeSession.buffer || activeSession.proxy) && (
                          <Fragment>
                            {activeSession.kind === "hprof" && (
                              <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onclick={() => { mapFileEl?.click(); menuOpen = false; }}>
                                Load Mapping
                              </button>
                            )}
                            <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onclick={async () => {
                              menuOpen = false;
                              if (activeSession.kind === "vmadump" && activeSession.buffer) {
                                downloadBlob(activeSession.name + ".bin", activeSession.buffer);
                              } else if (activeSession.proxy) {
                                const buf = await activeSession.proxy.query<ArrayBuffer | null>("getRawBuffer");
                                if (buf) downloadBuffer(activeSession.name, buf);
                              }
                            }}>
                              Download
                            </button>
                          </Fragment>
                        )}
                        {activeSession && !showTabs && (
                          <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-rose-400" onclick={() => { closeTab(activeSession.id); menuOpen = false; }}>
                            Close
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sub-bar: dump nav + diff — multi-dump layout only, when active tab is a ready hprof */}
              {showTabs && activeSession?.status === "ready" && activeSession.kind === "hprof" && activeTab !== "device" && (
                <div className="px-4 py-1 border-t border-stone-700 flex items-center gap-4">
                  <nav className="flex gap-0.5">
                    {navItems.map(n => (
                      <button
                        key={n.view}
                        className={`px-3 py-1 text-sm transition-colors ${
                          nav.view === n.view ? "bg-stone-600 text-white" : "text-stone-300 hover:bg-stone-700 hover:text-white"
                        }`}
                        onclick={() => navigateTop(n.view, n.params)}
                      >{n.label}</button>
                    ))}
                  </nav>
                  {diffControls}
                </div>
              )}
            </header>
          )}

          {/* Landing page — no sessions, no capture */}
          {isLanding && activeTab === "device" && (
            <div className="relative flex items-center justify-center p-8 min-h-screen">
              <div className="absolute top-4 right-4">
                <ThemeToggle variant="landing" />
              </div>
              <div className="max-w-lg w-full">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-stone-800 dark:bg-stone-700 flex items-center justify-center text-white font-bold text-sm">A</div>
                    <h1 className="text-3xl font-bold text-stone-800 dark:text-stone-100 tracking-tight">
                      ahat<span className="text-stone-400 dark:text-stone-500 font-normal">.web</span>
                    </h1>
                  </div>
                  <p className="text-stone-500 dark:text-stone-400 text-sm">Android Heap Analysis Tool — runs entirely in your browser</p>
                </div>
                <div
                  className="bg-white dark:bg-stone-900 border-2 border-dashed border-stone-300 dark:border-stone-600 p-10 text-center cursor-pointer hover:border-sky-400 dark:hover:border-sky-500 transition-colors"
                  onclick={() => fileEl?.click()}
                >
                  <div className="mb-4">
                    <svg className="w-12 h-12 mx-auto text-stone-300 dark:text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  </div>
                  <p className="text-stone-700 dark:text-stone-200 font-medium mb-1">Drop an .hprof file here or click to browse</p>
                  <p className="text-stone-400 dark:text-stone-500 text-sm">Supports J2SE HPROF format with Android extensions</p>
                </div>
                <div className="mt-4 flex items-center justify-center">
                  <button
                    className="px-5 py-2.5 border border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-300 hover:border-stone-400 dark:hover:border-stone-500 hover:bg-white dark:hover:bg-stone-800 transition-colors"
                    onclick={() => { captureUsed = true; }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
                      </svg>
                      Capture from device
                    </span>
                  </button>
                </div>
                {error && (
                  <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-400 text-sm">{error}</div>
                )}
              </div>
            </div>
          )}

          {/* CaptureView — mounted once captureUsed, stays mounted to preserve USB connection */}
          {captureUsed && (
            <div className={activeTab === "device" ? "" : "hidden"}>
              {sessions.length === 0 && (
                <div className="p-8 pb-0 max-w-[95%] mx-auto">
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-lg font-semibold text-stone-800 dark:text-stone-100">Capture from device</h1>
                    <ThemeToggle variant="landing" />
                  </div>
                </div>
              )}
              <div className={sessions.length > 0 ? "flex-1 p-4 max-w-[95%] mx-auto w-full text-sm" : "max-w-[95%] mx-auto px-8"}>
                <CaptureView onCaptured={loadBuffer} onVmaDump={loadVmaDump} conn={adbConn} />
              </div>
            </div>
          )}

          {/* Active session content */}
          {activeTab !== "device" && activeSession && (
            <Fragment>
              {/* Loading state — inline in tab */}
              {activeSession.status === "loading" && (
                <div className="flex items-center justify-center p-8 flex-1">
                  <div className="max-w-md w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 p-8">
                    <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100 mb-4 truncate" title={`Parsing ${activeSession.name}`}>
                      Parsing {activeSession.name}{"\u2026"}
                    </h2>
                    <div className="w-full h-2 bg-stone-100 dark:bg-stone-700 overflow-hidden mb-3">
                      <div className="h-full bg-sky-500 transition-all duration-300" style={{ width: activeSession.progress.pct + "%" }} />
                    </div>
                    <p className="text-sm text-stone-500 dark:text-stone-400 truncate" title={activeSession.progress.msg}>{activeSession.progress.msg}</p>
                    <button
                      className="mt-4 text-sm text-stone-500 dark:text-stone-400 hover:text-rose-600 dark:hover:text-rose-400"
                      onclick={() => closeTab(activeSession.id)}
                    >Cancel</button>
                  </div>
                </div>
              )}

              {/* Error state */}
              {activeSession.status === "error" && (
                <div className="flex items-center justify-center p-8 flex-1">
                  <div className="max-w-md w-full bg-white dark:bg-stone-900 border border-rose-200 dark:border-rose-800 p-8">
                    <h2 className="text-lg font-semibold text-rose-700 dark:text-rose-400 mb-2">Failed to parse {activeSession.name}</h2>
                    <p className="text-sm text-stone-600 dark:text-stone-400 mb-4">{activeSession.errorMsg}</p>
                    <button
                      className="text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                      onclick={() => closeTab(activeSession.id)}
                    >Close</button>
                  </div>
                </div>
              )}

              {/* Ready — vmadump hex view */}
              {activeSession.status === "ready" && activeSession.kind === "vmadump" && activeSession.buffer && (
                <main className="flex-1 p-4 max-w-[95%] mx-auto w-full">
                  <HexView
                    buffer={activeSession.buffer}
                    name={activeSession.name}
                    regions={activeSession.vmaRegions}
                    availableDiffs={sessions
                      .filter(s => s.kind === "vmadump" && s.id !== activeSession.id && s.status === "ready" && s.buffer)
                      .map(s => ({ id: s.id, name: s.name, buffer: s.buffer! }))
                    }
                  />
                </main>
              )}

              {/* Ready — hprof content views */}
              {activeSession.status === "ready" && activeSession.kind === "hprof" && activeProxy && activeOverview && (
                <main className="flex-1 p-4 max-w-[95%] mx-auto w-full text-sm">
                  <Breadcrumbs trail={trail} activeIndex={trailIndex} onNavigate={onBreadcrumbNavigate} />
                  {nav.view === "overview" && <OverviewView overview={activeOverview} name={activeSession.name} navigate={navigate} />}
                  {nav.view === "rooted"   && <RootedView proxy={activeProxy} heaps={activeOverview.heaps} navigate={navigate} isDiffed={isDiffed} />}
                  {nav.view === "object"   && <ObjectView proxy={activeProxy} heaps={activeOverview.heaps} navigate={navigate} params={nav.params} />}
                  {nav.view === "objects"  && <ObjectsView proxy={activeProxy} navigate={navigate} params={nav.params} />}
                  {nav.view === "site"     && <SiteView proxy={activeProxy} heaps={activeOverview.heaps} navigate={navigate} params={nav.params} isDiffed={isDiffed} />}
                  {nav.view === "search"   && <SearchView proxy={activeProxy} navigate={navigate} initialQuery={nav.params.q} />}
                  {nav.view === "bitmaps"  && <BitmapGalleryView proxy={activeProxy} navigate={navigate} />}
                  {nav.view === "strings" && <StringsView proxy={activeProxy} navigate={navigate} initialQuery={nav.params.q} />}
                </main>
              )}
            </Fragment>
          )}
        </div>
      );
    },
  };
}
