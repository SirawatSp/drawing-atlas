# Drawing Atlas

A minimal dashboard and checklist for **studying symbolic subjects before drawing them**.

Pick a category, read what the subject means and the lore behind it, note what to
look at while drawing, then tick it off. Every entry links out to the sources its
summary was built from, so nothing has to be taken on trust.

**Live site:** https://sirawatsp.github.io/drawing-atlas/

---

## What's in it

| Category | Entries | Covers |
| --- | --- | --- |
| Flowers | 103 | Victorian floriography — sentiment, colour codes, conflicting dictionaries |
| Birds | 20 | Omens, messengers, and the same bird meaning opposite things in two places |
| Greek gods | 20 | Olympians, chthonics and personifications, read by their attributes |
| Chinese lore & gods | 20 | Creation figures, the celestial bureaucracy, the Four Symbols |
| Japanese kami & yōkai | 18 | Shintō deities and the uncanny things at the edge of the village |
| Norse gods | 17 | Æsir, Vanir, giants, and the cosmology they are all falling through |

**198 subjects, 437 reference links.**

Companion to two books worth owning:

- Jessica Roux, *Floriography: An Illustrated Guide to the Victorian Language of Flowers* (2020)
- Jessica Roux, *Ornithography: An Illustrated Guide to Bird Lore & Symbolism* (2024)

Where an entry overlaps with those books, the summary here is built from independent
web sources and cites them — it is a cross-reference, not a substitute.

## Reference images

Entries name a **Wikipedia article** (`image: { wiki: "Common_raven" }`) and the
site resolves that article's lead image at view time.

This is deliberate. Real Commons URLs embed an MD5 hash prefix that cannot be
derived from a filename, so hardcoding image URLs means guessing and getting a
wall of 404s. Keying to an article title is verifiable, and it self-heals when
Wikipedia changes its lead image.

Targets are chosen for the *image*, not the lore. `birds/raven` cites
`Huginn_and_Muninn` as a source — that is where the Odin material comes from —
but its image target is `Common_raven`, because you want a photograph of the bird.

**Where images appear:** a 16:9 hero on each entry (with author and licence
fetched from Commons and a link to the file page), and a thumbnail on each
checklist row, lazy-loaded as you scroll and cached in `localStorage`.

**Where they don't:** anywhere that blocks cross-origin requests. Every image box
starts as a placeholder generated from that entry's own four-colour palette, so a
blocked, offline or missing image degrades to something deliberate instead of a
broken-image icon. Notably the published Claude artifact shows only placeholders —
its Content-Security-Policy blocks all external hosts. Serve the site over
http(s) and the images appear.

To find bad targets:

```bash
node scripts/check-images.mjs            # summary
node scripts/check-images.mjs --verbose  # every resolved URL
```

It resolves all 198 against the live API and reports which articles don't exist,
which have no lead image, and which titles have gone stale via a redirect.

**Licensing:** Wikipedia lead images are freely licensed but not all public
domain — many are CC BY-SA. The hero caption shows the author and licence pulled
from Commons for that specific file, which is why attribution is fetched rather
than assumed.

## Each entry gives you

- **Reference image** — the subject's lead image from Wikipedia, with attribution
- **Meaning** — the one-line symbolic reading
- **Lore** — two paragraphs of the myth or history that produced that reading
- **Meaning by variant** — where colour or form changes the message (rose, carnation, hyacinth)
- **What to look at when drawing it** — concrete visual notes: the structure, the
  identifying detail, the mistake people make
- **Attributes & symbols** — the held objects and companion animals that make a figure legible
- **Palette starting point** — four hex swatches, as a departure point rather than a prescription
- **References** — every source the summary drew on

## Recording what you've drawn

An entry can carry `drawn: "YYYY-MM-DD"`:

```js
{ id: "dogwood", drawn: "2026-08-09", name: "Dogwood", … }
```

