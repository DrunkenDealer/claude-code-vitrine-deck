const HEADLINE_RATIO = 0.067;
// 0.077 of the headline, which is what the stores' own top listings measure at.
//
// It used to be 0.042 — a subtitle 0.63 of its headline. That reads as a
// caption under a title, and no shipped store screenshot sets one that way. A
// sample of the US top-25 free App Store apps and 24 top Play apps (first
// screenshots of each, 162 measurable portrait slides) has 89 slides carrying a
// real two-size caption, and their subtitle-to-headline ink-height ratio is
// **0.77 median** — the second line is in the same size class as the first, not
// a footnote to it. 0.0515/0.067 = 0.769.
//
// It is a ratio rather than a per-preset `sizeMul` because the error was in the
// relationship, not in any one layout: every preset inherited 0.63 and then most
// of them widened the gap further by giving the headline the larger multiplier.
// Fixing it here fixes it for the presets, the looks, the themes and every deck
// already saved, and leaves `sizeMul` free to carry a preset's character.
const SUBTITLE_RATIO = 0.0515;
// Landscape (TV) canvases are short; a caption sized like a portrait one reads
// too heavy, so scale it down relative to the short (height) edge. The pair
// keeps the same 0.77 relationship (0.036/0.047).
const HEADLINE_RATIO_LANDSCAPE = 0.047;
const SUBTITLE_RATIO_LANDSCAPE = 0.036;

export const PHONE_FRAME_FOR_PLATFORM = {
  ios: "iphone-6.9-black",
  android: "pixel-10",
};

// The phone frame a tablet row falls back to when the deck has no tablet slides.
export const PHONE_FRAME_FOR_PLATFORM_LANDSCAPE = {
  ios: "iphone-6.9-black-landscape",
  android: "pixel-10-landscape",
};

// Font size keys off the shorter canvas edge, not the width. For portrait
// devices that's the width (unchanged), but for landscape devices (TV) it keeps
// text proportional to the visible height instead of ballooning off the long
// horizontal edge.
export const sizesFor = (canvasWidth, canvasHeight) => {
  const base = Math.min(canvasWidth, canvasHeight);
  const landscape = canvasWidth > canvasHeight;
  return {
    headlineFontSize: Math.round(base * (landscape ? HEADLINE_RATIO_LANDSCAPE : HEADLINE_RATIO)),
    subtitleFontSize: Math.round(base * (landscape ? SUBTITLE_RATIO_LANDSCAPE : SUBTITLE_RATIO)),
  };
};

// `sizes` overrides the edge-derived pair. Only the feature graphic needs it: a
// 1024×500 banner is landscape by shape but is read like a poster rather than a
// screen, and 0.047 of its short edge is a 24px headline on an asset that exists
// to carry three words.
//
// `artSafe` is a store's own "art safe area" in canvas px, `{ x, y, w, h }`: the
// box the store promises not to crop on any device or orientation. Only the App
// Store banners have one; see src/safeArea.js for how it replaces the editable
// insets.
const device = ({ label, canvasWidth, canvasHeight, frame, category, platform, sizes, artSafe }) => ({
  label,
  canvasWidth,
  canvasHeight,
  frame,
  category,
  platform,
  ...(sizes ?? sizesFor(canvasWidth, canvasHeight)),
  ...(artSafe ? { artSafe } : {}),
});

