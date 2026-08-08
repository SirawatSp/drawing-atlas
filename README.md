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
| Flowers | 26 | Victorian floriography — sentiment, colour codes, conflicting dictionaries |
| Birds | 20 | Omens, messengers, and the same bird meaning opposite things in two places |
| Greek gods | 20 | Olympians, chthonics and personifications, read by their attributes |
| Chinese lore & gods | 20 | Creation figures, the celestial bureaucracy, the Four Symbols |
| Japanese kami & yōkai | 18 | Shintō deities and the uncanny things at the edge of the village |
| Norse gods | 17 | Æsir, Vanir, giants, and the cosmology they are all falling through |

**121 subjects, 275 reference links.**

Companion to two books worth owning:

- Jessica Roux, *Floriography: An Illustrated Guide to the Victorian Language of Flowers* (2020)
- Jessica Roux, *Ornithography: An Illustrated Guide to Bird Lore & Symbolism* (2024)

Where an entry overlaps with those books, the summary here is built from independent
web sources and cites them — it is a cross-reference, not a substitute.

## Each entry gives you

- **Meaning** — the one-line symbolic reading
- **Lore** — two paragraphs of the myth or history that produced that reading
- **Meaning by variant** — where colour or form changes the message (rose, carnation, hyacinth)
- **What to look at when drawing it** — concrete visual notes: the structure, the
  identifying detail, the mistake people make
- **Attributes & symbols** — the held objects and companion animals that make a figure legible
- **Palette starting point** — four hex swatches, as a departure point rather than a prescription
- **References** — every source the summary drew on

## Features

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
