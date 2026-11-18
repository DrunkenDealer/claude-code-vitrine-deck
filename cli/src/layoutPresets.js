// Layout templates that change position + alignment + size only. Each one is
// pre-validated to keep text and device from overlapping at the default device
// height. Backgrounds, fonts, weights, and colors are intentionally left alone
// so brand stays consistent across a deck.
//
// A preset addresses layers by *role*, so it repositions the headline, subtitle
// and device and leaves every layer the user added exactly where they put it.
//
// `portrait` covers phone and tablet; `landscape` is the TV variant. Text is
// sized off the canvas's short edge (src/devices.js), which on a 1920×1080 TV
// *is* the height — so a headline eats ~0.047 of the canvas height there versus
// ~0.031 in portrait. Every landscape caption band is therefore taller in ratio
// terms, with device height giving way to keep deviceY + deviceHeight ≈ 0.99.
//
// A preset may also carry a block named for a *kind*, which wins over both. Only
// `phone-landscape` needs one so far; see the note on it below.
//
// Every `portrait` block's proportions — the headline-to-subtitle gap, the air
// above the device, the device's height and width — are set from a measured
// sample of the App Store and Play top charts rather than by hand.
// test/storeShape.test.js carries the corpus, the numbers and the bounds, and
// is what fails if one of these drifts back out of that range. The `landscape`
// and `phone-landscape` blocks are **not** measured that way: store listings
// for a TV app are rare enough that there was no sample to take, so those keep
// their hand-tuned geometry and only inherit the type-scale change.

import { CAPTION_GAP } from "./captionFlow.js";
import { CAPTION_TO_DEVICE } from "./layoutStack.js";
import { DEFAULT_TEXT_WRATIO } from "./geometry.js";

