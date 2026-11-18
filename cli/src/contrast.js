// Whether the words can be read off the background they sit on.
//
// src/layoutScore.js catches a slide that is *broken* — text off the canvas, a
// headline over the device, type nobody could read at that size. It has nothing
// to say about white text on a pale mesh, which is legible in the sense that it
// occupies the right rectangle and illegible in the sense that matters. That is
// the mistake anything picking colours automatically makes first, so it gets its
// own grader.
//
// **Sampled where the text is**, not over the whole spec. The first version of
// this took the worst colour a background mentioned anywhere, and faulted every
// slide using Vitrine's own Sunset theme — whose amber blob sits bottom-left of
// a headline at the top. A check that cries wolf on the shipped themes is a
// check people switch off, and then it protects nothing. So a mesh blob counts
// only where its disc reaches the ink, and a gradient is read at the offsets the
// ink actually spans.
//
// Deliberately **not** folded into scoreLayout's penalty, and deliberately not
// something polishLayout acts on: polish makes a minimal geometric repair, and
// changing a colour is an opinion about the design rather than a repair to it.
// This reports; what to do about it is the caller's call.
//
// Node-API-free like the rest of src/ that both hosts share.
import { normalizeBackground, normalizeSpan } from "./visual.js";
import { accentRuns } from "./layers.js";

export const LOW_CONTRAST = "low-contrast";
// A text layer this could not judge: its colour is not one it parses, or the
// ground under it is a photo or CSS it cannot read. Reported by contrastFaults
// on request, as a warning: silence over such a layer read as a pass.
export const CONTRAST_UNVERIFIED = "contrast-unverified";

export const CONTRAST_HINT = {
  [LOW_CONTRAST]:
    "change `color` (or `accent`, when the fault names that run), move the caption, or add a `highlight` with its own `color`; polish never changes colours",
  [CONTRAST_UNVERIFIED]: "not measurable: use a colour spec or a highlight pill, or review the rendered PNG",
};

// WCAG 2.2 AA. 4.5:1 for normal text; 3:1 only for large text, which the spec
// defines as 24px, or 18.66px when the face is bold.
//
// Which of the two applies is a **per-layer** question, and getting it wrong in
// either direction is the failure mode here.
//
// The reasoning that used to sit at this line — "every text layer is large by
// any reading of the spec, a headline is ~88px" — is sound about the canvas and
// wrong about the listing. That 88px headline is met at ~20px in a store search
// result (src/thumbnail.js), which is large only while it stays bold, and the
// subtitle under it lands at ~12.6px, which is ordinary text by any reading of
// the spec. So white-on-mid-tone subtitles passed at 3:1 and were unreadable
// exactly where the deck has to work.
//
// The opposite mistake is the one this file was originally shaped by (see the
// header): applying 4.5 to everything faults shipped themes at their own hero
// anchor, and a check that cries wolf is a check people switch off. Sizing the
// floor per layer is what lets it be strict about the subtitle without being
// wrong about the headline.
export const AA_LARGE = 3;
export const AA_NORMAL = 4.5;

// WCAG's own thresholds: 18pt / 14pt bold, in px, and the weight at which a face
// counts as bold.
export const LARGE_TEXT_PX = 24;
export const LARGE_TEXT_BOLD_PX = 18.66;
export const BOLD_WEIGHT = 700;

/** Is text of this size and weight WCAG "large text"? */
export const isLargeText = (px, weight) =>
  px >= (Number(weight) >= BOLD_WEIGHT ? LARGE_TEXT_BOLD_PX : LARGE_TEXT_PX);

// The rule, in one place, so capabilities can serve it and a caller can explain
// a failure rather than guessing at one.
export const CONTRAST_RULE = {
  normal: AA_NORMAL,
  large: AA_LARGE,
  largeAtPx: LARGE_TEXT_PX,
  largeAtPxBold: LARGE_TEXT_BOLD_PX,
  boldWeight: BOLD_WEIGHT,
  measuredAt:
    "the layer's size on a store thumbnail, not on the canvas — see thumbnail in this document",
};

const HEX = /^#([0-9a-f]{3,8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/i;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * A CSS colour as `{ r, g, b, a }` in 0-255 / 0-1, or null when it isn't one
 * this can judge. Null is a real answer — a named colour, a gradient string, a
 * `currentColor` — and it means "no opinion", never "fails".
 */
