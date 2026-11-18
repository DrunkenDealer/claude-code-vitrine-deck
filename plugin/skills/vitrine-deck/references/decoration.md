# Decoration

`design-rules.md` is the judgement: what a slide may ask of a shopper. This file is the toolkit. It
covers what "designed" is made of, which field renders each part, and how to spend them across a
deck. Use it when a deck is measurably clean but reads flat.

## What the top of the stores ships

Vitrine's layout presets are tuned to a measured sample of App Store and Play top-chart slides
(its `test/storeShape.test.js`). Hit that shape unless the brand argues otherwise:

- **The device is flat.** Median tilt is 0.00°; none of 138 measured product shots is tilted past
  1.5°. Every look ships flat, and so does `defaults.deviceTransform`. Tilt is an occasional,
  deliberate choice, never the default.
- **Caption on top, device filling the rest.** The vertical budget is fully spent. Air goes above the
  composition, never below it. `caption-top` and `thirds` are the measured shapes. The device is about
  0.73–0.77 of canvas height and 0.78–0.81 of its width. The exception worth knowing: about 12 of 16
  award-winning sets (Flighty, Headspace, Things, Strava) let a bigger device run off the bottom
  edge — `bleed` does that (device 0.8–0.95 of height, 8–15% cropped; `check` allows the crop only
  while the preset owns the device). Use it where the screen is the story and the bottom of the UI
  is expendable.
- **Light behind the product.** A radial bloom behind the device, deep at the edges. This is what the
  looks are built on.

A raw, unframed capture is far below that floor and reads as an unfinished listing.

## Start from a look

A look sets the ground, its graded ink, the font, weights, alignment, frame tint, a flat device and
a layout preset in one move. The text column is solved on the real fonts. Read the ids from
`capabilities.looks.entries`; there is one family, `bloom`:

| Look | Layout | Font | Character |
|---|---|---|---|
| `bloom-indigo` (default) | caption-top | sora | the safe default |
| `bloom-emerald` | thirds | manrope | calm, health |
| `bloom-violet-caps` | caption-top | space-grotesk | uppercase display headline |
| `bloom-rose-left` | bold-left | outfit | left-aligned, editorial |
| `bloom-cyan-banner` | lower-banner | dm-sans | device up top, claim beneath |
| `bloom-slate-quiet` | thirds | inter | near-monochrome, titanium frame |

```bash
vitrine init --screenshots shots --out deck.json --device iphone-6.3,android-phone --look bloom-indigo
vitrine apply --deck deck.json --look bloom-emerald --write            # restyle the whole deck
vitrine apply --deck deck.json --layout thirds --slide 03 --write      # one slide's geometry
```

A look gets you to the store's median, not past it. **Pick the look's hue against the screenshots**
(step 4 of the skill), then drift the ground per slide and spend accents as below. If the brand
colour isn't one of the look's hues, keep the look's structure and swap the ground for a bloom in
the brand colour (see *The bloom*).

Themes (`capabilities.themes`) are legacy: a closed list, four of six of them the same mesh. Don't
start from one.

## The ground

| Type | Shape | Reach for it when |
|---|---|---|
| `radial` | `{ x, y, r, stops }` | **the default.** A bloom behind the device lights the product and lets the corners fall away |
| `mesh` | `{ base, blobs: [{c,x,y,r}] }` | the brand has two or three colours that all deserve to appear |
| `linear` | `{ angle, stops }` | a two-colour brand. Take the angle off 180°, because a vertical gradient is the most generic ground there is |
| `solid` | `{ color }` | editorial, premium, confident, **but only when depth comes from somewhere else** |
| `image` | `{ sourceKey, fit, scale, x, y, blur, dim }` | a photo ground, or the app's own screenshot blurred into colour |

Radial and mesh `x`/`y` are **percent** (−50..150), and so is `r` (1..200).

**Presets.** `capabilities.backgrounds.presets` has 66 specs in six groups: dark, vivid, graphic,
swatch, light and neutral. Each preset carries an `ink`, the text colour graded against it. Apply
that ink as `defaults.textColor` along with the ground, unless your own colour already clears the
contrast floor. Nine are blooms (`indigo-bloom`, `emerald-bloom`, `cyan-bloom`, `violet-bloom`,
`fuchsia-bloom`, `rose-bloom`, `amber-bloom`, `slate-bloom`, `bloom`).

**Photo grounds** are addressed as `backgrounds/<id>.webp`. The catalogue, with each photo's ink and
credit, is `assets/backgrounds/index.json` in the Vitrine checkout. They are bundled with the app,
not uploaded.

### The store frames it

A slide always appears inside store chrome that is **white in light mode and near-black in dark**,
and both are common. A near-white ground bleeds into the light listing and a near-black one into the
dark listing. Either way the slide loses its edges, and the gallery reads as one smear rather than
six cards.

**Mid-to-deep grounds hold in both.** If the brand really is white or black, keep the extreme in the
middle and let the outer 6% of the canvas fall to a tone away from it. A bloom does this for free; a
solid needs an edge tone you chose deliberately.

