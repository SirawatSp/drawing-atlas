#!/usr/bin/env node
/**
 * Fetches public-domain books from Project Gutenberg and writes them into
 * data/books/ as structured JSON the reader can page through.
 *
 * WHY A BUILD STEP: Gutenberg does not serve CORS headers, so a browser cannot
 * fetch these directly. Downloading once at build time also means the reader
 * works offline and does not hammer Gutenberg on every page turn.
 *
 * COPYRIGHT: every book listed here is public domain in the United States —
 * the whole Sherlock Holmes canon was published before 1929. The script
 * strips Gutenberg's own licence header and footer, which are not part of the
 * work, and records the source URL for attribution.
 *
 * Run: node scripts/fetch-books.mjs [--force] [--only <slug>]
 */
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "data", "books");

const FORCE = process.argv.includes("--force");
const ONLY = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1]
  : null;

const UA = "drawing-atlas/1.0 (reading library; +https://github.com/SirawatSp/drawing-atlas)";
const TIMEOUT = 60000;

/* ---- the canon --------------------------------------------------------- */

/**
 * Every title here is public domain in the United States — all first published
 * before 1929, most of them long before. `gutenbergId` is a starting guess;
 * resolveId() corrects it against Gutenberg's catalogue if it is wrong.
 *
 * `shelf` groups the library, and `level` is a rough reading difficulty for
 * someone reading English as a second language: sentence length and how much
 * archaic or dialect vocabulary the book demands, not literary merit.
 */
const DEFAULT_AUTHOR = "Arthur Conan Doyle";

