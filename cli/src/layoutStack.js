// The vertical budget of a slide, allocated rather than assigned.
//
// A preset used to hold four independent absolute ratios — a headline yRatio, a
// subtitle yRatio, a device yRatio and a device hRatio — so the relationships
// between them were implicit, and whatever the arithmetic failed to spend piled
// up wherever it happened to land. Measured on the 6.9" canvas with a one-line
// headline, that was 0.192 of the canvas height dead at the bottom of
// `lower-banner`, 0.075 under `thirds`, and 0.082 of empty band between the
// caption and the device in `bold-left`. At a three-line headline `caption-top`
// left **0.634** of the canvas in a single empty band, and scoreLayout said
// nothing, because BIG_GAP did not start counting until 0.25.
//
// The stores do not have this problem, and the reason is a law rather than a
// knack. Across 166 portrait top-chart slides:
//
//   topMargin + caption + gap + deviceHeight  =  1.000 median
//                                                p25 0.965, p05 0.934
//   68% of slides claim >= 0.98 of the canvas height.
//   60-64% run the device off the bottom edge entirely.
//
// The budget is fully spent. And what little slack there is sits at the top, not
// the bottom: the band at the top edge is 0.055 median, the band at the bottom
// edge is **0.000** median (p75 0.044, p90 0.066, p95 0.102). Which is what
// optical centering predicts — the optical centre of a frame is about 46% down,
// so mass belongs slightly high and residue belongs underneath it.
//
// So a preset declares a **stack** instead: an ordered list of bands, each one
// either fixed (`edge`, `gap`), measured (`layer`, whose height is its text's
// ink) or growing (`grow`, which takes what is left). Solving it gives every
// participating layer its yRatio and the growing layer its hRatio, and by
// construction there is nothing left over. It is a flexbox column, and the
// analogy is exact enough to be useful: `edge`/`gap` are fixed-basis items,
// `layer` is content-sized, `grow` is `flex-grow: 1`.
//
// The corpus is described in test/storeShape.test.js. Everything here is a ratio
// of canvas **height**, which is not arbitrary: across aspect 1.78 -> 2.17 the
// top margin holds at 0.0577 -> 0.0589 of H (2% apart) but swings 0.1026 ->
// 0.1275 against the short edge (24% apart). Height is the stable unit for
// vertical spacing, and it is the one the rest of the repo already uses.
//
// Like src/captionFlow.js — whose headline-to-subtitle gap this reuses rather
// than restating — it is resolved on the **write** path. `resolveLayers` stays a
// pure merge and the solved numbers are stored, so the preview, the render
// payload, the hash and the scorer cannot disagree. Solving on the read path
// would make a layer's position depend on which host measured it: the editor
// passes a real browser measurer, the CLI falls back to the glyph estimator, and
// the two disagree about a wrap often enough to move a band a whole line between
// the picture you approved and the PNG you shipped.
import { textInkBox } from "./textMetrics.js";
import { CAPTION_GAP } from "./captionFlow.js";

export { CAPTION_GAP };

// Caption to device.
//
// **Not** the market median, and the departure is deliberate. The market's gap
// is 0.043-0.060 median (p10 0.020, p25 0.028-0.038), and 0.057-0.082 is exactly
// what the shipped presets already measured at — the band that reads as too much
// air. The market median puts the gap at ~0.9x the top margin, which makes the
// caption a free-standing band equidistant from the canvas edge and the phone;
// at 0.022 against a 0.040 margin the gap is visibly the smaller of the two, so
// the caption reads as a label *on* the product shot. That is what the proximity
// principle actually asks for, and it is the shape picked out of the look library
// as the one that worked. It sits at the market p10, not off the end of it.
export const CAPTION_TO_DEVICE = 0.022;

// How tall the growing band may be, as a ratio of canvas height.
//
// Per shape, not global. A split layout puts the device *between* two captions,
// so two bands eat the budget and the market's own device is genuinely smaller
// there: 0.515-0.615 median against 0.739-0.769 for an adjacent caption. One
// band for both would either starve the common case or let a split layout
// overrun.
export const DEVICE_BANDS = {
  // p10 0.593 .. p90 0.825, widened to the round numbers test/storeShape.test.js
  // already gates on.
  adjacent: { min: 0.62, max: 0.87 },
  // p25 0.305 .. p90 0.751 across both stores. The floor is well below anything
  // a preset asks for and is there to stop an oversubscribed budget inverting;
  // the ceiling is the p90, because a one-line caption at either end leaves
  // `thirds` more height than a split layout's device should take — 0.70 left
  // 0.092 of it stranded at the bottom, which is the fault this file exists to
  // remove.
  split: { min: 0.45, max: 0.75 },
  // The device runs off the bottom edge (BLEED below): 0.88-0.95 of the canvas
  // in the award-winning sets, though BLEED.width binds first on most canvases.
  bleed: { min: 0.62, max: 0.95 },
};

