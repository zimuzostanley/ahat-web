// Quick Node.js test to profile the parser against the real hprof file.
// Run with: node test-parse.mjs
import { readFileSync } from "fs";
import { performance } from "perf_hooks";

const file = "/tmp/sys.hprof";
console.log("Reading", file, "...");
const buf = readFileSync(file).buffer;
console.log("File size:", (buf.byteLength / 1024 / 1024).toFixed(1), "MB");

// ── inline just enough of the parser to measure each phase ──
// We transpile via tsx/ts-node style: just import the compiled JS from dist.
// But since we only have TS source, use a simpler approach: instrument by hand.

// Actually, let's just use tsx to run the TS directly.
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// We need to run this via tsx. Let's exec it.
import { execSync } from "child_process";
try {
  const t0 = performance.now();
  console.log("Parsing with tsx...");
  execSync(
    `node --import tsx/esm - <<'EOF'
import { readFileSync } from "fs";
import { performance } from "perf_hooks";
import { parseHprof } from "./src/hprof.ts";

const buf = readFileSync("/tmp/sys.hprof").buffer;
const t0 = performance.now();

let lastMsg = "";
const snap = parseHprof(buf, (msg, pct) => {
  if (msg !== lastMsg) {
    lastMsg = msg;
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(\`  [\${dt}s] \${pct}% \${msg}\`);
  }
});

const dt = ((performance.now() - t0) / 1000).toFixed(1);
console.log(\`Done in \${dt}s — \${snap.instances.size} instances\`);
EOF
`,
    { cwd: "/usr/local/google/home/zezeozue/Downloads/ahat", stdio: "inherit", timeout: 120000 }
  );
} catch (e) {
  console.error(e.message);
}