export const PRESETS = [
  {
    id: "hero",
    label: "Hero",
    textAlign: "center",
    portrait: {
      headline: { xRatio: 0, yRatio: 0.04, sizeMul: 1.0 },
      subtitle: { xRatio: 0, yRatio: 0.108, sizeMul: 1.0, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.192, hRatio: 0.79 },
    },
    // Matches the landscape defaults so a fresh TV slide already reads as Hero.
    landscape: {
      headline: { xRatio: 0, yRatio: 0.05, sizeMul: 1.0 },
      subtitle: { xRatio: 0, yRatio: 0.155, sizeMul: 1.0, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.27, hRatio: 0.72 },
    },
    // A landscape phone is a 2.1:1 slab, where a TV with its stand is 1.54:1, so
    // at the TV's height ratio the phone came out 87% of the width of the 16:9
    // canvas Play takes — nearly edge to edge. Hence a block of its own, with the
    // device shorter and re-centred in the band the caption leaves it.
    //
    // One ratio has to serve two canvases: a phone-landscape slide renders on
    // both 2868×1320 and 1920×1080, and a layer holds one hRatio. So this splits
    // the difference — 75% of the width on the squarer canvas, 60% on the wider
    // one. Sizing it for either alone leaves the other visibly wrong, and the
    // only exact fix is a per-device override, which is the user's to make.
    "phone-landscape": {
      headline: { xRatio: 0, yRatio: 0.05, sizeMul: 1.0 },
      subtitle: { xRatio: 0, yRatio: 0.155, sizeMul: 1.0, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.32, hRatio: 0.62 },
    },
  },
  {
    id: "lower-banner",
    label: "Lower banner",
    textAlign: "center",
    portrait: {
      headline: { xRatio: 0, yRatio: 0.72, sizeMul: 1.1 },
      subtitle: { xRatio: 0, yRatio: 0.832, sizeMul: 1.1, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.03, hRatio: 0.645 },
    },
    // Caption band sits centred in the space the device leaves below it, with
    // the headline→subtitle gap still clearing a two-line headline.
    landscape: {
      headline: { xRatio: 0, yRatio: 0.74, sizeMul: 1.1 },
      subtitle: { xRatio: 0, yRatio: 0.85, sizeMul: 0.95, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.02, hRatio: 0.62 },
    },
    "phone-landscape": {
      headline: { xRatio: 0, yRatio: 0.74, sizeMul: 1.1 },
      subtitle: { xRatio: 0, yRatio: 0.85, sizeMul: 0.95, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.065, hRatio: 0.53 },
    },
  },
  {
    id: "big-headline",
    label: "Big headline",
    textAlign: "center",
    portrait: {
      headline: { xRatio: 0, yRatio: 0.05, sizeMul: 1.35 },
      subtitle: { xRatio: 0, yRatio: 0.162, sizeMul: 1.35, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.298, hRatio: 0.685 },
    },
    landscape: {
      headline: { xRatio: 0, yRatio: 0.06, sizeMul: 1.35 },
      subtitle: { xRatio: 0, yRatio: 0.21, sizeMul: 1.05, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.35, hRatio: 0.64 },
    },
    "phone-landscape": {
      headline: { xRatio: 0, yRatio: 0.06, sizeMul: 1.35 },
      subtitle: { xRatio: 0, yRatio: 0.21, sizeMul: 1.05, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.395, hRatio: 0.55 },
    },
  },
  {
    id: "compact",
    label: "Compact",
    textAlign: "center",
    portrait: {
      headline: { xRatio: 0, yRatio: 0.02, sizeMul: 0.92 },
      subtitle: { xRatio: 0, yRatio: 0.087, sizeMul: 0.92, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.163, hRatio: 0.825 },
    },
    // 0.05, not 0.03: TV title-safe is 5% per axis (defaultSafeAreaFor), and
    // anything higher would sit outside the safe-area guide.
    landscape: {
      headline: { xRatio: 0, yRatio: 0.05, sizeMul: 0.8 },
      subtitle: { xRatio: 0, yRatio: 0.14, sizeMul: 0.8, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.24, hRatio: 0.75 },
    },
    "phone-landscape": {
      headline: { xRatio: 0, yRatio: 0.05, sizeMul: 0.8 },
      subtitle: { xRatio: 0, yRatio: 0.14, sizeMul: 0.8, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.3, hRatio: 0.63 },
    },
  },
  {
    id: "bold-left",
    label: "Bold left",
    textAlign: "left",
    portrait: {
      headline: { xRatio: 0, yRatio: 0.04, sizeMul: 1.2 },
      subtitle: { xRatio: 0, yRatio: 0.164, sizeMul: 1.2, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.254, hRatio: 0.73 },
    },
    landscape: {
      headline: { xRatio: 0, yRatio: 0.05, sizeMul: 1.2 },
      subtitle: { xRatio: 0, yRatio: 0.175, sizeMul: 1.1, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.31, hRatio: 0.68 },
    },
    "phone-landscape": {
      headline: { xRatio: 0, yRatio: 0.05, sizeMul: 1.2 },
      subtitle: { xRatio: 0, yRatio: 0.175, sizeMul: 1.1, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.355, hRatio: 0.59 },
    },
  },
];