const BOOKS = [
  {
    slug: "a-study-in-scarlet",
    gutenbergId: 244,
    title: "A Study in Scarlet",
    year: 1887,
    kind: "Novel",
    shelf: "Sherlock Holmes",
    level: "Moderate",
    blurb: "The first Holmes story, and the one where Watson meets him over a bench of chemicals.",
  },
  {
    slug: "the-sign-of-the-four",
    shelf: "Sherlock Holmes",
    level: "Moderate",
    gutenbergId: 2097,
    title: "The Sign of the Four",
    year: 1890,
    kind: "Novel",
    blurb: "A stolen treasure, a locked room, and a boat chase down the Thames.",
  },
  {
    slug: "the-adventures-of-sherlock-holmes",
    shelf: "Sherlock Holmes",
    level: "Moderate",
    gutenbergId: 1661,
    title: "The Adventures of Sherlock Holmes",
    year: 1892,
    kind: "Short stories",
    blurb: "Twelve stories, including A Scandal in Bohemia and The Speckled Band. The best place to start.",
  },
  {
    slug: "the-memoirs-of-sherlock-holmes",
    shelf: "Sherlock Holmes",
    level: "Moderate",
    gutenbergId: 834,
    title: "The Memoirs of Sherlock Holmes",
    year: 1894,
    kind: "Short stories",
    blurb: "Eleven stories, ending at the Reichenbach Falls.",
  },
  {
    slug: "the-hound-of-the-baskervilles",
    shelf: "Sherlock Holmes",
    level: "Moderate",
    gutenbergId: 2852,
    title: "The Hound of the Baskervilles",
    year: 1902,
    kind: "Novel",
    blurb: "The most famous of the novels: a moor, a legend, and a very large dog.",
  },
  {
    slug: "the-return-of-sherlock-holmes",
    shelf: "Sherlock Holmes",
    level: "Moderate",
    gutenbergId: 108,
    title: "The Return of Sherlock Holmes",
    year: 1905,
    kind: "Short stories",
    blurb: "Thirteen stories written after public pressure brought Holmes back from the dead.",
  },
  {
    slug: "the-valley-of-fear",
    shelf: "Sherlock Holmes",
    level: "Harder",
    gutenbergId: 3289,
    title: "The Valley of Fear",
    year: 1915,
    kind: "Novel",
    blurb: "The last novel, half English country house and half Pennsylvania coal country.",
  },
  {
    slug: "his-last-bow",
    shelf: "Sherlock Holmes",
    level: "Moderate",
    gutenbergId: 2350,
    title: "His Last Bow",
    year: 1917,
    kind: "Short stories",
    blurb: "Seven late stories, with Holmes retired to keep bees on the Sussex Downs.",
  },
  /* ---- Start here: short, plain sentences, high payoff ------------------ */
  { slug: "aesops-fables", gutenbergId: 21, title: "Aesop's Fables", author: "Aesop", year: 1867,
    kind: "Short stories", shelf: "Start here", level: "Easier",
    blurb: "Hundreds of fables a paragraph long, each ending in a moral. The easiest possible way in." },
  { slug: "alices-adventures-in-wonderland", gutenbergId: 11, title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll", year: 1865, kind: "Novel", shelf: "Start here", level: "Easier",
    blurb: "Short chapters, simple sentences, and Tenniel's illustrations throughout." },
  { slug: "through-the-looking-glass", gutenbergId: 12, title: "Through the Looking-Glass",
    author: "Lewis Carroll", year: 1871, kind: "Novel", shelf: "Start here", level: "Easier",
    blurb: "The sequel, built on a chess game. Contains Jabberwocky." },
  { slug: "the-wonderful-wizard-of-oz", gutenbergId: 55, title: "The Wonderful Wizard of Oz",
    author: "L. Frank Baum", year: 1900, kind: "Novel", shelf: "Start here", level: "Easier",
    blurb: "Written deliberately in plain modern English, and illustrated by W. W. Denslow." },
  { slug: "just-so-stories", gutenbergId: 2781, title: "Just So Stories", author: "Rudyard Kipling",
    year: 1902, kind: "Short stories", shelf: "Start here", level: "Easier",
    blurb: "How the leopard got his spots, and so on. Written to be read aloud." },
  { slug: "the-jungle-book", gutenbergId: 236, title: "The Jungle Book", author: "Rudyard Kipling",
    year: 1894, kind: "Short stories", shelf: "Start here", level: "Moderate",
    blurb: "Mowgli, Rikki-Tikki-Tavi, and the law of the jungle." },

  /* ---- Fairy tales ------------------------------------------------------ */
  { slug: "grimms-fairy-tales", gutenbergId: 2591, title: "Grimms' Fairy Tales",
    author: "Jacob Grimm and Wilhelm Grimm", year: 1812, kind: "Short stories",
    shelf: "Fairy tales", level: "Easier",
    blurb: "Sixty-odd tales, most only a few pages. The originals are darker than the retellings." },
  { slug: "andersens-fairy-tales", gutenbergId: 1597, title: "Andersen's Fairy Tales",
    author: "Hans Christian Andersen", year: 1837, kind: "Short stories",
    shelf: "Fairy tales", level: "Easier",
    blurb: "The Little Mermaid, The Snow Queen, The Ugly Duckling — sadder and stranger than expected." },

  /* ---- Adventure -------------------------------------------------------- */
  { slug: "treasure-island", gutenbergId: 120, title: "Treasure Island",
    author: "Robert Louis Stevenson", year: 1883, kind: "Novel", shelf: "Adventure", level: "Moderate",
    blurb: "The book that invented most of what we picture when we picture pirates." },
  { slug: "the-call-of-the-wild", gutenbergId: 215, title: "The Call of the Wild",
    author: "Jack London", year: 1903, kind: "Novel", shelf: "Adventure", level: "Moderate",
    blurb: "Short, fierce, and told largely from a dog's point of view." },
  { slug: "around-the-world-in-eighty-days", gutenbergId: 103, title: "Around the World in Eighty Days",
    author: "Jules Verne", year: 1873, kind: "Novel", shelf: "Adventure", level: "Moderate",
    blurb: "A wager, a timetable, and a very calm Englishman." },
  { slug: "twenty-thousand-leagues-under-the-sea", gutenbergId: 164,
    title: "Twenty Thousand Leagues Under the Sea", author: "Jules Verne", year: 1870,
    kind: "Novel", shelf: "Adventure", level: "Harder",
    blurb: "Captain Nemo and the Nautilus. Heavy on marine vocabulary — good for a reader who likes lists." },
  { slug: "the-adventures-of-tom-sawyer", gutenbergId: 74, title: "The Adventures of Tom Sawyer",
    author: "Mark Twain", year: 1876, kind: "Novel", shelf: "Adventure", level: "Moderate",
    blurb: "Small-town Missouri boyhood, with a murder in the middle of it." },

  /* ---- Gothic and mystery ----------------------------------------------- */
  { slug: "the-strange-case-of-dr-jekyll-and-mr-hyde", gutenbergId: 43,
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde", author: "Robert Louis Stevenson",
    year: 1886, kind: "Novella", shelf: "Gothic & mystery", level: "Moderate",
    blurb: "Under 30,000 words. A whole novel's worth of dread in an evening." },
  { slug: "frankenstein", gutenbergId: 84, title: "Frankenstein", author: "Mary Wollstonecraft Shelley",
    year: 1818, kind: "Novel", shelf: "Gothic & mystery", level: "Harder",
    blurb: "Long sentences and high Romantic diction, but the argument at its centre is worth the work." },
  { slug: "dracula", gutenbergId: 345, title: "Dracula", author: "Bram Stoker", year: 1897,
    kind: "Novel", shelf: "Gothic & mystery", level: "Harder",
    blurb: "Told entirely in letters, diaries and telegrams, so it reads in short bursts." },
  { slug: "the-picture-of-dorian-gray", gutenbergId: 174, title: "The Picture of Dorian Gray",
    author: "Oscar Wilde", year: 1890, kind: "Novel", shelf: "Gothic & mystery", level: "Harder",
    blurb: "A painting ages while its subject does not. Wilde's dialogue is the reason to read it." },

  /* ---- Science fiction --------------------------------------------------- */
  { slug: "the-time-machine", gutenbergId: 35, title: "The Time Machine", author: "H. G. Wells",
    year: 1895, kind: "Novella", shelf: "Science fiction", level: "Moderate",
    blurb: "Short, and the book that fixed the shape of every time-travel story after it." },
  { slug: "the-war-of-the-worlds", gutenbergId: 36, title: "The War of the Worlds",
    author: "H. G. Wells", year: 1898, kind: "Novel", shelf: "Science fiction", level: "Moderate",
    blurb: "An invasion reported like journalism, street by street across Surrey and London." },
  { slug: "the-invisible-man", gutenbergId: 5230, title: "The Invisible Man", author: "H. G. Wells",
    year: 1897, kind: "Novel", shelf: "Science fiction", level: "Moderate",
    blurb: "Less a science story than a study of a man with no reason left to behave." },

  /* ---- Classics ---------------------------------------------------------- */
  { slug: "a-christmas-carol", gutenbergId: 46, title: "A Christmas Carol", author: "Charles Dickens",
    year: 1843, kind: "Novella", shelf: "Classics", level: "Moderate",
    blurb: "Five short staves. The best entry point to Dickens by a wide margin." },
  { slug: "pride-and-prejudice", gutenbergId: 1342, title: "Pride and Prejudice", author: "Jane Austen",
    year: 1813, kind: "Novel", shelf: "Classics", level: "Harder",
    blurb: "Almost entirely conversation, but the sentences are long and the irony is quiet." },
  { slug: "the-secret-garden", gutenbergId: 113, title: "The Secret Garden",
    author: "Frances Hodgson Burnett", year: 1911, kind: "Novel", shelf: "Classics", level: "Moderate",
    blurb: "Gentle and slow in a good way. Some Yorkshire dialect in the dialogue." },
  { slug: "anne-of-green-gables", gutenbergId: 45, title: "Anne of Green Gables",
    author: "L. M. Montgomery", year: 1908, kind: "Novel", shelf: "Classics", level: "Moderate",
    blurb: "Warm, funny, and full of a talkative narrator who explains herself constantly." },
  { slug: "the-wind-in-the-willows", gutenbergId: 27805, title: "The Wind in the Willows",
    author: "Kenneth Grahame", year: 1908, kind: "Novel", shelf: "Classics", level: "Moderate",
    blurb: "A riverbank, four animals, and some of the most careful English prose of its century." },
  { slug: "peter-pan", gutenbergId: 16, title: "Peter Pan", author: "J. M. Barrie", year: 1911,
    kind: "Novel", shelf: "Classics", level: "Moderate",
    blurb: "Stranger and more melancholy than the films let on." },
];

