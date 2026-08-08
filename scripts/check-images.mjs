#!/usr/bin/env node
/**
 * Resolves every entry's image.wiki against the live Wikipedia REST API and
 * reports which ones have no usable lead image.
 *
 * This is the script to run first if images look wrong: it tells you exactly
 * which article titles are dead or picture-less, so they can be repointed in
 * data/*.js. Needs network access, so it is not part of the deploy gate.
 *
 * Run: node scripts/check-images.mjs [--verbose] [--json]
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const VERBOSE = process.argv.includes("--verbose");
const AS_JSON = process.argv.includes("--json");
const CONCURRENCY = 5;
const TIMEOUT_MS = 15000;
const SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, "data");

const entries = [];
for (const file of (await readdir(dataDir)).filter((f) => f.endsWith(".js")).sort()) {
  const src = await readFile(path.join(dataDir, file), "utf8");
  vm.runInNewContext(src, {
    ATLAS: {
      register(cat) {
        for (const e of cat.entries ?? []) {
          entries.push({ cat: cat.id, id: e.id, name: e.name, wiki: e.image?.wiki ?? null });
        }
      }
    }
  }, { filename: `data/${file}`, timeout: 5000 });
}

const missing = entries.filter((e) => !e.wiki);
const targets = entries.filter((e) => e.wiki);

// One request per distinct article, not per entry — japanese/kirin and
// chinese/qilin deliberately share the Qilin article.
const titles = [...new Set(targets.map((e) => e.wiki))];
if (!AS_JSON) console.log(`Resolving ${titles.length} distinct articles for ${targets.length} entries…\n`);

async function resolve(title) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SUMMARY + encodeURIComponent(title.replace(/ /g, "_")), {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "drawing-atlas-imagecheck/1.0 (+https://github.com/SirawatSp/drawing-atlas)"
      }
    });
    clearTimeout(timer);
    if (res.status === 404) return { title, status: "no-article" };
    if (!res.ok) return { title, status: "error", detail: "HTTP " + res.status };

    const json = await res.json();
    // A redirect is fine, but worth surfacing: the title in data/ is stale.
    const landed = json.titles?.canonical ?? json.title;
    const redirected = landed && landed.replace(/ /g, "_") !== title.replace(/ /g, "_");

    if (!json.thumbnail?.source) return { title, status: "no-image", landed, redirected };
    return {
      title,
      status: "ok",
      landed,
      redirected,
      thumb: json.thumbnail.source,
      width: json.originalimage?.width ?? json.thumbnail.width
    };
  } catch (err) {
    clearTimeout(timer);
    return { title, status: "error", detail: err.name === "AbortError" ? "timeout" : err.message };
  }
}

async function pool(items, size, worker) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await worker(items[idx]);
      }
    })
  );
  return out;
}

const results = await pool(titles, CONCURRENCY, resolve);
const byTitle = new Map(results.map((r) => [r.title, r]));

const buckets = { ok: [], "no-image": [], "no-article": [], error: [] };
for (const e of targets) buckets[byTitle.get(e.wiki).status].push(e);
const redirects = results.filter((r) => r.status === "ok" && r.redirected);

if (AS_JSON) {
  console.log(JSON.stringify({ results, missing, buckets }, null, 2));
  process.exit(buckets["no-article"].length || missing.length ? 1 : 0);
}

console.log(`  ${buckets.ok.length} entries have an image`);
console.log(`  ${buckets["no-image"].length} article exists but has no lead image`);
console.log(`  ${buckets["no-article"].length} article does not exist`);
console.log(`  ${buckets.error.length} could not be checked`);
if (missing.length) console.log(`  ${missing.length} entries have no image.wiki at all`);

if (VERBOSE) {
  console.log("\nResolved:");
  for (const e of buckets.ok) {
    const r = byTitle.get(e.wiki);
    console.log(`  ${e.cat}/${e.id} → ${r.title} (${r.width ?? "?"}px)`);
  }
}

for (const [label, list] of [
  ["ARTICLE DOES NOT EXIST — repoint image.wiki in data/", buckets["no-article"]],
  ["NO LEAD IMAGE — pick a different article", buckets["no-image"]],
  ["COULD NOT CHECK — probably transient", buckets.error]
]) {
  if (!list.length) continue;
  console.log(`\n${label}:`);
  for (const e of list) {
    const r = byTitle.get(e.wiki);
    console.log(`  ${e.cat}/${e.id}  (${e.name})  wiki="${e.wiki}"${r.detail ? "  " + r.detail : ""}`);
  }
}

if (redirects.length) {
  console.log("\nRedirects (works, but the title in data/ is stale):");
  for (const r of redirects) console.log(`  "${r.title}" → "${r.landed}"`);
}

const broken = buckets["no-article"].length + missing.length;
if (broken) {
  console.error(`\n${broken} entry image target(s) need fixing.`);
  process.exit(1);
}
console.log("\nEvery entry resolves to an image.");
