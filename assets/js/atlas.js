/* Drawing Atlas — data registry and progress store.
 *
 * Data files call ATLAS.register(category). Progress (done / starred / notes)
 * lives in localStorage keyed by "<categoryId>:<entryId>" so adding, removing or
 * reordering entries never corrupts existing progress.
 */
(function () {
  "use strict";

  var STORE_KEY = "drawing-atlas.progress.v1";
  var PREFS_KEY = "drawing-atlas.prefs.v1";
  var SEED_KEY = "drawing-atlas.seeded.v1";

  var categories = [];
  var byId = Object.create(null);

  /* ---- persistence ---------------------------------------------------- */

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (err) {
      // Private-mode Safari and disabled storage both throw. Degrade to memory.
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  var progress = readJSON(STORE_KEY, {});
  var prefs = readJSON(PREFS_KEY, {});
  var listeners = [];

  function emit(detail) {
    for (var i = 0; i < listeners.length; i++) listeners[i](detail);
  }

  function persist() { writeJSON(STORE_KEY, progress); }

  /* ---- registry ------------------------------------------------------- */

  function register(category) {
    if (!category || !category.id) throw new Error("ATLAS.register: category needs an id");
    if (byId[category.id]) throw new Error("ATLAS.register: duplicate category id " + category.id);

    var entries = category.entries || [];
    var seen = Object.create(null);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.id) throw new Error("ATLAS.register: entry without id in " + category.id);
      if (seen[e.id]) throw new Error("ATLAS.register: duplicate entry id " + category.id + "/" + e.id);
      seen[e.id] = true;
      e.categoryId = category.id;
      e.key = category.id + ":" + e.id;
    }

    categories.push(category);
    byId[category.id] = category;
    seedDrawn(entries);
    return category;
  }

  /**
   * Entries carrying `drawn: "<date>"` are ones already drawn, recorded in the
   * data so the fact travels with the repo instead of living only in one
   * browser. They are ticked automatically the first time this browser loads
   * the site.
   *
   * Seeding runs once ever, guarded by its own flag rather than by "is progress
   * empty" — otherwise unticking a seeded entry and reloading would silently
   * re-tick it, and the checkbox would appear broken.
   */
  function seedDrawn(entries) {
    var alreadySeeded;
    try {
      alreadySeeded = localStorage.getItem(SEED_KEY);
    } catch (err) {
      return; // storage unavailable: nothing to seed into
    }
    if (alreadySeeded) return;

    var touched = false;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.drawn) continue;
      if (progress[e.key] && progress[e.key].done) continue;
      progress[e.key] = progress[e.key] || {};
      progress[e.key].done = true;
      touched = true;
    }
    if (touched) persist();
  }

  /** Called once after all categories have registered. */
  function finishSeeding() {
    try {
      if (!localStorage.getItem(SEED_KEY)) localStorage.setItem(SEED_KEY, String(Date.now()));
    } catch (err) {}
  }

  /* ---- lookups -------------------------------------------------------- */

  function allEntries() {
    var out = [];
    for (var i = 0; i < categories.length; i++) {
      out = out.concat(categories[i].entries || []);
    }
    return out;
  }

  function getCategory(id) { return byId[id] || null; }

  function getEntry(categoryId, entryId) {
    var cat = byId[categoryId];
    if (!cat) return null;
    var entries = cat.entries || [];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === entryId) return entries[i];
    }
    return null;
  }

  /* ---- state per entry ------------------------------------------------ */

  function state(key) {
    return progress[key] || { done: false, star: false, note: "" };
  }

  function isDone(key) { return !!(progress[key] && progress[key].done); }
  function isStarred(key) { return !!(progress[key] && progress[key].star); }
  function noteFor(key) { return (progress[key] && progress[key].note) || ""; }

  function patch(key, changes) {
    var next = progress[key] || {};
    for (var k in changes) if (Object.prototype.hasOwnProperty.call(changes, k)) next[k] = changes[k];

    // Drop empty records so exports stay small and meaningful.
    if (!next.done && !next.star && !(next.note && next.note.trim())) {
      delete progress[key];
    } else {
      if (next.note != null && !next.note.trim()) delete next.note;
      progress[key] = next;
    }
    persist();
    emit({ key: key });
    return state(key);
  }

  function setDone(key, value) { return patch(key, { done: !!value }); }
  function setStar(key, value) { return patch(key, { star: !!value }); }
  function setNote(key, value) { return patch(key, { note: String(value == null ? "" : value) }); }
  function toggleDone(key) { return setDone(key, !isDone(key)); }
  function toggleStar(key) { return setStar(key, !isStarred(key)); }

  /* ---- aggregate stats ------------------------------------------------ */

  function statsFor(entries) {
    var done = 0, starred = 0, noted = 0;
    for (var i = 0; i < entries.length; i++) {
      var s = progress[entries[i].key];
      if (!s) continue;
      if (s.done) done++;
      if (s.star) starred++;
      if (s.note && s.note.trim()) noted++;
    }
    return {
      total: entries.length,
      done: done,
      starred: starred,
      noted: noted,
      remaining: entries.length - done,
      pct: entries.length ? Math.round((done / entries.length) * 100) : 0
    };
  }

  /* ---- import / export / reset ---------------------------------------- */

  function exportData() {
    return {
      format: "drawing-atlas/progress",
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: progress
    };
  }

  function importData(payload) {
    if (!payload || typeof payload !== "object") throw new Error("Not a Drawing Atlas export.");
    var incoming = payload.progress && typeof payload.progress === "object" ? payload.progress : null;
    if (!incoming) throw new Error("No progress found in that file.");

    var valid = Object.create(null);
    var merged = 0;
    var entries = allEntries();
    for (var i = 0; i < entries.length; i++) valid[entries[i].key] = true;

    for (var key in incoming) {
      if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
      if (!valid[key]) continue; // ignore keys for entries this build does not have
      var rec = incoming[key];
      if (!rec || typeof rec !== "object") continue;
      var clean = {};
      if (rec.done) clean.done = true;
      if (rec.star) clean.star = true;
      if (typeof rec.note === "string" && rec.note.trim()) clean.note = rec.note;
      if (Object.keys(clean).length) { progress[key] = clean; merged++; }
    }
    persist();
    emit({ imported: merged });
    return merged;
  }

  function resetAll() {
    progress = {};
    persist();
    emit({ reset: true });
  }

  /* ---- prefs ---------------------------------------------------------- */

  function getPref(key, fallback) {
    return Object.prototype.hasOwnProperty.call(prefs, key) ? prefs[key] : fallback;
  }
  function setPref(key, value) {
    prefs[key] = value;
    writeJSON(PREFS_KEY, prefs);
  }

  function onChange(fn) {
    listeners.push(fn);
    return function off() {
      var i = listeners.indexOf(fn);
      if (i > -1) listeners.splice(i, 1);
    };
  }

  window.ATLAS = {
    register: register,
    finishSeeding: finishSeeding,
    categories: categories,
    getCategory: getCategory,
    getEntry: getEntry,
    allEntries: allEntries,
    state: state,
    isDone: isDone,
    isStarred: isStarred,
    noteFor: noteFor,
    setDone: setDone,
    setStar: setStar,
    setNote: setNote,
    toggleDone: toggleDone,
    toggleStar: toggleStar,
    statsFor: statsFor,
    exportData: exportData,
    importData: importData,
    resetAll: resetAll,
    getPref: getPref,
    setPref: setPref,
    onChange: onChange
  };
})();
