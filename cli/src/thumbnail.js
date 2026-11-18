// How big the type is where the shopper actually meets it.
//
// Every other size in this repo is measured on the canvas, which is the one
// place a store listing is never seen. A 1320px-wide screenshot reaches a search
// result about 300px wide, and an 88px headline arrives there at 20px — so the
// interesting question about a caption is not "is it readable at 1320px" (it
// always is) but "does it survive the 4.5× reduction between here and the store".
// src/layoutScore.js asks the first question; this is what lets it ask the second,
// and it is also what src/contrast.js needs to know whether a layer is WCAG
// *large text* at the size it is read at rather than at the size it is drawn.
//
// **These numbers are ours, not the stores'.** Neither Apple nor Google publishes
// the size a listing thumbnail is rendered at — it varies by surface, device and
// density. 300px is a practitioner measurement of a phone search result, and the
// floors are the size at which a caption stays legible there. Tunable, unlike
// everything in src/storeFit.js, which is the stores' own arithmetic.
//
// Node-API-free, and dependency-free on purpose: layoutScore, contrast, polish
// and capabilities all read it.

// A portrait screenshot in a search result's strip. The strip's height is the
// same measurement seen the other way round — 300px of a 19.5:9 phone canvas is
// ~650px tall — and a landscape asset is fitted to that strip rather than to the
// 300px width, so it is scaled by height. Scaling a 1920×1080 TV canvas to 300px
// wide would put its headline at 8px and fault every landscape slide there is,
// which is a statement about the model rather than about the deck.
const WIDTH_PX = 300;
const HEIGHT_PX = 650;

// The Play feature graphic is the listing's header image, not one of the strip's
// screenshots: it is shown at roughly its own 1024px width, so nothing scales
// down and the floor is met at the size it is drawn.
const UNSCALED_KINDS = new Set(["feature-graphic"]);

// Below this, at thumbnail scale, a caption stops being read and starts being
// texture. Two floors because a headline carries the slide and a subtitle only
// has to be legible if you look — the same distinction WCAG draws between
// content and supporting text, at sizes an app-store shopper actually sees.
export const HEADLINE_FLOOR_PX = 17;
export const TEXT_FLOOR_PX = 12;

export const THUMBNAIL = {
  widthPx: WIDTH_PX,
  heightPx: HEIGHT_PX,
  headlineFloorPx: HEADLINE_FLOOR_PX,
  textFloorPx: TEXT_FLOOR_PX,
  note:
    "not a store rule — a measured store search result. Portrait canvases are scaled to " +
    `${WIDTH_PX}px wide, landscape ones to ${HEIGHT_PX}px tall (the same strip, seen the other way ` +
    "round), and a feature graphic is not scaled at all.",
};

/**
 * What one canvas pixel becomes on a store thumbnail, or null when the device
 * has no canvas to scale. Takes a device in either host's spelling, the way
 * layoutScore.canvasOf does.
 */
export function thumbnailScale(device) {
  const W = device?.canvasWidth ?? device?.width;
  const H = device?.canvasHeight ?? device?.height;
  if (!Number.isFinite(W) || !Number.isFinite(H)) return null;
  if (UNSCALED_KINDS.has(device?.category ?? device?.kind)) return 1;
  return W > H ? HEIGHT_PX / H : WIDTH_PX / W;
}

// The floor a role has to clear. `null` is a text layer the user added, which
// gets the supporting-text floor: it is not the line carrying the slide.
export const thumbnailFloorFor = (role) =>
  role === "headline" ? HEADLINE_FLOOR_PX : TEXT_FLOOR_PX;

/** A canvas font size, in thumbnail px. Null when there is nothing to scale by. */
export function thumbnailPx(fontSizePx, device) {
  const scale = thumbnailScale(device);
  return scale == null || !Number.isFinite(fontSizePx) ? null : fontSizePx * scale;
}

/**
 * Does this size still read where the listing is met? `true` when there is
 * nothing to measure with — an unanswerable question is not a fault.
 */
export function readsOnThumbnail(role, fontSizePx, device) {
  const px = thumbnailPx(fontSizePx, device);
  return px == null || px >= thumbnailFloorFor(role);
}