export const DEVICES = {
  // One row per App Store Connect upload slot, the required one first. Since
  // October 2026 the slot every iPhone submission must fill is "Dynamic Island
  // (medium)" — the 6.1"/6.3" slot, 1179×2556 or 1206×2622 — not 6.9", which is
  // now optional. A deck made on 6.9 alone could not be submitted. The 6.1" row
  // used to render 1170×2532, a Face ID (medium) size the 6.1"/6.3" slot does
  // not take, so its label pointed at the required slot and its file at an
  // optional one; it is retired into this row. See src/storeFit.js.
  "iphone-6.3": device({ label: 'iPhone 6.3"', canvasWidth: 1206, canvasHeight: 2622, frame: "iphone-6.9-black", category: "phone", platform: "ios" }),
  "iphone-6.9": device({ label: 'iPhone 6.9"', canvasWidth: 1320, canvasHeight: 2868, frame: "iphone-6.9-black", category: "phone", platform: "ios" }),
  "iphone-6.5": device({ label: 'iPhone 6.5"', canvasWidth: 1284, canvasHeight: 2778, frame: "iphone-6.9-black", category: "phone", platform: "ios" }),
  // iPhone Duo's two displays are two App Store slots. The outer one is a phone;
  // the inner one is 2007×2853, iPad-shaped, so it is a tablet row and shares
  // the iPad slides — which is what a foldable open flat shows. Optional until
  // April 2027, when apps built on the iOS 27.1 SDK must supply them.
  "iphone-duo": device({ label: "iPhone Duo", canvasWidth: 1398, canvasHeight: 2034, frame: "iphone-duo-outer", category: "phone", platform: "ios" }),

  // 13" is the required iPad slot, and it is also the 12.9" one: the Console's
  // "iPad 12.9" or 13"" slot takes 2048×2732 and 2064×2752 alike, so a 12.9"
  // row only rendered a second set for the same slot. Retired into this row.
  "ipad-13": device({ label: 'iPad 13"', canvasWidth: 2064, canvasHeight: 2752, frame: "ipad-3-4-black", category: "tablet", platform: "ios" }),
  "ipad-11": device({ label: 'iPad 11"', canvasWidth: 1668, canvasHeight: 2420, frame: "ipad-11-black", category: "tablet", platform: "ios" }),
  "ipad-10.5": device({ label: 'iPad 10.5"', canvasWidth: 1668, canvasHeight: 2224, frame: "ipad-3-4-black", category: "tablet", platform: "ios" }),
  "iphone-duo-inner": device({ label: "iPhone Duo inner", canvasWidth: 2007, canvasHeight: 2853, frame: "iphone-duo-inner", category: "tablet", platform: "ios" }),

  // One Android phone row, because Play's uploader takes one shape: the Console
  // asks for "16:9 or 9:16" and nothing else. The handset rows that used to live
  // here — Pixel 10 at 20:9, the Pro XL, the S25 — were all real device shapes
  // and all refused at upload, which made them a menu of traps. See
  // src/storeFit.js.
  "android-phone": device({ label: "Android phone", canvasWidth: 1080, canvasHeight: 1920, frame: "pixel-10", category: "phone", platform: "android" }),

  // Both Play tablet slots are 16:9/9:16 too, and the 10" slot floors every side
  // at 1080px rather than 320px — 1440×2560 clears both. The 7" row shares the
  // phone canvas and differs only in its frame, which is what the Console asks
  // for: same shape, its own upload slot.
  "android-tablet-7": device({ label: 'Android 7" tablet', canvasWidth: 1080, canvasHeight: 1920, frame: "android-tablet-black", category: "tablet", platform: "android" }),
  "android-tablet-10": device({ label: 'Android 10" tablet', canvasWidth: 1440, canvasHeight: 2560, frame: "android-tablet-black", category: "tablet", platform: "android" }),

  // Landscape is a separate *kind*, not a flag on a slide: one kind maps to one
  // orientation, which is the invariant the sidebar tabs, scene pairing, deck
  // ordering and preset resolution all rest on. A phone slide and its landscape
  // counterpart are different slides with different layouts, which is what they
  // actually are.
  // The required slot's landscape size, first for the same reason as portrait.
  "iphone-6.3-landscape": device({ label: 'iPhone 6.3" landscape', canvasWidth: 2622, canvasHeight: 1206, frame: "iphone-6.9-black-landscape", category: "phone-landscape", platform: "ios" }),
  "iphone-6.9-landscape": device({ label: 'iPhone 6.9" landscape', canvasWidth: 2868, canvasHeight: 1320, frame: "iphone-6.9-black-landscape", category: "phone-landscape", platform: "ios" }),
  "iphone-duo-landscape": device({ label: "iPhone Duo landscape", canvasWidth: 2034, canvasHeight: 1398, frame: "iphone-duo-outer-landscape", category: "phone-landscape", platform: "ios" }),
  // 1920×1080 is 16:9 and is also Play's featuring landscape size, so the one
  // landscape phone row a deck can upload is the one that earns the slot.
  "android-phone-landscape": device({ label: "Android phone landscape", canvasWidth: 1920, canvasHeight: 1080, frame: "pixel-10-landscape", category: "phone-landscape", platform: "android" }),
  "ipad-13-landscape": device({ label: 'iPad 13" landscape', canvasWidth: 2752, canvasHeight: 2064, frame: "ipad-3-4-black-landscape", category: "tablet-landscape", platform: "ios" }),
  "iphone-duo-inner-landscape": device({ label: "iPhone Duo inner landscape", canvasWidth: 2853, canvasHeight: 2007, frame: "iphone-duo-inner-landscape", category: "tablet-landscape", platform: "ios" }),
  "android-tablet-10-landscape": device({ label: 'Android 10" tablet landscape', canvasWidth: 2560, canvasHeight: 1440, frame: "android-tablet-black-landscape", category: "tablet-landscape", platform: "android" }),

  // Platform-neutral: tvOS and Android TV both take 1920x1080 landscape and
  // share the generic TV frame, so one entry renders the asset both stores get.
  "tv": device({ label: "TV", canvasWidth: 1920, canvasHeight: 1080, frame: "tv-black", category: "tv" }),

  // Mandatory on every Play listing and not a screenshot: 1024×500 exactly, so
  // Play's 2:1 screenshot cap does not apply to it (it is 2.05:1 by
  // specification). A phone frame because a device layer on one is optional but
  // common; the kind ships without a device layer by default.
  "play-feature-graphic": device({
    label: "Play feature graphic",
    canvasWidth: 1024,
    canvasHeight: 500,
    frame: "pixel-10",
    category: "feature-graphic",
    platform: "android",
    sizes: { headlineFontSize: 72, subtitleFontSize: 36 },
  }),

  // The App Store's banners (App Store Connect → Product Page Information →
  // "Header and Search Results", new with iOS 27). Apple crops both to whatever
  // the viewer's device and orientation leave, and keeps only the art safe area
  // intact, so the caption is sized to that box rather than to the canvas: 0.047
  // of a 1646px edge would be a 77px headline in a 661px band. Search results
  // take any 3:2 from 1920×1280 to 3840×2560; the largest, because the safe area
  // Apple publishes is stated against it. Creative assets specifications, read
  // 2026-11-14 — see APP_STORE_BANNERS in src/storeFit.js.
  "app-store-header": device({
    label: "App Store header",
    canvasWidth: 3840,
    canvasHeight: 1646,
    frame: "iphone-6.9-black",
    category: "page-header",
    platform: "ios",
    sizes: { headlineFontSize: 130, subtitleFontSize: 100 },
    artSafe: { x: 1097, y: 493, w: 1646, h: 661 },
  }),
  "app-store-search": device({
    label: "App Store search result",
    canvasWidth: 3840,
    canvasHeight: 2560,
    frame: "iphone-6.9-black",
    category: "search-result",
    platform: "ios",
    sizes: { headlineFontSize: 180, subtitleFontSize: 140 },
    artSafe: { x: 836, y: 765, w: 2168, h: 1030 },
  }),
};

