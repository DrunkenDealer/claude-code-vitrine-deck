// Whether the store will take the file at all.
//
// src/layoutScore.js grades the design and src/contrast.js grades the colours;
// both can say a cell is perfect while the PNG it names is refused at upload,
// because neither of them knows anything about a store. Vitrine used to ship a
// `pixel-10` row at 1080×2424 — a real handset's 20:9, and refused by Play — and
// the only place that was ever written down was a prompt. The Android rows are
// 16:9 now, so this grader mostly guards canvases somebody authored by hand.
//
// This is a third grader, reported beside the layout penalty for the same reason
// contrast is: it measures something else, and it is not something a geometric
// repair may act on. A canvas is not too tall in a way Polish can fix.
//
// Everything here is the stores' own arithmetic, sourced below. The one number
// that is *ours* lives in src/thumbnail.js and is labelled as such there.
//
// Node-API-free like the rest of src/ that both hosts share.
import { DEVICES } from "./devices.js";
import { DEVICELESS_KINDS, slidesForDevice } from "./deck.js";

export const STORE_FIT = "store-fit";
export const SLOT_COUNT = "slot-count";
export const FEATURING = "featuring";
export const NO_FEATURE_GRAPHIC = "no-feature-graphic";
export const REQUIRED_SLOT = "required-slot";

export const STORE_FAULT_LABEL = {
  [STORE_FIT]: "a canvas the store refuses",
  [SLOT_COUNT]: "the wrong number of screenshots for a store slot",
  [FEATURING]: "ineligible for store featuring",
  [NO_FEATURE_GRAPHIC]: "no Play feature graphic",
  [REQUIRED_SLOT]: "no row for a slot App Store Connect requires",
};

// What storeFaults emits for each code. store-fit is a warn when the store's rule
// cannot verify the canvas (uploadable null), a block when it refuses it.
export const STORE_FAULT_SEVERITY = {
  [STORE_FIT]: "block",
  [SLOT_COUNT]: "block",
  [FEATURING]: "warn",
  [NO_FEATURE_GRAPHIC]: "warn",
  [REQUIRED_SLOT]: "warn",
};

export const STORE_FAULT_HINT = {
  [STORE_FIT]: "move this row to a canvas the store accepts — detail.alternative names one — or set defaults.storeCheck: false for a deck not meant for a store",
  [SLOT_COUNT]: "select more or fewer slides for this row (detail.min–detail.max); unselected slides do not count",
  [FEATURING]: "optional: Play features listings with more screenshots (detail.want) on canvases at least its short-side floor",
  [NO_FEATURE_GRAPHIC]: "add a feature-graphic slide on the play-feature-graphic row (capabilities.kinds); every Play listing needs one",
  [REQUIRED_SLOT]: "add the row in detail.alternative to projectDevices, or ignore it if that row is checked in another run",
};

// ---- Google Play ------------------------------------------------------------
//
// Two Google sources that do not say the same thing. The help page —
// support.google.com/googleplay/android-developer/answer/9866151, read
// 2026-09-09 — says the long side may not exceed twice the short side. The
// Console's own uploader, read 2026-09-10, asks for "16:9 or 9:16 aspect ratio"
// on all three screenshot slots and nothing else.
//
// The uploader is the thing that actually refuses the file, so 16:9 is the rule
// here. It is also the strict one: everything it accepts, the help page accepts
// too, so a deck that clears this cannot be refused by either reading. That is
// the whole reason to encode the tighter of two disagreeing sources.
//
// The Console also floors the 10" tablet slot at 1080px a side rather than
// 320px. Not modelled: `category` does not separate the 7" slot from the 10"
// one, and every tablet row Vitrine ships is over 1080 by construction.
//
// "Store listing assets" — the feature graphic is 1024×500 exactly and is
// mandatory on every listing, which is why the aspect rule is not applied to it:
// it is 2.048:1 by specification.
export const PLAY = {
  screenshot: { minSidePx: 320, maxSidePx: 3840, aspect: [16, 9], slots: [2, 8] },
  featureGraphic: { widthPx: 1024, heightPx: 500 },
  // "For apps, you must provide at least four screenshots with minimum 1080px
  // resolution. These should be 16:9 for landscape (minimum 1920x1080px)
  // screenshots and 9:16 for portrait screenshots (minimum 1080x1920px)." —
  // read 2026-10-20. Either orientation: this used to also demand a landscape
  // row, which warned on every portrait-only deck that was in fact eligible.
  featuring: { minScreenshots: 4, minSidePx: 1080 },
  source: "https://support.google.com/googleplay/android-developer/answer/9866151",
  // `screenshot.aspect` is the one rule here the page above does not state — it
  // says the long side may not exceed twice the short. Attributed separately so
  // a reader checking the value against the URL does not find them disagreeing
  // and assume the value is the stale one. It is the other way round.
  screenshotSource: { where: "Play Console, store listing uploader", readOn: "2026-09-10" },
};

