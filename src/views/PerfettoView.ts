import m from "mithril";

const PERFETTO_UI = "https://ui.perfetto.dev";

/**
 * Embeds ui.perfetto.dev in an iframe and sends an hprof buffer via postMessage.
 *
 * Protocol (matching Perfetto's post_message_handler.ts):
 * 1. Parent sends PING repeatedly to the iframe
 * 2. Perfetto responds with PONG when ready
 * 3. Parent sends the trace buffer via {perfetto: {buffer, title, fileName}}
 */
const PerfettoView: m.Component<{ buffer: ArrayBuffer; name: string }> = {
  oncreate(vnode) {
    const { buffer, name } = vnode.attrs;
    const iframe = vnode.dom as HTMLIFrameElement;

    let sent = false;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function onMessage(e: MessageEvent) {
      if (e.source !== iframe.contentWindow) return;
      if (e.data !== "PONG" || sent) return;

      sent = true;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (timeout) { clearTimeout(timeout); timeout = null; }
      window.removeEventListener("message", onMessage);

      // Send the trace buffer with transfer for efficiency
      const copy = buffer.slice(0);
      iframe.contentWindow!.postMessage({
        perfetto: {
          buffer: copy,
          title: name,
          fileName: name.endsWith(".hprof") ? name : name + ".hprof",
          keepApiOpen: false,
        },
      }, PERFETTO_UI, [copy]);
    }

    window.addEventListener("message", onMessage);

    // Send PING every 50ms until Perfetto responds with PONG
    iframe.addEventListener("load", () => {
      pingTimer = setInterval(() => {
        if (!sent && iframe.contentWindow) {
          iframe.contentWindow.postMessage("PING", PERFETTO_UI);
        }
      }, 50);
    });

    // Timeout after 15s to avoid leaking the interval
    timeout = setTimeout(() => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      window.removeEventListener("message", onMessage);
    }, 15_000);

    (vnode as any)._perfettoCleanup = () => {
      if (pingTimer) clearInterval(pingTimer);
      if (timeout) clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
  },

  onremove(vnode) {
    const cleanup = (vnode as any)._perfettoCleanup;
    if (cleanup) cleanup();
  },

  view() {
    return m("iframe", {
      src: PERFETTO_UI,
      style: { border: "none", width: "100%", height: "calc(100vh - 3rem)" },
      allow: "clipboard-write",
    });
  },
};

export default PerfettoView;
