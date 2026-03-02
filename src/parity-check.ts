/**
 * Parity check: compare TS parser output against Java ahat running on localhost:7199.
 *
 * Run: npx tsx src/parity-check.ts
 */
import { readFileSync } from "fs";
import { parseHprof, AhatInstance } from "./hprof";

const HPROF_PATH = "/home/zimvm/systemui.hprof";
const JAVA_AHAT = "http://localhost:7199";

// ─── Parse the hprof file with our TS parser ─────────────────────────────────

console.log("Parsing hprof file with TS parser...");
const buf = readFileSync(HPROF_PATH);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const snap = parseHprof(ab, (msg, pct) => {
  if (pct % 10 < 1 || msg.includes("done") || msg.includes("Dominat")) {
    process.stdout.write(`\r  ${msg} (${pct.toFixed(1)}%)`);
  }
});
console.log("\nParsing complete.");

// ─── Fetch Java ahat data ────────────────────────────────────────────────────

async function fetchText(path: string): Promise<string> {
  const res = await fetch(`${JAVA_AHAT}${path}`);
  return res.text();
}

function parseNum(s: string): number {
  return parseInt(s.replace(/,/g, "").trim(), 10);
}

// ─── Compare overview (heap sizes) ──────────────────────────────────────────

async function compareOverview() {
  console.log("\n═══ OVERVIEW: Heap Sizes ═══");

  const html = await fetchText("/");

  // Parse Java ahat heap table rows: <td>heap</td><td>java</td><td>native</td><td>total</td>
  const rowRe = /<tr><td>(\w+)<\/td><td[^>]*>\s*([\d,]+)\s*<\/td><td[^>]*>\s*([\d,]*)\s*<\/td><td[^>]*>\s*([\d,]+)\s*<\/td><\/tr>/g;
  const javaHeaps: { name: string; java: number; native_: number; total: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    javaHeaps.push({
      name: m[1],
      java: parseNum(m[2]),
      native_: m[3] ? parseNum(m[3]) : 0,
      total: parseNum(m[4]),
    });
  }

  let allMatch = true;
  for (const jh of javaHeaps) {
    if (jh.name === "Total") continue;
    const tsHeap = snap.heaps.find(h => h.name === jh.name);
    if (!tsHeap) {
      console.log(`  ✗ Heap "${jh.name}" not found in TS parser`);
      allMatch = false;
      continue;
    }
    const tsJava = tsHeap.size.java;
    const tsNative = tsHeap.size.native_;
    const tsTotal = tsJava + tsNative;
    const javaMatch = tsJava === jh.java;
    const nativeMatch = tsNative === jh.native_;
    const totalMatch = tsTotal === jh.total;

    if (javaMatch && nativeMatch && totalMatch) {
      console.log(`  ✓ ${jh.name}: java=${tsJava}, native=${tsNative}, total=${tsTotal}`);
    } else {
      allMatch = false;
      console.log(`  ✗ ${jh.name}:`);
      console.log(`      Java:   TS=${tsJava}  Java=${jh.java}  ${javaMatch ? "✓" : "✗ DIFF=" + (tsJava - jh.java)}`);
      console.log(`      Native: TS=${tsNative}  Java=${jh.native_}  ${nativeMatch ? "✓" : "✗ DIFF=" + (tsNative - jh.native_)}`);
      console.log(`      Total:  TS=${tsTotal}  Java=${jh.total}  ${totalMatch ? "✓" : "✗ DIFF=" + (tsTotal - jh.total)}`);
    }
  }

  // Also check totals
  const totalJava = snap.heaps.reduce((s, h) => s + h.size.java, 0);
  const totalNative = snap.heaps.reduce((s, h) => s + h.size.native_, 0);
  const totalTotal = totalJava + totalNative;
  const jtotal = javaHeaps.find(h => h.name === "Total");
  if (jtotal) {
    console.log(`  Total: TS java=${totalJava} native=${totalNative} total=${totalTotal} | Java java=${jtotal.java} native=${jtotal.native_} total=${jtotal.total}`);
    if (totalTotal !== jtotal.total) {
      console.log(`  ✗ TOTAL MISMATCH: diff=${totalTotal - jtotal.total}`);
      allMatch = false;
    } else {
      console.log(`  ✓ Total matches exactly!`);
    }
  }

  return allMatch;
}

// ─── Compare rooted objects ──────────────────────────────────────────────────