Entries marked this way are ticked automatically the first time a browser loads
the site, so the record travels with the repo instead of living in one browser's
storage — a new phone, a new laptop or a cleared cache all show the right state
with nothing to import.

Seeding runs **once ever**, guarded by its own flag rather than by "is progress
empty". That distinction matters: if it re-ran whenever progress looked empty,
unticking a seeded entry and reloading would silently re-tick it and the
checkbox would appear broken.

Your own ticks, stars and notes still live in `localStorage` and are never
overwritten by seeding. Export/import still works for moving those between
browsers.

## Features

- Two layouts: image-led **cards** (default) or a **compact** list, remembered across categories
- Checklist with **studied**, **starred** and **per-entry notes**, saved in your browser
- **Group** by sentiment, season, tradition, direction, realm, fate — each category
  defines its own useful axes
- **Sort** A–Z, to-do first, done first, starred first, or curated order
- **Filter** by status; **search** across names, meanings, lore, attributes and tags
- Progress rings and per-group counters that update without losing your scroll position
- **Export / import** progress as JSON so it survives a new browser or machine
- Light and dark themes, following your system by default
- Keyboard: <kbd>/</kbd> focuses search, <kbd>Esc</kbd> clears it

## Running it

No build step, no dependencies. It is static files.

```bash
# just open it
open index.html

# or serve it, which is closer to production
python3 -m http.server 8000   # → http://localhost:8000
```

Data is loaded via `<script>` tags rather than `fetch`, specifically so that
opening `index.html` straight off disk works too.

## Adding a subject

Open the relevant file in `data/` and add an entry to the `entries` array:

```js
{
  id: "kebab-case-unique-within-the-category",
  name: "Display Name",
  sub: "Latin name · alternate name · romanisation",
  group: "One of the category's sentiment/kind groups",
  facets: { season: "Summer", form: "Spike" },   // used for grouping
  meaning: "One line. This is what shows in the checklist.",
  lore: ["Paragraph one.", "Paragraph two."],
  variants: [{ label: "Red", text: "..." }],     // optional
  draw: ["Concrete visual note.", "Another."],
  attributes: ["Held object", "Sacred animal"],  // optional
  tags: ["lowercase", "keywords"],
  palette: ["#8e2438", "#c96a7a"],               // optional, 6-digit hex
  refs: [{ label: "Source name — what it is", url: "https://..." }]
}
```

Then validate:

```bash
node scripts/check-data.mjs
```

It enforces the things that actually break the site or the trust in it: unique
slug ids, a meaning, real lore, draw notes, **at least one https reference per
entry**, valid hex palettes, and grouping keys that resolve on real entries.
CI runs it on every push and blocks the deploy if it fails.

### Adding a whole category

Copy any file in `data/`, change the `id`, and add a `<script>` tag for it in
`index.html`. Categories self-describe their own `groupings`, so the UI picks up
the new axes with no further work.

## Reference rot

The one way this project quietly degrades is links dying. `scripts/check-links.mjs`
probes every URL and is run monthly by CI. It fails only on a definite 404/410 —
hosts that block bots or rate-limit are reported as inconclusive for a human to
check, rather than breaking the build.

```bash
node scripts/check-links.mjs --verbose
```

## A note on the content

Symbolism is not a fixed system, and this project does not pretend otherwise.
Victorian flower dictionaries contradicted each other outright — lavender is
"distrust" in Greenaway (1884) and "devotion" in modern florists' usage. A magpie
is sorrow in England and joy in China. A chrysanthemum is cheerfulness in one
country and strictly funerary in the next.

Where sources disagree, **both readings are given** and the disagreement is named.
Entries also flag which layer a figure comes from — Snorri's *Prose Edda* rather
than older verse, or *Journey to the West* rather than Taoist ritual — because
that changes how much weight a detail can carry.

## Licence

Code: [MIT](LICENSE). Written entries are original prose compiled from the cited
sources; the sources themselves belong to their authors and are linked, not reproduced.
