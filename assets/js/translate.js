/* Drawing Atlas — English → Thai word lookup for the reader.
 *
 * Tap a word, get a Thai gloss. Three layers, cheapest first:
 *
 *   1. localStorage cache   — a word is ever fetched once per browser
 *   2. bundled glossary     — data/books/glossary-th.json, pre-translated in CI
 *                             for the most frequent words, so common taps are
 *                             instant and work offline
 *   3. live API             — MyMemory, which is free, keyless and CORS-enabled
 *
 * NOTE ON TRUST: every Thai gloss comes from a translation service, never from
 * hand-written guesses, and the popover always says which layer answered so a
 * machine translation is never mistaken for a dictionary definition. Single
 * words out of context are the weakest case for machine translation, which is
 * why the sentence the word came from is shown underneath it.
 */
(function () {
  "use strict";

  var CACHE_KEY = "drawing-atlas.th-cache.v1";
  var HIT_TTL = 180 * 24 * 60 * 60 * 1000; // 180 days — word meanings do not move
  var MISS_TTL = 2 * 60 * 60 * 1000;
  var TIMEOUT = 9000;

  var API = "https://api.mymemory.translated.net/get";
  var ALLOWED_HOSTS = /^api\.mymemory\.translated\.net$/;

  var cache = load();
  var glossary = null;      // lazily fetched bundled dictionary
  var glossaryState = "idle";
  var inflight = Object.create(null);

  function load() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  var saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch (err) {
        // Quota exceeded: drop the oldest half rather than losing everything.
        var keys = Object.keys(cache).sort(function (a, b) {
          return (cache[a].at || 0) - (cache[b].at || 0);
        });
        for (var i = 0; i < Math.floor(keys.length / 2); i++) delete cache[keys[i]];
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { cache = {}; }
      }
    }, 400);
  }

  function fresh(rec) {
    if (!rec || typeof rec.at !== "number") return false;
    return Date.now() - rec.at < (rec.miss ? MISS_TTL : HIT_TTL);
  }

  /** Strips punctuation and case. Keeps internal apostrophes and hyphens. */
  function normalise(word) {
    return String(word || "")
      .replace(/[‘’]/g, "'")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, "")
      .toLowerCase()
      .trim();
  }

  /**
   * Very small stemmer. Only used to find a SECOND candidate when the exact
   * form is not in the glossary — the exact form is always tried first, so a
   * word that is genuinely irregular is never mangled into something wrong.
   */
  function candidates(word) {
    var out = [word];
    var add = function (w) { if (w && w.length > 2 && out.indexOf(w) === -1) out.push(w); };

    if (/[^s]s$/.test(word)) add(word.slice(0, -1));            // hands → hand
    if (/(?:ch|sh|ss|x|z)es$/.test(word)) add(word.slice(0, -2)); // boxes → box
    if (/ies$/.test(word)) add(word.slice(0, -3) + "y");         // cries → cry
    if (/ied$/.test(word)) add(word.slice(0, -3) + "y");
    if (/ed$/.test(word)) { add(word.slice(0, -2)); add(word.slice(0, -1)); }
    if (/ing$/.test(word)) {
      add(word.slice(0, -3));
      add(word.slice(0, -3) + "e");                              // making → make
      if (/([bdfglmnprt])\1ing$/.test(word)) add(word.slice(0, -4)); // running → run
    }
    if (/ly$/.test(word)) add(word.slice(0, -2));
    if (/'s$/.test(word)) add(word.slice(0, -2));
    return out;
  }

  /* ---- bundled glossary ------------------------------------------------- */

  function loadGlossary() {
    if (glossaryState !== "idle") return Promise.resolve(glossary);
    glossaryState = "loading";
    return fetch("data/books/glossary-th.json", { headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("no glossary"); return r.json(); })
      .then(function (json) {
        glossary = (json && json.words) || {};
        glossaryState = "ready";
        return glossary;
      })
      .catch(function () {
        // Absent glossary is fine — the API covers everything, just less quickly.
        glossary = {};
        glossaryState = "missing";
        return glossary;
      });
  }

  /* ---- live lookup ------------------------------------------------------ */

  function safeUrl(url) {
    try {
      var u = new URL(url);
      return u.protocol === "https:" && ALLOWED_HOSTS.test(u.hostname) ? u.href : null;
    } catch (err) {
      return null;
    }
  }

  function fetchThai(word) {
    var url = safeUrl(API + "?q=" + encodeURIComponent(word) + "&langpair=en%7Cth&de=drawing-atlas");
    if (!url) return Promise.reject(new Error("bad url"));

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT);

    return fetch(url, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        var d = json && json.responseData;
        var text = d && typeof d.translatedText === "string" ? d.translatedText.trim() : "";
        // The API echoes the input back when it has nothing, and sometimes
        // returns its own error prose in the translation field.
        if (!text) throw new Error("empty");
        if (text.toLowerCase() === word.toLowerCase()) throw new Error("echo");
        if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(text)) throw new Error("quota");
        if (!/[฀-๿]/.test(text)) throw new Error("not thai");
        return text;
      })
      .catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  /* ---- public API ------------------------------------------------------- */

  /**
   * @returns {Promise<null|{word,base,thai,source}>}
   *   source is "glossary" (pre-built), "api" (live) or "cache".
   */
  function lookup(raw) {
    var word = normalise(raw);
    if (!word || !/[a-z]/.test(word)) return Promise.resolve(null);

    var rec = cache[word];
    if (fresh(rec)) {
      return Promise.resolve(rec.miss ? null : { word: word, base: rec.base || word, thai: rec.thai, source: "cache" });
    }
    if (inflight[word]) return inflight[word];

    inflight[word] = loadGlossary()
      .then(function (g) {
        var forms = candidates(word);
        for (var i = 0; i < forms.length; i++) {
          if (g && g[forms[i]]) {
            return { word: word, base: forms[i], thai: g[forms[i]], source: "glossary" };
          }
        }
        return fetchThai(word).then(function (thai) {
          return { word: word, base: word, thai: thai, source: "api" };
        });
      })
      .then(function (result) {
        cache[word] = { at: Date.now(), thai: result.thai, base: result.base };
        save();
        delete inflight[word];
        return result;
      })
      .catch(function () {
        cache[word] = { at: Date.now(), miss: true };
        save();
        delete inflight[word];
        return null;
      });

    return inflight[word];
  }

  /** Words the reader has looked up, newest first — the study list. */
  function history(limit) {
    var out = [];
    for (var w in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, w)) continue;
      if (cache[w].miss || !cache[w].thai) continue;
      out.push({ word: w, thai: cache[w].thai, at: cache[w].at });
    }
    out.sort(function (a, b) { return b.at - a.at; });
    return limit ? out.slice(0, limit) : out;
  }

  function clear() {
    cache = {};
    try { localStorage.removeItem(CACHE_KEY); } catch (err) {}
  }

  function stats() {
    var n = 0, misses = 0;
    for (var w in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, w)) continue;
      if (cache[w].miss) misses++; else n++;
    }
    return { known: n, failed: misses, glossary: glossaryState };
  }

  window.ATLAS_TH = {
    lookup: lookup,
    normalise: normalise,
    history: history,
    clear: clear,
    stats: stats,
    loadGlossary: loadGlossary
  };
})();
