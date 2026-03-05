import type { OverviewData } from "./hprof.worker";

export type QueryName = "getOverview" | "getRooted" | "getInstance" | "getSite" | "search" | "getObjects" | "getBitmapList" | "getByteArray" | "getRawBuffer";

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

export function makeWorkerProxy(
  worker: Worker,
  buffer: ArrayBuffer,
  onProgress: (msg: string, pct: number) => void,
): Promise<{ proxy: WorkerProxy; overview: OverviewData }> {
  return new Promise((resolve, reject) => {
    let nextId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let ready = false;

    // Diff state
    let diffProgressCb: ((msg: string, pct: number) => void) | null = null;
    let diffResolve: ((ov: OverviewData) => void) | null = null;
    let diffReject: ((e: Error) => void) | null = null;
    let clearResolve: ((ov: OverviewData) => void) | null = null;
    let clearReject: ((e: Error) => void) | null = null;
    let mapResolve: ((ok: boolean) => void) | null = null;
    let mapReject: ((e: Error) => void) | null = null;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as WorkerInMessage;
      if (msg.type === "progress") {
        onProgress(msg.msg, msg.pct);
      } else if (msg.type === "ready") {
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
              diffProgressCb = onProg;
              diffResolve = res;
              diffReject = rej;
              const copy = buf.slice(0);
              worker.postMessage({ type: "diffWithBaseline", buffer: copy }, [copy]);
            });
          },
          clearBaseline(): Promise<OverviewData> {
            return new Promise<OverviewData>((res, rej) => {
              clearResolve = res;
              clearReject = rej;
              worker.postMessage({ type: "clearBaseline" });
            });
          },
          loadProguardMap(text: string): Promise<boolean> {
            return new Promise<boolean>((res, rej) => {
              mapResolve = res;
              mapReject = rej;
              worker.postMessage({ type: "loadProguardMap", text });
            });
          },
          terminate() { worker.terminate(); },
        };
        resolve({ proxy, overview: msg.overview });
      } else if (msg.type === "error") {
        if (!ready) reject(new Error(msg.message));
        if (diffReject) { diffReject(new Error(msg.message)); diffReject = null; diffResolve = null; diffProgressCb = null; }
        if (clearReject) { clearReject(new Error(msg.message)); clearReject = null; clearResolve = null; }
        if (mapReject) { mapReject(new Error(msg.message)); mapReject = null; mapResolve = null; }
      } else if (msg.type === "result") {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.resolve(msg.data); }
      } else if (msg.type === "queryError") {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p.reject(new Error(msg.message)); }
      } else if (msg.type === "diffProgress") {
        diffProgressCb?.(msg.msg, msg.pct);
      } else if (msg.type === "diffReady") {
        if (diffResolve) { diffResolve(msg.overview); diffResolve = null; diffReject = null; diffProgressCb = null; }
      } else if (msg.type === "baselineCleared") {
        if (clearResolve) { clearResolve(msg.overview); clearResolve = null; }
      } else if (msg.type === "proguardMapLoaded") {
        if (mapResolve) { mapResolve(msg.hasEntries); mapResolve = null; }
      }
    };
    worker.onerror = (err) => {
      const error = new Error(err.message ?? "Worker error");
      if (!ready) { reject(error); return; }
      // Worker crashed post-ready: reject all pending promises
      for (const [, p] of pending) p.reject(error);
      pending.clear();
      if (diffReject) { diffReject(error); diffReject = null; diffResolve = null; diffProgressCb = null; }
      if (clearReject) { clearReject(error); clearReject = null; clearResolve = null; }
      if (mapReject) { mapReject(error); mapReject = null; mapResolve = null; }
    };

    const forWorker = buffer.slice(0);
    worker.postMessage({ type: "parse", buffer: forWorker }, [forWorker]);
  });
}
