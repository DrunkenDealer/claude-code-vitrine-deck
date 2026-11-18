// How broken a slide's layout is, as a number.
//
// The five layout presets are "pre-validated to keep text and device from
// overlapping at the default device height" (src/layoutPresets.js) —
// which holds at exactly one device height, with placeholder text, on one
// aspect ratio. The editor then lets a user type a long headline, drag the
// device taller, drop a sticker under it and switch to a tablet, and nothing
// re-checks any of it. This is the thing that re-checks.
//
// It is a **penalty**: 0 is clean and larger is worse. Nothing here is a
// quality score — a slide can be tasteless and score 0, which is correct. The
// only claim is that a non-zero penalty names something measurably wrong.
//
// Node-API-free like geometry.js/visual.js/textMetrics.js — both hosts import it.
import { layerBox, projectCorners } from "./geometry.js";
import { textInkBox } from "./textMetrics.js";
import { normalizeSpan, rotationCss } from "./visual.js";
import { thumbnailFloorFor, thumbnailPx } from "./thumbnail.js";
import { stackFor } from "./layoutPresets.js";
import { BLEED } from "./layoutStack.js";

export const FAULTS = {
  OFF_CANVAS: "off-canvas",
  SAFE_AREA: "safe-area",
  OVERLAP: "overlap",
  TINY_TEXT: "tiny-text",
  SMALL_TEXT: "small-text",
  TIGHT_MARGIN: "tight-margin",
  BIG_GAP: "big-gap",
  NO_FRAME: "no-frame",
  // Never from scoreLayout: `check` reports it, as a warning, on a slide whose
  // kind is meant to show a device and has none.
  NO_DEVICE: "no-device",
  // Never from scoreLayout either: `check` reports it, as a warning, on a caption
  // whose last line is one word. No box is wrong, so no geometric fault sees it,
  // and at thumbnail size it reads as a mistake.
  ORPHAN: "orphan",
  // Also check-only warnings, on the Play feature graphic, for what Play's own
  // guidance asks it not to be: device imagery, a picture with no words, or a
  // ground that melts into the store's white, black or dark-grey surfaces.
  FG_DEVICE: "fg-device",
  FG_NO_TEXT: "fg-no-text",
  FG_DULL_GROUND: "fg-dull-ground",
};

// What the panel says a fix was. Kept beside the codes so the two cannot drift.
export const FAULT_LABEL = {
  [FAULTS.OFF_CANVAS]: "a layer off the canvas",
  [FAULTS.SAFE_AREA]: "text past the safe area",
  [FAULTS.OVERLAP]: "text over another layer",
  [FAULTS.TINY_TEXT]: "text too small to read",
  [FAULTS.SMALL_TEXT]: "text too small to read on a store thumbnail",
  [FAULTS.TIGHT_MARGIN]: "text crowding the edge",
  [FAULTS.BIG_GAP]: "a large empty band",
  [FAULTS.NO_FRAME]: "a framed device with no frame to measure it against",
  [FAULTS.NO_DEVICE]: "no device on a slide that shows one",
  [FAULTS.ORPHAN]: "a last line of one word",
  [FAULTS.FG_DEVICE]: "a device on the feature graphic",
  [FAULTS.FG_NO_TEXT]: "a feature graphic with no words",
  [FAULTS.FG_DULL_GROUND]: "a feature graphic ground that blends into the store",
};

