/* Drawing Atlas — router, views and interaction.
 *
 * Routes (hash-based so it works on GitHub Pages and from file:// alike):
 *   #/                     dashboard
 *   #/c/<catId>            category checklist
 *   #/c/<catId>/<entryId>  entry detail
 *   #/starred              everything starred, across categories
 *   #/search?q=...         search results
 */
(function () {
  "use strict";

  var A = window.ATLAS;
  var main = document.getElementById("main");
  var searchInput = document.getElementById("search");
  var toastEl = document.getElementById("toast");
  var importInput = document.getElementById("import-file");

  var SORTS = {
    "az":      { label: "A – Z",        fn: function (a, b) { return cmp(a.name, b.name); } },
    "za":      { label: "Z – A",        fn: function (a, b) { return cmp(b.name, a.name); } },
    "todo":    { label: "To do first",  fn: function (a, b) { return (A.isDone(a.key) - A.isDone(b.key)) || cmp(a.name, b.name); } },
    "done":    { label: "Done first",   fn: function (a, b) { return (A.isDone(b.key) - A.isDone(a.key)) || cmp(a.name, b.name); } },
    "starred": { label: "Starred first",fn: function (a, b) { return (A.isStarred(b.key) - A.isStarred(a.key)) || cmp(a.name, b.name); } },
    "default": { label: "Curated",      fn: null }
  };

  var FILTERS = { all: "All", todo: "To do", done: "Done", star: "Starred" };

  /* ---- helpers -------------------------------------------------------- */

  function cmp(a, b) { return String(a).localeCompare(String(b), undefined, { sensitivity: "base" }); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function attr(s) { return esc(s); }

  /** Reads "facets.season" style paths off an entry. */
  function pluck(obj, path) {
    var parts = String(path).split(".");
    var cur = obj;
    for (var i = 0; i < parts.length && cur != null; i++) cur = cur[parts[i]];
    return cur == null || cur === "" ? null : cur;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove("show"); }, 2400);
  }

  var ICON = {
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 17l-5.25 2.75 1-5.85L3.5 9.75l5.9-.85Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg>',
    ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l4 4v12H5z"/><path d="M8 11h8M8 15h5"/></svg>'
  };

  function ringHTML(pct, done, total) {
    var r = 39, c = 2 * Math.PI * r;
    var offset = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
    return '<div class="ring">' +
      '<svg viewBox="0 0 92 92" role="img" aria-label="' + attr(done + " of " + total + " studied, " + pct + " percent") + '">' +
      '<circle class="track" cx="46" cy="46" r="' + r + '"/>' +
      '<circle class="fill" cx="46" cy="46" r="' + r + '" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"/>' +
      "</svg>" +
      '<div class="ring-label" aria-hidden="true"><b>' + pct + '<small style="font-size:.6em">%</small></b><span>studied</span></div>' +
    "</div>";
  }

  function barHTML(stats, label) {
    return '<div class="bar-row"><span>' + esc(label || "Studied") + '</span><b>' + stats.done + " / " + stats.total + "</b></div>" +
      '<div class="bar"><i style="width:' + stats.pct + '%"></i></div>';
  }

  /* ---- rows ----------------------------------------------------------- */

  function rowHTML(entry, opts) {
    opts = opts || {};
    var s = A.state(entry.key);
    var cat = A.getCategory(entry.categoryId);
    var href = "#/c/" + entry.categoryId + "/" + entry.id;
    var hasNote = !!(s.note && s.note.trim());

    return '<li class="row" data-key="' + attr(entry.key) + '" data-done="' + (s.done ? "true" : "false") + '">' +
      '<input class="check" type="checkbox" ' + (s.done ? "checked" : "") +
        ' data-act="done" aria-label="' + attr("Mark " + entry.name + " as studied") + '">' +
      '<div class="row-body">' +
        '<div class="row-title">' +
          '<a class="row-name" href="' + attr(href) + '">' + esc(entry.name) + "</a>" +
          (entry.sub ? '<span class="row-sub">' + esc(entry.sub) + "</span>" : "") +
          (opts.showCategory && cat ? '<span class="row-cat">' + esc(cat.name) + "</span>" : "") +
          (hasNote ? '<span class="has-note" title="You have a note on this">' + ICON.note + "</span>" : "") +
        "</div>" +
        '<p class="row-meaning">' + esc(entry.meaning || "") + "</p>" +
      "</div>" +
      '<button class="star" type="button" data-act="star" aria-pressed="' + (s.star ? "true" : "false") +
        '" aria-label="' + attr((s.star ? "Unstar " : "Star ") + entry.name) + '" title="Priority">' + ICON.star + "</button>" +
    "</li>";
  }

  function listHTML(entries, opts) {
    if (!entries.length) {
      return '<div class="empty"><b>Nothing here</b>Try a different filter.</div>';
    }
    return '<ul class="list">' + entries.map(function (e) { return rowHTML(e, opts); }).join("") + "</ul>";
  }

  function groupedHTML(entries, groupKey, opts) {
    if (!groupKey) return listHTML(entries, opts);

    var buckets = [];
    var index = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var name = pluck(entries[i], groupKey) || "Unsorted";
      if (!index[name]) { index[name] = { name: name, items: [] }; buckets.push(index[name]); }
      index[name].items.push(entries[i]);
    }
    buckets.sort(function (a, b) { return cmp(a.name, b.name); });

    return buckets.map(function (b) {
      var st = A.statsFor(b.items);
      return '<section class="group">' +
        '<div class="group-head"><h3>' + esc(b.name) + "</h3><em>" + st.done + " / " + st.total + "</em></div>" +
        listHTML(b.items, opts) +
      "</section>";
    }).join("");
  }

  /* ---- filtering / sorting -------------------------------------------- */

  function applyFilter(entries, filter) {
    if (filter === "todo")  return entries.filter(function (e) { return !A.isDone(e.key); });
    if (filter === "done")  return entries.filter(function (e) { return A.isDone(e.key); });
    if (filter === "star")  return entries.filter(function (e) { return A.isStarred(e.key); });
    return entries.slice();
  }

  function applySort(entries, sortKey) {
    var sort = SORTS[sortKey] || SORTS["default"];
    if (!sort.fn) return entries;
    return entries.slice().sort(sort.fn);
  }

  function matches(entry, needle) {
    if (!needle) return true;
    var hay = [
      entry.name, entry.sub, entry.meaning, entry.group,
      (entry.tags || []).join(" "),
      (entry.attributes || []).join(" "),
      (entry.lore || []).join(" "),
      (entry.draw || []).join(" ")
    ].join(" ").toLowerCase();
    var words = needle.toLowerCase().split(/\s+/).filter(Boolean);
    for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) === -1) return false;
    return true;
  }

  /* ---- views ---------------------------------------------------------- */

  function viewDashboard() {
    var all = A.allEntries();
    var st = A.statsFor(all);

    var cards = A.categories.map(function (cat) {
      var cs = A.statsFor(cat.entries || []);
      return '<a class="cat-card" href="#/c/' + attr(cat.id) + '" style="--cat-accent:' + attr(cat.accent || "#8a5a3c") + '">' +
        '<div class="cat-card-top">' +
          '<span class="cat-glyph" aria-hidden="true">' + esc(cat.glyph || "◆") + "</span>" +
          "<span><h2>" + esc(cat.name) + "</h2>" +
          '<div class="cat-sub">' + esc(cat.subtitle || "") + "</div></span>" +
        "</div>" +
        "<p>" + esc(cat.blurb || "") + "</p>" +
        barHTML(cs) +
      "</a>";
    }).join("");

    var starred = all.filter(function (e) { return A.isStarred(e.key); });

    main.innerHTML =
      '<div class="page-head">' +
        '<p class="eyebrow">Drawing checklist &amp; reference</p>' +
        "<h1>What to draw next, and what it means</h1>" +
        '<p class="lede">Pick a category, read the meaning and lore, then tick it off when you have ' +
        "studied it. Every entry links out to the sources its summary was built from. Progress is saved " +
        "in this browser.</p>" +
      "</div>" +

      '<section class="overview" aria-label="Overall progress">' +
        ringHTML(st.pct, st.done, st.total) +
        '<div class="stats">' +
          "<div class=\"stat\"><b>" + st.total + "</b><span>subjects</span></div>" +
          "<div class=\"stat\"><b>" + st.done + "</b><span>studied</span></div>" +
          "<div class=\"stat\"><b>" + st.remaining + "</b><span>to go</span></div>" +
          "<div class=\"stat\"><b>" + st.starred + "</b><span>starred</span></div>" +
          "<div class=\"stat\"><b>" + A.categories.length + "</b><span>categories</span></div>" +
        "</div>" +
      "</section>" +

      (starred.length
        ? '<section class="block"><h3>Starred — draw these first</h3>' + listHTML(applySort(starred, "todo"), { showCategory: true }) + "</section>"
        : "") +

      '<section class="block"><h3>Categories</h3><div class="cat-grid">' + cards + "</div></section>";

    document.title = "Drawing Atlas";
  }

  function viewCategory(catId) {
    var cat = A.getCategory(catId);
    if (!cat) return viewNotFound();

    var filter = A.getPref("filter." + catId, "all");
    var sortKey = A.getPref("sort." + catId, "default");
    var groupKey = A.getPref("group." + catId, (cat.groupings && cat.groupings[0] && cat.groupings[0].key) || "");

    var entries = applySort(applyFilter(cat.entries || [], filter), sortKey);
    var st = A.statsFor(cat.entries || []);

    var groupOptions = ['<option value="">No grouping</option>'].concat(
      (cat.groupings || []).map(function (g) {
        return '<option value="' + attr(g.key) + '"' + (g.key === groupKey ? " selected" : "") + ">" + esc(g.label) + "</option>";
      })
    ).join("");

    var sortOptions = Object.keys(SORTS).map(function (k) {
      return '<option value="' + attr(k) + '"' + (k === sortKey ? " selected" : "") + ">" + esc(SORTS[k].label) + "</option>";
    }).join("");

    var filterButtons = Object.keys(FILTERS).map(function (k) {
      return '<button type="button" data-filter="' + attr(k) + '" aria-pressed="' + (k === filter ? "true" : "false") + '">' + esc(FILTERS[k]) + "</button>";
    }).join("");

    var sourceList = (cat.sources || []).map(function (s) {
      return '<li><a href="' + attr(s.url) + '" target="_blank" rel="noopener noreferrer">' + ICON.ext + "<span>" + esc(s.label) + "</span></a></li>";
    }).join("");

    main.innerHTML =
      '<a class="backlink" href="#/">' + ICON.back + "All categories</a>" +
      '<div class="page-head">' +
        '<p class="eyebrow">' + esc(cat.subtitle || "") + "</p>" +
        "<h1>" + esc(cat.name) + "</h1>" +
        '<p class="lede">' + esc(cat.blurb || "") + "</p>" +
      "</div>" +

      '<section class="overview" aria-label="Category progress">' +
        ringHTML(st.pct, st.done, st.total) +
        '<div class="stats">' +
          "<div class=\"stat\"><b>" + st.total + "</b><span>subjects</span></div>" +
          "<div class=\"stat\"><b>" + st.done + "</b><span>studied</span></div>" +
          "<div class=\"stat\"><b>" + st.starred + "</b><span>starred</span></div>" +
          "<div class=\"stat\"><b>" + st.noted + "</b><span>with notes</span></div>" +
        "</div>" +
      "</section>" +

      '<div class="toolbar" id="toolbar">' +
        '<div class="segmented" role="group" aria-label="Filter by status">' + filterButtons + "</div>" +
        '<div class="field"><label for="group-by">Group</label>' +
          '<select id="group-by">' + groupOptions + "</select></div>" +
        '<div class="field"><label for="sort-by">Sort</label>' +
          '<select id="sort-by">' + sortOptions + "</select></div>" +
        '<span class="toolbar-spacer count-note">' + entries.length + " shown</span>" +
      "</div>" +

      '<div id="checklist">' + groupedHTML(entries, groupKey, {}) + "</div>" +

      (sourceList ? '<section class="block"><h3>Sources for this category</h3><ul class="refs">' + sourceList + "</ul></section>" : "");

    var toolbar = document.getElementById("toolbar");
    toolbar.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-filter]");
      if (!btn) return;
      A.setPref("filter." + catId, btn.getAttribute("data-filter"));
      viewCategory(catId);
    });
    document.getElementById("group-by").addEventListener("change", function () {
      A.setPref("group." + catId, this.value);
      viewCategory(catId);
    });
    document.getElementById("sort-by").addEventListener("change", function () {
      A.setPref("sort." + catId, this.value);
      viewCategory(catId);
    });

    document.title = cat.name + " · Drawing Atlas";
  }

  function viewEntry(catId, entryId) {
    var cat = A.getCategory(catId);
    var entry = A.getEntry(catId, entryId);
    if (!cat || !entry) return viewNotFound();

    var s = A.state(entry.key);
    var siblings = cat.entries || [];
    var idx = siblings.indexOf(entry);
    var prev = idx > 0 ? siblings[idx - 1] : null;
    var next = idx > -1 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

    function block(title, body) {
      return body ? '<section class="block"><h3>' + esc(title) + "</h3>" + body + "</section>" : "";
    }

    var loreHTML = (entry.lore || []).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");

    var variantsHTML = (entry.variants || []).length
      ? '<div class="variants">' + entry.variants.map(function (v) {
          return '<div class="variant"><b>' + esc(v.label) + "</b><span>" + esc(v.text) + "</span></div>";
        }).join("") + "</div>"
      : "";

    var drawHTML = (entry.draw || []).length
      ? '<ul class="draw-list">' + entry.draw.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>"
      : "";

    var attrHTML = (entry.attributes || []).length
      ? '<div class="chips">' + entry.attributes.map(function (a) { return '<span class="chip">' + esc(a) + "</span>"; }).join("") + "</div>"
      : "";

    var tagHTML = (entry.tags || []).length
      ? '<div class="chips">' + entry.tags.map(function (t) { return '<span class="chip tag">' + esc(t) + "</span>"; }).join("") + "</div>"
      : "";

    var paletteHTML = (entry.palette || []).length
      ? '<div class="swatches">' + entry.palette.map(function (c) {
          return '<span class="swatch"><i style="background:' + attr(c) + '"></i><code>' + esc(c) + "</code></span>";
        }).join("") + "</div>"
      : "";

    var facetHTML = "";
    if (entry.group || entry.facets) {
      var bits = [];
      if (entry.group) bits.push('<span class="chip">' + esc(entry.group) + "</span>");
      if (entry.facets) {
        for (var f in entry.facets) {
          if (Object.prototype.hasOwnProperty.call(entry.facets, f) && entry.facets[f]) {
            bits.push('<span class="chip">' + esc(entry.facets[f]) + "</span>");
          }
        }
      }
      facetHTML = bits.length ? '<div class="chips">' + bits.join("") + "</div>" : "";
    }

    var refsHTML = (entry.refs || []).length
      ? '<ul class="refs">' + entry.refs.map(function (r) {
          return '<li><a href="' + attr(r.url) + '" target="_blank" rel="noopener noreferrer">' +
            ICON.ext + "<span>" + esc(r.label) + "</span></a></li>";
        }).join("") + "</ul>"
      : '<p class="count-note">No references recorded for this entry yet.</p>';

    main.innerHTML =
      '<a class="backlink" href="#/c/' + attr(cat.id) + '">' + ICON.back + esc(cat.name) + "</a>" +
      '<article class="entry">' +
        '<div class="entry-head">' +
          '<p class="eyebrow">' + esc(cat.name) + (entry.group ? " · " + esc(entry.group) : "") + "</p>" +
          "<h1>" + esc(entry.name) + "</h1>" +
          (entry.sub ? '<p class="entry-sub">' + esc(entry.sub) + "</p>" : "") +
          '<p class="entry-meaning">' + esc(entry.meaning || "") + "</p>" +
          '<div class="entry-actions">' +
            '<button class="btn" type="button" id="btn-done" data-on="' + (s.done ? "true" : "false") + '">' +
              ICON.check + "<span>" + (s.done ? "Studied" : "Mark as studied") + "</span></button>" +
            '<button class="btn btn-star" type="button" id="btn-star" data-on="' + (s.star ? "true" : "false") +
              '" aria-pressed="' + (s.star ? "true" : "false") + '">' + ICON.star +
              "<span>" + (s.star ? "Starred" : "Star") + "</span></button>" +
          "</div>" +
        "</div>" +

        block("Lore & meaning", loreHTML) +
        block("Meaning by variant", variantsHTML) +
        block("What to look at when drawing it", drawHTML) +
        block("Attributes & symbols", attrHTML) +
        block("Palette starting point", paletteHTML) +
        block("Classification", facetHTML) +
        block("Tags", tagHTML) +

        '<section class="block"><h3>References</h3>' +
          '<p class="count-note" style="margin-bottom:.6rem">Every summary above is built from these. Follow them before you commit to an interpretation.</p>' +
          refsHTML +
        "</section>" +

        '<section class="block"><h3>Your notes</h3>' +
          '<textarea class="note" id="note" placeholder="Sketch ideas, composition thoughts, page references from Floriography or Ornithography…">' + esc(s.note || "") + "</textarea>" +
          '<p class="note-status" id="note-status"></p>' +
        "</section>" +

        '<nav class="entry-nav">' +
          (prev ? '<a href="#/c/' + attr(cat.id) + "/" + attr(prev.id) + '"><small>Previous</small><b>' + esc(prev.name) + "</b></a>" : "<span></span>") +
          (next ? '<a href="#/c/' + attr(cat.id) + "/" + attr(next.id) + '"><small>Next</small><b>' + esc(next.name) + "</b></a>" : "<span></span>") +
        "</nav>" +
      "</article>";

    var btnDone = document.getElementById("btn-done");
    var btnStar = document.getElementById("btn-star");

    btnDone.addEventListener("click", function () {
      var next = A.toggleDone(entry.key);
      btnDone.setAttribute("data-on", next.done ? "true" : "false");
      btnDone.querySelector("span").textContent = next.done ? "Studied" : "Mark as studied";
      toast(next.done ? "Marked " + entry.name + " as studied" : "Unmarked " + entry.name);
    });

    btnStar.addEventListener("click", function () {
      var next = A.toggleStar(entry.key);
      btnStar.setAttribute("data-on", next.star ? "true" : "false");
      btnStar.setAttribute("aria-pressed", next.star ? "true" : "false");
      btnStar.querySelector("span").textContent = next.star ? "Starred" : "Star";
    });

    var noteEl = document.getElementById("note");
    var noteStatus = document.getElementById("note-status");
    var noteTimer;
    noteEl.addEventListener("input", function () {
      noteStatus.textContent = "Saving…";
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () {
        A.setNote(entry.key, noteEl.value);
        noteStatus.textContent = "Saved to this browser";
      }, 450);
    });

    document.title = entry.name + " · " + cat.name + " · Drawing Atlas";
    window.scrollTo(0, 0);
  }

  function viewStarred() {
    var starred = A.allEntries().filter(function (e) { return A.isStarred(e.key); });
    main.innerHTML =
      '<a class="backlink" href="#/">' + ICON.back + "All categories</a>" +
      '<div class="page-head"><p class="eyebrow">Priority list</p><h1>Starred subjects</h1>' +
      '<p class="lede">Everything you have starred, across all categories.</p></div>' +
      (starred.length
        ? listHTML(applySort(starred, "todo"), { showCategory: true })
        : '<div class="empty"><b>Nothing starred yet</b>Star a subject to queue it up here.</div>');
    document.title = "Starred · Drawing Atlas";
  }

  function viewSearch(q) {
    var needle = (q || "").trim();
    var results = needle ? A.allEntries().filter(function (e) { return matches(e, needle); }) : [];

    main.innerHTML =
      '<a class="backlink" href="#/">' + ICON.back + "All categories</a>" +
      '<div class="page-head"><p class="eyebrow">Search</p><h1>' +
        (needle ? esc(results.length + (results.length === 1 ? " result" : " results")) : "Search") +
      "</h1>" +
      '<p class="lede">' + (needle ? "Matching &ldquo;" + esc(needle) + "&rdquo; across names, meanings, lore, attributes and tags." : "Type in the box above to search every subject.") + "</p></div>" +
      (needle
        ? (results.length
            ? groupedHTML(applySort(results, "az"), "categoryId", { showCategory: true })
            : '<div class="empty"><b>No matches</b>Try a shorter or different term.</div>')
        : "");

    document.title = (needle ? '"' + needle + '" · ' : "") + "Search · Drawing Atlas";
  }

  function viewNotFound() {
    main.innerHTML = '<div class="empty"><b>Page not found</b>' +
      '<a class="backlink" href="#/" style="margin-top:1rem">' + ICON.back + "Back to the dashboard</a></div>";
    document.title = "Not found · Drawing Atlas";
  }

  /* ---- checklist interaction (delegated) ------------------------------ */

  main.addEventListener("change", function (ev) {
    var box = ev.target.closest('input[data-act="done"]');
    if (!box) return;
    var row = box.closest(".row");
    A.setDone(row.getAttribute("data-key"), box.checked);
    row.setAttribute("data-done", box.checked ? "true" : "false");
    refreshProgressWidgets();
  });

  main.addEventListener("click", function (ev) {
    var btn = ev.target.closest('button[data-act="star"]');
    if (!btn) return;
    var row = btn.closest(".row");
    var next = A.toggleStar(row.getAttribute("data-key"));
    btn.setAttribute("aria-pressed", next.star ? "true" : "false");
    refreshProgressWidgets();
  });

  /* Updates rings, bars and counters in place so ticking a box does not
     re-render the list and lose the user's scroll position. */
  function refreshProgressWidgets() {
    var route = parseRoute();
    var scope = route.name === "category" ? (A.getCategory(route.catId) || {}).entries || [] : A.allEntries();
    var st = A.statsFor(scope);

    var ring = main.querySelector(".ring .fill");
    if (ring) {
      var r = 39, c = 2 * Math.PI * r;
      ring.setAttribute("stroke-dashoffset", (c * (1 - st.pct / 100)).toFixed(1));
      var lbl = main.querySelector(".ring-label b");
      if (lbl) lbl.innerHTML = st.pct + '<small style="font-size:.6em">%</small>';
      var svg = main.querySelector(".ring svg");
      if (svg) svg.setAttribute("aria-label", st.done + " of " + st.total + " studied, " + st.pct + " percent");
    }

    var stats = main.querySelectorAll(".overview .stat");
    for (var i = 0; i < stats.length; i++) {
      var key = (stats[i].querySelector("span") || {}).textContent;
      var b = stats[i].querySelector("b");
      if (!b) continue;
      if (key === "studied") b.textContent = st.done;
      else if (key === "to go") b.textContent = st.remaining;
      else if (key === "starred") b.textContent = st.starred;
      else if (key === "with notes") b.textContent = st.noted;
    }

    // Per-group counters
    var groups = main.querySelectorAll(".group");
    for (var g = 0; g < groups.length; g++) {
      var rows = groups[g].querySelectorAll(".row");
      var doneCount = 0;
      for (var k = 0; k < rows.length; k++) if (rows[k].getAttribute("data-done") === "true") doneCount++;
      var em = groups[g].querySelector(".group-head em");
      if (em) em.textContent = doneCount + " / " + rows.length;
    }
  }

  /* ---- routing -------------------------------------------------------- */

  function parseRoute() {
    var hash = location.hash.replace(/^#\/?/, "");
    if (!hash) return { name: "dashboard" };

    var qIndex = hash.indexOf("?");
    var query = "";
    if (qIndex > -1) { query = hash.slice(qIndex + 1); hash = hash.slice(0, qIndex); }
    var parts = hash.split("/").filter(Boolean).map(decodeURIComponent);

    if (parts[0] === "c" && parts[1] && parts[2]) return { name: "entry", catId: parts[1], entryId: parts[2] };
    if (parts[0] === "c" && parts[1]) return { name: "category", catId: parts[1] };
    if (parts[0] === "starred") return { name: "starred" };
    if (parts[0] === "search") {
      var m = /(?:^|&)q=([^&]*)/.exec(query);
      return { name: "search", q: m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "" };
    }
    return { name: "notfound" };
  }

  function render() {
    var route = parseRoute();
    if (route.name === "dashboard") viewDashboard();
    else if (route.name === "category") viewCategory(route.catId);
    else if (route.name === "entry") viewEntry(route.catId, route.entryId);
    else if (route.name === "starred") viewStarred();
    else if (route.name === "search") { searchInput.value = route.q; viewSearch(route.q); }
    else viewNotFound();
  }

  window.addEventListener("hashchange", render);

  /* ---- search box ----------------------------------------------------- */

  var searchTimer;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    var q = searchInput.value;
    searchTimer = setTimeout(function () {
      if (!q.trim()) {
        if (parseRoute().name === "search") location.hash = "#/";
        return;
      }
      var target = "#/search?q=" + encodeURIComponent(q.trim());
      if (location.hash === target) viewSearch(q.trim());
      else location.hash = target;
    }, 200);
  });

  document.addEventListener("keydown", function (ev) {
    var tag = (ev.target.tagName || "").toLowerCase();
    var typing = tag === "input" || tag === "textarea" || tag === "select" || ev.target.isContentEditable;
    if (ev.key === "/" && !typing && !ev.metaKey && !ev.ctrlKey) {
      ev.preventDefault();
      searchInput.focus();
      searchInput.select();
    } else if (ev.key === "Escape" && document.activeElement === searchInput) {
      searchInput.value = "";
      searchInput.blur();
      if (parseRoute().name === "search") location.hash = "#/";
    }
  });

  /* ---- theme ---------------------------------------------------------- */

  var themeBtn = document.getElementById("theme-toggle");

  function prefersDark() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function applyTheme(mode) {
    // "auto" removes the attribute so prefers-color-scheme decides.
    if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-theme", mode);
    else document.documentElement.removeAttribute("data-theme");
  }

  applyTheme(A.getPref("theme", "auto"));

  themeBtn.addEventListener("click", function () {
    var current = A.getPref("theme", "auto");
    var effectiveDark = current === "dark" || (current === "auto" && prefersDark());
    var next = effectiveDark ? "light" : "dark";
    A.setPref("theme", next);
    applyTheme(next);
  });

  /* ---- export / import / reset ---------------------------------------- */

  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.getAttribute("data-action");

    if (action === "export") {
      var blob = new Blob([JSON.stringify(A.exportData(), null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "drawing-atlas-progress-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast("Progress exported");
    }

    if (action === "import") importInput.click();

    if (action === "reset") {
      if (window.confirm("Clear every tick, star and note stored in this browser? This cannot be undone.")) {
        A.resetAll();
        render();
        toast("Progress cleared");
      }
    }
  });

  importInput.addEventListener("change", function () {
    var file = importInput.files && importInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var count = A.importData(JSON.parse(String(reader.result)));
        render();
        toast("Imported " + count + (count === 1 ? " entry" : " entries"));
      } catch (err) {
        toast("Could not import: " + err.message);
      }
      importInput.value = "";
    };
    reader.onerror = function () { toast("Could not read that file"); importInput.value = ""; };
    reader.readAsText(file);
  });

  /* ---- go ------------------------------------------------------------- */

  render();
})();