// A bleed device is cropped by the canvas's bottom edge on purpose: about 12 of
// 16 award-winning sets (Flighty, Headspace, Things, Strava…) put the caption on
// top and cut 8-15% off the bottom of a phone 0.88-0.95 of the canvas tall,
// which shows the screen bigger than any whole-phone layout can. Crops are
// fractions of the device's own height; `width` caps the device at that share
// of the canvas width, since on a 19.5:9 canvas the frame's width binds before
// its height does. `max` is how much layoutScore lets run off the bottom.
export const BLEED = { min: 0.08, target: 0.12, max: 0.15, width: 0.92 };

// Width / height of every portrait frame, so the solver can hold a bleed device
// inside BLEED.width without frame metadata (the editor loads that async).
// test/layoutStack.test.js pins these to assets/frames.
export const PORTRAIT_FRAME_ASPECT = {
  "iphone-6.9-black": 1420 / 2980,
  "pixel-10": 1164 / 2508,
  "ipad-3-4-black": 2190 / 2878,
  "ipad-11-black": 1790 / 2542,
  "android-tablet-black": 1724 / 2684,
  "iphone-duo-outer": 1598 / 2234,
  "iphone-duo-inner": 2078 / 2870,
};

// scoreLayout's TIGHT_MARGIN floor, in canvas-short-edge units. Duplicated
// rather than imported because layoutScore.js imports geometry and metrics and
// this has to stay a leaf that src/layoutPresets.js can reach; the two are
// pinned together by test/layoutStack.test.js.
const MARGIN_FLOOR = 0.03;

const canvasOf = (device) => ({
  W: device?.canvasWidth ?? device?.width,
  H: device?.canvasHeight ?? device?.height,
});

const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * Solve one stack against one slide on one canvas.
 *
 * `layers` must be **resolved** — a role layer leaves `fontId` and `weight` null
 * so a theme can restyle it (`INHERITED_KEYS`), and a null font cannot be
 * measured, so solving before `fillInherited` would size every headline in the
 * fallback face.
 *
 * Returns `{ byRole, deviceHRatio, over }`, or null when it cannot be solved —
 * no canvas, no stack, or a band naming a layer that exists and cannot be
 * measured. Null means "leave everything alone", never a guess.
 *
 * `aspects` is every canvas the solved numbers will be read on, as H/shortEdge.
 * It defaults to the measuring canvas alone, and callers leave it so: every
 * column is read only on the canvas it is solved on (each other canvas stores its
 * own), so unticking another device must not move this one (N815).
 *
 * `over` is how far the stack ran past the canvas because the growing band hit
 * its floor. It is reported rather than absorbed: no band is allowed to go
 * negative to hide an oversubscribed budget, because that quietly pushes the
 * device off the bottom edge instead of leaving the overlap that scoreLayout
 * reports and `fitTextScale` repairs by shrinking the type. The floor is a
 * signal, not a failure mode.
 */