// What to do about each fault, for a caller reading `check --json` that has no
// panel to show it. scoreLayout does not grade a fault and the editor reads
// these as-is; the severity `check` stamps on its way out is FAULT_SEVERITY below.
export const FAULT_HINT = {
  [FAULTS.OFF_CANVAS]:
    "polish usually fixes it; if it declines, fix yRatio/hRatio yourself (yRatio + hRatio must stay under 1, except a device the `bleed` preset stacks, which may run off the bottom by up to 15% of its height)",
  [FAULTS.SAFE_AREA]: "polish moves it; fires when safeAreaEnabled, and always on a banner with a store art safe area",
  [FAULTS.OVERLAP]: "run polish first; still failing means shorten the headline",
  [FAULTS.TINY_TEXT]: "cut the copy that made the type shrink; this firing means something went badly wrong",
  [FAULTS.SMALL_TEXT]: "shorten the copy so the type can be larger, or raise the layer's sizeMul",
  [FAULTS.TIGHT_MARGIN]: "widen the margin or narrow wRatio",
  [FAULTS.BIG_GAP]:
    "a warning that polish leaves alone; close it by re-applying a layout preset or growing the device's hRatio; it fails check only under --strict",
  [FAULTS.NO_FRAME]: "a broken device id or install, not a design problem",
  [FAULTS.NO_DEVICE]: "add a device layer, or ignore it if the slide is meant to be text only",
  [FAULTS.ORPHAN]: "reword or shorten the copy so the last line carries two words; never shrink the text to pull it up",
  [FAULTS.FG_DEVICE]: "Play asks for brand art, not device imagery: delete the device layer and use an icon or key art (layout fg-icon-left, fg-centered or fg-art-right)",
  [FAULTS.FG_NO_TEXT]: "give the banner its app name or a short tagline in the headline; a picture alone says nothing at thumbnail size",
  [FAULTS.FG_DULL_GROUND]: "pick a coloured ground; white, black and dark grey run into the store's own surfaces in light and dark mode",
};

// A fault absent here is `block`. These are the ones check reports but does not
// fail on: polish cannot repair them by design (BIG_GAP weighs under
// APPLY_MARGIN) or they can be deliberate (a slide of type alone). One table, so
// `check` and `capabilities` cannot disagree.
export const FAULT_SEVERITY = {
  [FAULTS.NO_DEVICE]: "warn",
  [FAULTS.BIG_GAP]: "warn",
  [FAULTS.ORPHAN]: "warn",
  [FAULTS.FG_DEVICE]: "warn",
  [FAULTS.FG_NO_TEXT]: "warn",
  [FAULTS.FG_DULL_GROUND]: "warn",
};

// Ordered by how much a viewer would notice, which is the only defensible basis
// for these: a layer half off the canvas is ruinous, an over-wide empty band is
// a matter of taste. The absolute values matter only through their ratios and
// through APPLY_MARGIN in layoutPolish.js — they are not derived from any
// published model, and a comment claiming otherwise would be worse than none.
export const WEIGHTS = {
  [FAULTS.OFF_CANVAS]: 2500,
  [FAULTS.SAFE_AREA]: 750,
  [FAULTS.OVERLAP]: 250,
  [FAULTS.TINY_TEXT]: 125,
  [FAULTS.TIGHT_MARGIN]: 75,
  [FAULTS.BIG_GAP]: 50,
};

// SMALL_TEXT deliberately carries no weight, like NO_FRAME.
//
// Polish only ever *shrinks* text — the ladders in layoutPolish.js and the fit
// steps for a translation both go one way — so a penalty for text being too
// small is one it can never pay off by repairing. Worse, weighting it would put
// the preset one-shots in reach of "fix this by stamping big-headline over it",
// and growing someone's type is a design decision rather than a repair. What
// stops small text being *created* is the clamp in layoutPolish.js; this is what
// reports the ones that are already there.

// How much better a candidate must be before Polish will act on it.
//
// It lives beside the weights because that is where it is justified: the two
// cheapest faults are BIG_GAP at 50 and TIGHT_MARGIN at 75, so a margin of 60
// means Polish can never fire to fix a purely cosmetic term. Clearing 60 needs
// a near-total margin violation, a quarter of the headline covered, or 8% of
// the safe band breached — all of them things you can see. That is what makes
// Polish a repair rather than an opinion, and it is the one number to tune.
//
// One exemption: a round that takes a slide from a safe-area fault to none, with
// no new blocking fault and a lower penalty, applies below the margin. A 41 px
// breach of a 661 px band scores ~18 yet check blocks on it, so without it Polish
// answered "no-better" over a fault it reports as blocking (N890). Overlap and
// tight margin stay under the margin on purpose (N774).
export const APPLY_MARGIN = 60;