export function parseColor(css) {
  if (typeof css !== "string") return null;
  const s = css.trim();

  const hex = HEX.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length !== 3 && h.length !== 4 && h.length !== 6 && h.length !== 8) return null;
    const wide = h.length > 4;
    const step = wide ? 2 : 1;
    const at = (i) => {
      const part = h.slice(i * step, i * step + step);
      return parseInt(wide ? part : part + part, 16);
    };
    return { r: at(0), g: at(1), b: at(2), a: h.length === 4 || h.length === 8 ? at(3) / 255 : 1 };
  }

  const rgb = RGB.exec(s);
  if (rgb) {
    const alpha = rgb[4] == null
      ? 1
      : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return {
      r: clamp(parseFloat(rgb[1]), 0, 255),
      g: clamp(parseFloat(rgb[2]), 0, 255),
      b: clamp(parseFloat(rgb[3]), 0, 255),
      a: clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1),
    };
  }

  return null;
}

export const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

// WCAG 2.x relative luminance.
export function relativeLuminance({ r, g, b }) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// `fg` painted at `alpha` over `bg`. A subtitle ships at opacity 0.78, which is a
// fifth of its contrast given away before anything else happens — comparing the
// raw colour would report a number the slide never shows.
export function composite(fg, bg, alpha = 1) {
  const a = clamp(alpha * (fg.a ?? 1), 0, 1);
  const mix = (f, b) => Math.round(f * a + b * (1 - a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

const lerp = (a, b, t) => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
  a: 1,
});

// A gradient read at one offset along its ramp, 0..1. Stops are sorted and the
// ends extend flat, which is what CSS does.
function sampleStops(stops, t) {
  const points = stops
    .map(([css, pct]) => ({ color: parseColor(css), t: clamp(pct, 0, 100) / 100 }))
    .filter((p) => p.color)
    .sort((a, b) => a.t - b.t);
  if (!points.length) return null;
  if (t <= points[0].t) return points[0].color;
  if (t >= points[points.length - 1].t) return points[points.length - 1].color;
  for (let i = 1; i < points.length; i++) {
    if (t > points[i].t) continue;
    const span = points[i].t - points[i - 1].t;
    return span <= 0 ? points[i].color : lerp(points[i - 1].color, points[i].color, (t - points[i - 1].t) / span);
  }
  return points[points.length - 1].color;
}

// Where a box sits along a linear gradient's axis, as a 0..1 range. CSS angles
// run clockwise from "to top", so the axis direction is (sin θ, -cos θ) and the
// ramp is measured from the corner the gradient starts at.
function linearRange(box, angle) {
  const rad = ((angle % 360) + 360) % 360 * (Math.PI / 180);
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // Half-length of the gradient line for a unit square, per the CSS spec.
  const half = (Math.abs(dx) + Math.abs(dy)) / 2;
  const project = (x, y) => ((x - 0.5) * dx + (y - 0.5) * dy + half) / (2 * half);
  const ts = [
    project(box.x0, box.y0), project(box.x1, box.y0),
    project(box.x0, box.y1), project(box.x1, box.y1),
  ];
  return [clamp(Math.min(...ts), 0, 1), clamp(Math.max(...ts), 0, 1)];
}

const SAMPLES = 5;
const acrossRange = ([lo, hi], fn) =>
  Array.from({ length: SAMPLES }, (_, i) => fn(lo + ((hi - lo) * i) / (SAMPLES - 1)));

// The strongest a mesh blob gets anywhere over this box, 0..1. A blob compiles
// to `radial-gradient(circle at x% y%, c 0, transparent r%)` (visual.js), so its
// colour fades linearly to nothing at r% of the distance from its centre to the
// farthest corner, measured in pixels — which is why the canvas's aspect is
// needed. Counting the whole disc at full strength faulted white text on every
// default feature graphic, where a blob's faint rim is all that reaches it.
function blobStrength(blob, box, aspect) {
  const cx = (blob.x / 100) * aspect;
  const cy = blob.y / 100;
  const far = Math.max(...[[0, 0], [aspect, 0], [0, 1], [aspect, 1]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const reach = (blob.r / 100) * far;
  const nx = clamp(cx, box.x0 * aspect, box.x1 * aspect);
  const ny = clamp(cy, box.y0, box.y1);
  return clamp(1 - Math.hypot(cx - nx, cy - ny) / reach, 0, 1);
}

/**
 * The colours text over `box` could actually land on.
 *
 * `box` is `{ x0, y0, x1, y1 }` in 0..1 of the canvas. Omit it and the whole
 * canvas is assumed, which is the honest answer when there is nothing to measure
 * the ink with — over-reporting beats a pass that means nothing.
 *
 * An image yields nothing: what it paints is not knowable from the spec, and
 * guessing would report a pass that means nothing either. A raw CSS string is
 * read only when it is exactly one colour (`"#fff"`, `"rgb(0 0 0)"`), which is
 * the same thing a solid spec says; any other string (a gradient, `url()`, a
 * named colour, `var()`) is not parsed and yields nothing.
 */
export function backgroundColorsAt(background, box = { x0: 0, y0: 0, x1: 1, y1: 1 }, aspect = 1) {
  const spec = normalizeBackground(background);
  if (!spec) return [];
  switch (spec.type) {
    case "solid":
      return [parseColor(spec.color)].filter(Boolean);
    case "linear":
      return acrossRange(linearRange(box, spec.angle), (t) => sampleStops(spec.stops, t)).filter(Boolean);
    case "radial": {
      // Distance from the centre, over the radius, clamped to the ramp.
      const cx = spec.x / 100;
      const cy = spec.y / 100;
      const r = Math.max(spec.r / 100, 1e-6);
      const corners = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]];
      const ds = corners.map(([x, y]) => Math.hypot(x - cx, y - cy) / r);
      const near = Math.hypot(clamp(cx, box.x0, box.x1) - cx, clamp(cy, box.y0, box.y1) - cy) / r;
      return acrossRange([clamp(near, 0, 1), clamp(Math.max(...ds), 0, 1)], (t) => sampleStops(spec.stops, t)).filter(Boolean);
    }
    case "mesh": {
      const base = parseColor(spec.base);
      if (!base) return [];
      const reaching = spec.blobs.flatMap((b) => {
        const c = parseColor(b.c);
        const strength = c ? blobStrength(b, box, aspect) : 0;
        return strength > 0 ? [composite(c, base, strength)] : [];
      });
      return [base, ...reaching];
    }
    case "raw":
      return [parseColor(spec.css)].filter(Boolean);
    default:
      return [];
  }
}

/**
 * The text layers of one slide that can't be read off it.
 *
 * `boxes` maps a layer id to its ink box in canvas pixels (what
 * layoutScore.boxesFor returns); with `canvas` it becomes the 0..1 box the
 * background is sampled over. Without them every layer is measured against the
 * whole canvas, which is stricter and never wrong in the unsafe direction.
 *
 * `span` is the panorama window the slide shows (see normalizeSpan): the
 * background then runs across `count` canvases, so a box is sampled where it
 * sits in the whole picture rather than as if the slide owned all of it.
 *
 * Returns `{ code, layerId, detail }` shaped like a layoutScore fault, so a
 * report can merge the two lists.
 *
 * `unverified` also reports each layer it could not judge, as a warning
 * (CONTRAST_UNVERIFIED): a text colour it does not parse, or a ground that is
 * an image, CSS other than one colour, or a gradient with no parseable stop.
 * Off by default, because an unanswerable question is "no opinion" for every
 * caller that asks about one colour (the editor's ink pick); check turns it on
 * so that silence over such a layer cannot be read as a pass.
 */
export function contrastFaults(
  layers,
  background,
  { boxes = null, canvas = null, thumbScale = null, floor = null, span = null, unverified = false } = {},
) {
  // Which floor this layer has to clear. An explicit `floor` overrides — a
  // caller grading against one fixed bar is a legitimate thing to want, and it
  // is what every existing caller of this asked for.
  //
  // Without a measured size there is no way to tell large from normal, so this
  // keeps the large-text bar rather than inventing a stricter one: an
  // unanswerable question is "no opinion", never "fails". The gate always has
  // one — layoutScore.boxesFor carries fontSizePx for every text layer.
  const floorFor = (layer, box) => {
    if (floor != null) return { floor, px: null };
    const px = thumbScale != null && Number.isFinite(box?.fontSizePx)
      ? box.fontSizePx * thumbScale
      : null;
    if (px == null) return { floor: AA_LARGE, px: null };
    return { floor: isLargeText(px, layer.weight) ? AA_LARGE : AA_NORMAL, px };
  };

  const onCanvas = (b) => {
    if (!b || !canvas) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return {
      x0: clamp(b.x / canvas.W, 0, 1),
      y0: clamp(b.y / canvas.H, 0, 1),
      x1: clamp((b.x + b.w) / canvas.W, 0, 1),
      y1: clamp((b.y + b.h) / canvas.H, 0, 1),
    };
  };
  const win = normalizeSpan(span);
  // A panorama's background runs across every canvas of the span.
  const aspect = canvas ? (canvas.W * (win?.count ?? 1)) / canvas.H : 1;
  const boxOf = (b) => {
    const box = onCanvas(b);
    if (!win) return box;
    const across = (x) => (win.index + x) / win.count;
    return { ...box, x0: across(box.x0), x1: across(box.x1) };
  };

  const faults = [];
  const spec = normalizeBackground(background);
  // Why a layer could not be judged, for the warning that replaces the silence.
  const whyNot = () => (spec?.type === "image" ? "image" : spec?.type === "raw" ? "css" : "colour");
  const unverifiedFault = (layer, reason) => ({
    code: CONTRAST_UNVERIFIED,
    severity: "warn",
    layerId: layer.id,
    detail: { reason, color: layer.color ?? null },
  });
  for (const layer of layers) {
    if (layer.type !== "text" || !layer.text) continue;
    const fg = parseColor(layer.color);
    if (!fg) {
      if (unverified) faults.push(unverifiedFault(layer, "text-colour"));
      continue;
    }

    const box = boxes?.find?.((x) => x.id === layer.id);

    // A highlight pill is what the glyphs actually sit on, so it replaces the
    // background rather than adding to it.
    const pill = layer.highlight ? parseColor(layer.highlight.color) : null;
    const against = pill ? [pill] : backgroundColorsAt(background, boxOf(box), aspect);
    if (against.length === 0) {
      if (unverified) faults.push(unverifiedFault(layer, whyNot()));
      continue;
    }

    // An accented keyword is read at the layer's size and weight, so it has to
    // clear the same floor; it is judged over the same box, the layer's ink,
    // because it can wrap anywhere in it. Only when it is actually drawn.
    const accented = accentRuns(layer.text, layer.accent).some((r) => r.accent && r.text.trim());
    const accent = accented ? parseColor(layer.accent) : null;
    if (accented && !accent && unverified) faults.push(unverifiedFault(layer, "accent-colour"));
    const inks = [{ fg, color: layer.color }, ...(accent ? [{ fg: accent, color: layer.accent, run: "accent" }] : [])];

    let worst = null;
    for (const ink of inks) {
      for (const bg of against) {
        const ratio = contrastRatio(composite(ink.fg, bg, layer.opacity ?? 1), bg);
        if (!worst || ratio < worst.ratio) worst = { ratio, bg, ink };
      }
    }
    const { floor: applied, px } = floorFor(layer, box);
    if (worst.ratio >= applied) continue;

    faults.push({
      code: LOW_CONTRAST,
      layerId: layer.id,
      detail: {
        ratio: Math.round(worst.ratio * 100) / 100,
        color: worst.ink.color,
        // Set when the run that failed is the accented keyword, not the caption.
        ...(worst.ink.run ? { run: worst.ink.run } : {}),
        against: toHex(worst.bg),
        opacity: layer.opacity ?? 1,
        floor: applied,
        // Why *this* floor: the size the layer is read at, and the weight that
        // decides whether that size counts as large. Null when the caller fixed
        // the floor or gave nothing to measure with.
        thumbnailPx: px == null ? null : Math.round(px * 10) / 10,
        weight: px == null ? null : (layer.weight ?? null),
      },
    });
  }

  return faults;
}

/**
 * Does `color` read over every colour a background paints?
 *
 * The whole-canvas, no-layout version of the check above, for the editor: the
 * background picker has a spec and a text colour and no boxes at all, because
 * the user has not picked the background yet. Sampling the whole canvas is the
 * conservative read — it can say "no" about a corner the headline never reaches
 * — and conservative is the right bias for a prompt the user can decline.
 *
 * `true` when there is nothing to judge (a photo, a raw string that is not one
 * colour, a named colour): an unanswerable question is never a fault, the same
 * rule parseColor and contrastFaults follow. A raw string that is one colour is
 * judged as that colour.
 */
export function readsOver(color, background, floor = AA_LARGE) {
  const fg = parseColor(color);
  if (!fg) return true;
  return backgroundColorsAt(background).every((bg) => contrastRatio(fg, bg) >= floor);
}
