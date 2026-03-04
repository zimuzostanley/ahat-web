import { useState, useCallback, useRef, useEffect } from "react";
import type { OverviewData } from "./hprof.worker";
import { AdbConnection } from "./adb/capture";
import HprofWorkerInline from "./hprof.worker.ts?worker&inline";
import { type WorkerProxy, makeWorkerProxy } from "./worker-proxy";
import { stateToUrl, urlToState } from "./routing";
import type { NavFn } from "./components";
import { downloadBuffer, openInPerfetto } from "./utils";
import CaptureView from "./views/CaptureView";
import OverviewView from "./views/OverviewView";
import RootedView from "./views/RootedView";
import ObjectView, { type ObjectParams } from "./views/ObjectView";
import SiteView, { type SiteParams } from "./views/SiteView";
import SearchView from "./views/SearchView";
import ObjectsView, { type ObjectsParams } from "./views/ObjectsView";
import BitmapGalleryView from "./views/BitmapGalleryView";

// ─── Session type ─────────────────────────────────────────────────────────────

type SessionStatus = "loading" | "ready" | "error";

interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  buffer: ArrayBuffer | null;
  proxy: WorkerProxy | null;
  overview: OverviewData | null;
  progress: { msg: string; pct: number };
  worker: Worker | null;
  errorMsg: string | null;
}