// Slack subtracted before every threshold, as a fraction of the relevant axis.
//
// A predicted wrap can be a line out when a word lands within a few px of a
// break. 1.5% of a 2868px canvas is 43px — under half a headline line, so a
// real overflow still fires while a rounding difference cannot manufacture one.
//
// It does **not** cover the fallback glyph estimator. That is good to ~5% on a
// single advance, but a wrap is discrete: 5% of a line's width is enough to
// move a word onto the next line, and a six-line headline predicted as four is
// out by a third of its height — measured, not supposed. So the tolerance is
// for measurement noise, and being sure means passing a real `measurer`:
// web/src/lib/measureText.js in the editor, src/measure.js in the CLI.
export const TOL = 0.015;

// Absolute legibility floor, as a fraction of the canvas short edge. Deliberately
// absolute rather than relative to the role's base size: a floor of "80% of the
// default" would permanently fault a slide whose author wanted small type, while
// this only fires on text nobody could read. A portrait headline reaches it at
// sizeMul ~0.33, which no preset comes near.
const TINY_FLOOR = 0.022;
// How close text may sit to a canvas edge before it reads as crowded.
const MARGIN = 0.03;
// An empty band wider than this fraction of the canvas starts to count, and
// saturates at twice it.
//
// 0.25 was a guess, and a bad one: measured against 166 portrait top-chart
// slides it faults the largest band on **5%** of the market, which means it was
// effectively off. `lower-banner` carried 0.192 of dead canvas under its
// caption, `thirds` 0.075, and `caption-top` at a three-line headline **0.634**
// in a single band — and this term said nothing about any of them. The corpus is
// in test/storeShape.test.js.
//
// The market's largest single band is 0.073 median, p75 0.102, **p90 0.149**. So
// the onset is the p90: loud enough to catch a sixth of a screenshot doing
// nothing, quiet enough that one slide in ten from the top charts would trip it.
const GAP_START = 0.15;
const GAP_SPAN = 0.15;

// The bottom edge is measured separately because the market treats it
// differently from every other band: the air under the composition is **0.000**
// median (p75 0.044, p90 0.066), against 0.055 above it and 0.062 for the widest
// band in between. 60-64% of slides run the device off the bottom edge entirely.
// Which is what optical centering predicts — the optical centre of a frame is
// about 46% down, so mass belongs slightly high — and it is where Vitrine's
// geometry went wrong, so a single threshold would have to be loose enough for
// the top band and would then miss the one that matters. This is the p90.
const GAP_BOTTOM_START = 0.08;
const GAP_BOTTOM_SPAN = 0.12;

// Steps for the rounded-rect overlap integral. Fixed, not adaptive: the same
// input has to produce the identical number every time or a ranking flickers.
const QUAD_STEPS = 64;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The canvas size, from either host's device record. Node spells it
 * canvasWidth/canvasHeight (src/devices.js), the editor width/height (the
 * /api/state projection). Both spell the font sizes the same, so this is the
 * whole adapter.
 */
export function canvasOf(device) {
  const W = device?.canvasWidth ?? device?.width;
  const H = device?.canvasHeight ?? device?.height;
  if (!Number.isFinite(W) || !Number.isFinite(H)) {
    // A NaN canvas would poison every term silently and produce a confident
    // penalty of NaN, which compares false against everything.
    throw new Error("layoutScore: device has no canvas size");
  }
  return { W, H };
}

const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);

/**
 * Overlap area of `t` with `d`, where `d` may be a rounded rectangle.
 *
 * The device silhouette is rounded hard — 200px of corner radius on a 1400px
 * iPhone frame — and a strict box intersection over-reports a caption crossing
 * its top edge by up to 2R²(1-π/4), about a fifth of a one-line headline's ink.
 * That is enough to invent a fault out of nothing, so the corners are integrated
 * rather than ignored. R = 0 collapses this to a plain rectangle intersection.
 */
export function overlapArea(t, d) {
  const y0 = Math.max(t.y, d.y);
  const y1 = Math.min(t.y + t.h, d.y + d.h);
  const x0 = Math.max(t.x, d.x);
  const x1 = Math.min(t.x + t.w, d.x + d.w);
  if (y1 <= y0 || x1 <= x0) return 0;

  const R = d.radius ?? 0;
  if (R <= 0) return (x1 - x0) * (y1 - y0);

  const step = (y1 - y0) / QUAD_STEPS;
  let acc = 0;
  for (let i = 0; i < QUAD_STEPS; i++) {
    const y = y0 + (i + 0.5) * step;
    // Distance to the nearer horizontal edge; inside the straight middle the
    // inset is zero and the row is the full width.
    const e = Math.min(y - d.y, d.y + d.h - y);
    const inset = e >= R ? 0 : R - Math.sqrt(Math.max(0, 2 * R * e - e * e));
    const l = Math.max(t.x, d.x + inset);
    const r = Math.min(t.x + t.w, d.x + d.w - inset);
    if (r > l) acc += (r - l) * step;
  }
  return acc;
}

