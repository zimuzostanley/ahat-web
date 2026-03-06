import type { OverviewData } from "./hprof.worker";

export type QueryName = "getOverview" | "getRooted" | "getInstance" | "getSite" | "search" | "getObjects" | "getBitmapList" | "getStringList" | "getByteArray" | "getRawBuffer";

export type WorkerInMessage =
  | { type: "progress"; msg: string; pct: number }
  | { type: "ready"; overview: OverviewData }
  | { type: "error"; message: string }
  | { type: "result"; id: number; data: unknown }
  | { type: "queryError"; id: number; message: string }
  | { type: "diffProgress"; msg: string; pct: number }
  | { type: "diffReady"; overview: OverviewData }
  | { type: "baselineCleared"; overview: OverviewData }
  | { type: "proguardMapLoaded"; hasEntries: boolean };

export interface WorkerProxy {
  query<T>(name: QueryName, params?: Record<string, unknown>): Promise<T>;
  diffWithBaseline(buffer: ArrayBuffer, onProgress: (msg: string, pct: number) => void): Promise<OverviewData>;
  clearBaseline(): Promise<OverviewData>;
  loadProguardMap(text: string): Promise<boolean>;
  terminate(): void;
}

/** Pending one-shot operation with resolve/reject and optional progress callback. */
interface PendingOp<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  onProgress?: (msg: string, pct: number) => void;
}

export function makeWorkerProxy(
  worker: Worker,
  buffer: ArrayBuffer,
  onProgress: (msg: string, pct: number) => void,
): Promise<{ proxy: WorkerProxy; overview: OverviewData }> {
  return new Promise((resolve, reject) => {
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let ready = false;

    let diffOp: PendingOp<OverviewData> | null = null;
    let clearOp: PendingOp<OverviewData> | null = null;
    let mapOp: PendingOp<boolean> | null = null;

    function rejectOp<T>(op: PendingOp<T> | null, error: Error): null {
      if (op) op.reject(error);
      return null;
    }

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as WorkerInMessage;
      switch (msg.type) {
        case "progress":
          onProgress(msg.msg, msg.pct);
          break;
        case "ready": {
          ready = true;
          const proxy: WorkerProxy = {
            query<T>(name: QueryName, params?: Record<string, unknown>): Promise<T> {
              return new Promise<T>((res, rej) => {
                const id = nextId++;
                pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
                worker.postMessage({ type: "query", id, name, params });
              });
            },
            diffWithBaseline(buf: ArrayBuffer, onProg: (msg: string, pct: number) => void): Promise<OverviewData> {
              return new Promise<OverviewData>((res, rej) => {
                diffOp = { resolve: res, reject: rej, onProgress: onProg };
                const copy = buf.slice(0);
                worker.postMessage({ type: "diffWithBaseline", buffer: copy }, [copy]);
              });
            },
            clearBaseline(): Promise<OverviewData> {
              return new Promise<OverviewData>((res, rej) => {
                clearOp = { resolve: res, reject: rej };
                worker.postMessage({ type: "clearBaseline" });
              });
            },
            loadProguardMap(text: string): Promise<boolean> {
              return new Promise<boolean>((res, rej) => {
                mapOp = { resolve: res, reject: rej };
                worker.postMessage({ type: "loadProguardMap", text });
              });
            },
            terminate() { worker.terminate(); },
          };
          resolve({ proxy, overview: msg.overview });
          break;
        }
        case "error": {
          const error = new Error(msg.message);
          if (!ready) reject(error);
          diffOp = rejectOp(diffOp, error);
          clearOp = rejectOp(clearOp, error);
          mapOp = rejectOp(mapOp, error);
          break;
        }
        case "result": {
          const p = pending.get(msg.id);
          if (p) { pending.delete(msg.id); p.resolve(msg.data); }
          break;
        }
        case "queryError": {
          const p = pending.get(msg.id);
          if (p) { pending.delete(msg.id); p.reject(new Error(msg.message)); }
          break;
        }
        case "diffProgress":
          diffOp?.onProgress?.(msg.msg, msg.pct);
          break;
        case "diffReady":
          if (diffOp) { diffOp.resolve(msg.overview); diffOp = null; }
          break;
        case "baselineCleared":
          if (clearOp) { clearOp.resolve(msg.overview); clearOp = null; }
          break;
        case "proguardMapLoaded":
          if (mapOp) { mapOp.resolve(msg.hasEntries); mapOp = null; }
          break;
      }
    };
    worker.onerror = (err) => {
      const error = new Error(err.message ?? "Worker error");
      if (!ready) { reject(error); return; }
      for (const [, p] of pending) p.reject(error);
      pending.clear();
      diffOp = rejectOp(diffOp, error);
      clearOp = rejectOp(clearOp, error);
      mapOp = rejectOp(mapOp, error);
    };

    const forWorker = buffer.slice(0);
    worker.postMessage({ type: "parse", buffer: forWorker }, [forWorker]);
  });
}