// ---- App Store --------------------------------------------------------------
//
// "Screenshot specifications" —
// developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
// Read 2026-10-20.
//
// Apple publishes a *list*, not a rule: there is no aspect cap, and a canvas is
// accepted because it appears on the list. A copy of a list goes stale in a way
// a rule does not — which is why an unlisted size is reported as **unverified**
// rather than as a refusal. `uploadable: null` is a real answer meaning "no
// opinion", the same way src/contrast.js's parseColor returns null for a colour
// it cannot judge.
//
// Portrait pairs; either orientation of a pair is listed. The pre-iOS-7 classes
// that also list a shorter "without status bar" variant are left out — no device
// row targets one, and half a legacy table is worse than none.
// iPhone Duo, outer and inner display. Optional for now; Apple requires it from
// April 2027 for apps built with the iOS 27.1 SDK or later.
const DUO_SIZES = [[1398, 2034], [2007, 2853]];

const APP_STORE_SIZES = [
  ...DUO_SIZES,
  // iPhone 6.9" / 6.5" / 6.3" / 6.1" and the classes below them.
  [1260, 2736], [1290, 2796], [1320, 2868],
  [1284, 2778], [1242, 2688],
  [1179, 2556], [1206, 2622],
  [1170, 2532], [1125, 2436], [1080, 2340],
  [1242, 2208], [750, 1334], [640, 1136], [640, 960],
  // iPad 13" / 12.9" / 11" / 10.5" / 9.7".
  [2064, 2752], [2048, 2732],
  [1488, 2266], [1668, 2420], [1668, 2388], [1640, 2360],
  [1668, 2224], [1536, 2048], [768, 1024],
  // Apple TV (3840×2160 is also Apple Vision Pro's one size).
  [1080, 1920], [2160, 3840],
  // Mac, all 16:10.
  [800, 1280], [900, 1440], [1600, 2560], [1800, 2880],
];

// The display classes App Store Connect will not submit without — "To submit
// your app, you must provide screenshots for … iPhone: At least one screenshot
// for iPhone with Dynamic Island (medium display). iPad (if your app supports
// iPadOS): At least one screenshot for iPad 13-inch display." Since October
// 2026 the iPhone one is the 6.1"/6.3" class; before, it was 6.9", which is
// what every default in Vitrine used to point at. Matched by canvas, either
// orientation, so a hand-authored 1179×2556 counts the same as iphone-6.3.
const REQUIRED_CLASSES = [
  { categories: ["phone", "phone-landscape"], sizes: [[1179, 2556], [1206, 2622]], row: "iphone-6.3", name: 'iPhone 6.1"/6.3" (Dynamic Island, medium)' },
  // The Duo's inner display is a tablet row but not an iPad: a deck for an
  // iPhone-only app that fills it owes Apple no iPad set.
  { categories: ["tablet", "tablet-landscape"], sizes: [[2064, 2752], [2048, 2732]], except: DUO_SIZES, row: "ipad-13", name: 'iPad 13"' },
];

// "Product page header, search results, and universal asset" —
// developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/
// Read 2026-11-14. Exact for the header; the search result takes any 3:2 in a
// range. Both are optional, one per localization, JPEG or PNG without alpha
// (Vitrine's PNGs are opaque: every slide has a background). The art safe areas
// live on the device rows (devices.js `artSafe`).
export const APP_STORE_BANNERS = {
  "page-header": { name: "product page header", widthPx: 3840, heightPx: 1646 },
  "search-result": { name: "search results asset", minPx: [1920, 1280], maxPx: [3840, 2560], aspect: [3, 2] },
  source: "https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/",
};

export const APP_STORE = {
  slots: [1, 10],
  source: "https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/",
};

const LISTED = new Set(APP_STORE_SIZES.flatMap(([w, h]) => [`${w}x${h}`, `${h}x${w}`]));

// ---- per-device verdicts ----------------------------------------------------

const canvas = (device) => ({
  W: device?.canvasWidth ?? device?.width,
  H: device?.canvasHeight ?? device?.height,
});

const round2 = (n) => Math.round(n * 100) / 100;

// Which stores a device row is an asset for. A platform-neutral row — the TV,
// which tvOS and Android TV both take at 1920×1080 — is an asset for both.
export function storesFor(device) {
  if (device.platform === "ios") return ["appStore"];
  if (device.platform === "android") return ["play"];
  return ["appStore", "play"];
}