// ---------------------------------------------------------------------------
// The two tight presets, added for the Look library.
//
// These exist because the five above are all *top-caption* layouts and, as
// shipped, they were all variations on one arrangement. What separates these
// two is structure: `caption-top` runs the claim and its line as one block with
// the product immediately under, and `thirds` splits the caption to the two
// ends of the canvas with the product between them.
//
// Both come off published store-screenshot guidance rather than taste:
//
//   * a listing reads as **three bands** — claim, product, supporting line — and
//     the bands are meant to be adjacent.
//   * the claim wants **60-90px on a ~1290px-wide canvas at weight 700-900**,
//     which is where the raised `sizeMul` lands it, because only the headline is
//     legible at the ~120px width a search result is skimmed at.
//   * a line is capped near **25 characters**, which makes the wrap predictable,
//     so the block is reliably two lines and the geometry beneath it can be
//     tight.
//
// The "generous air" problem this pair was added to dodge is gone from the
// originals too: every preset's proportions are now set from the measured top
// charts rather than by hand, and test/storeShape.test.js is the gate. What was
// wrong is worth recording, because nothing in the codebase could see it —
// `hero` left ~10% of canvas height between the subtitle and the device and
// `big-headline` ~16%, while layoutScore's BIG_GAP term starts counting at 25%
// of the canvas and is weighted below the apply margin, so it could neither
// fire alone nor notice a sixth of a screenshot doing nothing.
//
// test/looks.test.js holds both to a dead-band ceiling and a thumbnail type
// floor, and the sweep at the bottom of test/layoutScore.test.js holds them to
// the same clean-on-every-device bar as the originals.
const TIGHT_PRESETS = [
  {
    id: "caption-top",
    label: "Caption top",
    textAlign: "center",
    portrait: {
      headline: { xRatio: 0, yRatio: 0.045, sizeMul: 1.34 },
      subtitle: { xRatio: 0, yRatio: 0.156, sizeMul: 1.27, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.243, hRatio: 0.74 },
    },
    // A landscape caption band is taller in ratio terms because text is sized
    // off the canvas's short edge, which here is the height — same reason every
    // landscape block in the presets above gives up device height.
    landscape: {
      headline: { xRatio: 0, yRatio: 0.06, sizeMul: 1.2 },
      subtitle: { xRatio: 0, yRatio: 0.235, sizeMul: 1.1, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.33, hRatio: 0.63 },
    },
    "phone-landscape": {
      headline: { xRatio: 0, yRatio: 0.06, sizeMul: 1.2 },
      subtitle: { xRatio: 0, yRatio: 0.235, sizeMul: 1.1, followGap: CAPTION_GAP },
      device: { xRatio: 0, yRatio: 0.35, hRatio: 0.58 },
    },
  },
  {
    id: "thirds",
    label: "Thirds",
    textAlign: "center",
    portrait: {
      headline: { xRatio: 0, yRatio: 0.05, sizeMul: 1.42 },
      subtitle: { xRatio: 0, yRatio: 0.845, sizeMul: 1.3 },
      device: { xRatio: 0, yRatio: 0.15, hRatio: 0.66 },
    },
    landscape: {
      headline: { xRatio: 0, yRatio: 0.06, sizeMul: 1.25 },
      subtitle: { xRatio: 0, yRatio: 0.845, sizeMul: 1.1 },
      device: { xRatio: 0, yRatio: 0.24, hRatio: 0.53 },
    },
    "phone-landscape": {
      headline: { xRatio: 0, yRatio: 0.06, sizeMul: 1.25 },
      subtitle: { xRatio: 0, yRatio: 0.845, sizeMul: 1.1 },
      device: { xRatio: 0, yRatio: 0.26, hRatio: 0.49 },
    },
  },
];

PRESETS.push(...TIGHT_PRESETS);

// The device off the bottom edge. Every preset above shows the whole phone; about
// 12 of 16 award-winning sets (Flighty, Headspace, Things, Strava…) instead put
// the caption on top and crop the bottom 8-15% of a phone 0.88-0.95 of the
// canvas tall, which shows the screen bigger than a whole phone can. Only the
// portrait stack bleeds (src/layoutStack.js BLEED); landscape kinds have no stack
// to scope the scorer's allowance to, so they keep a whole device.
PRESETS.push({
  id: "bleed",
  label: "Bleed",
  textAlign: "center",
  portrait: {
    headline: { xRatio: 0, yRatio: 0.045, sizeMul: 1.1 },
    subtitle: { xRatio: 0, yRatio: 0.12, sizeMul: 1.1, followGap: CAPTION_GAP },
    device: { xRatio: 0, yRatio: 0.22, hRatio: 0.82 },
  },
  landscape: {
    headline: { xRatio: 0, yRatio: 0.05, sizeMul: 1.1 },
    subtitle: { xRatio: 0, yRatio: 0.16, sizeMul: 1.0, followGap: CAPTION_GAP },
    device: { xRatio: 0, yRatio: 0.255, hRatio: 0.735 },
  },
  "phone-landscape": {
    headline: { xRatio: 0, yRatio: 0.05, sizeMul: 1.1 },
    subtitle: { xRatio: 0, yRatio: 0.16, sizeMul: 1.0, followGap: CAPTION_GAP },
    device: { xRatio: 0, yRatio: 0.3, hRatio: 0.66 },
  },
});

