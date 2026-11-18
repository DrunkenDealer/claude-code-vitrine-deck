# Design rules

This file holds enough taste to be useful, and no more. `check` measures the geometry, contrast,
type floor and store copy. This is the part it can't measure: the decisions that make a deck read as
designed rather than assembled.

## The deck

**Slides 1-3 each sell on their own.** Search shows the first three and nothing else, and roughly
nine shoppers in ten never scroll past them (`store-rules.md`). They are not an opening sequence.
Each is a complete pitch to someone who sees only that one, in that order:

| # | Role | The question it answers |
|---|---|---|
| 1 | **Hook** | *what do I get?* The strongest single outcome, broadest appeal, clearest screen |
| 2 | **Proof** | *is it real?* The most convincing screen in the app, doing the thing |
| 3 | **Difference** | *why this one?* What the four competitors above it can't say |

A home screen with no copy is documentation, not an ad. A splash screen, a login screen or title art
is a **rejection**, not a weak slide (Apple 2.3.3). Slide 1 shows the app in use.

**Then a shape, not a list.** Slides 4-5 carry the features that matter most, **one idea per slide**.
A slide holding two features holds neither at 300px. The last one closes the story, with breadth,
the end state, or proof.

**Proof is real or absent.** On the App Store a real award (Apple Design Award, App of the Year,
Editors' Choice), a press quote or a true rating is the strongest slide 2 there is — use it when the
repo or listing shows one, never invent it. Play rejects all of these in the picture, so a deck that
ships to Play rows proves with something factual that isn't from a store: a real usage number, a
privacy guarantee, an integration. "Rated #1 in Health" with no source is a rejection on both.

**One slide in Dark Mode when the app has one.** Apple asks for it by name, and it doubles as the
slide that says the app is maintained.

**Six for Play, eight for the App Store**, and returns diminish past that, because about one shopper
in ten reaches slide 5 at all. Add a slide only when it tells a story none of the others do. Fewer
good slides beat more filler.

**Use every screenshot the developer gives you.** If one genuinely doesn't deserve a slide, such as a
settings screen or an empty state, say so and say why. Don't quietly drop it or dress it up as a
feature.

## Copy

**Headline: 3-6 words, benefit-led.** Write what the user *gets*, never what the screen *is*.

| Instead of | Write |
|---|---|
| Dashboard View | Everything at a glance |
| Settings Screen | Make it yours |
| Search Feature | Find anything instantly |
| Dark Mode Support | Easy on the eyes |
| Statistics | Proof you're getting better |

**Subtitle: 6-12 words** of supporting context. Never restate the headline in longer words. The
subtitle is optional, and a hook slide is often stronger without one.

**The thumbnail enforces these caps whether you do or not:** seven words in a headline, two lines of
text on a slide, one idea. Use sentence case for typed copy. Play asks listings to avoid ALL CAPS,
and `check` flags typed caps. `textCase: "upper"` as a display style on a short headline (the
`bloom-violet-caps` look) isn't caught by the gate, so use it only there, never on a subtitle.

Echo the store keywords where they read naturally, never at the cost of the sentence. Power words
earn their place when they're true: *effortless, instant, beautiful, smart, secure*.

**`vitrine init` writes placeholder copy** ("Your value prop here", "A supporting line"), and it
grades clean. Replace every string.

**Clear the store gate before you fall in love with the copy.** Unsourced superlatives, prices, offers, calls to action and the other store's name are rejections everywhere, and rankings, awards and ratings on Play rows. `check`
enforces them (its `copy` section), but "better than ever" slips past it, so read the copy yourself. Obeying now is cheaper than obeying after the
layout is fitted to the words.

**When a headline won't fit, it's too long.** Cutting a word is always better than shrinking the type.
`polish` agrees: it will not shrink type below the store floor, and reports `copy-too-long`
instead.

## Type size

Every device sizes text off its **short canvas edge**. In portrait, a headline is 6.7% of it and a
subtitle 5.15%. In landscape they are 4.7% and 3.6%. `sizeMul` multiplies that. The device rows in
`capabilities` carry the exact px: iPhone 6.9" is 88/68, iPhone 6.3" is 81/62, and a 1080-wide
Android canvas is 72/56.

The floor that matters is the store thumbnail: 300px wide for portrait, 650px tall for landscape, and
a feature graphic at its own size. **`check` blocks on `small-text`** when a headline lands under
17px or any other text under 12px there, on every device. So these floors are enforced,
and you need them only to choose sizes that won't fault:

| Canvas | Headline `sizeMul` ≥ | Subtitle / other ≥ |
|---|---|---|
| Portrait (phone, tablet) | **0.86** | **0.79** |
| Landscape (TV, phone-landscape) | 0.56 | 0.62 (here `tiny-text` fires first) |
| Feature graphic (1024×500) | 0.24 | 0.34 |

The figure is 0.86, not 0.85, because whole-px rounding puts 0.85 at 16.9px on a 1080 canvas.

Every preset clears those floors. `compact` is 0.92 on both roles in portrait, but it is the tightest,
so use it with a short headline. A look's `sizeMul` multiplies the preset's.

**When `small-text` or `copy-too-long` fires, cut the copy. Don't raise the size back**, or you
restore the overlap that polish was clearing.

**Two font families at most, and three type styles across the whole deck**: display, subtitle, and
at most one caption. Three families on one slide is the most reliable amateur tell there is. The
display face is bold or heavier. A thin face survives the full-size render and dies at 300px, and a
headline that isn't bold stops counting as *large* text for contrast. Weights snap to the family's
real ones: `space-grotesk` and `dm-sans` have only 400/700, so an 800 headline renders at 700.

## Colour and ground

**One ground family for the whole deck.** Consistency is the look. Per-slide colour chaos reads as
low production value even when each slide is fine on its own.

**Choose it against the screenshots, not against the app's name.** A dark app on a light background
looks like a mistake; a ground built from the app's own accent looks deliberate. If the screenshots
are dark navy with indigo highlights, `bloom-indigo` makes the device look like it belongs there.
`decoration.md` has the looks, the 66 presets with their graded ink, and the bloom recipe.

**Rotate the ground's energy, never its tone.** Vary one parameter of one family across the deck so
it reads as a continuous field. Six different palettes read as six unrelated images.

**Contrast is measured, at thumbnail size.** `check` blocks `low-contrast` below **4.5:1**. **3:1** is
allowed only for text that is still large on the thumbnail: at least 24px, or at least 18.66px at
weight 700+. In portrait that means a bold headline at `sizeMul` ≥ 0.93. A subtitle is never large,
so it always needs 4.5:1. **Opacity is blended in before measuring**, and a subtitle defaults to
0.78. White at 0.78 on `#3b5bdb` measures 4.1:1 and fails, even though plain white would pass.
Vet colours at the opacity they'll render at, or set `opacity: 1`.

A `highlight` pill is the cheapest fix when a caption has to sit over something busy. **It is also
the one place you must set `color` on that text layer.** The pill's `color` is the fill, and the
glyphs keep `textColor` unless you say otherwise, so a white pill under white ink measures 1:1.
`polish` never repairs contrast.

Image and raw-CSS grounds raise `contrast-unverified`, a warning that means nothing was graded. Treat
it as unchecked, not as clean.

**The store frames your ground** in white chrome in light mode and near-black in dark. A near-white or
near-black full-bleed ground dissolves into it, and the slide loses its edges for half the people
who see it. `decoration.md` has the mid-tone rule that survives both.

## Layout

**Vary the preset, but let the screenshot decide.** A screen with an empty top third can carry a
headline over it; a dense list can't, and needs the caption clear of the device. Rhythm across the
deck matters less than any single slide reading badly.

**Keep the device big and flat.** It's the thing being sold, and the top of the store doesn't tilt
it. A caption that needs the device shrunk to fit is a caption that needs cutting.

**Let the project defaults reach the layers.** Leave `color`, `fontId`, `align` and `weight` null on
role-carrying layers. Setting them explicitly is how a deck ends up impossible to restyle with
`vitrine apply --look`.

## Accents

Two different things get confused here, and the restraint below applies to only one of them.

**Deck-level treatment belongs on every slide.** That means a ground with depth, a background that
pans across the set, the device shadow, and one frame finish throughout. This is what separates a
designed listing from a framed screenshot. It is uniform by definition, and leaving it off reads as
unfinished, not as restraint.

**Per-slide accents are rationed: only where one points at something, never two on one.**

An accent is a lens or a `highlight` pill — or a `stickers/*` mark, **only when the developer asked
for stickers**. It earns its place when it points at something: a pill on the claim the listing rests
on, a lens on a detail too small for the thumbnail. A pill backs a whole text layer rather than one word inside it,
so give the claim its own short line if you want it stamped.

One to three per deck is the shape, and none is fine when nothing earns one: the deck-level treatment
above is what keeps it from reading raw. One on every slide is a sticker sheet.

**A sticker never covers the device's content area**, and the scorer won't catch it if one does.

## Other languages

The skill builds the English deck only. Vitrine's editor translates it after the push, so name the
languages the repo ships in the report rather than building them.

## What "good" looks like when you check your own work

Look at the rendered PNGs, **tiled at 300px wide**, which is the size a shopper actually meets them
at.

- Does slide 1 make a claim, or just show a screen?
- **Hide slides 2 and 3: does slide 1 still sell? Then hide 1 and 3, and then 1 and 2.** Each of the
  first three meets someone alone.
- **At 300px, can you read every headline and every subtitle?** If you're squinting, so is the
  shopper.
- Does the app look *used* (data, streaks, history), or does it look like a fresh install?
- Do the slides look like one set, or six unrelated images?
- Is the device the biggest thing on every slide?
- Is there at most one thing per slide asking for attention, and does each accent point at something?
- Does any slide have the same ground *and* the same layout as the one before it?
- Did every accent you placed actually appear?
- Does anything appear twice on one slide, such as a stat on the device and in a lens beside it?
- Is any last line a single orphaned word? That's the copy asking to be a few characters shorter.
- Does any `contrast-unverified` slide actually read?
