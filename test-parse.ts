import { readFileSync } from "fs";
import { performance } from "perf_hooks";
import { parseHprof } from "./src/hprof.ts";

const buf = readFileSync("/tmp/sys.hprof").buffer;
const t0 = performance.now();
console.log("File size:", (buf.byteLength / 1024 / 1024).toFixed(1), "MB");

let lastMsg = "";
const snap = parseHprof(buf, (msg: string, pct: number) => {
  if (msg !== lastMsg) {
    lastMsg = msg;
    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    console.log(`  [${dt}s] ${pct}% ${msg}`);
  }
});
const dt = ((performance.now() - t0) / 1000).toFixed(2);
console.log(`Done in ${dt}s — ${snap.instances.size} instances, ${snap.heaps.length} heaps`);