export function solveStack(stack, layers, { device, measurer = null, aspects = null }) {
  if (!Array.isArray(stack?.bands) || !stack.bands.length) return null;
  const { W, H } = canvasOf(device);
  if (!Number.isFinite(W) || !Number.isFinite(H)) return null;

  const band = DEVICE_BANDS[stack.device ?? "adjacent"];
  if (!band) return null;

  // An outer margin is checked by scoreLayout in short-edge units, so a band
  // authored against H must not fall under that floor on a squarer canvas —
  // otherwise the solver writes slides its own grader faults. `compact` does
  // exactly that today on every iPad: its 0.020 top edge is 55px of a 2752
  // canvas against a 62px floor on the 2064 short edge.
  //
  // Taken over every canvas the answer will be read on, not just the one being
  // measured. The floor is MARGIN_FLOOR / aspect, so the *squarest* canvas binds
  // — which is the one the measuring canvas is least likely to be, since a
  // slide is measured on its own kind's device and read on the tablet rows too.
  const own = H / Math.min(W, H);
  const edgeFloor = MARGIN_FLOOR / Math.min(own, ...(aspects?.length ? aspects : [own]));

  // Measure every content band first: the budget cannot be divided until the
  // text has said how much of it it wants.
  const measured = new Map();
  for (const b of stack.bands) {
    // A growing band takes what is left; it is not measured, and running
    // textInkBox over the device layer asks the measurer for a null font — which
    // it correctly refuses, and then reports the whole run as guessed.
    if (!b.layer || b.grow) continue;
    const layer = layers.find((l) => l.role === b.layer);
    // A band whose layer the slide does not have claims nothing — the same
    // answer as a layer whose text is empty, below, and for the same reason: a
    // deleted subtitle is not a subtitle of unknown height, it is no subtitle.
    // Refusing the whole solve instead froze the column wherever the caption
    // had last left it, reserving 0.031 of the canvas for a layer that was
    // gone, and no later edit could recover it. A layer that *is* there and is
    // not text still refuses, because that band has a height nobody can read.
    if (!layer) {
      measured.set(b.layer, 0);
      continue;
    }
    if (layer.type !== "text") return null;
    const ink = textInkBox(layer, { W, H, device, measurer });
    if (!ink || !Number.isFinite(ink.h)) return null;
    // Empty text paints nothing, so it claims nothing. A slide with a blank
    // subtitle should close up, not reserve a line for it.
    measured.set(b.layer, ink.lineCount === 0 ? 0 : ink.h / H);
  }

  // The device's `stackLead` moves the leading edge: what a caption resized
  // from its top handle leaves behind (leadFor).
  const lead = layers.find((l) => l.type === "device")?.stackLead;
  const leadOf = (b) => (b === stack.bands[0] && Number.isFinite(lead) ? lead : 0);
  const edgeOf = (b) => (b.edge == null ? 0 : Math.max(b.edge + leadOf(b), edgeFloor));
  let fixed = 0;
  for (const b of stack.bands) fixed += edgeOf(b) + (b.gap ?? 0);
  let content = 0;
  for (const v of measured.values()) content += v;

  const want = 1 - fixed - content;
  if (stack.device === "bleed") return solveBleed(stack, { want, band, W, H, frame: device?.frame, edgeOf, measured });
  // An oversubscribed budget at the floor runs whatever is last off the bottom
  // edge: under the device (`lower-banner`) the subtitle, cropped in the export;
  // above it the device, which hung half off a squarer canvas the column was
  // never measured for — off-canvas to the grader either way, not an overlap
  // anything repairs. So the device gives way past its floor, down to the split
  // shape's, before anything leaves the canvas.
  const floor = Math.min(band.min, DEVICE_BANDS.split.min);
  const grown = Math.max(floor, Math.min(band.max, want));

  // Undersubscribed: the growing band hit its *ceiling*, so there is height
  // nobody claimed. Left alone it falls through to whichever band happens to be
  // last, which is the original disease — `thirds` with a one-line caption at
  // each end stranded 0.092 of canvas below its supporting line.
  //
  // It is split evenly between the outer bands rather than dropped at the
  // bottom, because that is what the corpus does: across the split family the
  // air above the composition and the air below it are 0.055/0.053 (App Store)
  // and 0.027/0.030 (Play) — balanced to within a few thousandths. A slight
  // bottom weight would also be defensible, since the optical centre of a frame
  // sits about 46% down, but the measurement does not show one and inventing it
  // would be taste dressed as data.
  const spare = Math.max(0, want - grown);
  const edgeCount = stack.bands.reduce((n, b) => n + (b.edge == null ? 0 : 1), 0);
  const perEdge = edgeCount ? spare / edgeCount : 0;

  // Walk the stack, accumulating the top edge of each band.
  const byRole = {};
  let y = 0;
  let deviceHRatio = null;
  for (const b of stack.bands) {
    if (b.grow) {
      byRole[b.layer ?? "device"] = round4(y);
      deviceHRatio = round4(grown);
      y += grown;
      continue;
    }
    if (b.layer) {
      byRole[b.layer] = round4(y);
      y += measured.get(b.layer);
      continue;
    }
    y += edgeOf(b) + (b.edge == null ? 0 : perEdge) + (b.gap ?? 0);
  }
  if (deviceHRatio == null) return null;

  return { byRole, deviceHRatio, over: round4(Math.max(0, grown - want)) };
}