// ---------------------------------------------------------------------------
// The vertical stacks.
//
// The `portrait` blocks above hold each preset's geometry as four absolute
// ratios. Those are the **seed**: they are what a fresh slide and a stamped
// preset start from, what `landscape` and `phone-landscape` still use, and what
// a host with no way to measure text falls back to. What they cannot express is
// the relationship *between* the four, so whatever they failed to spend piled up
// at the bottom of the canvas — 0.192 of it under `lower-banner`.
//
// A stack says how the height is divided instead, and src/layoutStack.js solves
// it on the write path. The seed and the solved result agree to within a few
// thousandths on a one-line headline (test/layoutStack.test.js pins that, so the
// two cannot drift apart); everything past one line is where they diverge, and
// where the stack is the one that stays correct.
//
// Only `portrait` has one. Store listings for a TV app are rare enough that
// there was no sample to measure, so the landscape blocks keep their hand-tuned
// geometry — see the header of this file.
// ---------------------------------------------------------------------------

// The air under the last band of an adjacent-caption layout.
//
// One number for all six rather than the 0.012-0.018 spread the hand-tuned
// ratios happened to leave, because in a stack this term *means* something: it
// is the only thing standing between the product shot and the canvas edge. The
// market puts 0.000 there at the median (p75 0.044), so this is deliberately
// near the bottom of that range and the same on every preset.
const EDGE_BOTTOM = 0.018;
// A split layout's trailing band carries the supporting line, so it is measured
// against the market's split family instead: 0.030-0.053 median across the two
// stores.
const EDGE_BOTTOM_SPLIT = 0.035;

// A caption above the product shot, which is six of the seven. The leading edge
// is each preset's own — it is the one term that distinguishes them, along with
// the type scale — and everything below it follows from the measurement.
const captionAbove = (edge) => ({
  device: "adjacent",
  bands: [
    { edge },
    { layer: "headline" },
    { gap: CAPTION_GAP },
    { layer: "subtitle" },
    { gap: CAPTION_TO_DEVICE },
    { layer: "device", grow: true },
    { edge: EDGE_BOTTOM },
  ],
});

const PORTRAIT_STACKS = {
  hero: captionAbove(0.04),
  "big-headline": captionAbove(0.05),
  compact: captionAbove(0.02),
  "bold-left": captionAbove(0.04),
  "caption-top": captionAbove(0.045),

  // Inverted: the product shot on top, the caption beneath it. The device is the
  // growing band either way, so the solve is the same one read in the other
  // direction — which is the whole reason the stack is an ordered list rather
  // than a set of named margins.
  "lower-banner": {
    device: "adjacent",
    bands: [
      { edge: 0.03 },
      { layer: "device", grow: true },
      // Wider than CAPTION_TO_DEVICE because this gap is doing the opposite job:
      // above the device it groups the caption with the product, below it the
      // caption is the last thing on the slide and needs to clear the shadow.
      { gap: 0.045 },
      { layer: "headline" },
      { gap: CAPTION_GAP },
      { layer: "subtitle" },
      { edge: EDGE_BOTTOM_SPLIT },
    ],
  },

  // Split: the claim at the top, the product between, the supporting line at the
  // bottom. Both gaps come from the market's split family (top 0.018-0.038,
  // bottom 0.022-0.048), and the device takes the DEVICE_BANDS.split clamp
  // because two captions genuinely leave it less room.
  // No trailing edge: the device runs off the bottom (layoutStack.js solveBleed).
  bleed: {
    device: "bleed",
    bands: [
      { edge: 0.045 },
      { layer: "headline" },
      { gap: CAPTION_GAP },
      { layer: "subtitle" },
      { gap: CAPTION_TO_DEVICE },
      { layer: "device", grow: true },
    ],
  },

  thirds: {
    device: "split",
    bands: [
      { edge: 0.05 },
      { layer: "headline" },
      { gap: 0.03 },
      { layer: "device", grow: true },
      { gap: 0.04 },
      { layer: "subtitle" },
      { edge: EDGE_BOTTOM_SPLIT },
    ],
  },
};

/**
 * The stack governing a preset on one orientation, or null when that
 * orientation has none and the absolute seed is all there is.
 */
export function stackFor(presetId, orientation, kind = null) {
  if (orientation === "landscape" || (kind && kind !== "phone" && kind !== "tablet")) return null;
  // Own property only: a hand-written stackId of "constructor" came back as Object.
  return Object.hasOwn(PORTRAIT_STACKS, presetId) ? PORTRAIT_STACKS[presetId] : null;
}

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) ?? FEATURE_GRAPHIC_PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

