#!/usr/bin/env node
/**
 * Pre-translates the most frequent words in the library into Thai, so the
 * common taps in the reader are instant and work offline.
 *
 * Runs against the same translation service the browser uses, which keeps a
 * single source of truth for the Thai — no hand-written glosses anywhere in
 * this project.
 *
 * Designed to be run repeatedly: it merges into the existing glossary and
 * translates at most --limit new words per run, so a free-tier rate limit
 * spreads the work over several scheduled runs instead of failing.
 *
 * Run: node scripts/build-glossary.mjs [--limit 300] [--min-count 3]
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const booksDir = path.join(root, "data", "books");
const outFile = path.join(booksDir, "glossary-th.json");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}
const LIMIT = arg("--limit", 300);
const MIN_COUNT = arg("--min-count", 3);
const DELAY_MS = 1400;   // stay well inside the free tier's rate limit
const TIMEOUT = 15000;

if (!existsSync(booksDir)) {
  console.error("No data/books directory — run scripts/fetch-books.mjs first.");
  process.exit(1);
}

/* ---- word frequency across the library --------------------------------- */

const files = (await readdir(booksDir)).filter(
  (f) => f.endsWith(".json") && f !== "index.json" && f !== "glossary-th.json"
);
if (!files.length) {
  console.error("No books found — run scripts/fetch-books.mjs first.");
  process.exit(1);
}

const counts = new Map();
for (const f of files) {
  const book = JSON.parse(await readFile(path.join(booksDir, f), "utf8"));
  for (const ch of book.chapters ?? []) {
    for (const p of ch.paragraphs ?? []) {
      // A chapter's blocks are paragraphs (strings) or illustrations (objects).
      if (typeof p !== "string") continue;
      for (const raw of p.split(/\s+/)) {
        const w = raw
          .replace(/[‘’]/g, "'")
          .replace(/^[^\p{L}']+|[^\p{L}']+$/gu, "")
          .toLowerCase();
        // Skip contractions and single letters: they translate badly in isolation.
        if (w.length < 2 || w.includes("'") || !/^[a-z-]+$/.test(w)) continue;
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
  }
}

const ranked = [...counts.entries()]
  .filter(([, n]) => n >= MIN_COUNT)
  .sort((a, b) => b[1] - a[1]);

console.log(`${counts.size.toLocaleString()} distinct words across ${files.length} book(s); ` +
  `${ranked.length.toLocaleString()} appear at least ${MIN_COUNT} times.`);

/* ---- merge with whatever already exists -------------------------------- */

let existing = { words: {}, meta: {} };
if (existsSync(outFile)) {
  try { existing = JSON.parse(await readFile(outFile, "utf8")); } catch {}
}
const words = existing.words ?? {};
const failed = new Set(existing.meta?.failed ?? []);

const todo = ranked
  .map(([w]) => w)
  .filter((w) => !words[w] && !failed.has(w))
  .slice(0, LIMIT);

if (!todo.length) {
  console.log(`Nothing new to translate. Glossary holds ${Object.keys(words).length} words.`);
  process.exit(0);
}
console.log(`Translating ${todo.length} new word(s)…\n`);

/* ---- translate --------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function translate(word) {
  const url = "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(word) + "&langpair=en%7Cth&de=drawing-atlas";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (res.status === 429) return { rateLimited: true };
    if (!res.ok) return { error: "HTTP " + res.status };

    const json = await res.json();
    const text = (json?.responseData?.translatedText ?? "").trim();
    if (!text) return { error: "empty" };
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|USAGE LIMIT/i.test(text)) return { rateLimited: true };
    if (text.toLowerCase() === word.toLowerCase()) return { error: "echo" };
    if (!/[฀-๿]/.test(text)) return { error: "not thai" };
    return { thai: text };
  } catch (err) {
    clearTimeout(timer);
    return { error: err.name === "AbortError" ? "timeout" : err.message };
  }
}

let added = 0, errored = 0, stoppedEarly = false;

for (const word of todo) {
  const r = await translate(word);
  if (r.rateLimited) {
    console.log(`\nRate limited after ${added} word(s). Stopping cleanly — rerun later to continue.`);
    stoppedEarly = true;
    break;
  }
  if (r.thai) {
    words[word] = r.thai;
    added++;
    if (added % 25 === 0) process.stdout.write(`  ${added} translated…\n`);
  } else {
    failed.add(word);
    errored++;
  }
  await sleep(DELAY_MS);
}

/* ---- write ------------------------------------------------------------- */

const payload = {
  meta: {
    source: "MyMemory (api.mymemory.translated.net), machine translation",
    note: "Single-word machine translation. Useful for reading, not authoritative as a dictionary.",
    updatedAt: new Date().toISOString(),
    total: Object.keys(words).length,
    failed: [...failed].sort(),
  },
  words: Object.fromEntries(Object.entries(words).sort(([a], [b]) => a.localeCompare(b))),
};

await writeFile(outFile, JSON.stringify(payload));

const coverage = ranked.length
  ? Math.round((ranked.filter(([w]) => words[w]).length / ranked.length) * 100)
  : 0;

console.log(`\n+${added} translated, ${errored} unavailable.`);
console.log(`Glossary now holds ${payload.meta.total.toLocaleString()} words ` +
  `(${coverage}% of words appearing ${MIN_COUNT}+ times).`);
if (stoppedEarly) console.log("Run again to keep going.");