function playVerdict(device) {
  const { W, H } = canvas(device);
  if (!Number.isFinite(W) || !Number.isFinite(H)) return { uploadable: null, reason: "no canvas size" };
  const short = Math.min(W, H);
  const long = Math.max(W, H);

  if ((device.category ?? device.kind) === "feature-graphic") {
    const { widthPx, heightPx } = PLAY.featureGraphic;
    return W === widthPx && H === heightPx
      ? { uploadable: true, reason: null }
      : {
          uploadable: false,
          reason: `a Play feature graphic is exactly ${widthPx}×${heightPx}, not ${W}×${H}`,
        };
  }

  const { minSidePx, maxSidePx, aspect } = PLAY.screenshot;
  if (short < minSidePx || long > maxSidePx) {
    return {
      uploadable: false,
      reason: `${W}×${H} — Play takes ${minSidePx}-${maxSidePx}px on every side`,
    };
  }
  // Cross-multiplied rather than compared as a decimal: 16/9 has no exact float,
  // so `long / short === 16 / 9` is a coin toss on sizes that are in fact 16:9.
  const [aw, ah] = aspect;
  if (long * ah !== short * aw) {
    return {
      uploadable: false,
      reason:
        `Play takes ${aw}:${ah} or ${ah}:${aw} only (${W}×${H} is ${round2(long / short)}:1)`,
    };
  }
  return { uploadable: true, reason: null };
}

function appStoreVerdict(device) {
  const { W, H } = canvas(device);
  if (!Number.isFinite(W) || !Number.isFinite(H)) return { uploadable: null, reason: "no canvas size" };
  const banner = APP_STORE_BANNERS[device.category ?? device.kind];
  if (banner?.widthPx) {
    return W === banner.widthPx && H === banner.heightPx
      ? { uploadable: true, reason: null }
      : { uploadable: false, reason: `an App Store ${banner.name} is exactly ${banner.widthPx}×${banner.heightPx}, not ${W}×${H}` };
  }
  if (banner?.aspect) {
    const [aw, ah] = banner.aspect;
    const fits = W * ah === H * aw && W >= banner.minPx[0] && W <= banner.maxPx[0];
    return fits
      ? { uploadable: true, reason: null }
      : {
          uploadable: false,
          reason: `an App Store ${banner.name} is ${aw}:${ah}, ${banner.minPx.join("×")} to ${banner.maxPx.join("×")}, not ${W}×${H}`,
        };
  }
  if (LISTED.has(`${W}x${H}`)) return { uploadable: true, reason: null };
  return {
    uploadable: null,
    reason: `${W}×${H} is not a size App Store Connect lists — confirm before upload`,
  };
}

const VERDICT = { play: playVerdict, appStore: appStoreVerdict };

/**
 * Whether each store this device is an asset for will take its canvas.
 *
 * `{ play, appStore }`, each `{ uploadable, reason }` or null when the row is
 * not that store's asset at all. `uploadable` is true / false / null, and null
 * means unverified rather than refused — see APP_STORE_SIZES.
 */
export function storeFitFor(device) {
  const stores = new Set(storesFor(device));
  return {
    play: stores.has("play") ? VERDICT.play(device) : null,
    appStore: stores.has("appStore") ? VERDICT.appStore(device) : null,
  };
}

// A row of the same shape that the same store would actually accept, so a fault
// can name the way out rather than only the way in. Every row Vitrine ships is
// uploadable now, so this answers for hand-authored canvases. Widest first, then
// tallest: a bigger canvas scales down to the smaller classes, which is what
// both stores do with it, and the ordering is explicit rather than leaning on a
// stable sort over DEVICES order.
export function compliantAlternative(device, store) {
  const category = device.category ?? device.kind;
  return (
    Object.entries(DEVICES)
      .filter(([, d]) => d.category === category && d.platform === device.platform)
      .filter(([, d]) => storeFitFor(d)[store]?.uploadable === true)
      .sort((a, b) => b[1].canvasWidth - a[1].canvasWidth || b[1].canvasHeight - a[1].canvasHeight)
      .map(([id]) => id)[0] ?? null
  );
}

// ---- the deck's shape -------------------------------------------------------

const fault = (code, severity, deviceId, detail) => ({ code, severity, deviceId, detail, hint: STORE_FAULT_HINT[code] });

const SLOTS = { play: PLAY.screenshot.slots, appStore: APP_STORE.slots };

const STORE_NAME = { play: "Google Play", appStore: "the App Store" };

/**
 * The device rows whose slide count passes their store's cap — App Store 10,
 * Play 8 (both from the stores' own pages, cited above). Counted the way the
 * export counts, fallback included. Read by the editor's ZIP summary, which
 * warns and still ships the files: a store refuses the extras at upload, which
 * is not a reason to withhold the PNGs.
 */
export function overSlotLimit(screenshots, devices) {
  const over = [];
  for (const device of devices) {
    const n = slidesForDevice(screenshots ?? [], device).length;
    const banner = DEVICELESS_KINDS.has(device.category ?? device.kind);
    for (const store of storesFor(device)) {
      const max = banner ? 1 : SLOTS[store][1];
      if (n > max) over.push({ deviceId: device.id, label: device.label ?? device.id, store, count: n, max });
    }
  }
  return over;
}

