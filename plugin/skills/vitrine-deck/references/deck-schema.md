# The deck format (v4)

What the Vitrine editor saves and what the CLI reads. `vitrine capabilities` carries the
authoritative version of every list and clamp here (`deck`, `layers`, `kinds`, `backgrounds`,
`export`). This file is the *shape*; capabilities is the *vocabulary*. When they disagree,
capabilities is right.

**Don't hand-write the skeleton.** Start from `vitrine init`, which writes a valid v4 deck with one
selected slide per screenshot and the editor's own layers, then edit copy, ground and accents:

```bash
vitrine init --screenshots shots/ --out deck.json --device iphone-6.3,android-phone [--look <id>] [--layout <id>]
vitrine validate --deck deck.json      # after every edit — no browser, lists every unknown id and out-of-range value
```

The screenshots folder must sit inside the deck's folder. `init` makes one kind per deck; to add a
banner, init it separately (`--kind feature-graphic --device play-feature-graphic --out fg.json`) and
copy its slide into the main deck, adding the row to `projectDevices`. **init's placeholder copy
("Your value prop here") grades clean** — replace every headline and subtitle.

`check`, `render`, `push`, `polish` and `apply` run `validate` first and refuse (exit 2) on an error.

## The envelope

```json
{
  "v": 4,
  "projectDevices": ["iphone-6.3", "android-phone"],
  "defaults": { },
  "knownSourceKeys": [],
  "screenshots": [ ]
}
```

- **`v`** — 4, or omit it. An older number runs the editor's migrations, which change fields.
- **`projectDevices`** — the rows this deck renders on; `check`, `polish` and `render` default to it,
  `--device` overrides. Use ids from `capabilities.devices[].id` only. An id no longer in that list
  may be remapped silently to a replacement row with no warning from `validate` or `check`, so
  compare yours against the list rather than trusting a green run.
- **`knownSourceKeys`** — uploads the deck knows about but doesn't use as slides. The editor makes a
  slide from every server upload *not* in this list, so it only stops extra files becoming slides.
  `push` fills it in; leave it `[]`.

## `defaults` — the project's own look

What a role-carrying layer inherits when it doesn't set the field itself. Change one value, restyle
the deck. Omit a key and the built-in default applies; `null` is the same as omitting it.

```json
{
  "background": { "type": "radial", "x": 50, "y": 44, "r": 100,
                  "stops": [["#4f46e5", 0], ["#4f46e5", 18], ["#1e1b4b", 72]] },
  "textColor": "#ffffff",
  "fontId": "sora",
  "headlineWeight": 800,
  "subtitleWeight": 400,
  "textAlign": "center",
  "useFrame": true,
  "deviceHeightRatio": 0.79,
  "deviceTransform": "flat",
  "headlineRotation": { "x": 0, "y": 0, "z": 0, "depth": 2200 },
  "subtitleRotation": { "x": 0, "y": 0, "z": 0, "depth": 2200 },
  "frameTint": "black",
  "locales": ["en-US"],
  "baseLocale": "en-US",
  "safeAreaEnabled": false,
  "safeAreaTop": 75, "safeAreaBottom": 75, "safeAreaLeft": 50, "safeAreaRight": 50,
  "storeCheck": true,
  "exportFormat": "png", "exportQuality": 0.92,
  "exportNameTemplate": "{device}/{order}_{slide}", "exportLocaleScope": "all"
}
```

- **`deviceTransform`** — `flat` · `tilt-left` · `tilt-right` · `perspective`, or `{x,y,z,depth}`.
  Every device layer whose `rotation` is `null` inherits it.
- **`storeCheck: false`** turns off `check`'s store section, for a deck not meant for a store.
- A look (`vitrine apply --look <id>`) writes most of these in one go.

**Background types** (`capabilities.backgrounds.types` has the clamps):

| Type | Shape |
|---|---|
| `solid` | `{ color }` |
| `linear` | `{ angle: 0..360, stops: [[color, 0..100], …] }` |
| `radial` | `{ x, y: -50..150, r: 1..200, stops: [[color, pct], …] }` — x/y/r are **percent** |
| `mesh` | `{ base, blobs: [{ c, x, y, r }] }` — same percent units |
| `image` | `{ sourceKey, fit: cover\|contain, scale: 1..4, x, y: 0..100, blur: 0..100, dim: 0..1 }` |

`capabilities.backgrounds` also lists presets, each with a graded `ink` to use as `textColor`, and
bundled photo grounds (`backgrounds/<id>.webp`). The contrast check samples the ground where the ink
lands, so a bright stop under the headline is a fault and the same stop in a corner is fine. Image
grounds aren't measured: `check` warns `contrast-unverified`.