/* ---- fetching ---------------------------------------------------------- */

async function get(url, asText = true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": UA }, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return asText ? await res.text() : await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function getBinary(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": UA }, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Gutenberg serves the same book from several paths and the canonical one has
 * changed over the years, so try the known shapes in order rather than
 * depending on any single URL staying put.
 */
async function fetchBookText(id) {
  const candidates = [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/files/${id}/${id}.txt`,
    `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`,
  ];
  const errors = [];
  for (const url of candidates) {
    try {
      const text = await get(url);
      if (text && text.length > 20000) return { text, url };
      errors.push(`${url}: suspiciously short (${text.length} chars)`);
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  throw new Error(`could not fetch ebook ${id}\n    ` + errors.join("\n    "));
}

/**
 * Gutenberg ebook numbers are stable but easy to get wrong when adding books in
 * bulk. If the hardcoded id yields nothing, ask Gutendex — a JSON API over
 * Gutenberg's catalogue — for the same title by the same author, so one wrong
 * number costs a redirect rather than a missing book.
 */
async function resolveId(book) {
  try {
    const json = await get(
      "https://gutendex.com/books?search=" + encodeURIComponent(book.title + " " + (book.author || "")),
      false
    );
    const results = (json && json.results) || [];
    const wanted = book.title.toLowerCase().replace(/^the\s+/, "");
    const hit =
      results.find((r) => String(r.title || "").toLowerCase().replace(/^the\s+/, "").startsWith(wanted)) ||
      results[0];
    return hit && hit.id !== book.gutenbergId ? hit.id : null;
  } catch {
    return null;
  }
}

/* ---- illustrated HTML edition ------------------------------------------ */

/**
 * Gutenberg's HTML edition carries the original magazine illustrations —
 * for the Holmes canon, Sidney Paget's Strand drawings, themselves public
 * domain. It also marks chapters with real headings, so parsing it gives
 * better structure than guessing divisions out of plain text.
 *
 * Parsed with regexes rather than a DOM library on purpose: this project has
 * no dependencies and no build step, and Gutenberg's generated HTML is regular
 * enough for it. Anything unparseable falls back to the plain-text path.
 */
async function fetchHtmlEdition(id) {
  const candidates = [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}-images.html`,
    `https://www.gutenberg.org/files/${id}/${id}-h/${id}-h.htm`,
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.html`,
  ];
  for (const url of candidates) {
    try {
      const html = await get(url);
      if (html && html.length > 20000) return { html, url };
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…").replace(/&lsquo;/g, "‘").replace(/&rsquo;/g, "’")
    .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Walks the body in document order, emitting headings, paragraphs and images.
 * Chapters are cut at each heading; paragraphs and illustrations keep their
 * relative order so a picture stays where the author put it.
 */
function parseHtmlBook(html) {
  let body = html;

  const start = body.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (start) body = body.slice(start.index + start[0].length);
  const end = body.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i);
  if (end) body = body.slice(0, end.index);

  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const blockRe = /<(h1|h2|h3|p|img)\b([^>]*)>([\s\S]*?)<\/\1>|<img\b([^>]*?)\/?>/gi;
  const items = [];
  let m;

  while ((m = blockRe.exec(body)) !== null) {
    const tag = (m[1] || "img").toLowerCase();

    if (tag === "img" || m[4] != null) {
      const attrs = m[2] || m[4] || "";
      const src = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!src) continue;
      const alt = decodeEntities((attrs.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || "");
      items.push({ type: "img", src, alt });
      continue;
    }

    const inner = m[3] || "";
    // An image wrapped inside a paragraph or figure still needs emitting.
    const nested = [...inner.matchAll(/<img\b([^>]*?)\/?>/gi)];
    for (const im of nested) {
      const src = (im[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
      if (!src) continue;
      const alt = decodeEntities((im[1].match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || "");
      items.push({ type: "img", src, alt });
    }

    const text = stripTags(inner);
    if (!text) continue;

    if (tag === "p") items.push({ type: "p", text });
    else items.push({ type: "h", text });
  }

  // Cut into chapters at headings, ignoring headings with no body under them
  // (title pages, tables of contents).
  const chapters = [];
  let current = null;
  for (const item of items) {
    if (item.type === "h") {
      if (current && current.paragraphs.filter((x) => typeof x === "string").length >= 3) chapters.push(current);
      current = { title: item.text, paragraphs: [] };
      continue;
    }
    if (!current) current = { title: "Opening", paragraphs: [] };
    if (item.type === "p") current.paragraphs.push(item.text);
    else current.paragraphs.push({ img: item.src, alt: item.alt });
  }
  if (current && current.paragraphs.filter((x) => typeof x === "string").length >= 3) chapters.push(current);

  return chapters;
}

/** Downloads every illustration a parsed book references, rewriting src to a local path. */
async function downloadImages(chapters, slug, pageUrl, limits = { max: 80, maxBytes: 3_000_000 }) {
  const dir = path.join(outDir, "images", slug);
  const seen = new Map();
  let saved = 0, skipped = 0;

  for (const chapter of chapters) {
    for (let i = 0; i < chapter.paragraphs.length; i++) {
      const item = chapter.paragraphs[i];
      if (typeof item === "string" || !item.img) continue;

      if (seen.has(item.img)) {
        chapter.paragraphs[i] = { ...item, img: seen.get(item.img) };
        continue;
      }
      if (saved >= limits.max) { chapter.paragraphs[i] = null; skipped++; continue; }

      let abs;
      try { abs = new URL(item.img, pageUrl).href; } catch { chapter.paragraphs[i] = null; continue; }
      if (!/^https:\/\/(www\.)?gutenberg\.org\//.test(abs)) { chapter.paragraphs[i] = null; continue; }

      const ext = (abs.split("?")[0].match(/\.(jpe?g|png|gif|webp)$/i) || [, "jpg"])[1].toLowerCase();
      const name = `${String(saved).padStart(3, "0")}.${ext}`;

      try {
        const buf = await getBinary(abs);
        if (buf.length > limits.maxBytes || buf.length < 500) { chapter.paragraphs[i] = null; skipped++; continue; }
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, name), buf);
        const rel = `data/books/images/${slug}/${name}`;
        seen.set(item.img, rel);
        chapter.paragraphs[i] = { ...item, img: rel };
        saved++;
      } catch {
        chapter.paragraphs[i] = null;
        skipped++;
      }
    }
    // Drop the entries that failed, so the reader never sees a dead image.
    chapter.paragraphs = chapter.paragraphs.filter(Boolean);
  }
  return { saved, skipped };
}

/* ---- cleaning ---------------------------------------------------------- */

/** Removes Gutenberg's licence header and footer, which are not part of the work. */
function stripGutenbergWrapper(raw) {
  let text = raw.replace(/\r\n/g, "\n");

  const startRe = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;
  const endRe = /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i;

  const start = text.match(startRe);
  if (start) text = text.slice(start.index + start[0].length);
  const end = text.match(endRe);
  if (end) text = text.slice(0, end.index);

  // Some texts carry a short producer credit after the header.
  text = text.replace(/^\s*(Produced by|E-text prepared by|Transcribed from)[^\n]*\n/i, "");
  return text.trim();
}

/** Collapses hard-wrapped lines into real paragraphs. */
function toParagraphs(block) {
  return block
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

/**
 * Splits a Gutenberg plain-text book into chapters.
 *
 * These texts have no markup, so headings are found structurally: a short line,
 * surrounded by blank lines, that looks like a chapter or story title. Roman
 * numerals, "CHAPTER N", and all-caps story titles all appear across the canon.
 */
function splitChapters(text) {
  const lines = text.split("\n");
  const headings = [];

  const patterns = [
    /^\s*(?:CHAPTER|Chapter)\s+([IVXLC]+|\d+)\.?\s*(.*)$/,
    /^\s*([IVXLC]+)\.\s+(.{2,80})$/,
    /^\s*(?:ADVENTURE\s+)?([IVXLC]+)\.?\s*$/,
    /^\s*(?:PART|Part)\s+([IVXLC]+|\d+)\.?\s*(.*)$/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().length > 90) continue;
    const blankBefore = i === 0 || !lines[i - 1].trim();
    if (!blankBefore) continue;

    for (const re of patterns) {
      const m = line.match(re);
      if (!m) continue;
      // Title may sit on the heading line or on the next non-blank line.
      let title = (m[2] || "").trim();
      if (!title) {
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const cand = lines[j].trim();
          if (!cand) continue;
          if (cand.length <= 80 && !/[.!?]$/.test(cand)) title = cand;
          break;
        }
      }
      headings.push({ line: i, label: line.trim(), title: title.replace(/\s+/g, " ") });
      break;
    }
  }

  if (headings.length < 2) {
    // No usable divisions: keep it as one chapter rather than inventing them.
    return [{ title: "Full text", paragraphs: toParagraphs(text) }];
  }

  const chapters = [];
  for (let h = 0; h < headings.length; h++) {
    const from = headings[h].line;
    const to = h + 1 < headings.length ? headings[h + 1].line : lines.length;
    const body = lines.slice(from + 1, to).join("\n");
    const paragraphs = toParagraphs(body);
    if (paragraphs.length < 3) continue; // a heading in a table of contents, not a real chapter
    const label = headings[h].label;
    const title = headings[h].title && headings[h].title !== label
      ? `${label} — ${headings[h].title}`
      : label;
    chapters.push({ title: title, paragraphs: paragraphs });
  }
  return chapters.length ? chapters : [{ title: "Full text", paragraphs: toParagraphs(text) }];
}

/* ---- main -------------------------------------------------------------- */

await mkdir(outDir, { recursive: true });

const targets = ONLY ? BOOKS.filter((b) => b.slug === ONLY) : BOOKS;
if (!targets.length) {
  console.error(`No book matches --only "${ONLY}". Known slugs:\n  ` + BOOKS.map((b) => b.slug).join("\n  "));
  process.exit(1);
}

const manifest = [];
let fetched = 0, skipped = 0, failed = 0;

for (const book of targets) {
  const outFile = path.join(outDir, `${book.slug}.json`);

  if (existsSync(outFile) && !FORCE) {
    const existing = JSON.parse(await readFile(outFile, "utf8"));

    // Editorial fields belong to the table above, not to the download. A book
    // fetched before a field existed would otherwise keep the gap forever,
    // because the whole point of this branch is not to refetch it — which is
    // how the eight Holmes books ended up with no shelf and no reading level
    // after both were introduced, and sat in an unnamed group at the foot of
    // the library.
    const meta = {
      title: book.title,
      author: book.author || DEFAULT_AUTHOR,
      year: book.year,
      kind: book.kind,
      shelf: book.shelf || "Other",
      level: book.level || "Moderate",
      blurb: book.blurb,
    };
    const stale = Object.keys(meta).filter((k) => existing[k] !== meta[k]);
    if (stale.length) {
      Object.assign(existing, meta);
      await writeFile(outFile, JSON.stringify(existing));
    }

    manifest.push(summarise(existing));
    skipped++;
    console.log(`skip   ${book.slug} (already present; --force to refetch)` +
      (stale.length ? ` — refreshed ${stale.join(", ")}` : ""));
    continue;
  }

  try {
    process.stdout.write(`fetch  ${book.slug} … `);

    // Prefer the illustrated HTML edition: it carries the original
    // illustrations and real chapter headings. Fall back to plain text.
    let chapters = null, url = null, images = { saved: 0, skipped: 0 }, via = "text";
    let id = book.gutenbergId;

    let htmlEdition = await fetchHtmlEdition(id);
    if (!htmlEdition) {
      const better = await resolveId(book);
      if (better) {
        const retry = await fetchHtmlEdition(better);
        if (retry) {
          process.stdout.write(`(id ${id} → ${better}) `);
          id = better;
          htmlEdition = retry;
        }
      }
    }
    if (htmlEdition) {
      try {
        const parsed = parseHtmlBook(htmlEdition.html);
        const parsedWords = parsed.reduce(
          (n, c) => n + c.paragraphs.reduce((m, p) => m + (typeof p === "string" ? p.split(/\s+/).length : 0), 0), 0
        );
        if (parsed.length >= 1 && parsedWords >= 5000) {
          images = await downloadImages(parsed, book.slug, htmlEdition.url);
          chapters = parsed;
          url = htmlEdition.url;
          via = "html";
        }
      } catch (err) {
        // Fall through to plain text rather than failing the book.
      }
    }

    if (!chapters) {
      let text, textUrl;
      try {
        ({ text, url: textUrl } = await fetchBookText(id));
      } catch (err) {
        const better = await resolveId(book);
        if (!better) throw err;
        process.stdout.write(`(id ${id} \u2192 ${better}) `);
        id = better;
        ({ text, url: textUrl } = await fetchBookText(id));
      }
      chapters = splitChapters(stripGutenbergWrapper(text));
      url = textUrl;
    }

    const words = chapters.reduce(
      (n, c) => n + c.paragraphs.reduce((m, p) => m + (typeof p === "string" ? p.split(/\s+/).length : 0), 0), 0
    );
    if (words < 5000) throw new Error(`only ${words} words after cleaning — parse probably failed`);

    const doc = {
      slug: book.slug,
      title: book.title,
      author: book.author || DEFAULT_AUTHOR,
      year: book.year,
      kind: book.kind,
      shelf: book.shelf || "Other",
      level: book.level || "Moderate",
      blurb: book.blurb,
      source: {
        name: "Project Gutenberg",
        url: `https://www.gutenberg.org/ebooks/${id}`,
        textUrl: url,
        gutenbergId: id,
        rights: "Public domain in the United States (published before 1929).",
      },
      fetchedAt: new Date().toISOString(),
      stats: { chapters: chapters.length, words: words, images: images.saved },
      chapters: chapters,
    };
    if (images.saved) {
      doc.source.illustrations =
        "Original magazine illustrations from the Gutenberg HTML edition; public domain.";
    }

    await writeFile(outFile, JSON.stringify(doc));
    manifest.push(summarise(doc));
    fetched++;
    console.log(
      `${chapters.length} chapters, ${words.toLocaleString()} words` +
      (images.saved ? `, ${images.saved} illustrations` : ", no illustrations") +
      ` (via ${via})`
    );
  } catch (err) {
    failed++;
    console.log("FAILED");
    console.error(`       ${err.message}`);
  }
}

// Rebuild the manifest from whatever is actually on disk, so a partial run
// still leaves a manifest consistent with the files present.
if (ONLY || failed) {
  manifest.length = 0;
  for (const f of (await readdir(outDir)).filter((f) => f.endsWith(".json") && f !== "index.json").sort()) {
    manifest.push(summarise(JSON.parse(await readFile(path.join(outDir, f), "utf8"))));
  }
}

manifest.sort((a, b) => a.year - b.year);
await writeFile(path.join(outDir, "index.json"), JSON.stringify({ books: manifest }, null, 2));

function summarise(doc) {
  return {
    slug: doc.slug,
    title: doc.title,
    author: doc.author,
    year: doc.year,
    kind: doc.kind,
    shelf: doc.shelf,
    level: doc.level,
    blurb: doc.blurb,
    chapters: doc.stats.chapters,
    images: doc.stats.images || 0,
    words: doc.stats.words,
    source: doc.source,
  };
}

console.log(`\n${fetched} fetched, ${skipped} skipped, ${failed} failed. Manifest lists ${manifest.length} book(s).`);
process.exit(failed && !fetched ? 1 : 0);
