import m from "mithril";
import { Fragment } from "./mithril-helpers";
import { AdbConnection, parseSmaps, aggregateSmaps, parseSmapsRollups, parseBatchSmaps, type SmapsAggregated, type ProcessStringsResult } from "./adb/capture";
import { downloadBlob } from "./utils";
import { getTheme, toggleTheme } from "./theme";
import CaptureView from "./views/CaptureView";
import HexView from "./views/HexView";
import SmapsFileView from "./views/SmapsFileView";
import ProcessStringsView from "./views/ProcessStringsView";
import PerfettoView from "./views/PerfettoView";

// ─── CmdTooltip ──────────────────────────────────────────────────────────────

function CmdTooltip(): m.Component<{ commands: { label: string; cmd: string }[] }> {
  let open = false;
  let copiedIdx: number | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function show() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    open = true;
  }
  function scheduleHide() {
    hideTimer = setTimeout(() => { open = false; copiedIdx = null; m.redraw(); }, 300);
  }

  return {
    view(vnode) {
      const { commands } = vnode.attrs;
      return m("span", {
        className: "ah-cmd-tip",
        onmouseenter: show,
        onmouseleave: scheduleHide,
        onclick: (e: Event) => { e.stopPropagation(); e.preventDefault(); show(); m.redraw(); },
      }, [
        m("span", { className: "ah-cmd-tip__trigger" }, "adb commands"),
        open && m("div", {
          className: "ah-cmd-tip__popup",
          onmouseenter: show,
          onmouseleave: scheduleHide,
          onclick: (e: Event) => { e.stopPropagation(); e.preventDefault(); },
        },
          commands.map((c, i) =>
            m("div", { className: "ah-cmd-tip__row", key: i }, [
              m("div", { className: "ah-cmd-tip__label" }, c.label),
              m("code", {
                className: `ah-cmd-tip__cmd${copiedIdx === i ? " ah-cmd-tip__cmd--copied" : ""}`,
                onclick: (e: Event) => {
                  e.stopPropagation();
                  e.preventDefault();
                  navigator.clipboard.writeText(c.cmd).then(() => {
                    copiedIdx = i;
                    m.redraw();
                    setTimeout(() => { if (copiedIdx === i) { copiedIdx = null; m.redraw(); } }, 1500);
                  });
                },
              }, copiedIdx === i ? "copied!" : c.cmd),
            ])
          ),
        ),
      ]);
    },
  };
}

// ─── Session type ─────────────────────────────────────────────────────────────

/** Address region for VMA dumps — used to show real memory addresses. */
export interface VmaRegion { addrStart: string; addrEnd: string }

interface Session {
  id: string;
  name: string;
  kind: "perfetto" | "vmadump" | "smaps" | "procstrings";
  buffer: ArrayBuffer | null;
  vmaRegions?: VmaRegion[];
  initialStringFilter?: string;
  smapsAggregated?: SmapsAggregated[];
  smapsProcesses?: { pid: number; name: string; aggregated: SmapsAggregated[] }[];
  procStrings?: ProcessStringsResult;
  scanAbortCtrl?: AbortController;
}

let nextSessionId = 1;

