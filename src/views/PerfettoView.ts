import m from "mithril";

/**
 * Embeds ui.perfetto.dev in an iframe and sends a trace buffer via postMessage.
 *
 * Protocol:
 * 1. iframe loads ui.perfetto.dev
 * 2. iframe sends PING messages until parent responds
 * 3. Parent responds with PONG
 * 4. Parent sends the trace buffer via {perfetto: {buffer, title}}
 */
const PerfettoView: m.Component<{ buffer: ArrayBuffer; name: string }> = {
  oncreate(vnode) {
    const { buffer, name } = vnode.attrs;
    const iframe = vnode.dom.querySelector("iframe") as HTMLIFrameElement;
    if (!iframe) return;

    let sent = false;

    function onMessage(e: MessageEvent) {
      if (e.source !== iframe.contentWindow) return;
      if (e.data === "PING") {
        iframe.contentWindow!.postMessage("PONG", "https://ui.perfetto.dev");
        if (!sent) {
          sent = true;
          // Small delay to let Perfetto finish init after PONG
          setTimeout(() => {
            iframe.contentWindow!.postMessage({
              perfetto: {
                buffer: buffer.slice(0),
                title: name,
                keepApiOpen: false,
              },
            }, "https://ui.perfetto.dev");
          }, 100);
        }
      }
    }

    window.addEventListener("message", onMessage);
    (vnode as any)._perfettoCleanup = () => window.removeEventListener("message", onMessage);
  },

  onremove(vnode) {
    const cleanup = (vnode as any)._perfettoCleanup;
    if (cleanup) cleanup();
  },

  view() {
    return m("div", { style: { width: "100%", height: "100%", display: "flex", flexDirection: "column" } },
      m("iframe", {
        src: "https://ui.perfetto.dev",
        style: { flex: "1", border: "none", width: "100%", minHeight: "0" },
        allow: "clipboard-write",
      }),
    );
  },
};

export default PerfettoView;