### The bloom

The looks ship this shape:

```json
{ "type": "radial", "x": 50, "y": 44, "r": 100,
  "stops": [["#065f46", 0], ["#065f46", 18], ["#022c22", 72]] }
```

For a brand colour, keep the shape and swap in two stops of the **same hue** at different lightness.
A bloom made of two different hues is a gradient wearing a hat. Put `y` where the device's optical
centre lands rather than at 50. Keep the bright stop dark enough for the ink: white text needs
4.5:1 against the bright stop, and more at the subtitle's 0.78 opacity (see `design-rules.md`).

### Solids, and what they cost

A solid is the fastest way to look either premium or unfinished, and the difference is what else is
on the slide. **A flat colour behind a frame with nothing else is the raw look**: a screenshot on a
rectangle. Spend a solid only alongside the device shadow (`device.shadow`, on by default) and one
accent or a `highlight` pill.

Mid-tone grounds that are safe for white ink, measured against `#ffffff`:

| Ground | Hex | Ratio | Reads as |
|---|---|---|---|
| Forest | `#0f5132` | 9.4:1 | calm, health, outdoors |
| Deep teal | `#0b3b3c` | 12.3:1 | clinical, trustworthy |
| Indigo | `#1e2a5a` | 13.7:1 | focus, night, productivity |
| Aubergine | `#3b1d4e` | 14.3:1 | premium, creative |
| Oxblood | `#5b1a24` | 13.0:1 | editorial, serious |
| Clay | `#7c3a1d` | 8.5:1 | warm, handmade |

All of them clear 8:1, so a subtitle at its default 0.78 opacity still clears 4.5:1 (Clay, the
weakest, lands at 5.9:1).

For a light ground with dark ink `#1f2937`: Bone `#f2ede3` (12.6:1), Sand `#e8dcc8` (10.8:1), Sage
`#cfd9ce` (10.1:1). Bone is close enough to white to dissolve into light-mode chrome, so give it an
edge tone. Light grounds suit a `silver` or `titanium` frame; a black frame on bone reads as heavy.

### A ground from the app itself

An `image` ground whose `sourceKey` is one of the app's own screenshots, blurred past recognition,
gives a ground no palette can, because it is literally the product's colour:

```json
{ "type": "image", "sourceKey": "shots/insights.png", "fit": "cover",
  "scale": 1.6, "x": 50, "y": 40, "blur": 72, "dim": 0.62 }
```

**It only works from a colourful capture.** A light, mostly-white UI blurs and dims to flat grey.
That is worse than any solid, because it looks like a mistake rather than a choice. **`check` cannot
grade contrast on an image ground.** It raises `contrast-unverified` as a warning and never blocks,
so the text there has passed nothing. Use enough `dim`, a text `shadow`, or a `highlight` pill with
its own `color`, and judge it on the 300px strip.

### Making the deck move

`background` is a slide field, so each slide may override it while the project default holds the
family. **Vary energy, never palette.** Drift one parameter across the deck, and the listing reads
as one continuous field as the shopper scrolls:

- `radial`: walk `y` from 38 to 55 and `r` from 100 down to 75, so the light travels.
- `mesh`: move one blob's `x` a consistent 12-15 per slide; leave the base and the colours alone.
- `linear`: hold the stops and rotate `angle` about 8° a slide.

One slide may break the pattern on purpose: a proof slide as a flat solid in the same family reads
as a deliberate beat. Two breaks read as an accident.

**Drift the field; don't build a panorama** (`spanId` across up to three slides). A true panorama
only reads when the slides sit side by side, and they mostly don't. App Store search shows the first
three, Play shows one, and an A/B test or a Play experiment reorders them. Half a picture with no
other half is a bug, not a design. A ground that *evolves* survives every one of those crops.

## The toolkit

Everything here renders. Anything not here doesn't exist: check `capabilities.layers.schema` before
inventing a field.