// Where an App Store banner's two lines start, as yRatio, and how wide they run.
// The banners centre the pair in Apple's art safe area (devices.js `artSafe`) and
// keep it as narrow as that box, since everything outside it is cropped on some
// device. Both kinds used to fall through to the TV `landscape` block, which is
// built around a device (headline at 0.05, above the box), so a preset or look on
// a banner stamped that and only a fresh slide was inside the box.
export const BANNER_CAPTION = {
  "page-header": { headline: 0.41, subtitle: 0.52, wRatio: 0.42 },
  "search-result": { headline: 0.42, subtitle: 0.51, wRatio: 0.56 },
};

// A preset keeps its own type scale (and, in presetPatchFor, alignment) on a
// banner; position and column are the banner's. No `device` entry: a banner has
// no device, and a hand-added one is never moved.
function bannerGeometry(preset, kind) {
  const B = BANNER_CAPTION[kind];
  const { headline, subtitle } = preset.landscape;
  return {
    headline: { xRatio: 0, yRatio: B.headline, wRatio: B.wRatio, sizeMul: headline.sizeMul },
    subtitle: { xRatio: 0, yRatio: B.subtitle, wRatio: B.wRatio, sizeMul: subtitle.sizeMul, followGap: CAPTION_GAP },
  };
}

// The Play feature graphic (1024×500): a banner with no device, built after
// Google's guidance and a sample of live listings — a brand mark, a name or a
// tagline of five words at most, optional key art, the focal content central
// and inside the edges Play crops, and the centre left clear for the promo
// video's play button wherever the layout allows it.
//
// `icon` and `art` are image roles (src/layers.js IMAGE_ROLES): a preset places
// them as it places the caption, and a layout without one leaves that layer where
// it is. Type runs at 0.8 so a five-word line fits the column on one line.
const FG = "feature-graphic";

// Text only: a fresh slide, and any device preset applied to one. The pair is
// centred on a one-line headline; the line follows it, so a wrap pushes it down.
const FEATURE_GRAPHIC_CAPTION = {
  headline: { xRatio: 0, yRatio: 0.365, wRatio: DEFAULT_TEXT_WRATIO, sizeMul: 1 },
  subtitle: { xRatio: 0, yRatio: 0.54, wRatio: DEFAULT_TEXT_WRATIO, sizeMul: 1, followGap: CAPTION_GAP },
};

export const FEATURE_GRAPHIC_PRESETS = [
  {
    id: "fg-icon-left",
    label: "Icon left",
    textAlign: "left",
    // The classic lockup. The caption crosses the centre, so it suits a listing
    // with no promo video.
    [FG]: {
      icon: { xRatio: -0.3, yRatio: 0.33, wRatio: 0.16, hRatio: null },
      headline: { xRatio: 0.12, yRatio: 0.385, wRatio: 0.6, sizeMul: 0.8 },
      subtitle: { xRatio: 0.12, yRatio: 0.53, wRatio: 0.6, sizeMul: 0.8, followGap: CAPTION_GAP },
    },
  },
  {
    id: "fg-centered",
    label: "Mark over tagline",
    textAlign: "center",
    // The mark above the play button, the tagline below it — the band between
    // only as tall as the button, or mark and name read as two things.
    [FG]: {
      icon: { xRatio: 0, yRatio: 0.15, wRatio: 0.13, hRatio: null },
      headline: { xRatio: 0, yRatio: 0.59, wRatio: DEFAULT_TEXT_WRATIO, sizeMul: 0.8 },
      subtitle: { xRatio: 0, yRatio: 0.76, wRatio: DEFAULT_TEXT_WRATIO, sizeMul: 0.8, followGap: CAPTION_GAP },
    },
  },
  {
    id: "fg-art-right",
    label: "Art right",
    textAlign: "left",
    // Mark and tagline in the left half, key art in the right, the centre between.
    // The column is narrow, so the headline is seeded for two lines.
    [FG]: {
      icon: { xRatio: -0.38, yRatio: 0.12, wRatio: 0.08, hRatio: null },
      headline: { xRatio: -0.23, yRatio: 0.33, wRatio: 0.42, sizeMul: 0.8 },
      subtitle: { xRatio: -0.23, yRatio: 0.6, wRatio: 0.42, sizeMul: 0.8, followGap: CAPTION_GAP },
      art: { xRatio: 0.24, yRatio: 0.1, wRatio: 0.4, hRatio: 0.8 },
    },
  },
];

