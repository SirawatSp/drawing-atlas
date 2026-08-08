#!/usr/bin/env node
/**
 * Validates every data file without a browser:
 *   - each file registers exactly one category with the required fields
 *   - entry ids are unique within a category, and slug-safe
 *   - every entry has a meaning, lore, draw notes and at least one reference
 *   - every grouping key actually resolves on at least one entry
 *   - every reference URL parses as https
 *
 * Run: node scripts/check-data.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, "data");

const problems = [];
const warnings = [];
const categories = [];

function fail(msg) { problems.push(msg); }
function warn(msg) { warnings.push(msg); }

function pluck(obj, dotted) {
  return String(dotted).split(".").reduce((cur, k) => (cur == null ? cur : cur[k]), obj);
}

const files = (await readdir(dataDir)).filter((f) => f.endsWith(".js")).sort();
if (files.length === 0) fail("data/ contains no .js files");

for (const file of files) {
  const source = await readFile(path.join(dataDir, file), "utf8");
  const registered = [];
  const sandbox = { ATLAS: { register: (c) => registered.push(c) } };

  try {
    vm.runInNewContext(source, sandbox, { filename: `data/${file}`, timeout: 5000 });
  } catch (err) {
    fail(`${file}: failed to evaluate — ${err.message}`);
    continue;
  }

  if (registered.length !== 1) {
    fail(`${file}: expected exactly 1 ATLAS.register() call, found ${registered.length}`);
    continue;
  }
  categories.push({ file, cat: registered[0] });
}

const seenCategoryIds = new Set();

for (const { file, cat } of categories) {
  const where = `${file} (${cat.id ?? "no id"})`;

  for (const field of ["id", "name", "subtitle", "blurb"]) {
    if (!cat[field] || typeof cat[field] !== "string") fail(`${where}: missing category field "${field}"`);
  }
  if (cat.id && seenCategoryIds.has(cat.id)) fail(`${where}: duplicate category id "${cat.id}"`);
  if (cat.id) seenCategoryIds.add(cat.id);
  if (cat.id && !/^[a-z0-9-]+$/.test(cat.id)) fail(`${where}: category id must be lowercase slug`);
  if (!Array.isArray(cat.sources) || cat.sources.length === 0) warn(`${where}: no category-level sources`);

  const entries = cat.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    fail(`${where}: no entries`);
    continue;
  }

  const ids = new Set();
  for (const e of entries) {
    const label = `${where} › ${e.name ?? e.id ?? "?"}`;

    if (!e.id) fail(`${label}: missing id`);
    else if (!/^[a-z0-9-]+$/.test(e.id)) fail(`${label}: id "${e.id}" must be lowercase slug`);
    else if (ids.has(e.id)) fail(`${label}: duplicate entry id "${e.id}"`);
    else ids.add(e.id);

    if (!e.name) fail(`${label}: missing name`);
    if (!e.meaning) fail(`${label}: missing meaning`);
    if (!e.group) warn(`${label}: no group — it will land in "Unsorted"`);

    if (!Array.isArray(e.lore) || e.lore.length === 0) fail(`${label}: missing lore`);
    else e.lore.forEach((p, i) => {
      if (typeof p !== "string" || p.trim().length < 40) fail(`${label}: lore[${i}] too short to be useful`);
    });

    if (!Array.isArray(e.draw) || e.draw.length === 0) fail(`${label}: missing draw notes`);

    if (!Array.isArray(e.refs) || e.refs.length === 0) {
      fail(`${label}: no references — every entry must cite its sources`);
    } else {
      for (const r of e.refs) {
        if (!r || !r.label || !r.url) { fail(`${label}: malformed reference ${JSON.stringify(r)}`); continue; }
        let u;
        try { u = new URL(r.url); } catch { fail(`${label}: unparseable URL "${r.url}"`); continue; }
        if (u.protocol !== "https:") fail(`${label}: reference must be https — "${r.url}"`);
      }
    }

    for (const arrField of ["draw", "tags", "attributes", "palette"]) {
      if (e[arrField] != null && !Array.isArray(e[arrField])) fail(`${label}: "${arrField}" must be an array`);
    }
    if (Array.isArray(e.palette)) {
      for (const c of e.palette) {
        if (!/^#[0-9a-fA-F]{6}$/.test(c)) fail(`${label}: palette colour "${c}" is not a 6-digit hex`);
      }
    }
    if (Array.isArray(e.variants)) {
      for (const v of e.variants) {
        if (!v || !v.label || !v.text) fail(`${label}: malformed variant ${JSON.stringify(v)}`);
      }
    }
  }

  for (const g of cat.groupings ?? []) {
    if (!g.key || !g.label) { fail(`${where}: malformed grouping ${JSON.stringify(g)}`); continue; }
    const hits = entries.filter((e) => pluck(e, g.key) != null).length;
    if (hits === 0) fail(`${where}: grouping "${g.key}" resolves on no entries`);
    else if (hits < entries.length) warn(`${where}: grouping "${g.key}" missing on ${entries.length - hits} entries`);
  }
}

/* ---- report ---------------------------------------------------------- */

const totalEntries = categories.reduce((n, { cat }) => n + (cat.entries?.length ?? 0), 0);
const totalRefs = categories.reduce(
  (n, { cat }) => n + (cat.entries ?? []).reduce((m, e) => m + (e.refs?.length ?? 0), 0),
  0
);

console.log(`Checked ${categories.length} categories, ${totalEntries} entries, ${totalRefs} references.`);

for (const w of warnings) console.log(`  warn  ${w}`);
for (const p of problems) console.error(`  FAIL  ${p}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log(warnings.length ? `\nOK with ${warnings.length} warning(s).` : "\nAll good.");
