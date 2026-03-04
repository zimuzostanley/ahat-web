export const PERFETTO_UI = "https://ui.perfetto.dev";

export function openInPerfetto(buffer: ArrayBuffer, title: string): void {
  const win = window.open(PERFETTO_UI);
  if (!win) return;
  const timer = setInterval(() => win.postMessage("PING", PERFETTO_UI), 50);
  const timeout = setTimeout(() => { clearInterval(timer); window.removeEventListener("message", onPong); }, 10_000);
  const onPong = (evt: MessageEvent) => {
    if (evt.data !== "PONG") return;
    clearInterval(timer);
    clearTimeout(timeout);
    window.removeEventListener("message", onPong);
    const copy = buffer.slice(0);
    win.postMessage(
      { perfetto: { buffer: copy, title, fileName: title + ".hprof" } },
      PERFETTO_UI,
      [copy],
    );
  };
  window.addEventListener("message", onPong);
}

export function downloadBlob(name: string, buffer: ArrayBuffer): void {
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBuffer(name: string, buffer: ArrayBuffer): void {
  downloadBlob(name.endsWith(".hprof") ? name : name + ".hprof", buffer);
}