function aabbOf(corners) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Every layer as a box the scorer can compare, in canvas px.
 *
 * Text becomes its **ink**, not its column — the column is 88% of the canvas
 * wide and mostly empty, and scoring against it reports every centred headline
 * as covering every centred device. See textMetrics.textInkBox.
 *
 * A rotated layer is reduced to the axis-aligned box around its corners. That
 * over-reports, but Polish never rotates anything, so the same over-report
 * appears in every candidate and cancels out of a ranking — which is why this
 * does not carry a separating-axis test the repo would otherwise have to grow.
 */
export function boxesFor(layers, { device, frame, measurer }) {
  const { W, H } = canvasOf(device);
  const out = [];
  for (const layer of layers) {
    if (layer.opacity === 0) continue;

    let box;
    let radius = 0;
    let fontSizePx = null;
    let lineCount = null;
    // Whether this box came from a real font measurement or from the glyph
    // estimator. Carried out so a caller can say which, rather than reporting
    // a guess and a measurement in the same voice — the estimator is out by a
    // whole line often enough that "clean" means different things.
    let estimated = false;

    if (layer.type === "text") {
      const ink = textInkBox(layer, { W, H, device, measurer });
      // Empty text paints nothing and must not be scored as a box at the
      // origin — it would fault margins on every slide with a blank subtitle.
      if (ink.lineCount === 0 || ink.w <= 0 || ink.h <= 0) continue;
      box = { x: ink.x, y: ink.y, w: ink.w, h: ink.h };
      fontSizePx = ink.fontSizePx;
      lineCount = ink.lineCount;
      estimated = ink.estimated;
    } else {
      box = layerBox(layer, { W, H, frame });
      if (box.h == null || box.w <= 0 || box.h <= 0) continue;
      if (layer.type === "device" && layer.useFrame !== false && frame) {
        // Scaled the same way cutoutBox scales its own radius.
        radius = (frame.outerRadius ?? 0) * (box.w / frame.frameWidth);
      }
    }

    const rotated = rotationCss(layer.rotation).transform !== "none";
    if (rotated) {
      const corners = projectCorners(box, layer.rotation);
      // projectCorners gives up when a corner projects behind the camera. A box
      // nobody can place is excluded rather than guessed at.
      if (!corners) continue;
      box = aabbOf(corners);
      radius = 0;
    }

    out.push({
      id: layer.id,
      role: layer.role ?? null,
      type: layer.type,
      ...box,
      radius,
      fontSizePx,
      lineCount,
      estimated,
    });
  }
  return out;
}

const TEXT_ROLES = new Set(["headline", "subtitle"]);

/**
 * Score one slide's layout.
 *
 * `safeArea` is `{ topPx, bottomPx, leftPx, rightPx }` or null. Null means the
 * band is the canvas, so the safe-area term degenerates into "text falls off
 * the edge" — still exactly the fault worth catching. It then double-counts
 * with off-canvas for text, which is intentional: text hanging off the edge is
 * worse than a sticker doing it, and 2500 + 750 says so.
 *
 * `span` is the slide's panorama window (see normalizeSpan). A layer hanging off
 * a seam there carries on onto the neighbour — that is the layout, not a fault —
 * so it is the whole panorama it must stay on.
 */