async function compareRooted() {
  console.log("\n═══ ROOTED: Top retained objects ═══");

  const html = await fetchText("/rooted");

  // Parse rooted table: columns are app, image, zygote, Total, then object link
  // Each row: <tr><td align="right">  N</td>...<td><a href="object?id=0xHEX">display</a></td></tr>
  // Some rows have "root " prefix before the link
  const javaRooted: { id: number; app: number; total: number; display: string }[] = [];

  const fullRows = html.match(/<tr><td[^>]*>[\s\S]*?<\/tr>/g) || [];

  for (const rowHtml of fullRows) {
    // Extract all <td> values
    const tdVals: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      tdVals.push(tdMatch[1]);
    }
    if (tdVals.length < 5) continue;

    // Last td has the object link
    const linkMatch = tdVals[4].match(/href="object\?id=0x([0-9a-f]+)"/);
    if (!linkMatch) continue;

    const id = parseInt(linkMatch[1], 16);
    const app = tdVals[0].trim() ? parseNum(tdVals[0]) : 0;
    const total = tdVals[3].trim() ? parseNum(tdVals[3]) : 0;
    const display = tdVals[4].replace(/<[^>]+>/g, "").trim();

    javaRooted.push({ id, app, total, display });
  }

  console.log(`  Java ahat rooted count: ${javaRooted.length}`);

  // Get our rooted list
  const appHeap = snap.getHeap("app");
  const cmp = (a: AhatInstance, b: AhatInstance): number => {
    if (appHeap) {
      const c = b.getRetainedSize(appHeap).total - a.getRetainedSize(appHeap).total;
      if (c !== 0) return c;
    }
    return b.getTotalRetainedSize().total - a.getTotalRetainedSize().total;
  };
  const tsItems = [...snap.superRoot.dominated];
  tsItems.sort(cmp);

  console.log(`  TS parser rooted count: ${tsItems.length}`);

  // Compare top 20
  let matchCount = 0;
  let mismatchCount = 0;
  const compareN = Math.min(20, javaRooted.length, tsItems.length);

  for (let i = 0; i < compareN; i++) {
    const j = javaRooted[i];
    const t = tsItems[i];

    const tsApp = appHeap ? t.getRetainedSize(appHeap).total : 0;
    const tsTotal = t.getTotalRetainedSize().total;

    const idMatch = t.id === j.id;
    const appMatch = tsApp === j.app;
    const totalMatch = tsTotal === j.total;

    if (idMatch && appMatch && totalMatch) {
      matchCount++;
      console.log(`  ✓ #${i + 1}: id=0x${t.id.toString(16)} app=${tsApp} total=${tsTotal}`);
    } else {
      mismatchCount++;
      console.log(`  ✗ #${i + 1}:`);
      console.log(`      ID:    TS=0x${t.id.toString(16)}  Java=0x${j.id.toString(16)}  ${idMatch ? "✓" : "✗"}`);
      console.log(`      App:   TS=${tsApp}  Java=${j.app}  ${appMatch ? "✓" : "✗ DIFF=" + (tsApp - j.app)}`);
      console.log(`      Total: TS=${tsTotal}  Java=${j.total}  ${totalMatch ? "✓" : "✗ DIFF=" + (tsTotal - j.total)}`);
      if (!idMatch) {
        console.log(`      TS display: ${t.toString()}`);
        console.log(`      Java display: ${j.display}`);
      }
    }
  }

  console.log(`\n  Summary: ${matchCount} match, ${mismatchCount} mismatch out of ${compareN}`);
  return mismatchCount === 0;
}

// ─── Compare specific instance detail ────────────────────────────────────────

async function compareInstance(hexId: string) {
  console.log(`\n═══ INSTANCE: 0x${hexId} ═══`);

  await fetchText(`/object?id=0x${hexId}`);
  const id = parseInt(hexId, 16);
  const inst = snap.findInstance(id);

  if (!inst) {
    console.log(`  ✗ Instance 0x${hexId} not found in TS parser`);
    return false;
  }

  console.log(`  TS: ${inst.toString()}`);
  console.log(`  TS class: ${inst.getClassName()}`);
  console.log(`  TS heap: ${inst.heap?.name}`);
  console.log(`  TS shallow: java=${inst.getSize().java}, native=${inst.getSize().native_}`);
  console.log(`  TS retained total: ${inst.getTotalRetainedSize().total}`);
  for (const h of snap.heaps) {
    const r = inst.getRetainedSize(h);
    if (r.total > 0) {
      console.log(`    retained[${h.name}]: java=${r.java}, native=${r.native_}, total=${r.total}`);
    }
  }

  return true;
}

// ─── Compare site data ───────────────────────────────────────────────────────

async function compareSites() {
  console.log("\n═══ SITES: Root allocation site ═══");

  const html = await fetchText("/sites");
  const site = snap.rootSite;

  console.log(`  TS root site children: ${site.children.length}`);
  console.log(`  TS root site objectsInfos: ${site.objectsInfos.length}`);

  // Parse Java site children count from HTML
  const childRowCount = (html.match(/<tr><td[^>]*>/g) || []).length;
  console.log(`  Java site table rows: ${childRowCount}`);

  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Comparing TS parser vs Java ahat...\n");
  console.log(`Instance count: ${snap.instances.size}`);
  console.log(`Heap count: ${snap.heaps.length} (${snap.heaps.map(h => h.name).join(", ")})`);

  const overviewOk = await compareOverview();
  const rootedOk = await compareRooted();

  // Compare a few specific instances
  // Use first rooted object ID from Java ahat
  await compareInstance("2011430");  // dalvik.system.PathClassLoader
  await compareInstance("3f52398");  // BigPictureNotificationImageView

  await compareSites();

  console.log("\n═══ SUMMARY ═══");
  console.log(`Overview match: ${overviewOk ? "✓" : "✗"}`);
  console.log(`Rooted match:  ${rootedOk ? "✓" : "✗"}`);
}

main().catch(e => { console.error(e); process.exit(1); });