/**
 * The App Store slots a deck has iOS rows for but does not fill — see
 * REQUIRED_CLASSES. Only rows with slides in them count, either way: an empty
 * 6.3" row uploads nothing. Shared by `check` and the editor's ZIP summary.
 */
export function missingRequiredSlots(screenshots, devices) {
  const ios = devices.filter((d) => d.platform === "ios" && slidesForDevice(screenshots ?? [], d).length > 0);
  const sized = (d, sizes) => {
    const { W, H } = canvas(d);
    return sizes.some(([w, h]) => (W === w && H === h) || (W === h && H === w));
  };
  return REQUIRED_CLASSES.filter(({ categories, sizes, except = [] }) => {
    const family = ios.filter((d) => categories.includes(d.category ?? d.kind) && !sized(d, except));
    return family.length > 0 && !family.some((d) => sized(d, sizes));
  });
}

export const requiredSlotMessage = ({ row, name }) =>
  `No ${name} screenshots — App Store Connect will not submit without them. Check the ${DEVICES[row].label} row`;

export const slotLimitMessage = (o) =>
  `${o.label}: ${o.count} slides, but ${STORE_NAME[o.store]} takes ${o.max} per device — it will refuse the extra ${o.count - o.max}`;

/**
 * Every store fault a deck has: a canvas the store refuses, a row with the wrong
 * number of screenshots in it, and the two things that cost Play featuring.
 *
 * Device-level rather than per-cell on purpose — a canvas is refused once, not
 * once per locale, and repeating the same line across forty cells is how a gate
 * teaches people to skim it.
 */
export function storeFaults(deck, devices) {
  const screenshots = deck.screenshots ?? [];
  const faults = [];

  for (const device of devices) {
    const fit = storeFitFor(device);
    for (const store of storesFor(device)) {
      const verdict = fit[store];
      if (verdict?.uploadable === false) {
        const alternative = compliantAlternative(device, store);
        faults.push(fault(STORE_FIT, "block", device.id, {
          store,
          width: canvas(device).W,
          height: canvas(device).H,
          reason: verdict.reason,
          alternative,
        }));
      } else if (verdict?.uploadable === null) {
        faults.push(fault(STORE_FIT, "warn", device.id, { store, reason: verdict.reason }));
      }
    }

    // How many images this row actually produces per language, fallback and all
    // — the same walk deckCells does, so the count is the upload rather than a
    // guess about it.
    const n = slidesForDevice(screenshots, device).length;
    if (n === 0) continue;

    // A banner is one image per listing, in either store.
    if (DEVICELESS_KINDS.has(device.category ?? device.kind)) {
      if (n > 1) {
        for (const store of storesFor(device)) {
          faults.push(fault(SLOT_COUNT, "block", device.id, { store, count: n, min: 1, max: 1 }));
        }
      }
      continue;
    }

    for (const store of storesFor(device)) {
      const [lo, hi] = SLOTS[store];
      if (n < lo || n > hi) {
        faults.push(fault(SLOT_COUNT, "block", device.id, { store, count: n, min: lo, max: hi }));
      } else if (store === "play" && n < PLAY.featuring.minScreenshots) {
        faults.push(fault(FEATURING, "warn", device.id, {
          store: "play", count: n, want: PLAY.featuring.minScreenshots,
          reason: `Play wants ${PLAY.featuring.minScreenshots}+ screenshots to be eligible for featuring`,
        }));
      } else if (store === "play" && Math.min(canvas(device).W, canvas(device).H) < PLAY.featuring.minSidePx) {
        faults.push(fault(FEATURING, "warn", device.id, {
          store: "play",
          reason: `Play wants ${PLAY.featuring.minSidePx}px or more on the short side to be eligible for featuring`,
        }));
      }
    }
  }

  // A warning, not a block: `check --device` grades a subset of the deck's rows
  // on purpose, and the required row may simply be outside it.
  for (const { row, name } of missingRequiredSlots(screenshots, devices)) {
    faults.push(fault(REQUIRED_SLOT, "warn", null, {
      store: "appStore",
      reason: `App Store Connect will not submit without an ${name} set`,
      alternative: row,
    }));
  }

  const play = devices.filter((d) => storesFor(d).includes("play"));
  if (play.length) {
    if (!play.some((d) => (d.category ?? d.kind) === "feature-graphic")) {
      faults.push(fault(NO_FEATURE_GRAPHIC, "warn", null, {
        store: "play",
        reason: "every Play listing needs a 1024×500 feature graphic — add a feature-graphic slide and check the play-feature-graphic row",
      }));
    }
  }

  return faults;
}