// The bleed shape has no trailing band: the device starts where the caption
// ends and runs off the bottom. Its height aims at BLEED.target cropped, capped
// by width; where the cap leaves less than BLEED.min cropped (a short caption,
// a wide frame), the device moves down instead, the spare split between the
// leading edge and the caption-to-device gap so the caption sits centred above
// the product shot rather than stranded at the top. A caption tall enough to
// push the device to its floor crops it past BLEED.max, and `over` says by how
// much — the off-canvas fault the scorer then reports.
function solveBleed(stack, { want, band, W, H, frame, edgeOf, measured }) {
  const aspect = PORTRAIT_FRAME_ASPECT[frame] ?? W / H;
  const cap = Math.min(band.max, (BLEED.width * W) / (H * aspect));
  const grown = Math.max(band.min, Math.min(cap, want / (1 - BLEED.target)));
  const spare = Math.max(0, want - grown * (1 - BLEED.min)) / 2;
  const devAt = stack.bands.findIndex((b) => b.grow);
  if (devAt < 0) return null;
  const byRole = {};
  let y = 0;
  stack.bands.forEach((b, i) => {
    if (b.grow) byRole[b.layer ?? "device"] = round4(y);
    else if (b.layer) {
      byRole[b.layer] = round4(y);
      y += measured.get(b.layer);
    } else y += edgeOf(b) + (b.gap ?? 0) + (i === 0 || i === devAt - 1 ? spare : 0);
  });
  const top = byRole[stack.bands[devAt].layer ?? "device"];
  return { byRole, deviceHRatio: round4(grown), over: round4(Math.max(0, top + grown * (1 - BLEED.max) - 1)) };
}

// The layer fields that change how much of the budget a content band claims,
// and therefore the writes that have to be followed by a re-solve. `text`,
// `wRatio`, `sizeMul`, `fontId`, `weight`, `lineHeight`, `letterSpacing`,
// `textCase` and `highlight` each change the wrap or the line box; `balance`
// changes where the breaks fall; `accent` decides whether braces are drawn.
//
// `yRatio` is deliberately **absent**, which is the difference from
// captionFlow.js's HEADLINE_METRIC_KEYS: there the gap is measured from a
// headline the user positions, so the anchor moving is an input. Here every
// position is an output, so treating a yRatio write as a re-solve trigger would
// make the solver fight the write that was just made.
export const STACK_METRIC_KEYS = new Set([
  "text",
  "wRatio",
  "sizeMul",
  "fontId",
  "weight",
  "lineHeight",
  "letterSpacing",
  "textCase",
  "highlight",
  "accent",
  "balance",
]);

// Writing one of these onto a device layer is the user placing or sizing the
// device themselves, which takes the slide out of the stack — the same bargain a
// hand-dragged subtitle makes with `followGap`.
export const STACK_DETACH_KEYS = new Set(["yRatio", "hRatio"]);

// Whether a content band's top can travel when its layer grows: only a growing
// band above it gives way. Under `lower-banner` the device sits over the
// caption, so a taller headline shortens the device and the headline's bottom
// holds; under a caption-above stack there is nothing over the headline but the
// fixed margin, so its top is pinned and it can only grow downward.
export function topGivesWay(stack, role) {
  const bands = stack?.bands ?? [];
  const i = bands.findIndex((b) => b.layer === role && !b.grow);
  return i > 0 && bands.slice(0, i).some((b) => b.grow);
}

// The device `stackLead` that puts `role`'s top at `top`, for a caption resized
// from its north handle: that handle pins the caption's bottom edge, and where
// nothing above it gives way the solve would hold its top at the margin and
// grow it downward instead. Moving the leading edge by the difference keeps the
// slide in its stack, so every band below stays where it was and every language
// re-divides around its own copy. `layers` carry the new size; null when the
// stack cannot be solved.
//
// Searched rather than subtracted once, because the top does not follow the
// lead one-for-one everywhere: with the device at its ceiling the unclaimed
// height is shared between the outer edges, and at the margin floor the edge
// stops moving at all. Each piece is linear, so a few secant steps land it.
export function leadFor(stack, layers, role, top, opts) {
  const topAt = (lead) => {
    const placed = layers.map((l) => (l.type === "device" ? { ...l, stackLead: lead } : l));
    return solveStack(stack, placed, opts)?.byRole[role] ?? null;
  };
  let a = 0;
  let at = topAt(0);
  if (at == null) return null;
  let b = top - at;
  for (let i = 0; i < 6; i++) {
    const bt = topAt(b);
    if (Math.abs(top - bt) < 1e-4) break;
    const slope = (bt - at) / (b - a);
    if (!(slope > 0)) break;
    a = b;
    at = bt;
    b += (top - bt) / slope;
  }
  // Past the floor the edge no longer moves, and the search would run off after
  // a top it cannot reach; a lead under a zero edge means nothing anyway.
  return round4(Math.max(b, -(stack.bands[0]?.edge ?? 0)));
}

// The highest top `role` can reach by moving the leading edge — the lowest
// lead leadFor will hand out, which the solve then holds at the margin floor.
// Null when the stack cannot be solved.
export function highestTop(stack, layers, role, opts) {
  const lead = -(stack.bands[0]?.edge ?? 0);
  const placed = layers.map((l) => (l.type === "device" ? { ...l, stackLead: lead } : l));
  return solveStack(stack, placed, opts)?.byRole[role] ?? null;
}