export function scoreLayout({ layers, device, frame = null, safeArea = null, measurer = null, span = null }) {
  const { W, H } = canvasOf(device);

  // A framed device without frame metadata does not throw — layerBox silently
  // falls back to the canvas aspect, which is 3% wrong on an iPhone 6.9. A
  // wrong number is worse here than no number, so this refuses.
  if (!frame && layers.some((l) => l.type === "device" && l.useFrame !== false)) {
    return {
      penalty: Infinity,
      terms: {},
      faults: [{ code: FAULTS.NO_FRAME, layerId: null, detail: null }],
    };
  }

  const boxes = boxesFor(layers, { device, frame, measurer });
  const short = Math.min(W, H);
  const terms = {};
  const faults = [];
  const add = (code, layerId, detail) => faults.push({ code, layerId, detail });

  // ---- off the canvas -------------------------------------------------------
  // In a panorama anything may carry on across the seams (see resolvePaint), so
  // "off" is off the whole strip.
  const pano = normalizeSpan(span);
  const bounds = pano
    ? { x: -pano.index * W, y: 0, w: pano.count * W, h: H, radius: 0 }
    : { x: 0, y: 0, w: W, h: H, radius: 0 };
  // A device a bleed stack governs runs off the bottom edge by design, up to
  // BLEED.max of its height; only that edge, and only while the stack holds it —
  // a device dragged out of it is graded like any hand-cropped one.
  const bleeds = new Set(
    layers
      .filter((l) => l.type === "device" && stackFor(l.stackId, null, device?.category)?.device === "bleed")
      .map((l) => l.id),
  );
  let off = 0;
  for (const b of boxes) {
    const inside = overlapArea(b, bleeds.has(b.id) ? { ...bounds, h: bounds.h + b.h * BLEED.max } : bounds);
    const frac = 1 - inside / area(b);
    if (frac > TOL) {
      off += frac;
      add(FAULTS.OFF_CANVAS, b.id, { fraction: frac });
    }
  }
  terms[FAULTS.OFF_CANVAS] = clamp01(off);

  // ---- past the safe band ---------------------------------------------------
  // The band is a guide — nothing pins a layer inside it — and yRatio is the
  // layer's *top edge*, so a three-line headline anchored at the band's bottom
  // sits entirely below the line. That is why the term is on the ink box rather
  // than on the anchor.
  const band = {
    x: safeArea?.leftPx ?? 0,
    y: safeArea?.topPx ?? 0,
    w: W - (safeArea?.leftPx ?? 0) - (safeArea?.rightPx ?? 0),
    h: H - (safeArea?.topPx ?? 0) - (safeArea?.bottomPx ?? 0),
  };
  let outside = 0;
  if (band.w > 0 && band.h > 0) {
    for (const b of boxes) {
      if (b.type !== "text") continue;
      const vOver =
        Math.max(0, band.y - b.y) + Math.max(0, b.y + b.h - (band.y + band.h));
      const hOver =
        Math.max(0, band.x - b.x) + Math.max(0, b.x + b.w - (band.x + band.w));
      // Each axis against its own extent, so a 1080-tall TV band and a
      // 2718-tall phone band produce comparable numbers.
      const p = clamp01(
        Math.max(0, vOver - TOL * H) / band.h + Math.max(0, hOver - TOL * W) / band.w,
      );
      if (p > 0) {
        outside += p;
        add(FAULTS.SAFE_AREA, b.id, { vOver, hOver });
      }
    }
  }
  terms[FAULTS.SAFE_AREA] = clamp01(outside);

  // ---- text over something --------------------------------------------------
  // Only pairs involving a role text layer. Two stickers overlapping is a
  // collage; a headline over anything is a fault.
  const scored = (b) => b.type === "text" && TEXT_ROLES.has(b.role);
  let over = 0;
  for (let i = 0; i < boxes.length; i++) {
    const t = boxes[i];
    if (!scored(t)) continue;
    for (let j = 0; j < boxes.length; j++) {
      if (j === i) continue;
      const b = boxes[j];
      // A pair of scored text layers is symmetric, so the outer loop reaches it
      // from both ends — measure it once, or a headline lying across a subtitle
      // counts double what the same headline lying across the device does.
      // Array order is stable, so which end wins is deterministic.
      if (j < i && scored(b)) continue;
      const a = overlapArea(t, b);
      if (a <= 0) continue;
      // Against the *smaller* box, so "half the headline is covered" reads 0.5
      // whether the other thing is a sticker or a 2000px device.
      const p = a / Math.max(1, Math.min(area(t), area(b)));
      if (p > TOL) {
        over += p;
        add(FAULTS.OVERLAP, t.id, { otherId: b.id, fraction: p });
      }
    }
  }
  terms[FAULTS.OVERLAP] = clamp01(over);

  // ---- unreadably small -----------------------------------------------------
  const floor = TINY_FLOOR * short;
  let tiny = 0;
  for (const b of boxes) {
    if (b.type !== "text") continue;
    const p = clamp01(Math.max(0, floor - b.fontSizePx) / floor);
    if (p > 0) {
      tiny += p;
      add(FAULTS.TINY_TEXT, b.id, { fontSizePx: b.fontSizePx, floor });
    }
  }
  terms[FAULTS.TINY_TEXT] = clamp01(tiny);

  // ---- too small where the listing is met -----------------------------------
  // A different question from tiny-text, and the one that decides whether the
  // deck works: TINY_FLOOR asks whether the glyphs are legible on the canvas,
  // this asks whether they survive the reduction to a store thumbnail. A
  // headline at sizeMul 0.58 is comfortably readable at 1320px and is 12px in a
  // search result. See src/thumbnail.js for the floors and where they come from.
  for (const b of boxes) {
    if (b.type !== "text") continue;
    const px = thumbnailPx(b.fontSizePx, device);
    const storeFloor = thumbnailFloorFor(b.role);
    if (px != null && px < storeFloor) {
      add(FAULTS.SMALL_TEXT, b.id, {
        fontSizePx: b.fontSizePx,
        thumbnailPx: Math.round(px * 10) / 10,
        floor: storeFloor,
      });
    }
  }

  // ---- crowding an edge -----------------------------------------------------
  // Text only. A device is allowed to run to the edge — `compact` deliberately
  // takes it to 0.985 of the canvas height — and a term that faults a shipped
  // preset is a broken term.
  const m = MARGIN * short;
  let crowd = 0;
  for (const b of boxes) {
    if (b.type !== "text") continue;
    const d = Math.min(b.x, b.y, W - (b.x + b.w), H - (b.y + b.h));
    const p = clamp01(Math.max(0, m - Math.max(0, d)) / m);
    if (p > 0) {
      crowd += p;
      add(FAULTS.TIGHT_MARGIN, b.id, { distance: d });
    }
  }
  terms[FAULTS.TIGHT_MARGIN] = clamp01(crowd);

  // ---- one big empty band ---------------------------------------------------
  // Vertical gaps between the role layers, plus the two canvas edges. Silent
  // until a single band passes a quarter of the canvas, which no preset does.
  //
  // Only where there is a device to caption. The term compares the caption band
  // against the thing it captions, and on a slide with no device layer — a Play
  // feature graphic, which is a banner and is mostly negative space by design —
  // the biggest gap is always most of the canvas, so it would fault every such
  // slide at every layout. Nothing changes for the kinds that have one: every
  // preset places a device, so this is a no-op on any deck that existed before.
  const stack = boxes
    .filter((b) => b.role)
    .sort((a, b) => a.y - b.y);
  let maxGap = 0;
  let bottomGap = 0;
  if (stack.length && boxes.some((b) => b.type === "device")) {
    maxGap = Math.max(0, stack[0].y);
    for (let i = 1; i < stack.length; i++) {
      maxGap = Math.max(maxGap, stack[i].y - (stack[i - 1].y + stack[i - 1].h));
    }
    const last = stack[stack.length - 1];
    bottomGap = Math.max(0, H - (last.y + last.h));
  }
  // Whichever of the two reads worse on its own scale. Two thresholds, one term:
  // a slide is not more broken for having dead air at both ends than at one, and
  // summing them would make the bottom count twice on a layout whose last band
  // *is* the widest.
  const gapP = Math.max(
    clamp01((maxGap / H - GAP_START) / GAP_SPAN),
    clamp01((bottomGap / H - GAP_BOTTOM_START) / GAP_BOTTOM_SPAN),
  );
  terms[FAULTS.BIG_GAP] = gapP;
  if (gapP > 0) add(FAULTS.BIG_GAP, null, { maxGap, bottomGap });

  let penalty = 0;
  for (const [code, w] of Object.entries(WEIGHTS)) penalty += w * (terms[code] ?? 0);

  return { penalty, terms, faults };
}
