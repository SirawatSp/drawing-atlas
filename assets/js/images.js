/* Drawing Atlas — reference image resolution.
 *
 * Entries name a Wikipedia article (`image: { wiki: "Common_raven" }`) rather
 * than a Commons filename, because real Commons URLs embed an MD5 hash prefix
 * that cannot be derived from the title. Resolving the article's lead image at
 * view time also self-heals when Wikipedia changes it.
 *
 * Two endpoints, both CORS-enabled for anonymous use:
 *   REST summary   → lead image thumbnail + article URL
 *   Commons action → author and licence for that file, for correct attribution
 *
 * Everything is cached in localStorage, including misses (so a subject with no
 * lead image is not re-fetched on every visit). If the network is unavailable —
 * offline, or a host with a strict CSP such as an embedded artifact — resolution
 * fails quietly and the caller draws a placeholder instead.
 */
(function () {
  "use strict";

  var CACHE_KEY = "drawing-atlas.images.v2";
  var HIT_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
  var MISS_TTL = 24 * 60 * 60 * 1000; //  1 day, so a blip is not permanent
  var TIMEOUT = 12000;

  var SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/";
  var COMMONS = "https://commons.wikimedia.org/w/api.php";

  // Only ever hand back media URLs on hosts we expect. The URLs come from an
  // API response, so this is defence in depth rather than a likely attack.
  var ALLOWED_HOSTS = /^(upload\.wikimedia\.org|commons\.wikimedia\.org|en\.wikipedia\.org)$/;

  var cache = load();
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
        // Quota exceeded or storage disabled: drop the cache rather than throw.
        cache = {};
      }
    }, 250);
  }

  function fresh(rec) {
    if (!rec || typeof rec.at !== "number") return false;
    return Date.now() - rec.at < (rec.miss ? MISS_TTL : HIT_TTL);
  }

  function safeUrl(url) {
    if (typeof url !== "string") return null;
    try {
      var u = new URL(url);
      if (u.protocol !== "https:") return null;
      if (!ALLOWED_HOSTS.test(u.hostname)) return null;
      return u.href;
    } catch (err) {
      return null;
    }
  }

  function getJSON(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT);
    return fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      referrerPolicy: "origin-when-cross-origin"
    })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        clearTimeout(timer);
        throw err;
      });
  }

  /** Pulls "Foo_bar.jpg" out of an upload.wikimedia.org thumb or original URL. */
  function fileNameFrom(url) {
    if (!url) return null;
    var clean = url.split("?")[0];
    var parts = clean.split("/");
    var last = parts[parts.length - 1];
    // Thumb URLs end in ".../<file>/<width>px-<file>"; the real name is one up.
    if (/^\d+px-/.test(last) && parts.length > 1) last = parts[parts.length - 2];
    try { return decodeURIComponent(last); } catch (err) { return last; }
  }

  /**
   * Resolves an entry's image spec.
   * @returns {Promise<null|{thumb:string, full:string, page:string, file:string, title:string}>}
   */
  function resolve(spec) {
    if (!spec || !spec.wiki) return Promise.resolve(null);
    var key = spec.wiki;

    var rec = cache[key];
    if (fresh(rec)) return Promise.resolve(rec.miss ? null : rec.data);
    if (inflight[key]) return inflight[key];

    var url = SUMMARY + encodeURIComponent(key.replace(/ /g, "_"));

    inflight[key] = getJSON(url)
      .then(function (json) {
        var thumb = safeUrl(json && json.thumbnail && json.thumbnail.source);
        var full = safeUrl(json && json.originalimage && json.originalimage.source) || thumb;
        if (!thumb) throw new Error("no lead image");

        var data = {
          thumb: thumb,
          full: full,
          width: (json.thumbnail && json.thumbnail.width) || null,
          height: (json.thumbnail && json.thumbnail.height) || null,
          page: safeUrl(json.content_urls && json.content_urls.desktop && json.content_urls.desktop.page) ||
                "https://en.wikipedia.org/wiki/" + encodeURIComponent(key),
          title: json.title || key,
          file: fileNameFrom(full || thumb)
        };
        cache[key] = { at: Date.now(), data: data };
        save();
        delete inflight[key];
        return data;
      })
      .catch(function () {
        cache[key] = { at: Date.now(), miss: true };
        save();
        delete inflight[key];
        return null;
      });

    return inflight[key];
  }

  /** Strips the HTML Commons returns in extmetadata fields down to plain text. */
  function toText(html) {
    if (!html) return "";
    var div = document.createElement("div");
    div.innerHTML = String(html);
    return (div.textContent || "").replace(/\s+/g, " ").trim();
  }

  /**
   * Fetches author + licence for a Commons file, for attribution.
   * @returns {Promise<null|{artist:string, licence:string, filePage:string}>}
   */
  function credit(file) {
    if (!file) return Promise.resolve(null);
    var key = "credit:" + file;

    var rec = cache[key];
    if (fresh(rec)) return Promise.resolve(rec.miss ? null : rec.data);
    if (inflight[key]) return inflight[key];

    var url = COMMONS + "?action=query&format=json&origin=*&prop=imageinfo" +
      "&iiprop=extmetadata&iiextmetadatafilter=Artist%7CLicenseShortName%7CCredit" +
      "&titles=" + encodeURIComponent("File:" + file);

    inflight[key] = getJSON(url)
      .then(function (json) {
        var pages = json && json.query && json.query.pages;
        if (!pages) throw new Error("no pages");
        var page = pages[Object.keys(pages)[0]];
        var meta = page && page.imageinfo && page.imageinfo[0] && page.imageinfo[0].extmetadata;
        if (!meta) throw new Error("no metadata");

        var data = {
          artist: toText(meta.Artist && meta.Artist.value),
          licence: toText(meta.LicenseShortName && meta.LicenseShortName.value),
          filePage: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(file)
        };
        cache[key] = { at: Date.now(), data: data };
        save();
        delete inflight[key];
        return data;
      })
      .catch(function () {
        cache[key] = { at: Date.now(), miss: true };
        save();
        delete inflight[key];
        return null;
      });

    return inflight[key];
  }

  /** Commons search page for a subject — the escape hatch when nothing resolves. */
  function searchUrl(name) {
    return "https://commons.wikimedia.org/w/index.php?search=" +
      encodeURIComponent(name) + "&title=Special:MediaSearch&type=image";
  }

  function clear() {
    cache = {};
    try { localStorage.removeItem(CACHE_KEY); } catch (err) {}
  }

  function stats() {
    var hits = 0, misses = 0;
    for (var k in cache) {
      if (!Object.prototype.hasOwnProperty.call(cache, k)) continue;
      if (k.indexOf("credit:") === 0) continue;
      if (cache[k].miss) misses++; else hits++;
    }
    return { resolved: hits, unresolved: misses };
  }

  window.ATLAS_IMAGES = {
    resolve: resolve,
    credit: credit,
    searchUrl: searchUrl,
    clear: clear,
    stats: stats
  };
})();