// ─── Sun / Moon SVG icons ────────────────────────────────────────────────────

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
  let vmaDumpFromStringsStatus: string | null = null;
  let vmaDumpFromStringsAc: AbortController | null = null;
  let captureUsed = false;
  let pendingSessionFile: File | null = null;
  let menuOpen = false;
  let fileEl: HTMLInputElement | null = null;
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

  function getActiveSession(): Session | null {
    return activeTab !== "device" ? sessions.find(s => s.id === activeTab) ?? null : null;
  }

  // Open an .hprof in Perfetto's iframe.
  function loadBuffer(name: string, buffer: ArrayBuffer) {
    const sessionId = `session-${nextSessionId++}`;
    sessions = [...sessions, {
      id: sessionId, name, kind: "perfetto",
      buffer,
    }];
    activeTab = sessionId;
    error = null;
    m.redraw();
  }

  async function loadFile(file: File) {
    error = null;
    try {
      const buffer = await file.arrayBuffer();
      loadBuffer(file.name.replace(/\.hprof$/i, ""), buffer);
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

  function switchToTab(tabId: string) {
    if (tabId === activeTab) return;
    activeTab = tabId;
  }

  function closeTab(id: string) {
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    sessions = sessions.filter(s => s.id !== id);
    if (activeTab === id) {
      const remaining = sessions;
      activeTab = remaining.length > 0 ? remaining[remaining.length - 1].id : "device";
    }
  }

  function loadVmaDump(name: string, buffer: ArrayBuffer, regions?: VmaRegion[], initialStringFilter?: string) {
    const sessionId = `session-${nextSessionId++}`;
    sessions = [...sessions, {
      id: sessionId, name, kind: "vmadump",
      buffer,
      vmaRegions: regions,
      initialStringFilter,
    }];
    activeTab = sessionId;
  }

  function loadProcessStrings(name: string, data: ProcessStringsResult, scanAbortCtrl?: AbortController): string {
    const sessionId = `session-${nextSessionId++}`;
    sessions = [...sessions, {
      id: sessionId, name, kind: "procstrings",
      buffer: null,
      procStrings: data,
      scanAbortCtrl,
    }];
    activeTab = sessionId;
    return sessionId;
  }

  function updateProcessStrings(sessionId: string, data: ProcessStringsResult) {
    sessions = sessions.map(s => s.id === sessionId ? { ...s, procStrings: data } : s);
    m.redraw();
  }

  async function loadSmapsFile(file: File) {
    error = null;
    try {
      const text = await file.text();
      const isBatch = /^===PID:\d+===/m.test(text);
      const sessionName = file.name.replace(/\.(txt|smaps)$/i, "");

      if (isBatch) {
        const batchFull = parseBatchSmaps(text);
        if (batchFull.size > 0) {
          const procs = [...batchFull.entries()].map(([pid, d]) => ({ pid, name: d.name, aggregated: d.aggregated }));
          const sessionId = `session-${nextSessionId++}`;
          sessions = [...sessions, {
            id: sessionId, name: sessionName, kind: "smaps", buffer: null,
            smapsProcesses: procs,
          }];
          activeTab = sessionId;
          m.redraw();
          return;
        }
        const rollups = parseSmapsRollups(text);
        if (rollups.size > 0) {
          const procs = [...rollups.entries()].map(([pid, r]) => ({
            pid,
            name: r.name ?? `pid ${pid}`,
            aggregated: [{ name: "[rollup]", count: 1, ...r, entries: [] }] as SmapsAggregated[],
          }));
          const sessionId = `session-${nextSessionId++}`;
          sessions = [...sessions, {
            id: sessionId, name: sessionName, kind: "smaps", buffer: null,
            smapsProcesses: procs,
          }];
          activeTab = sessionId;
          m.redraw();
          return;
        }
      }

      const entries = parseSmaps(text);
      if (entries.length === 0) {
        error = "No smaps data found. Expected /proc/[pid]/smaps, smaps_rollup, or batch ===PID:N=== format.";
        m.redraw();
        return;
      }
      const aggregated = aggregateSmaps(entries);
      const sessionId = `session-${nextSessionId++}`;
      sessions = [...sessions, {
        id: sessionId, name: sessionName, kind: "smaps", buffer: null,
        smapsAggregated: aggregated,
      }];
      activeTab = sessionId;
      m.redraw();
    } catch (err: unknown) {
      console.error(err);
      error = err instanceof Error ? err.message : "Failed to read smaps file";
      m.redraw();
    }
  }

  // postMessage handler for opening hprof from opener/parent
  function messageHandler(e: MessageEvent) {
    const d = e.data;
    if (d && typeof d === "object" && d.type === "open-hprof" && d.buffer instanceof ArrayBuffer) {
      const name = typeof d.name === "string" ? d.name : "untitled";
      loadBuffer(name, d.buffer);
    }
  }

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
      const showDeviceTab = captureUsed;
      const showTabs = sessions.length > 1 || showDeviceTab;
      const isLanding = sessions.length === 0 && !captureUsed;

      if (menuOpen) installMenuClose();
      else removeMenuClose();

      return m("div", {
        className: "ah-page",
        ondragover: (e: DragEvent) => e.preventDefault(), ondrop: handleDrop,
      },
        // Hidden file input
        m("input", { oncreate: (v: m.VnodeDOM) => { fileEl = v.dom as HTMLInputElement; }, type: "file", accept: ".hprof", className: "ah-hidden", onchange: handleFile }),

        // Header — shown when we have sessions
        sessions.length > 0 && (
          m("header", { className: "ah-header" },
            m("div", { className: "ah-header__bar" },
              // Logo
              m("button", {
                className: "ah-header__logo",
                onclick: () => {
                  captureUsed = true;
                  switchToTab("device");
                },
              },
                m("div", { className: "ah-header__logo-icon" }, "A"),
                m("span", { className: "ah-header__logo-text" }, "ahat", m("span", { className: "ah-header__logo-suffix" }, ".web"))
              ),

              showTabs ? (
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
                      title: s.name + (s.kind === "vmadump" ? " (VMA dump)" : s.kind === "smaps" ? " (smaps)" : s.kind === "perfetto" ? " (Perfetto)" : " (strings)"),
                    },
                      m("span", { className: "ah-tab__name" }, s.name),
                      m("button", {
                        className: `ah-tab__close ${activeTab === s.id ? "ah-tab__close--visible" : "ah-tab__close--hidden"}`,
                        onclick: (e: MouseEvent) => { e.stopPropagation(); closeTab(s.id); },
                        title: "Close tab",
                        "aria-label": `Close ${s.name}`,
                      }, "×")
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
                activeSession && m("span", { className: "ah-header__session-name" }, activeSession.name)
              ),

              // Right side: theme + menu
              m("div", { className: "ah-header__actions" },
                m(ThemeToggle, null),
                m("div", { style: { position: "relative" } },
                  m("button", {
                    className: "ah-header__menu-btn",
                    onclick: () => { menuOpen = !menuOpen; },
                    "aria-label": "Menu",
                  }, "⋯"),
                  menuOpen && (
                    m("div", { className: "ah-header__menu" },
                      m("button", { className: "ah-header__menu-item", onclick: () => { fileEl?.click(); menuOpen = false; } },
                        "Open File"),
                      !captureUsed && (
                        m("button", { className: "ah-header__menu-item", onclick: () => { captureUsed = true; activeTab = "device"; menuOpen = false; } },
                          "Capture from device")
                      ),
                      activeSession && activeSession.kind === "vmadump" && activeSession.buffer && (
                        m("button", { className: "ah-header__menu-item", onclick: () => {
                          menuOpen = false;
                          downloadBlob(activeSession.name + ".bin", activeSession.buffer!);
                        } }, "Download")
                      ),
                      activeSession && !showTabs && (
                        m("button", { className: "ah-header__menu-item--danger", onclick: () => { closeTab(activeSession.id); menuOpen = false; } },
                          "Close")
                      )
                    )
                  )
                )
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
                m("p", { className: "ah-landing__subtitle" }, "Android Heap Analysis Tool — runs entirely in your browser")
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
                m("p", { className: "ah-landing__drop-hint" }, "Heap dumps open in Perfetto UI"),
                m(CmdTooltip, { commands: [
                  { label: "Dump heap", cmd: "adb shell am dumpheap <pid> /data/local/tmp/dump.hprof" },
                  { label: "Pull file", cmd: "adb pull /data/local/tmp/dump.hprof" },
                ] }),
              ),
              m("div", { className: "ah-landing__session-row", style: { position: "relative" } },
                m("label", {
                  className: "ah-landing__session-load",
                }, [
                  "or load a smaps text file",
                  m("input", {
                    type: "file",
                    accept: ".txt,.smaps",
                    style: { display: "none" },
                    onchange: (e: Event) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) loadSmapsFile(file);
                      (e.target as HTMLInputElement).value = "";
                    },
                  }),
                ]),
                m(CmdTooltip, { commands: [
                  { label: "Single process", cmd: "adb shell cat /proc/<pid>/smaps > smaps.txt" },
                  { label: "Rollup", cmd: "adb shell cat /proc/<pid>/smaps_rollup > rollup.txt" },
                  { label: "All processes", cmd: "adb shell 'for p in /proc/[0-9]*/smaps_rollup; do pid=$(basename $(dirname $p)); name=$(cat /proc/$pid/cmdline 2>/dev/null | tr \"\\0\" \" \"); echo \"===PID:$pid===$name\"; cat $p 2>/dev/null; done' > all.txt" },
                ] }),
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
                ),
              ),
              m("div", { className: "ah-landing__session-row" },
                m("label", { className: "ah-landing__session-load" }, [
                  "or load a saved session",
                  m("input", {
                    type: "file",
                    accept: ".json",
                    style: { display: "none" },
                    onchange: (e: Event) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) { pendingSessionFile = file; captureUsed = true; }
                      (e.target as HTMLInputElement).value = "";
                    },
                  }),
                ]),
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
                  m("button", {
                    className: "ah-capture-header__logo",
                    onclick: () => { if (!adbConn.connected) captureUsed = false; },
                    title: adbConn.connected ? "" : "Back to home",
                    style: adbConn.connected ? { cursor: "default" } : undefined,
                  },
                    m("div", { className: "ah-header__logo-icon" }, "A"),
                  ),
                  m(ThemeToggle, { variant: "landing" }),
                )
              )
            ),
            m("div", { className: sessions.length > 0 ? "ah-capture-wrap--compact" : "ah-capture-wrap" },
              m(CaptureView, { onCaptured: loadBuffer, onVmaDump: loadVmaDump, onProcessStrings: loadProcessStrings, onUpdateProcessStrings: updateProcessStrings, conn: adbConn, sessionFile: pendingSessionFile })
            )
          )
        ),

        // Active session content
        activeTab !== "device" && activeSession && (
          m(Fragment, null,
            // VMA dump hex view
            activeSession.kind === "vmadump" && activeSession.buffer && (
              m("main", { className: "ah-main--vmadump" },
                m(HexView, {
                  buffer: activeSession.buffer,
                  name: activeSession.name,
                  regions: activeSession.vmaRegions,
                  initialStringFilter: activeSession.initialStringFilter,
                  availableDiffs: sessions
                    .filter(s => s.kind === "vmadump" && s.id !== activeSession.id && s.buffer)
                    .map(s => ({ id: s.id, name: s.name, buffer: s.buffer! })),
                })
              )
            ),

            // Process strings view
            activeSession.kind === "procstrings" && activeSession.procStrings && (
              m("main", { className: "ah-main--procstrings" },
                m(ProcessStringsView, {
                  data: activeSession.procStrings,
                  name: activeSession.name,
                  dumpStatus: vmaDumpFromStringsStatus,
                  onCancelScan: () => {
                    if (activeSession.scanAbortCtrl) {
                      activeSession.scanAbortCtrl.abort();
                      sessions = sessions.map(s => s.id === activeSession.id
                        ? { ...s, scanAbortCtrl: undefined, procStrings: s.procStrings ? { ...s.procStrings, scanning: false } : undefined }
                        : s);
                      m.redraw();
                    }
                  },
                  onCancelDump: () => {
                    if (vmaDumpFromStringsAc) { vmaDumpFromStringsAc.abort(); vmaDumpFromStringsAc = null; }
                    vmaDumpFromStringsStatus = null;
                    m.redraw();
                  },
                  onDumpVma: (dumpName: string, pid: number, region: { addrStart: string; addrEnd: string }, filterString?: string) => {
                    if (vmaDumpFromStringsStatus) return;
                    const ac = new AbortController();
                    vmaDumpFromStringsAc = ac;
                    const regions = [region];
                    vmaDumpFromStringsStatus = `Dumping ${region.addrStart}…`;
                    m.redraw();
                    adbConn.dumpVmaMemory(pid, regions, (status) => {
                      vmaDumpFromStringsStatus = status;
                      m.redraw();
                    }, ac.signal).then(data => {
                      vmaDumpFromStringsAc = null;
                      vmaDumpFromStringsStatus = null;
                      loadVmaDump(dumpName, data.buffer as ArrayBuffer, regions, filterString);
                    }).catch(e => {
                      vmaDumpFromStringsAc = null;
                      vmaDumpFromStringsStatus = null;
                      if (e instanceof DOMException && e.name === "AbortError") return;
                      error = e instanceof Error ? e.message : "VMA dump failed";
                      m.redraw();
                    });
                  },
                })
              )
            ),

            // Smaps file view
            activeSession.kind === "smaps" && (activeSession.smapsAggregated || activeSession.smapsProcesses) && (
              m("main", { className: "ah-main" },
                m(SmapsFileView, {
                  aggregated: activeSession.smapsAggregated ?? null,
                  processes: activeSession.smapsProcesses ?? null,
                  name: activeSession.name,
                }),
              )
            ),

            // Perfetto iframe sessions — keep all mounted, hide inactive ones to preserve iframe state
            sessions.some(s => s.kind === "perfetto" && s.buffer) &&
              m("div", { style: { display: "contents" } },
                sessions
                  .filter(s => s.kind === "perfetto" && s.buffer)
                  .map(s => m("main", {
                    key: s.id,
                    style: {
                      flex: "1", overflow: "hidden",
                      display: activeTab === s.id ? "" : "none",
                    },
                  }, m(PerfettoView, { buffer: s.buffer!, name: s.name })))
              )
          )
        )
      );
    },
  };
}