## A slide

```json
{
  "id": "s-today",
  "sourceKey": "shots/today.png",
  "name": "today",
  "kind": "phone",
  "order": 0,
  "selected": true,
  "groupId": null, "spanId": null, "spanIndex": null,
  "background": null,
  "layers": [ ],
  "layersByDevice": { },
  "layersByLocale": { },
  "byDevice": { },
  "shotByDevice": { }
}
```

- **`kind`** — one canvas shape, so landscape is its own kind. Read `capabilities.kinds`:

  | Kind | Device layer | Screenshot | Falls back to |
  |---|---|---|---|
  | `phone`, `phone-landscape`, `tv` | required | required | — |
  | `tablet` / `tablet-landscape` | required | required | `phone` / `phone-landscape` |
  | `page-header` (App Store header, 3840×1646) | optional | optional | — |
  | `search-result` (App Store search asset, 3840×2560) | optional | optional | — |
  | `feature-graphic` (Play, 1024×500) | optional | optional | — |

  A row draws the slides of its own kind; a tablet row with no tablet slides draws the phone slides.
  On a banner kind `sourceKey` may be `null` and the slide may carry text and images only. A
  selected slide whose kind no `projectDevices` row draws is skipped silently: no cells, no warning.
- **`selected: true`** — required. A slide without it is not checked, rendered or exported.
- **`name`** — the `{slide}` token in the exported filename. Short, filesystem-safe, unique.
- **`order`** — position within its kind; stores sort by filename, so this is the shopper's order.
- **`groupId`** — links slides across kinds that show the same store screenshot.
- **`spanId` / `spanIndex`** — a panorama: consecutive selected slides of one kind sharing a
  `spanId`, `spanIndex` counting 0, 1, 2 (at most 3). An image ground under `backgrounds/` uses its
  `backgrounds/wide/` twin.
- **`background: null`** — inherit the project default; set it to override this slide only.

## Layers

Back to front, **at most one layer per role**. Phone, tablet and TV slides need the device layer;
banner kinds may omit it.

**Common fields:** `id`, `role` (`device` · `headline` · `subtitle` · `null`), `type` (`device` ·
`text` · `image` · `lens`), `xRatio` (offset from the **centred** position, fraction of canvas width;
`0` is centred), `yRatio` (the **top edge**, fraction of canvas height), `rotation` (`{x,y,z,depth}`,
depth 800–5000, default 2200 — a smaller value is clamped up), `opacity`.

### `device`

```json
{ "id": "device", "role": "device", "type": "device",
  "xRatio": 0, "yRatio": 0.24, "hRatio": 0.70,
  "stackId": null, "sourceKey": null,
  "shot": { "zoom": 1, "x": 0.5, "y": 0 },
  "shadow": { "opacity": 0.35, "blur": 0.04, "y": 0.02 } }
```

- `yRatio + hRatio > 1` puts the frame off the bottom; the frame and its shadow also extend past the
  box, so leave headroom. `check` reports `off-canvas`.
- `sourceKey: null` = the slide's own screenshot. `shot` zooms (1–4) and positions inside the cutout.
- `shadow: null` turns the shadow off.
- **`stackId: null`** on a hand-written deck. A preset id makes y/height solved from that preset's
  stack, and the editor re-solves it on its own writes. The CLI doesn't, so a hand-set ratio and a
  stack fight each other.
- Don't write `solved`; the editor owns it.
- Inherits `useFrame`, `frameTint`, `hRatio`, `rotation`; leave them out to let the defaults drive.

### `text`

```json
{ "id": "headline", "role": "headline", "type": "text",
  "xRatio": 0, "yRatio": 0.055, "wRatio": 0.86, "sizeMul": 1.0,
  "text": "Habits that finally stick",
  "lineHeight": 1.08, "letterSpacing": -0.025, "followGap": null }
```

- `role` is `headline` or `subtitle`. Size comes from the **device's** own scale; `sizeMul`
  multiplies it.
- `wRatio` is the column width as a fraction of canvas width; text wraps inside it.
- `text` length: at most 120 characters for a headline, 200 for a subtitle, 400 otherwise.
- **Leave `color`, `fontId`, `align`, `weight`, `rotation` out** on a role-carrying layer, or the
  defaults stop reaching it. Exception: a layer with a `highlight` pill (below).
- Other fields: `textCase` (`none`/`upper`/`lower`), `balance` (boolean), `shadow`
  (`{x,y,blur,color}` in multiples of the font size, or `null`), `opacity` (a new subtitle is 0.78, and contrast
  is measured after blending, so set 1 if a colour falls short).
