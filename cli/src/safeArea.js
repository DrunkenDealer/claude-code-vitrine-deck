// The safe area: the band a store's chrome leaves usable, in absolute canvas px.
//
// Node-API-free — web/src/state.js resolves per-slide overrides on top of this,
// and src/layoutScore.js scores against the band it produces. The arithmetic
// lives here rather than in state.js so the editor and anything measuring a
// candidate layout cannot disagree about where the line is.
export const DEFAULT_SAFE_AREA = {
  top: 75,
  bottom: 75,
  left: 50,
  right: 50,
};

// The default px above are authored against this reference canvas (iPhone 6.9").
// The default safe area is scaled per device relative to it so bigger devices
// get proportionally bigger insets — top/bottom by height, left/right by width.
export const SAFE_AREA_BASE = { width: 1320, height: 2868 };

// TVs use the title-safe / overscan convention rather than the store-edge insets
// a phone or tablet needs.
const TV_INSET = 0.05;

const sizeOf = (device) => ({
  W: device?.width ?? device?.canvasWidth ?? null,
  H: device?.height ?? device?.canvasHeight ?? null,
});

/**
 * A store's own art safe area (devices.js `artSafe`) as insets, or null for a
 * device without one. It is a store fact rather than a preference: the guide is
 * on whether or not the project's safe area is, and per-slide insets do not move
 * it, because Apple crops what is outside it whatever the project says.
 */
export function artSafeInsets(device) {
  const a = device?.artSafe;
  if (!a) return null;
  const { W, H } = sizeOf(device);
  return { top: a.y, left: a.x, bottom: H - a.y - a.h, right: W - a.x - a.w };
}

/** Whether layout grading and the editor's guide use a safe area for this device. */
export const safeAreaApplies = (enabled, device) => Boolean(enabled || device?.artSafe);

/**
 * Default insets for one device, in canvas px.
 *
 * `insets` are the project's own values, authored against SAFE_AREA_BASE.
 * Without a device they pass through unscaled, which is what the editor wants
 * before a device row has resolved.
 */
export function scaledSafeArea(device, insets = DEFAULT_SAFE_AREA) {
  const { W, H } = sizeOf(device);
  const art = artSafeInsets(device);
  if (art) return art;

  if (device?.category === "tv") {
    return {
      top: Math.round(H * TV_INSET),
      bottom: Math.round(H * TV_INSET),
      left: Math.round(W * TV_INSET),
      right: Math.round(W * TV_INSET),
    };
  }

  // The reference canvas is portrait, so a landscape device compares against it
  // with the axes swapped — otherwise a rotated phone gets a top inset scaled
  // against its long edge and the band comes out less than half the size.
  const landscape = W != null && H != null ? W > H : false;
  const baseW = landscape ? SAFE_AREA_BASE.height : SAFE_AREA_BASE.width;
  const baseH = landscape ? SAFE_AREA_BASE.width : SAFE_AREA_BASE.height;
  const sw = W != null ? W / baseW : 1;
  const sh = H != null ? H / baseH : 1;

  return {
    top: Math.round(insets.top * sh),
    bottom: Math.round(insets.bottom * sh),
    left: Math.round(insets.left * sw),
    right: Math.round(insets.right * sw),
  };
}

/**
 * The band a text layer's *anchor* may sit in, as yRatio bounds.
 *
 * The band is a guide: nothing moves a layer into it, so render output never
 * depends on the insets.
 */
export function safeYBounds({ H, topPx, bottomPx }) {
  return { lo: topPx / H, hi: 1 - bottomPx / H };
}
