// Keeping a supporting line attached to the claim it supports.
//
// A text layer is anchored by `yRatio`, its top edge, and it grows downward, so
// a headline that wraps one more line pushes into whatever sits beneath it. The
// presets deal with that by parking the subtitle a whole headline line below a
// single-line headline's bottom — which is why a one-line headline shows an
// empty line under it. That reservation is not a tuning slip, it is the only
// headroom absolute anchoring has: measured on Hero at the 6.9" canvas, the gap
// is 0.0342 of canvas height and a second headline line costs 0.0337, so there
// is no slack at all. Tightening the ratio puts the subtitle *on* the headline's
// second line on all eleven portrait devices.
//
// The stores do not have this problem because their supporting line follows the
// claim rather than sitting on a grid. Across 89 top-chart slides carrying a
// real two-size caption the gap is **0.0169 of canvas height** median (p25
// 0.008, p75 0.027) — half a line, not a whole one. The corpus is described in
// test/storeShape.test.js.
//
// So a subtitle may carry `followGap`: "keep my top this far below the
// headline's ink bottom". It is resolved on the **write** path, not on the read
// path — `resolveLayers` stays a pure merge, and the number that lands in
// `yRatio` is stored, so the preview, the render payload, the hash and the
// scorer all read the same value. Doing it in `resolveLayers` instead would make
// a layer's position depend on which host measured it: the editor passes a real
// browser measurer and the CLI falls back to the estimator, and the two disagree
// about a wrap often enough to move the subtitle a whole line between the
// picture you approved and the PNG you shipped.
//
// `followGap: null` means "leave me where I am", which is what every layer a
// user has positioned by hand carries, what a deck saved before this field
// existed carries, and what `thirds` carries — its subtitle belongs to the
// bottom of the canvas, not to the headline.
import { textInkBox } from "./textMetrics.js";

// Node spells a canvas canvasWidth/canvasHeight (src/devices.js), the editor
// width/height (the /api/state projection). Inlined rather than imported from
// layoutScore.js so this module stays a leaf that src/layoutPresets.js can
// import without either of them reaching the other.
const canvasOf = (device) => ({
  W: device?.canvasWidth ?? device?.width,
  H: device?.canvasHeight ?? device?.height,
});

// The market median. Deliberately the median rather than the p25: the gap is
// measured to the headline's *ink* bottom, and an ink box ends at the deepest
// descender on the last line, so a headline ending in a descender would set a
// tighter optical gap than one that does not. Half the corpus sits above 0.0169
// and half below; a tighter default would make that asymmetry visible.
export const CAPTION_GAP = 0.017;

/**
 * Where a following subtitle's `yRatio` should be, or null if it should not
 * move — no headline to measure, no subtitle, nothing to measure *with*, or the
 * subtitle is not following.
 *
 * Takes **resolved** layers. A role layer leaves `fontId` and `weight` null so
 * a theme can restyle it (`INHERITED_KEYS`), and a null font cannot be
 * measured, so calling this before `fillInherited` would size every headline
 * with the fallback face.
 */
export function flowedSubtitleY(layers, { device, measurer = null }) {
  const headline = layers.find((l) => l.role === "headline");
  const subtitle = layers.find((l) => l.role === "subtitle");
  if (!headline || !subtitle || subtitle.followGap == null) return null;
  // An empty headline has no ink box worth measuring, and snapping the subtitle
  // to the top of the canvas while someone clears the field and retypes it is
  // not a repair.
  if (!headline.text || headline.type !== "text") return null;
  const { W, H } = canvasOf(device);
  if (!Number.isFinite(W) || !Number.isFinite(H)) return null;
  const ink = textInkBox(headline, { W, H, device, measurer });
  if (!ink || !Number.isFinite(ink.y) || !Number.isFinite(ink.h)) return null;
  const y = (ink.y + ink.h) / H + subtitle.followGap;

  // It follows the headline down, and into the product shot only as far as it
  // has to to stay off the headline.
  //
  // Without a floor a headline long enough to take four lines pushes the
  // supporting line onto the device — and it would do it *quietly*, because a
  // subtitle sitting exactly on the device's top edge is inside scoreLayout's
  // tolerance. So where the room above the device is shorter than the line, the
  // gap closes first; only then does the line overlap the device, never the
  // headline. Text on text is unreadable in every language, and a translation
  // that ran out of room is where nobody looks before it ships; a line over the
  // device is still the overlap the scorer reports and Polish repairs by
  // shrinking the headline.
  //
  // The ceiling is only the device's top edge when the caption is *above* the
  // device. `lower-banner` inverts the slide — device at the top, claim
  // beneath — and reading the device's top there clamped the supporting line to
  // the top of the canvas, above the device and a full canvas away from the
  // headline it belongs to. Which side the caption is on is a fact about this
  // slide's layers, so it is read off them rather than assumed.
  const dev = layers.find((l) => l.type === "device");
  const devTop = dev?.yRatio ?? null;
  const inkBottom = (ink.y + ink.h) / H;
  const above = devTop != null && inkBottom <= devTop;
  const own = textInkBox(subtitle, { W, H, device, measurer });
  const ownH = own && Number.isFinite(own.h) ? own.h / H : 0;
  // Under the headline with nothing below but the canvas edge, it is held whole
  // on the canvas the same way — the gap closes first, then the line crops at
  // the bottom, never over the headline. Held whole regardless, a translation
  // too long for a lower-banner column printed its subtitle across its headline.
  const capped = above
    ? Math.min(y, Math.max(devTop - ownH, inkBottom))
    : Math.min(y, Math.max(1 - ownH, inkBottom));

  // The clamp is the same one `normalizeLayer` would apply. Returning a value
  // outside it would hand the caller a write that silently becomes a different
  // number, and then the next reflow would compute a third one.
  return Math.max(0, Math.min(1, Math.round(capped * 10000) / 10000));
}

// The layer fields that change where a headline's ink ends, and therefore the
// writes that have to be followed by a reflow. `yRatio` is here because the gap
// is measured from the ink bottom, which moves with the anchor; `wRatio`,
// `sizeMul`, `fontId`, `weight`, `lineHeight`, `letterSpacing`, `textCase` and
// `highlight` because each one changes the wrap or the line box; `accent`
// because it decides whether the braces in the text are drawn.
export const HEADLINE_METRIC_KEYS = new Set([
  "text",
  "yRatio",
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
