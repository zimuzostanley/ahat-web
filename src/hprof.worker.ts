// ─── hprof.worker.ts ─────────────────────────────────────────────────────────
//
// Slim worker: only used by the Zygote scan. Parses an hprof, computes
// per-object fingerprints, returns them, and discards the snapshot. Every
// other heap-dump browsing path is delegated to ui.perfetto.dev via iframe.
//
// Protocol
// ────────
//   Main → Worker   { type: "fingerprint", buffer: ArrayBuffer }   (transferred)
//   Worker → Main   { type: "progress", msg, pct }
//   Worker → Main   { type: "fingerprints", fingerprints: ObjectFingerprint[] }
//   Worker → Main   { type: "error", message }

import { parseHprof, computeFingerprints } from "./hprof";

type WorkerMessage = { type: "fingerprint"; buffer: ArrayBuffer };

addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as WorkerMessage;

  if (msg.type === "fingerprint") {
    try {
      postMessage({ type: "progress", msg: "Parsing…", pct: 10 });
      const snap = parseHprof(msg.buffer, (m: string, pct: number) => {
        postMessage({ type: "progress", msg: m, pct: 10 + pct * 0.7 });
      });
      const instCount = snap.instances.size;
      postMessage({ type: "progress", msg: `Fingerprinting ${instCount.toLocaleString()} objects…`, pct: 85 });
      const fingerprints = computeFingerprints(snap);
      postMessage({ type: "progress", msg: `${fingerprints.length.toLocaleString()} fingerprints`, pct: 100 });
      postMessage({ type: "fingerprints", fingerprints });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[hprof worker] fingerprint error:", err);
      postMessage({ type: "error", message });
    }
  }
});