- **`followGap: null`** on a hand-written deck. A number makes the subtitle track the headline's ink
  bottom, which only the editor recomputes.
- `highlight: { color, padX, padY, radius }` draws a pill behind the glyphs, and contrast is measured
  against the pill. **`color` there is the pill's fill**, so the layer must also set its own text
  `color`: white ink inherited onto a white pill measures 1:1.
- **Keyword colour:** `"text": "Habits that {stick}", "accent": "#ffd23c"` draws each `{…}` run in
  `accent` (hex or `rgb()`/`hsl()`; no named colours). Braces are never drawn or measured, and without
  a valid `accent` they are literal text. Translations keep their own braces; the accent comes from the
  base layer. `check` grades the accent against the same contrast floor (`low-contrast` with
  `run: "accent"`).

### `image`

```json
{ "id": "accent", "type": "image", "role": null,
  "sourceKey": "stickers/objects/fire.svg",
  "xRatio": 0.30, "yRatio": 0.19, "wRatio": 0.16, "hRatio": null, "aspect": 0.8001,
  "rotation": { "x": 0, "y": 0, "z": 12, "depth": 2200 } }
```

- **`role: null`**: presets never move it and the defaults never restyle it.
- `sourceKey` is an upload key or a sticker key, `stickers/<pack>/<id>.svg`. Get it from
  `vitrine search icons|emoji|stickers <query> --json` rather than guessing.
- `aspect` is the source's own width/height; take it from `capabilities.stickers` or `search`, since
  a wrong one distorts the art.
- `hRatio: null` keeps the bitmap's proportions; with a number, `fit` (`contain`/`cover`) applies.
- `tint` (`{ c1: "#rrggbb" }`) only works on a pack that declares slots (icons do; objects and emoji
  don't).
- Image layers have no shadow. For a shadowed detail, use a lens.

### `lens`

A magnified piece of the device's screen, floated beside it: the way to pull out a detail.

```json
{ "id": "lens-1", "type": "lens", "role": null,
  "xRatio": 0.18, "yRatio": 0.40, "wRatio": 0.62, "hRatio": 0.14,
  "target": "device", "area": { "cx": 0.5, "cy": 0.32, "w": 0.6 },
  "radius": 0.16, "border": { "width": 0.003, "color": "#ffffff", "opacity": 0.3 },
  "shadow": { "opacity": 0.35, "blur": 0.08, "y": 0.04 },
  "markSource": true, "dim": 0, "blur": 0, "connector": "none" }
```

- `target` is the device layer's id; a lens whose target is gone draws nothing.
- `area` is the spot to magnify, in fractions of the target's screen.
- `radius` 0.5 makes a pill.
- `markSource` outlines the spot on the device; `dim`/`blur` push back the rest of the screen.
- `connector` is `none`, `line` or `wedge`.
- Presets: `card` · `pill` · `callout` · `spotlight` · `bare`. Apply one with
  `vitrine apply --lens <id> --slide <id> --write` instead of writing the fields.

## The override maps

| Map | Keyed by | May carry | Use it for |
|---|---|---|---|
| `layersByDevice` | `[deviceId][layerId]` | any layer field | geometry that differs per canvas |
| `layersByLocale` | `[locale][layerId]` | localizable keys, plus `from` | translations — the editor writes these; the skill leaves it empty |
| `byDevice` | `[deviceId]` | slide fields: `background`, `safeArea*` | a per-device ground or safe area |
| `shotByDevice` | `[deviceId]` | a `sourceKey` string — not `{sourceKey: …}` | a different screenshot on that device (e.g. a real iPad capture) |

Resolution for one cell: base layer → `layersByDevice` → `layersByLocale` (localizable part) →
project defaults → role defaults. Slide fields: `byDevice` → slide → project default.

## Source keys

Resolve against `--assets` (default: the deck file's own directory). Relative keys
(`shots/home.png`) keep a deck portable. An absolute path works only if it is inside that root;
`../` and anything outside are refused, because `push` uploads whatever resolves.
`uploads/<x>` also resolves to `images/<x>`, matching a copy of a server owner directory.

These prefixes are bundled with Vitrine, not read from your folder or uploaded:
`stickers/…`, `backgrounds/…` and `examples/…`.

`push` uploads every other key the deck names, **including unselected slides**, per-device overrides, image layers and image grounds. Remove what you dropped before pushing.

## Export naming

Tokens `{order}` `{slide}` `{device}` `{kind}` `{locale}`; default `{device}/{order}_{slide}`.
`{device}` is the row's **label** (`iPhone 6.3`), not its id. `{order}` is 1-based and zero-padded,
so slide 10 sorts after slide 2. A template that makes two slides write one file is
refused (exit 2).