// Rows that have been retired, and what a deck naming one should be read as.
// Retirements so far: "apple-tv"/"android-tv" merged into one platform-neutral
// "tv", and the phone rows that no store would take — the 20:9 handsets Play
// refuses, plus iPhone 6.7", which App Store Connect's Media Manager no longer
// offers a slot for, and iPhone 6.1" / iPad 12.9", which rendered a second set
// for a slot another row already fills (see DEVICES). Remapped rather than rejected: a deck that predates the
// pruning is a deck somebody made, and the nearest surviving row is a better
// answer than an error. Shared by both hosts so the CLI and the editor agree —
// see migrateDeck in web/src/lib/persist.js.
export const RETIRED_DEVICE_IDS = {
  "apple-tv": "tv",
  "android-tv": "tv",
  "iphone-6.7": "iphone-6.5",
  "iphone-6.1": "iphone-6.3",
  "ipad-12.9": "ipad-13",
  "pixel-10": "android-phone",
  "pixel-10-pro-xl": "android-phone",
  "samsung-s25": "android-phone",
  "android-phone-2to1": "android-phone",
  "pixel-10-landscape": "android-phone-landscape",
  "android-phone-2to1-landscape": "android-phone-landscape",
};

// The id a retired one is remapped to, or the id itself. An own-property lookup:
// a deck's projectDevices is any JSON, and "constructor" or "toString" found
// Object.prototype's function through a bare index, which then crashed the
// loader with "Cannot read properties of undefined" instead of reporting an
// unknown device (N480).
export const currentDeviceId = (id) =>
  typeof id === "string" && Object.hasOwn(RETIRED_DEVICE_IDS, id) ? RETIRED_DEVICE_IDS[id] : id;

// The remap applied, for a caller that has its own way of reporting an unknown
// id — the batch validator collects errors rather than throwing, and the server
// answers 400. Both used to index DEVICES directly, which made a retired id an
// error on those two paths and a working row on every other one.
//
// `id` comes off the network as any JSON value: an object id threw from the key
// conversion (a 500 with a stack) and "__proto__" returned Object.prototype, so
// only a string naming an own key counts.
export const lookupDevice = (id) => {
  if (typeof id !== "string") return null;
  const key = Object.hasOwn(RETIRED_DEVICE_IDS, id) ? RETIRED_DEVICE_IDS[id] : id;
  return Object.hasOwn(DEVICES, key) ? DEVICES[key] : null;
};

// The canvas a slide of this kind has its shared column solved on: the first of
// the kind in DEVICES order, whatever order the project lists its devices in.
// The editor solves the shared ratios on this device and stores every other
// canvas's column in `solved.byDevice`, so a reader that picks another base
// draws that canvas with the wrong column (N362: an android phone drawn with the
// iPhone's). Ids DEVICES does not know rank last, in the order given.
export function baseCanvasFor(kind, devices) {
  const order = Object.keys(DEVICES);
  const rank = (d) => {
    const i = order.indexOf(d.id);
    return i < 0 ? order.length : i;
  };
  let best = null;
  for (const d of devices) {
    if (d.category === kind && (best === null || rank(d) < rank(best))) best = d;
  }
  return best;
}

export function resolveDevice(id) {
  const d = lookupDevice(id);
  if (!d) {
    throw new Error(
      `Unknown device "${id}". Available: ${Object.keys(DEVICES).join(", ")}`
    );
  }
  return d;
}
