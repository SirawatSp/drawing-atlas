#!/usr/bin/env node
/**
 * Checks that every reference URL in data/ actually resolves.
 *
 * Kept separate from check-data.mjs because it needs network access, which
 * sandboxed environments often do not have. It is wired into CI on a schedule
 * rather than on every push, and it never fails the build on a single flake —
 * only on a definite 404/410.
 *
 * Run: node scripts/check-links.mjs [--verbose]
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const VERBOSE = process.argv.includes("--verbose");
const CONCURRENCY = 6;
const TIMEOUT_MS = 15000;
const UA = "drawing-atlas-linkcheck/1.0 (+https://github.com/SirawatSp/drawing-atlas)";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, "data");

/* ---- collect every (url -> where it is used) -------------------------- */

const usage = new Map(); // url -> Set of "category › entry"

function note(url, where) {
  if (!usage.has(url)) usage.set(url, new Set());
  usage.get(url).add(where);
}

for (const file of (await readdir(dataDir)).filter((f) => f.endsWith(".js")).sort()) {
  const source = await readFile(path.join(dataDir, file), "utf8");
  const sandbox = {
    ATLAS: {
      register(cat) {
        for (const s of cat.sources ?? []) note(s.url, `${cat.id} (category source)`);
        for (const e of cat.entries ?? []) {
          for (const r of e.refs ?? []) note(r.url, `${cat.id} › ${e.name}`);
        }
      }
    }
  };
  vm.runInNewContext(source, sandbox, { filename: `data/${file}`, timeout: 5000 });
}

const urls = [...usage.keys()].sort();
console.log(`Checking ${urls.length} unique URLs across ${usage.size} reference sites…\n`);

/* ---- probe ----------------------------------------------------------- */

async function probe(url) {
  // HEAD first (cheap); many sites reject it, so fall back to a ranged GET.
  for (const method of ["HEAD", "GET"]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,*/*",
          ...(method === "GET" ? { range: "bytes=0-2047" } : {})
        }
      });
      clearTimeout(timer);
      if (res.status === 405 || res.status === 501) continue; // method not allowed → try GET
      return { status: res.status, finalUrl: res.url };
    } catch (err) {
      clearTimeout(timer);
      if (method === "GET") return { status: 0, error: err.name === "AbortError" ? "timeout" : err.message };
    }
  }
  return { status: 0, error: "unreachable" };
}

async function pool(items, size, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

const results = await pool(urls, CONCURRENCY, async (url) => ({ url, ...(await probe(url)) }));

/* ---- report ---------------------------------------------------------- */

const dead = [];      // definite 404/410 — these are real defects
const suspect = [];   // 403/429/timeouts — usually bot-blocking, not a bad link
let ok = 0;

for (const r of results) {
  if (r.status >= 200 && r.status < 400) {
    ok++;
    if (VERBOSE) console.log(`  ok    ${r.status}  ${r.url}`);
  } else if (r.status === 404 || r.status === 410) {
    dead.push(r);
  } else {
    suspect.push(r);
  }
}

console.log(`\n${ok} reachable, ${suspect.length} inconclusive, ${dead.length} dead.\n`);

if (suspect.length) {
  console.log("Inconclusive (bot-blocked, rate-limited or slow — verify by hand):");
  for (const r of suspect) {
    console.log(`  ${String(r.status || r.error).padEnd(9)} ${r.url}`);
    for (const w of usage.get(r.url)) console.log(`            used by ${w}`);
  }
  console.log("");
}

if (dead.length) {
  console.error("DEAD LINKS — fix these:");
  for (const r of dead) {
    console.error(`  ${r.status}  ${r.url}`);
    for (const w of usage.get(r.url)) console.error(`        used by ${w}`);
  }
  process.exit(1);
}

console.log("No dead links.");
