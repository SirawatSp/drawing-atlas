/* Drawing Atlas — the reading room.
 *
 * Routes:
 *   #/read                      the library
 *   #/read/<slug>               a book's contents
 *   #/read/<slug>/<chapter>     the reader itself
 *   #/read/words                every word looked up, as a study list
 *
 * PAGINATION: real pages, not a scroll. The text is laid out in CSS columns
 * exactly one viewport wide and the track is translated sideways one column at
 * a time, which is how most web readers do it — the browser does the line
 * breaking and we only move the window.
 *
 * WORD TAPPING: the naive approach wraps every word in a <span>, which for a
 * novel is hundreds of thousands of elements. Instead the tap point is resolved
 * to a text node and offset with caretRangeFromPoint, and the word boundaries
 * are found by walking the string. No extra DOM at all.
 */
(function () {
  "use strict";

  var TH = window.ATLAS_TH;

  var POS_KEY = "drawing-atlas.reading.v1";   // last position per book
  var manifest = null;
  var bookCache = Object.create(null);

  var state = {
    slug: null,
    chapter: 0,
    page: 0,
    pages: 1
  };

  /* ---- helpers ---------------------------------------------------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var READ_KEY = "drawing-atlas.read-chapters.v1";

  function readPositions() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || "{}") || {}; }
    catch (err) { return {}; }
  }

  /** Which chapters have been read to the end, per book. */
  function readChapters(slug) {
    try {
      var all = JSON.parse(localStorage.getItem(READ_KEY) || "{}") || {};
      return all[slug] || {};
    } catch (err) { return {}; }
  }
  function markChapterRead(slug, index) {
    try {
      var all = JSON.parse(localStorage.getItem(READ_KEY) || "{}") || {};
      all[slug] = all[slug] || {};
      if (all[slug][index]) return;
      all[slug][index] = Date.now();
      localStorage.setItem(READ_KEY, JSON.stringify(all));
    } catch (err) {}
  }

  /* A short-story collection has episodes; a novel has chapters. Saying
     "Story 3 of 12" is more useful than "Chapter 3" when they are separate
     cases with their own titles. */
  function unitNoun(book, plural) {
    var isCollection = /stories/i.test(book.kind || "");
    if (isCollection) return plural ? "stories" : "Story";
    return plural ? "chapters" : "Chapter";
  }

  /** Roughly 220 wpm for a second-language reader stopping to tap words. */
  function minutesFor(words) {
    return Math.max(1, Math.round(words / 220));
  }
  function writePosition(slug, chapter, page) {
    try {
      var all = readPositions();
      all[slug] = { chapter: chapter, page: page, at: Date.now() };
      localStorage.setItem(POS_KEY, JSON.stringify(all));
    } catch (err) {}
  }

  function getManifest() {
    if (manifest) return Promise.resolve(manifest);
    return fetch("data/books/index.json", { headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("no manifest"); return r.json(); })
      .then(function (j) { manifest = (j && j.books) || []; return manifest; })
      .catch(function () { manifest = []; return manifest; });
  }

  /**
   * A chapter's blocks are either a paragraph (string) or an illustration
   * ({ img, alt }) kept at the position it occupied in the original edition.
   */
  function renderBlock(block) {
    if (typeof block === "string") return "<p>" + esc(block) + "</p>";
    if (!block || !block.img) return "";
    return '<figure class="plate">' +
      '<img src="' + esc(block.img) + '" alt="' + esc(block.alt || "Illustration") + '" loading="lazy" decoding="async">' +
      (block.alt ? '<figcaption>' + esc(block.alt) + "</figcaption>" : "") +
    "</figure>";
  }

  /** Words only — illustrations must not be counted as text. */
  function countWords(paragraphs) {
    return paragraphs.reduce(function (n, p) {
      return n + (typeof p === "string" ? p.split(/\s+/).length : 0);
    }, 0);
  }

  function getBook(slug) {
    if (bookCache[slug]) return Promise.resolve(bookCache[slug]);
    return fetch("data/books/" + encodeURIComponent(slug) + ".json", { headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (b) { bookCache[slug] = b; return b; })
      .catch(function () { return null; });
  }

  /* ---- library ---------------------------------------------------------- */

  function emptyLibraryHTML() {
    return '<div class="empty">' +
      "<b>The library is empty</b>" +
      "<p style=\"max-width:52ch;margin:.6rem auto 0\">Books are downloaded from Project Gutenberg by a build step rather than " +
      "committed by hand. Run <code>node scripts/fetch-books.mjs</code>, or trigger the " +
      "<em>Fetch books</em> workflow on GitHub, and they will appear here.</p>" +
      "</div>";
  }

  function libraryHTML(books) {
    if (!books.length) return emptyLibraryHTML();
    var positions = readPositions();

    var cards = books.map(function (b) {
      var pos = positions[b.slug];
      var progress = pos ? Math.min(99, Math.round((pos.chapter / Math.max(1, b.chapters)) * 100)) : 0;
      return '<a class="book-card" href="#/read/' + esc(b.slug) + '">' +
        '<div class="book-spine" aria-hidden="true"><span>' + esc(b.title) + "</span></div>" +
        '<div class="book-meta">' +
          "<h2>" + esc(b.title) + "</h2>" +
          '<p class="book-sub">' + esc(b.author) + " · " + esc(b.year) + " · " + esc(b.kind) + "</p>" +
          "<p>" + esc(b.blurb || "") + "</p>" +
          '<p class="book-stats">' + Number(b.chapters).toLocaleString() + " chapters · " +
            Number(b.words).toLocaleString() + " words</p>" +
          (pos
            ? '<div class="bar-row"><span>Reading</span><b>ch. ' + (pos.chapter + 1) + "</b></div>" +
              '<div class="bar"><i style="width:' + progress + '%"></i></div>'
            : '<div class="book-start">Start reading →</div>') +
        "</div>" +
      "</a>";
    }).join("");

    return '<div class="book-grid">' + cards + "</div>";
  }

  function viewLibrary(main) {
    main.innerHTML =
      '<a class="backlink" href="#/">' + backIcon() + "All categories</a>" +
      '<div class="page-head">' +
        '<p class="eyebrow">Reading room</p>' +
        "<h1>Read, and tap what you don't know</h1>" +
        '<p class="lede">Public-domain books with a Thai gloss one tap away. Tap any English word ' +
        "while reading and its meaning appears without losing your place. Every word you tap is kept " +
        "in a study list.</p>" +
      "</div>" +
      '<div id="library"><div class="empty"><b>Loading library…</b></div></div>' +
      '<section class="block"><h3>Study list</h3>' +
        '<p class="count-note" style="margin-bottom:.6rem">Every word you have tapped, newest first.</p>' +
        '<a class="btn" href="#/read/words">Open study list</a>' +
      "</section>";

    getManifest().then(function (books) {
      document.getElementById("library").innerHTML = libraryHTML(books);
    });
    document.title = "Reading · Drawing Atlas";
  }

  /* ---- contents --------------------------------------------------------- */

  function viewContents(main, slug) {
    main.innerHTML = '<div class="empty"><b>Opening…</b></div>';

    getBook(slug).then(function (book) {
      if (!book) {
        main.innerHTML = '<a class="backlink" href="#/read">' + backIcon() + "Library</a>" +
          '<div class="empty"><b>That book is not in the library</b>Run the fetch step to add it.</div>';
        return;
      }
      var pos = readPositions()[slug];
      var done = readChapters(slug);
      var unit = unitNoun(book, false);
      var doneCount = 0;

      var items = book.chapters.map(function (c, i) {
        var words = countWords(c.paragraphs);
        var plates = c.paragraphs.filter(function (p) { return p && typeof p !== "string" && p.img; }).length;
        var here = pos && pos.chapter === i;
        var finished = !!done[i];
        if (finished) doneCount++;

        var status = finished ? "read" : here ? "reading" : "unread";
        var statusLabel = finished ? "Read" : here ? "Reading" : "";

        return '<li class="toc-item' + (here ? " is-current" : "") + '" data-status="' + status + '">' +
          '<a href="#/read/' + esc(slug) + "/" + i + '">' +
            '<span class="toc-n">' + (i + 1) + "</span>" +
            '<span class="toc-body">' +
              '<span class="toc-t">' + esc(c.title) + "</span>" +
              '<span class="toc-facts">' + words.toLocaleString() + " words · " + minutesFor(words) + " min" +
                (plates ? " · " + plates + (plates === 1 ? " plate" : " plates") : "") + "</span>" +
            "</span>" +
            (statusLabel ? '<span class="toc-status">' + statusLabel + "</span>" : '<span class="toc-status"></span>') +
          "</a></li>";
      }).join("");

      var totalWords = book.chapters.reduce(function (n, c) { return n + countWords(c.paragraphs); }, 0);
      var pct = book.chapters.length ? Math.round((doneCount / book.chapters.length) * 100) : 0;

      main.innerHTML =
        '<a class="backlink" href="#/read">' + backIcon() + "Library</a>" +
        '<div class="page-head">' +
          '<p class="eyebrow">' + esc(book.author) + " · " + esc(book.year) + "</p>" +
          "<h1>" + esc(book.title) + "</h1>" +
          '<p class="lede">' + esc(book.blurb || "") + "</p>" +
          '<div class="entry-actions">' +
            '<a class="btn" href="#/read/' + esc(slug) + "/" + (pos ? pos.chapter : 0) + '">' +
              (pos ? "Resume at chapter " + (pos.chapter + 1) : "Start reading") + "</a>" +
          "</div>" +
        "</div>" +
        '<section class="block">' +
          '<div class="toc-head">' +
            "<h3>" + esc(unitNoun(book, true)) + "</h3>" +
            '<span class="toc-summary">' + doneCount + " of " + book.chapters.length + " read · " +
              minutesFor(totalWords) + " min in total</span>" +
          "</div>" +
          '<div class="bar" style="margin-bottom:1rem"><i style="width:' + pct + '%"></i></div>' +
          '<ul class="toc">' + items + "</ul>" +
        "</section>" +
        '<section class="block"><h3>Source</h3><ul class="refs"><li>' +
          '<a href="' + esc(book.source.url) + '" target="_blank" rel="noopener noreferrer">' +
          extIcon() + "<span>" + esc(book.source.name) + " — " + esc(book.source.rights) + "</span></a>" +
        "</li></ul></section>";

      document.title = book.title + " · Drawing Atlas";
    });
  }

  /* ---- study list ------------------------------------------------------- */

  function viewWords(main) {
    var words = TH ? TH.history() : [];
    var rows = words.map(function (w) {
      return '<li class="word-row"><b>' + esc(w.word) + "</b><span>" + esc(w.thai) + "</span></li>";
    }).join("");

    main.innerHTML =
      '<a class="backlink" href="#/read">' + backIcon() + "Library</a>" +
      '<div class="page-head"><p class="eyebrow">Study list</p>' +
      "<h1>" + words.length + (words.length === 1 ? " word" : " words") + " looked up</h1>" +
      '<p class="lede">Every English word you tapped while reading, with the Thai gloss, newest first. ' +
      "Kept in this browser.</p></div>" +
      (words.length
        ? '<ul class="word-list">' + rows + "</ul>"
        : '<div class="empty"><b>Nothing yet</b>Tap a word while reading and it lands here.</div>');

    document.title = "Study list · Drawing Atlas";
  }

  /* ---- the reader ------------------------------------------------------- */

  function viewReader(main, slug, chapterIndex) {
    main.innerHTML = '<div class="empty"><b>Opening…</b></div>';

    getBook(slug).then(function (book) {
      if (!book) {
        main.innerHTML = '<div class="empty"><b>That book is not in the library</b>' +
          '<a class="backlink" href="#/read" style="margin-top:1rem">' + backIcon() + "Library</a></div>";
        return;
      }
      var idx = Math.max(0, Math.min(book.chapters.length - 1, chapterIndex | 0));
      var chapter = book.chapters[idx];

      state.slug = slug;
      state.chapter = idx;
      state.page = 0;

      var saved = readPositions()[slug];
      if (saved && saved.chapter === idx) state.page = saved.page || 0;

      main.innerHTML =
        '<div class="reader" id="reader">' +
          '<div class="reader-bar">' +
            '<a class="backlink" href="#/read/' + esc(slug) + '">' + backIcon() + "Contents</a>" +
            '<div class="reader-title">' + esc(book.title) + " · " + esc(chapter.title) + "</div>" +
            '<div class="reader-tools">' +
              '<button class="icon-btn" type="button" id="font-down" aria-label="Smaller text">A−</button>' +
              '<button class="icon-btn" type="button" id="font-up" aria-label="Larger text">A+</button>' +
            "</div>" +
          "</div>" +

          '<div class="page-viewport" id="viewport">' +
            '<div class="page-track" id="track">' +
              "<h2 class=\"chapter-head\">" + esc(chapter.title) + "</h2>" +
              chapter.paragraphs.map(renderBlock).join("") +
            "</div>" +
          "</div>" +

          '<div class="reader-foot">' +
            '<button class="btn" type="button" id="prev-page">‹ Back</button>' +
            '<span class="page-count" id="page-count">—</span>' +
            '<button class="btn" type="button" id="next-page">Next ›</button>' +
          "</div>" +

          '<div class="chapter-nav">' +
            (idx > 0 ? '<a href="#/read/' + esc(slug) + "/" + (idx - 1) + '">‹ Previous chapter</a>' : "<span></span>") +
            (idx < book.chapters.length - 1 ? '<a href="#/read/' + esc(slug) + "/" + (idx + 1) + '">Next chapter ›</a>' : "<span></span>") +
          "</div>" +
        "</div>" +
        '<div class="word-pop" id="word-pop" role="dialog" aria-live="polite" hidden></div>';

      setupReader();
      document.title = chapter.title + " · " + book.title;
    });
  }

  /* ---- pagination ------------------------------------------------------- */

  var viewport, track, pop, resizeTimer;

  function measure() {
    if (!viewport || !track) return;
    var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    var width = viewport.clientWidth;
    track.style.columnWidth = width + "px";
    track.style.height = viewport.clientHeight + "px";

    // scrollWidth includes a trailing gap on all but the last column.
    var total = Math.max(1, Math.round((track.scrollWidth + gap) / (width + gap)));
    state.pages = total;
    if (state.page > total - 1) state.page = total - 1;
    if (state.page < 0) state.page = 0;
    applyPage();
  }

  function applyPage() {
    if (!viewport || !track) return;
    var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    var step = viewport.clientWidth + gap;
    track.style.transform = "translateX(" + (-state.page * step) + "px)";

    var counter = document.getElementById("page-count");
    if (counter) counter.textContent = (state.page + 1) + " / " + state.pages;

    // Reaching the last page is what marks a chapter read, so the index
    // reflects what has actually been finished rather than merely opened.
    if (state.page >= state.pages - 1) markChapterRead(state.slug, state.chapter);

    var prev = document.getElementById("prev-page");
    var next = document.getElementById("next-page");
    if (prev) prev.disabled = state.page === 0;
    if (next) next.disabled = state.page >= state.pages - 1;

    writePosition(state.slug, state.chapter, state.page);
  }

  function turn(delta) {
    var target = state.page + delta;
    if (target < 0 || target > state.pages - 1) return;
    state.page = target;
    hidePop();
    applyPage();
  }

  /* ---- word tapping ----------------------------------------------------- */

  var WORD_CHAR = /[\p{L}\p{N}'’-]/u;

  function rangeFromPoint(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      var r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
      return r;
    }
    return null;
  }

  /** Finds the word under a point without wrapping anything in spans. */
  function wordAtPoint(x, y) {
    var range = rangeFromPoint(x, y);
    if (!range) return null;
    var node = range.startContainer;
    if (!node || node.nodeType !== 3) return null;

    var text = node.textContent;
    var i = Math.min(range.startOffset, text.length - 1);
    if (i < 0) return null;

    // A tap just past the end of a word lands on the following space.
    if (!WORD_CHAR.test(text[i]) && i > 0 && WORD_CHAR.test(text[i - 1])) i--;
    if (!WORD_CHAR.test(text[i])) return null;

    var s = i, e = i;
    while (s > 0 && WORD_CHAR.test(text[s - 1])) s--;
    while (e < text.length - 1 && WORD_CHAR.test(text[e + 1])) e++;

    var wordRange = document.createRange();
    wordRange.setStart(node, s);
    wordRange.setEnd(node, e + 1);

    return { word: text.slice(s, e + 1), range: wordRange, node: node, start: s };
  }

  /** The sentence the word sits in — machine translation of a bare word is weak. */
  function sentenceAround(node, offset) {
    var full = (node.parentNode && node.parentNode.textContent) || node.textContent || "";
    var at = full.indexOf(node.textContent) + offset;
    if (at < 0) at = offset;

    var start = 0, end = full.length;
    for (var i = at; i > 0; i--) {
      if (/[.!?]/.test(full[i - 1]) && /\s/.test(full[i] || " ")) { start = i; break; }
    }
    for (var j = at; j < full.length; j++) {
      if (/[.!?]/.test(full[j])) { end = j + 1; break; }
    }
    var s = full.slice(start, end).trim();
    return s.length > 220 ? s.slice(0, 217) + "…" : s;
  }

  function hidePop() {
    if (!pop) return;
    pop.hidden = true;
    clearHighlight();
  }

  var highlightEl = null;
  function clearHighlight() {
    if (highlightEl && highlightEl.parentNode) highlightEl.parentNode.removeChild(highlightEl);
    highlightEl = null;
  }

  function highlight(range) {
    clearHighlight();
    var rect = range.getBoundingClientRect();
    var host = document.getElementById("reader");
    if (!host || !rect.width) return null;
    var hostRect = host.getBoundingClientRect();
    var el = document.createElement("span");
    el.className = "word-mark";
    el.style.left = (rect.left - hostRect.left) + "px";
    el.style.top = (rect.top - hostRect.top) + "px";
    el.style.width = rect.width + "px";
    el.style.height = rect.height + "px";
    host.appendChild(el);
    highlightEl = el;
    return rect;
  }

  function showPop(rect, word, bodyHTML) {
    if (!pop) return;
    pop.innerHTML =
      '<button class="pop-close" type="button" aria-label="Close">×</button>' +
      '<div class="pop-word">' + esc(word) + "</div>" + bodyHTML;
    pop.hidden = false;

    // Clamp within the viewport; prefer below the word, flip above if tight.
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = rect.left + rect.width / 2 - pw / 2;
    left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
    var top = rect.bottom + 10;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 10);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function onTap(ev) {
    if (ev.target.closest && ev.target.closest(".word-pop")) return;
    var hit = wordAtPoint(ev.clientX, ev.clientY);
    if (!hit) { hidePop(); return; }

    var rect = highlight(hit.range);
    if (!rect) return;

    var context = sentenceAround(hit.node, hit.start);
    showPop(rect, hit.word, '<div class="pop-loading">กำลังแปล… <span>looking up</span></div>');

    TH.lookup(hit.word).then(function (result) {
      if (pop.hidden) return;
      var body;
      if (result) {
        body =
          '<div class="pop-thai">' + esc(result.thai) + "</div>" +
          (result.base !== result.word
            ? '<div class="pop-base">from <b>' + esc(result.base) + "</b></div>"
            : "") +
          '<div class="pop-src">' +
            (result.source === "glossary" ? "bundled glossary"
              : result.source === "cache" ? "saved earlier"
              : "machine translation") +
          "</div>" +
          (context ? '<div class="pop-context">' + esc(context) + "</div>" : "");
      } else {
        body =
          '<div class="pop-fail">No translation available offline.</div>' +
          '<a class="pop-link" href="https://dict.longdo.com/search/' + encodeURIComponent(hit.word) +
            '" target="_blank" rel="noopener noreferrer">Look up on Longdo →</a>' +
          (context ? '<div class="pop-context">' + esc(context) + "</div>" : "");
      }
      showPop(rect, hit.word, body);
    });
  }

  /* ---- wiring ----------------------------------------------------------- */

  function setupReader() {
    viewport = document.getElementById("viewport");
    track = document.getElementById("track");
    pop = document.getElementById("word-pop");
    if (!viewport || !track) return;

    var size = Number(window.ATLAS && ATLAS.getPref ? ATLAS.getPref("reader.size", 19) : 19);
    track.style.fontSize = size + "px";

    // Fonts and images can shift line breaking, so measure after paint.
    requestAnimationFrame(function () { requestAnimationFrame(measure); });

    document.getElementById("next-page").addEventListener("click", function () { turn(1); });
    document.getElementById("prev-page").addEventListener("click", function () { turn(-1); });

    document.getElementById("font-up").addEventListener("click", function () { setSize(2); });
    document.getElementById("font-down").addEventListener("click", function () { setSize(-2); });

    viewport.addEventListener("click", onTap);
    pop.addEventListener("click", function (ev) {
      if (ev.target.closest(".pop-close")) hidePop();
    });

    // Swipe to turn pages.
    var x0 = null, y0 = null;
    viewport.addEventListener("touchstart", function (ev) {
      x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY;
    }, { passive: true });
    viewport.addEventListener("touchend", function (ev) {
      if (x0 == null) return;
      var dx = ev.changedTouches[0].clientX - x0;
      var dy = ev.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) turn(dx < 0 ? 1 : -1);
      x0 = y0 = null;
    }, { passive: true });

    window.addEventListener("resize", onResize);
  }

  function setSize(delta) {
    var current = parseFloat(track.style.fontSize) || 19;
    var next = Math.max(14, Math.min(30, current + delta));
    track.style.fontSize = next + "px";
    if (window.ATLAS && ATLAS.setPref) ATLAS.setPref("reader.size", next);
    hidePop();
    requestAnimationFrame(measure);
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { hidePop(); measure(); }, 150);
  }

  function onKey(ev) {
    if (!document.getElementById("reader")) return;
    var tag = (ev.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (ev.key === "ArrowRight" || ev.key === " ") { ev.preventDefault(); turn(1); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); turn(-1); }
    else if (ev.key === "Escape") hidePop();
  }
  document.addEventListener("keydown", onKey);

  /* ---- icons ------------------------------------------------------------ */

  function backIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg>';
  }
  function extIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/>' +
      '<path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
  }

  /* ---- route entry ------------------------------------------------------ */

  window.ATLAS_READER = {
    /** @returns true if it handled the route */
    route: function (main, parts) {
      if (parts[0] !== "read") return false;
      window.removeEventListener("resize", onResize);

      if (!parts[1]) viewLibrary(main);
      else if (parts[1] === "words") viewWords(main);
      else if (parts[2] != null) viewReader(main, parts[1], parseInt(parts[2], 10) || 0);
      else viewContents(main, parts[1]);

      window.scrollTo(0, 0);
      return true;
    },
    getManifest: getManifest
  };
})();