let nextSessionId = 1;

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeTab, setActiveTab] = useState<"device" | string>("device");
  const [view, setView] = useState("overview");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [captureUsed, setCaptureUsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [baselineSessionId, setBaselineSessionId] = useState<string | null>(null);
  const [diffing, setDiffing] = useState(false);
  const [diffProgress, setDiffProgress] = useState<{ msg: string; pct: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mapFileRef = useRef<HTMLInputElement>(null);
  const adbConnRef = useRef(new AdbConnection());

  // Derived state
  const activeSession = activeTab !== "device" ? sessions.find(s => s.id === activeTab) ?? null : null;
  const activeProxy = activeSession?.status === "ready" ? activeSession.proxy : null;
  const activeOverview = activeSession?.status === "ready" ? activeSession.overview : null;
  const isDiffed = activeOverview?.isDiffed ?? false;
  const readySessions = sessions.filter(s => s.status === "ready");
  const showDeviceTab = captureUsed;
  const showTabs = sessions.length > 1 || showDeviceTab;

  // Navigate: push new state to browser history
  const navigate: NavFn = useCallback((v, p = {}) => {
    setView(v);
    setParams(p);
    const url = stateToUrl(v, p);
    window.history.pushState({ view: v, params: p }, "", url);
    window.scrollTo(0, 0);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(false);
    // Delay so the opening click doesn't immediately close
    const id = requestAnimationFrame(() => document.addEventListener("click", handler));
    return () => { cancelAnimationFrame(id); document.removeEventListener("click", handler); };
  }, [menuOpen]);

  // Listen for browser back/forward
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      if (e.state && e.state.view) {
        setView(e.state.view);
        setParams(e.state.params ?? {});
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Non-blocking per-tab loading — creates session immediately, parses in background
  const loadBuffer = useCallback(async (name: string, buffer: ArrayBuffer) => {
    const sessionId = `session-${nextSessionId++}`;
    const worker = new HprofWorkerInline();
    setError(null);

    const newSession: Session = {
      id: sessionId, name, status: "loading",
      buffer: null, proxy: null, overview: null,
      progress: { msg: "Starting parser\u2026", pct: 2 },
      worker, errorMsg: null,
    };
    setSessions(prev => [...prev, newSession]);
    setActiveTab(sessionId);

    try {
      const { proxy: p, overview: ov } = await makeWorkerProxy(worker, buffer,
        (msg, pct) => setSessions(prev => prev.map(s =>
          s.id === sessionId ? { ...s, progress: { msg, pct } } : s
        )),
      );
      // Check session still exists (not cancelled)
      setSessions(prev => {
        if (!prev.find(s => s.id === sessionId)) return prev;
        return prev.map(s => s.id === sessionId
          ? { ...s, status: "ready" as const, buffer, proxy: p, overview: ov, worker: null }
          : s);
      });
      const initial = urlToState(new URL(window.location.href));
      setView(initial.view);
      setParams(initial.params);
      window.history.replaceState(
        { view: initial.view, params: initial.params }, "",
        stateToUrl(initial.view, initial.params),
      );
    } catch (err: unknown) {
      console.error(err);
      setSessions(prev => {
        if (!prev.find(s => s.id === sessionId)) return prev;
        return prev.map(s => s.id === sessionId
          ? { ...s, status: "error" as const, errorMsg: err instanceof Error ? err.message : "Parse failed", worker: null }
          : s);
      });
    }
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      await loadBuffer(file.name.replace(/\.hprof$/i, ""), buffer);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to read file");
    }
  }, [loadBuffer]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const handleMapFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeProxy) return;
    try {
      const text = await file.text();
      await activeProxy.loadProguardMap(text);
      const ov = await activeProxy.query<OverviewData>("getOverview");
      setSessions(prev => prev.map(s => s.id === activeTab ? { ...s, overview: ov } : s));
    } catch (err) {
      console.error("Failed to load mapping:", err);
      setError(err instanceof Error ? err.message : "Failed to load ProGuard mapping");
    }
    e.target.value = "";
  }, [activeProxy, activeTab]);

  const switchToTab = useCallback((tabId: string) => {
    if (tabId === activeTab) return;
    setActiveTab(tabId);
    if (tabId !== "device") {
      setView("overview");
      setParams({});
      setBaselineSessionId(null);
      window.history.replaceState({ view: "overview", params: {} }, "", stateToUrl("overview", {}));
    }
  }, [activeTab]);

  const closeTab = useCallback((id: string) => {
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    if (session.worker) session.worker.terminate();
    if (session.proxy) session.proxy.terminate();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (id === baselineSessionId) {
      setBaselineSessionId(null);
      if (activeProxy && activeTab !== id) {
        activeProxy.clearBaseline().then(ov => {
          setSessions(prev => prev.map(s => s.id === activeTab ? { ...s, overview: ov } : s));
        }).catch(() => {});
      }
    }
    if (activeTab === id) {
      const remaining = sessions.filter(s => s.id !== id);
      if (remaining.length > 0) {
        setActiveTab(remaining[remaining.length - 1].id);
      } else {
        setActiveTab("device");
      }
      setBaselineSessionId(null);
      if (diffing) { setDiffing(false); setDiffProgress(null); }
    }
  }, [sessions, activeTab, baselineSessionId, activeProxy, diffing]);

  const handleBaselineChange = useCallback(async (blId: string | null) => {
    if (!activeProxy || !activeSession) return;
    if (!blId) {
      setDiffing(true);
      setDiffProgress({ msg: "Clearing diff\u2026", pct: 0 });
      try {
        const ov = await activeProxy.clearBaseline();
        setBaselineSessionId(null);
        setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, overview: ov } : s));
      } finally {
        setDiffing(false);
        setDiffProgress(null);
      }
      return;
    }
    const blSession = readySessions.find(s => s.id === blId);
    if (!blSession || !blSession.buffer) return;
    setDiffing(true);
    setDiffProgress({ msg: "Starting diff\u2026", pct: 0 });
    try {
      const ov = await activeProxy.diffWithBaseline(
        blSession.buffer,
        (msg, pct) => setDiffProgress({ msg, pct }),
      );
      setBaselineSessionId(blId);
      setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, overview: ov } : s));
    } catch (err) {
      console.error("Diff failed:", err);
      setBaselineSessionId(null);
    } finally {
      setDiffing(false);
      setDiffProgress(null);
    }
  }, [activeProxy, activeSession, readySessions]);

  const handleCaptured = useCallback((name: string, buffer: ArrayBuffer) => {
    loadBuffer(name, buffer);
  }, [loadBuffer]);

  const isLanding = sessions.length === 0 && !captureUsed;

  const navItems = [
    { view: "overview", label: "Overview", params: {} },
    { view: "rooted", label: "Rooted", params: {} },
    { view: "site", label: "Allocations", params: { id: 0 } },
    { view: "bitmaps", label: "Bitmaps", params: {} },
    { view: "search", label: "Search", params: {} },
  ];

  // Diff controls — shared between single-dump and multi-dump layouts
  const diffControls = readySessions.length > 1 && (
    <div className="flex items-center gap-1.5 border-l border-stone-600 pl-3">
      <span className="text-stone-500 text-xs">Diff:</span>
      <select
        className="text-xs bg-stone-700 text-stone-300 border border-stone-600 px-1.5 py-0.5 cursor-pointer max-w-[120px] truncate"
        value={baselineSessionId ?? ""}
        disabled={diffing}
        onChange={e => handleBaselineChange(e.target.value || null)}
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
    <div className="min-h-screen bg-stone-50 flex flex-col"
      onDragOver={e => e.preventDefault()} onDrop={handleDrop}
    >
      {/* Hidden file inputs */}
      <input ref={fileRef} type="file" accept=".hprof" className="hidden" onChange={handleFile} />
      <input ref={mapFileRef} type="file" accept=".txt,.map" className="hidden" onChange={handleMapFile} />

      {/* Header — shown when we have sessions */}
      {sessions.length > 0 && (
        <header className="bg-stone-800 text-white flex-shrink-0">
          <div className="px-4 py-2 flex items-center gap-3">
            {/* Logo */}
            <button
              className="flex items-center gap-2 flex-shrink-0"
              onClick={() => {
                if (captureUsed) switchToTab("device");
                else if (activeSession) { setView("overview"); setParams({}); }
              }}
            >
              <div className="w-6 h-6 bg-sky-600 flex items-center justify-center text-white font-bold text-xs">A</div>
              <span className="font-bold tracking-tight text-sm">ahat<span className="text-stone-400 font-normal">.web</span></span>
            </button>

            {showTabs ? (
              /* ── Multi-dump / device layout: tabs ── */
              <>
                {showDeviceTab && (
                  <button
                    className={`px-3 py-1 text-sm transition-colors ${
                      activeTab === "device" ? "bg-stone-600 text-white" : "text-stone-300 hover:bg-stone-700 hover:text-white"
                    }`}
                    onClick={() => switchToTab("device")}
                  >Device</button>
                )}
                {sessions.map(s => (
                  <div key={s.id} className="flex items-center group">
                    <button
                      className={`px-3 py-1 text-sm transition-colors flex items-center gap-1.5 ${
                        activeTab === s.id ? "bg-stone-600 text-white" : "text-stone-300 hover:bg-stone-700 hover:text-white"
                      }`}
                      onClick={() => switchToTab(s.id)}
                    >
                      {s.status === "loading" && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />}
                      {s.status === "error" && <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />}
                      <span className="truncate max-w-[120px]">{s.name}</span>
                    </button>
                    <button
                      className={`text-stone-500 hover:text-rose-400 text-xs px-1 ${
                        activeTab === s.id ? "visible" : "invisible group-hover:visible"
                      }`}
                      onClick={e => { e.stopPropagation(); closeTab(s.id); }}
                      title="Close tab"
                    >&times;</button>
                  </div>
                ))}
                <button
                  className="text-stone-500 hover:text-white text-sm px-2 py-1"
                  onClick={() => fileRef.current?.click()}
                  title="Open file"
                >+</button>
              </>
            ) : (
              /* ── Single-dump layout: inline nav ── */
              <>
                {activeSession && (
                  <span className="text-stone-400 text-xs border-l border-stone-600 pl-3 truncate max-w-[200px]">{activeSession.name}</span>
                )}
                {activeSession?.status === "ready" && (
                  <nav className="flex gap-0.5 ml-2">
                    {navItems.map(n => (
                      <button
                        key={n.view}
                        className={`px-3 py-1 text-sm transition-colors ${
                          view === n.view ? "bg-stone-600 text-white" : "text-stone-300 hover:bg-stone-700 hover:text-white"
                        }`}
                        onClick={() => navigate(n.view, n.params)}
                      >{n.label}</button>
                    ))}
                  </nav>
                )}
                {diffControls}
              </>
            )}

            {/* Right side: back + menu */}
            <div className="ml-auto flex items-center gap-3">
              {activeSession?.status === "ready" && (
                <button className="text-stone-400 hover:text-white text-sm" onClick={() => window.history.back()}>
                  &larr; Back
                </button>
              )}
              <div className="relative">
                <button
                  className="text-stone-400 hover:text-white text-xs border border-stone-600 px-2 py-0.5"
                  onClick={() => setMenuOpen(!menuOpen)}
                >{"\u22EF"}</button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-stone-800 border border-stone-600 shadow-lg z-50 min-w-[140px]">
                    <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}>
                      Open File
                    </button>
                    {!captureUsed && (
                      <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { setCaptureUsed(true); setActiveTab("device"); setMenuOpen(false); }}>
                        Capture from device
                      </button>
                    )}
                    {activeSession?.status === "ready" && activeSession.buffer && (
                      <>
                        <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { mapFileRef.current?.click(); setMenuOpen(false); }}>
                          Load Mapping
                        </button>
                        <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { downloadBuffer(activeSession.name, activeSession.buffer!); setMenuOpen(false); }}>
                          Download
                        </button>
                        <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-white" onClick={() => { openInPerfetto(activeSession.buffer!, activeSession.name); setMenuOpen(false); }}>
                          Perfetto
                        </button>
                      </>
                    )}
                    {activeSession && !showTabs && (
                      <button className="w-full text-left px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-rose-400" onClick={() => { closeTab(activeSession.id); setMenuOpen(false); }}>
                        Close
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sub-bar: dump nav + diff — multi-dump layout only, when active tab is a ready dump */}
          {showTabs && activeSession?.status === "ready" && activeTab !== "device" && (
            <div className="px-4 py-1 border-t border-stone-700 flex items-center gap-4">
              <nav className="flex gap-0.5">
                {navItems.map(n => (
                  <button
                    key={n.view}
                    className={`px-3 py-1 text-sm transition-colors ${
                      view === n.view ? "bg-stone-600 text-white" : "text-stone-300 hover:bg-stone-700 hover:text-white"
                    }`}
                    onClick={() => navigate(n.view, n.params)}
                  >{n.label}</button>
                ))}
              </nav>
              {diffControls}
              <button
                className="text-stone-400 hover:text-white text-sm ml-auto"
                onClick={() => window.history.back()}
              >&larr; Back</button>
            </div>
          )}
        </header>
      )}

      {/* Landing page — no sessions, no capture */}
      {isLanding && activeTab === "device" && (
        <div className="flex items-center justify-center p-8 min-h-screen">
          <div className="max-w-lg w-full">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-stone-800 flex items-center justify-center text-white font-bold text-sm">A</div>
                <h1 className="text-3xl font-bold text-stone-800 tracking-tight">
                  ahat<span className="text-stone-400 font-normal">.web</span>
                </h1>
              </div>
              <p className="text-stone-500 text-sm">Android Heap Analysis Tool — runs entirely in your browser</p>
            </div>
            <div
              className="bg-white border-2 border-dashed border-stone-300 p-10 text-center cursor-pointer hover:border-sky-400 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <div className="mb-4">
                <svg className="w-12 h-12 mx-auto text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="text-stone-700 font-medium mb-1">Drop an .hprof file here or click to browse</p>
              <p className="text-stone-400 text-sm">Supports J2SE HPROF format with Android extensions</p>
            </div>
            <div className="mt-4 text-center">
              <button
                className="px-5 py-2.5 border border-stone-300 text-stone-700 hover:border-stone-400 hover:bg-white transition-colors"
                onClick={() => setCaptureUsed(true)}
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
              <div className="mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>
            )}
          </div>
        </div>
      )}

      {/* CaptureView — mounted once captureUsed, stays mounted to preserve USB connection */}
      {captureUsed && (
        <div className={activeTab === "device" ? "" : "hidden"}>
          {sessions.length === 0 && (
            <div className="p-8 pb-0 max-w-[95%] mx-auto">
              <div className="flex items-center gap-4 mb-6">
                <button className="text-stone-400 hover:text-stone-600" onClick={() => setCaptureUsed(false)}>
                  &larr; Back
                </button>
                <h1 className="text-lg font-semibold text-stone-800">Capture from device</h1>
              </div>
            </div>
          )}
          <div className={sessions.length > 0 ? "flex-1 p-4 max-w-[95%] mx-auto w-full text-sm" : "max-w-[95%] mx-auto px-8"}>
            <CaptureView onCaptured={handleCaptured} conn={adbConnRef.current} />
          </div>
        </div>
      )}

      {/* Active session content */}
      {activeTab !== "device" && activeSession && (
        <>
          {/* Loading state — inline in tab */}
          {activeSession.status === "loading" && (
            <div className="flex items-center justify-center p-8 flex-1">
              <div className="max-w-md w-full bg-white border border-stone-200 p-8">
                <h2 className="text-lg font-semibold text-stone-800 mb-4 truncate" title={`Parsing ${activeSession.name}`}>
                  Parsing {activeSession.name}&hellip;
                </h2>
                <div className="w-full h-2 bg-stone-100 overflow-hidden mb-3">
                  <div className="h-full bg-sky-500 transition-all duration-300" style={{ width: activeSession.progress.pct + "%" }} />
                </div>
                <p className="text-sm text-stone-500 truncate" title={activeSession.progress.msg}>{activeSession.progress.msg}</p>
                <button
                  className="mt-4 text-sm text-stone-500 hover:text-rose-600"
                  onClick={() => closeTab(activeSession.id)}
                >Cancel</button>
              </div>
            </div>
          )}

          {/* Error state */}
          {activeSession.status === "error" && (
            <div className="flex items-center justify-center p-8 flex-1">
              <div className="max-w-md w-full bg-white border border-rose-200 p-8">
                <h2 className="text-lg font-semibold text-rose-700 mb-2">Failed to parse {activeSession.name}</h2>
                <p className="text-sm text-stone-600 mb-4">{activeSession.errorMsg}</p>
                <button
                  className="text-sm text-stone-500 hover:text-stone-700"
                  onClick={() => closeTab(activeSession.id)}
                >Close</button>
              </div>
            </div>
          )}

          {/* Ready — main content views */}
          {activeSession.status === "ready" && activeProxy && activeOverview && (
            <main className="flex-1 p-4 max-w-[95%] mx-auto w-full text-sm">
              {view === "overview" && <OverviewView overview={activeOverview} name={activeSession.name} navigate={navigate} />}
              {view === "rooted"   && <RootedView proxy={activeProxy} heaps={activeOverview.heaps} navigate={navigate} isDiffed={isDiffed} />}
              {view === "object"   && <ObjectView proxy={activeProxy} heaps={activeOverview.heaps} navigate={navigate} params={params as unknown as ObjectParams} />}
              {view === "objects"  && <ObjectsView proxy={activeProxy} navigate={navigate} params={params as unknown as ObjectsParams} />}
              {view === "site"     && <SiteView proxy={activeProxy} heaps={activeOverview.heaps} navigate={navigate} params={params as unknown as SiteParams} isDiffed={isDiffed} />}
              {view === "search"   && <SearchView proxy={activeProxy} navigate={navigate} initialQuery={params.q as string | undefined} />}
              {view === "bitmaps"  && <BitmapGalleryView proxy={activeProxy} navigate={navigate} />}
            </main>
          )}
        </>
      )}
    </div>
  );
}