// The presets a slide of this kind offers.
export const presetsFor = (kind) => (kind === FG ? FEATURE_GRAPHIC_PRESETS : PRESETS);

// Portrait kinds use `portrait`; TV uses the hand-tuned landscape variant.
// Without this a preset would stamp portrait ratios onto a 1920×1080 canvas and
// collapse the caption onto the device.
//
// A kind may override the pair — `phone-landscape` does, because it is the one
// landscape kind whose device is far longer than the canvas it sits on. A kind
// with no block of its own falls through to its orientation, so adding one is
// additive and a caller that has no kind to give still resolves.
//
// A device preset on the feature graphic lands on its text-only caption, and a
// feature-graphic preset on any other kind places nothing.
export function presetGeometryFor(preset, orientation, kind = null) {
  if (preset[kind]) return preset[kind];
  if (BANNER_CAPTION[kind]) return bannerGeometry(preset, kind);
  if (kind === FG) return FEATURE_GRAPHIC_CAPTION;
  return (orientation === "landscape" ? preset.landscape : preset.portrait) ?? {};
}

// Which preset a slide's layers look like, or null. On a stacked kind the
// device's `stackId` is the answer: the solver rewrites the device's y and
// height from the seed (0.192/0.79 solved to something else once the caption's
// real height is in), so comparing against the seed matched only the preset
// that happened to solve back onto it and Shuffle bounced between two. Where no
// stack governs (TV, phone-landscape, a device dragged out of its stack) the
// absolute seed is the whole truth and is compared directly.
export function detectPresetId(layers, orientation, kind = null) {
  const device = layers.find((l) => l.role === "device");
  const headline = layers.find((l) => l.role === "headline");
  // The feature graphic's layouts differ in their headline's column; its y is a seed.
  if (kind === FG) {
    const same = (g) => g && headline && ["xRatio", "yRatio", "wRatio"].every((k) => Math.abs(headline[k] - g[k]) < 0.01);
    return FEATURE_GRAPHIC_PRESETS.find((p) => same(p[FG].headline))?.id ?? null;
  }
  if (!device) return null;
  if (device.stackId && stackFor(device.stackId, orientation, kind)) return device.stackId;
  for (const p of PRESETS) {
    const g = presetGeometryFor(p, orientation, kind);
    if (
      Math.abs(device.yRatio - g.device.yRatio) < 0.01 &&
      Math.abs(device.hRatio - g.device.hRatio) < 0.01 &&
      Math.abs((headline?.sizeMul ?? 1) - g.headline.sizeMul) < 0.02
    ) {
      return p.id;
    }
  }
  return null;
}

// The patch a preset applies to one layer, or null if the preset says nothing
// about it — which is every layer the user added.
export function presetPatchFor(preset, layer, orientation, kind = null) {
  if (!layer.role) return null;
  const g = presetGeometryFor(preset, orientation, kind)[layer.role];
  if (!g) return null;
  if (layer.type !== "text") {
    // `stackId` is emitted unconditionally, for the same reason `followGap` is
    // below: a preset with no stack has to *mean* "this device is placed
    // absolutely", or stamping a landscape preset over a portrait one would
    // leave the portrait stack governing a device it no longer describes.
    const stackId = layer.type === "device"
      ? { stackId: stackFor(preset.id, orientation, kind) ? preset.id : null, stackLead: null }
      : {};
    return { ...g, ...stackId };
  }
  // `followGap` is emitted even when the block is silent about it, because a
  // preset saying nothing has to *mean* "this layer does not follow" — a patch
  // that omits the key would leave the previous preset's value on the layer, so
  // stamping `thirds` over `hero` would keep dragging the bottom line up under
  // the headline. Same reason every other key here is unconditional.
  const flow = layer.role === "subtitle" ? { followGap: g.followGap ?? null } : {};
  return { ...g, ...flow, align: preset.textAlign };
}

// Round-robin a preset for a slide given its 0-based index within a sequence.
export function presetForIndex(i, kind = null) {
  const list = presetsFor(kind);
  return list[((i % list.length) + list.length) % list.length];
}
