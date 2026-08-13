#!/usr/bin/env node
/**
 * Pre-translates the most frequent words in the library into Thai, so the
 * common taps in the reader are instant and work offline.
 *
 * Runs against the same two services the browser uses, in the same order, which
 * keeps a single source of truth for the Thai — no hand-written glosses
 * anywhere in this project.
 *
 * Google is asked in batches of --batch words per request; MyMemory picks up
 * whatever Google skipped, one word at a time. Two providers rather than one
 * because a single service refusing a whole run is not a rare event: a runner's
 * datacentre IP is exactly what a free tier turns away.
 *
 * Designed to be run repeatedly: it merges into the existing glossary and
 * translates at most --limit new words per run, so a rate limit spreads the
 * work over several runs instead of failing. A word is blacklisted only when
 * the answer itself is unusable; anything that went wrong at the service stays
 * queued. --retry-failed clears the blacklist, for when a past run struck words
 * off during an outage.
 *
 * Run: node scripts/build-glossary.mjs [--limit 2000] [--min-count 3]
 *                                      [--batch 60] [--retry-failed]
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
const LIMIT = arg("--limit", 2000);
const MIN_COUNT = arg("--min-count", 3);
const DELAY_MS = 1400;   // stay well inside the free tier's rate limit
const TIMEOUT = 15000;
const BATCH = arg("--batch", 60);   // words per Google request
const RETRY_FAILED = process.argv.includes("--retry-failed");

// Thai block U+0E00–U+0E7F, written as escapes rather than literal characters so
// that no re-encoding between here and the runner can quietly break the check.
const THAI_RE = /[\u0E00-\u0E7F]/;

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
const failed = new Set(RETRY_FAILED ? [] : (existing.meta?.failed ?? []));
if (RETRY_FAILED && (existing.meta?.failed ?? []).length) {
  console.log(`Retrying ${existing.meta.failed.length} previously failed word(s).`);
}

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

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (res.status === 429) return { rateLimited: true };
    if (!res.ok) return { error: "HTTP " + res.status, transient: true };
    return { json: await res.json() };
  } catch (err) {
    clearTimeout(timer);
    // A network fault says nothing about the word, so it must not count
    // against it.
    return { error: err.name === "AbortError" ? "timeout" : err.message, transient: true };
  }
}

/**
 * Google's endpoint takes newline-separated input and answers segment by
 * segment, each segment carrying its own source text. Results are therefore
 * matched back by that text rather than by position, so a segment the service
 * merges or drops costs one word instead of silently shifting every
 * translation after it onto the wrong word.
 */
async function googleBatch(batch) {
  const r = await getJSON(
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=th&dt=t&q=" +
    encodeURIComponent(batch.join("\n"))
  );
  if (!r.json) return r;
  const map = new Map();
  for (const seg of r.json[0] ?? []) {
    const src = String(seg?.[1] ?? "").trim().toLowerCase();
    const dst = String(seg?.[0] ?? "").trim();
    if (src && dst) map.set(src, dst);
  }
  return { map };
}

/** One word at a time — the fallback when Google skipped or refused it. */
async function myMemory(word) {
  const r = await getJSON(
    "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(word) + "&langpair=en%7Cth"
  );
  if (!r.json) return r;
  const text = String(r.json?.responseData?.translatedText ?? "").trim();
  // Quota and input errors arrive inside the translation field itself.
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|USAGE LIMIT/i.test(text)) return { rateLimited: true };
  if (/INVALID|NOT VALID/i.test(text)) return { error: "rejected", transient: true };
  return text ? { text } : { error: "empty", transient: true };
}

/**
 * Only the answer itself may condemn a word permanently. Anything that went
 * wrong at the service — a refusal, a timeout, a skipped segment — leaves the
 * word queued for the next run rather than blacklisting it forever.
 */
function verdict(word, text) {
  if (!text) return { error: "no answer", transient: true };
  if (text.toLowerCase() === word.toLowerCase()) return { error: "echo", transient: false };
  if (!THAI_RE.test(text)) return { error: "not thai", transient: false };
  return { thai: text };
}

let added = 0, blacklisted = 0, deferred = 0, stoppedEarly = false;
const reasons = new Map();
const byProvider = new Map();
const tally = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

function record(word, v, provider) {
  if (v.thai) {
    words[word] = v.thai;
    tally(byProvider, provider);
    added++;
    return;
  }
  tally(reasons, `${provider}: ${v.error}`);
  if (v.transient) deferred++;
  else { failed.add(word); blacklisted++; }
}

for (let i = 0; i < todo.length && !stoppedEarly; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const g = await googleBatch(batch);

  if (g.rateLimited) {
    console.log(`\nRate limited by google after ${added} word(s). ` +
      "Stopping cleanly — rerun later to continue.");
    stoppedEarly = true;
    break;
  }

  const leftovers = [];
  for (const word of batch) {
    const text = g.map?.get(word);
    if (text === undefined) { leftovers.push(word); continue; }
    record(word, verdict(word, text), "google");
  }
  if (!g.map) tally(reasons, `google: ${g.error}`);

  for (const word of leftovers) {
    const r = await myMemory(word);
    if (r.rateLimited) {
      // Google already had its chance at this word; leave the rest queued.
      deferred += leftovers.length - leftovers.indexOf(word);
      console.log(`\nRate limited by mymemory after ${added} word(s). ` +
        "Stopping cleanly — rerun later to continue.");
      stoppedEarly = true;
      break;
    }
    record(word, r.text ? verdict(word, r.text) : { error: r.error, transient: true }, "mymemory");
    await sleep(DELAY_MS);
  }

  if (added && Math.floor(added / 250) !== Math.floor((added - batch.length) / 250)) {
    process.stdout.write(`  ${added} translated…\n`);
  }
  await sleep(DELAY_MS);
}

/* ---- write ------------------------------------------------------------- */

const payload = {
  meta: {
    source: "Google Translate and MyMemory, machine translation",
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

console.log(`\n+${added} translated, ${blacklisted} untranslatable, ${deferred} deferred.`);
for (const [name, n] of [...byProvider].sort((a, b) => b[1] - a[1])) {
  console.log(`  via ${name}: ${n}`);
}
// Why the failures happened matters more than how many: a run that reports
// three hundred failures is either a hard vocabulary or a dead service, and the
// two need opposite responses.
if (reasons.size) {
  console.log("Failure reasons:");
  for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${why}: ${n}`);
  }
}
console.log(`Glossary now holds ${payload.meta.total.toLocaleString()} words ` +
  `(${coverage}% of words appearing ${MIN_COUNT}+ times).`);
if (stoppedEarly) console.log("Run again to keep going.");
if (deferred) console.log(`${deferred} word(s) stay queued for the next run.`);

// Exiting non-zero when a whole batch failed is the point: the workflow marks
// this step continue-on-error so a rate limit cannot fail the build, and a
// following step turns a non-zero exit into a visible warning. Silence here is
// how the last run committed a library with an empty glossary behind a tick.
if (added === 0 && todo.length >= 20 && !stoppedEarly) {
  console.error(`\nEvery one of ${todo.length} lookups failed. Treating this as an outage, not as ` +
    "a vocabulary problem — no word has been blacklisted for it.");
  process.exit(1);
}