| Want | Field | Notes |
|---|---|---|
| A pulled-out UI detail | `lens` layer: `target` (the device layer's id), `area {cx, cy, w}`, `wRatio`, `hRatio`, `xRatio`, `yRatio` | `vitrine apply --lens card\|pill\|callout\|spotlight\|bare` styles every lens: radius, border, shadow, `markSource`, `dim`/`blur` on the rest of the screen, and a `connector` (none/line/wedge) |
| Device shadow | `shadow: {opacity, blur, y}` on the device layer | default 0.35 / 0.04 / 0.02, as fractions of mockup height; `null` turns it off |
| Device tilt | `defaults.deviceTransform`: `flat`, `tilt-left`, `tilt-right`, `perspective` or `{x,y,z,depth}`; per layer, `rotation` (`null` inherits) | x/y ±30°, z ±180°, depth 800–5000. Use it rarely, and see *Rotation eats headroom* |
| A zoomed detail in the frame | `shot: {zoom: 1..4, x, y}` on the device layer; `shotByDevice` per slide | zooms inside the frame's cutout |
| Emphasis on the claim | `highlight: {color, padX, padY, radius}` on a text layer | in em of the font size. `color` is the pill fill, so set the layer's `color` too |
| A mark that points at something | `image` layer, `sourceKey: stickers/<pack>/<id>.svg` | **only when the developer asked for stickers.** `objects` are bundled; `icons` and `emoji` are fetched on demand |
| A brand-tinted icon | `stickers/icons/<name>-<weight>.svg` + `tint: {c1: '#…'}` | weights: thin, light, regular, bold, fill, duotone. Only icons have a tint slot |
| Legibility over a busy ground | `shadow` on a text layer | offsets in multiples of the font size |
| Display caps | `textCase: "upper"` on a short headline | never on a subtitle; see `design-rules.md` |
| Bare UI, no frame | `useFrame: false` | only for captures that already carry their own frame |
| Frame finish | `frameTint`: black, silver or titanium | silver/titanium suit light grounds; titanium also works on slate |

**Find ids with `vitrine search`** rather than guessing paths. It returns the exact value to write:

```bash
vitrine search stickers trophy --json   # → stickers/objects/trophy.svg …
vitrine search icons flame --weight fill --json
vitrine search fonts "Inter" --json      # → gf:Inter …
```

The 36 bundled `objects/*` (trophy, medal-gold, crown, fire, rocket, chart-up, check, heart, …) carry
`tags` in `capabilities.stickers.objects`. `render` and `push` fetch on-demand icons and emoji
themselves, and `validate` errors on an id that doesn't exist. **`check` doesn't fetch them**, so
it grades a slide with an uncached sticker as if the sticker weren't there. Look at the render.

## Composing the deck

There are three dials. Set the family once, then vary on a schedule so that no two neighbours look
alike and the set still reads as one deck.

- **Ground.** One family for the whole deck, with one parameter drifting per slide.
- **Frame.** The layout preset and the device's size. It is driven by *where the dead space is in
  that screenshot*, not by a rotation.
- **Accent.** A `highlight` pill or a lens — a sticker only when the developer asked for one. This is the scarce one.

A six-slide deck, as a budget rather than a rule:

| # | Role | Ground | Frame | Accent |
|---|---|---|---|---|
| 1 | Hook | the richest the family has: bloom behind the device | `caption-top`, `bleed` or `big-headline` | a lens, if the promise lives in a detail too small for the thumbnail |
| 2 | Proof | same family, drifted | `thirds` | none |
| 3 | Difference | drifted further | `lower-banner`: device up top, claim beneath | a lens, if the screen has a detail too small for the thumbnail |
| 4 | Feature | the deliberate break: a flat solid in the same family | `big-headline` | `highlight` pill on the claim |
| 5 | Trust | back to the family | `bold-left` | none |
| 6 | Close | the far end of the drift | `caption-top` | none |

**Accents are earned, not quota'd.** One to three per deck: the one pill, a lens where a detail is
too small. What keeps a deck from reading "raw" is the deck-level treatment — the bloom, the drift,
the device shadow — not marks. **Stickers, emoji, icons and objects are opt-in**: add them only when
the developer asks, and then still one per slide, in the margin. When they do, prefer the app's own
art — its mascot, illustrations or 3D objects from the repo's assets — over generic emoji: the award
sets that decorate (Finch, Duolingo, Headspace, CapWords) use their own, and utility apps (Things,
Structured) use none.

These hard limits are not negotiable:

- **Never two accents on one slide.** Only one thing per slide asks for attention.
- **A sticker never covers the device's content area.** That screenshot is the reason the slide
  exists. Keep stickers in the margin, overlapping the frame's edge at most.
- **One `highlight` pill in the whole deck.** It is the loudest thing available, so spend it on the
  single claim the listing rests on.
- **Never two adjacent slides identical in both ground and frame.** That is what makes a deck feel
  like a list.

## Rules that cost something to learn

**A lens must show what the device can't.** Magnifying a stat row that is already legible on screen
reads as a rendering bug, not a design. A lens earns its place when it enlarges a detail too small to
survive the thumbnail, and not otherwise.

**The scorer doesn't catch a sticker over the device.** `overlap` is text-anchored, so art laid
across the screenshot is measured as clean. Keeping the device's content clear is on you.

**The scorer measures painted ink, positioned by `align`.** Bare text is boxed at its widest line,
placed where `align` puts it inside the `wRatio` column. A sticker in the column's empty side doesn't
overlap left-aligned ink. A `highlight` pill counts at the full column width.

**Hand-written geometry leaves `stackId` and `followGap` null.** Presets, looks and the editor link
the device and subtitle to the caption's measured height (`stackId`, `followGap`). A deck edited by
hand that keeps them is solved by rules it can no longer see. When you move a layer yourself, null
both and set the ratios directly, or re-run `vitrine apply --layout`.

**Rotation eats headroom.** A tilted device projects a larger box than `hRatio` describes, so a
geometry that cleared flat can fault `off-canvas` once tilted. Take about 1% off `hRatio`, and
re-run `check` after adding tilt.
