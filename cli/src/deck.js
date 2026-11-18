// A deck, resolved.
//
// The merge that turns a stored deck into the layers a canvas actually paints —
// per-device override, then per-locale, then the project defaults — used to live
// inside web/src/state.js wired to signals. That is why the CLI could not render
// what the editor renders: the same deck had two resolvers and only one of them
// existed. This is that resolver with the signal reads turned into parameters,
// so both hosts read a deck through one definition. state.js keeps one-line
// wrappers that supply the signals, which is why no component changed.
//
// Node-API-free like layoutScore.js / visual.js / geometry.js — both hosts
// import it, and the CLI imports it without a localStorage shim.
import {
  DEVICE_LAYER_ID,
  HEADLINE_LAYER_ID,
  SUBTITLE_LAYER_ID,
  baseFontSize,
  makeDeviceLayer,
  makeTextLayer,
  normalizeLayer,
} from "./layers.js";
import { getPreset, presetGeometryFor, stackFor } from "./layoutPresets.js";
import { DEFAULT_SAFE_AREA, artSafeInsets, scaledSafeArea } from "./safeArea.js";
import { canvasOf } from "./layoutScore.js";
import { cleanNameText } from "./fileName.js";
import { CAPTION_TO_DEVICE, STACK_METRIC_KEYS, solveStack } from "./layoutStack.js";
import { CAPTION_GAP, HEADLINE_METRIC_KEYS, flowedSubtitleY } from "./captionFlow.js";
import { textInkBox } from "./textMetrics.js";
import {
  DEFAULT_FONT_ID,
  DEFAULT_HEADLINE_WEIGHT,
  DEFAULT_SUBTITLE_WEIGHT,
} from "./fonts.js";
import { DEFAULT_FRAME_TINT } from "./frames.js";
import { DEFAULT_DEVICE_HEIGHT_RATIO, layerBox } from "./geometry.js";
import { DEFAULT_DEVICE_TRANSFORM, DEFAULT_ROTATION, MAX_SPAN, normalizeSpan } from "./visual.js";
import { columnOptions, solveBaseColumn, solveColumnStacks } from "./baseColumn.js";
import { DEFAULT_LOCALE } from "./locales.js";
import { DEFAULT_THEME_ID, getTheme } from "./themes.js";
import {
  DEVICES,
  PHONE_FRAME_FOR_PLATFORM,
  PHONE_FRAME_FOR_PLATFORM_LANDSCAPE,
} from "./devices.js";

const DEFAULT_THEME = getTheme(DEFAULT_THEME_ID);

// The slide kinds a deck has, in the order the editor's tabs show them.
//
// `feature-graphic` is the odd one and belongs here anyway: Play requires a
// 1024×500 header image on every listing, it is authored exactly like a slide
// (background, text, optionally a device), and the only thing that made it
// special was that Vitrine could not make one. Last, because it is one asset
// rather than a deck.
//
// The App Store's product page header and search result banners joined it with
// iOS 27 and are the same thing in Apple's store. The banners are listed
// together, after the screenshot kinds, because the editor shows them as one
// section of their own (BANNER_KINDS).
export const BANNER_KINDS = ["page-header", "search-result", "feature-graphic"];
export const KINDS = ["phone", "phone-landscape", "tablet", "tablet-landscape", "tv", ...BANNER_KINDS];

// Orientation is a property of the *kind*, which is why landscape is its own
// kind rather than a flag on a slide: one kind, one canvas shape, so a slide's
// ratio-based layout always means the same thing.
const LANDSCAPE_KINDS = new Set(["phone-landscape", "tablet-landscape", "tv", ...BANNER_KINDS]);
export const orientationOf = (kind) => (LANDSCAPE_KINDS.has(kind) ? "landscape" : "portrait");

// A device row shows the slides of its own kind. A tablet row with no tablet
// slides falls back to the phone deck of the same orientation, drawn in a phone
// frame — a tablet canvas is a shape people forget to fill, and an empty row is
// less useful than a preview of what it would look like.
export const FALLBACK_KIND = {
  "tablet": "phone",
  "tablet-landscape": "phone-landscape",
};

// Kinds whose slides are not a picture of an app running. A feature graphic is a
// banner: it may hold a device mockup, but most do not, so the device layer that
// every other kind requires is optional here — and with no device layer there is
// no screenshot to resolve either.
export const DEVICELESS_KINDS = new Set(BANNER_KINDS);

// The kinds the sidebar is *for*: one tile per uploaded screenshot. A deviceless
// kind has none — its slide is authored, arrives with its device, and is edited
// on its own row — so it has no tab there at all. A tab that can only ever say
// "nothing here, go to the inspector" is a tab that should not exist.
export const SCREENSHOT_KINDS = KINDS.filter((k) => !DEVICELESS_KINDS.has(k));

// The screenshot kind whose device screens share an image's shape, or `fallback`
// (the tab the upload came from) when none is close or the closest is a tie.
// Distance is |ln(ratio)|, so 10% too wide and 10% too tall weigh the same; 0.1
// takes 18:9 and 20:9 handsets as phones without reaching 9:16 or an iPad's 3:4.
// Ties are real, not hypothetical: Play's phone, tablet and landscape rows all
// share 16:9, and only the tab the user is on can say which one they meant.
// An exact canvas match settles it first: the iPhone Duo's outer display and an
// 11" iPad are the same shape to within 0.3%, and only the pixel count says
// which device a screenshot came off.
const ASPECT_TOLERANCE = 0.1;
export function kindForImage(width, height, fallback) {
  if (!(width > 0 && height > 0)) return fallback;
  const exact = new Set(Object.values(DEVICES)
    .filter((d) => SCREENSHOT_KINDS.includes(d.category) && d.canvasWidth === width && d.canvasHeight === height)
    .map((d) => d.category));
  if (exact.size === 1) return [...exact][0];
  const ratio = Math.log(width / height);
  const best = new Map();
  for (const d of Object.values(DEVICES)) {
    if (!SCREENSHOT_KINDS.includes(d.category)) continue;
    const dist = Math.abs(ratio - Math.log(d.canvasWidth / d.canvasHeight));
    if (dist <= ASPECT_TOLERANCE) best.set(d.category, Math.min(dist, best.get(d.category) ?? Infinity));
  }
  if (!best.size) return fallback;
  const min = Math.min(...best.values());
  const closest = SCREENSHOT_KINDS.filter((k) => best.get(k) - min < 0.01);
  return closest.length === 1 ? closest[0] : fallback;
}

// A kind and a device's `category` are the same vocabulary, so this answers for
// either. Every host that normalizes a layer list before drawing it reads this,
// which is what keeps the three of them agreeing about a deviceless slide.
export const needsDeviceLayer = (kind) => !DEVICELESS_KINDS.has(kind);

// Export naming. Both App Store Connect and fastlane order screenshots by
// filename, so a set without an ordering prefix arrives shuffled however the
// store feels like sorting it.
export const NAME_TOKENS = ["{order}", "{slide}", "{device}", "{kind}", "{locale}"];
export const DEFAULT_NAME_TEMPLATE = "{device}/{order}_{slide}";

// Which languages Download covers: "all" of the deck's, or just the one on screen
// (an editor-only notion — the CLI names its languages with --locale).
export const EXPORT_LOCALE_SCOPES = ["current", "all"];

// Every project default a deck carries, with the value used when a deck omits
// one. Same keys and same fallbacks as the editor's PROJECT_DEFAULTS signals, so
// a hand-written deck — one an agent produced, say — resolves exactly the way
// one saved out of the editor does.
export const DECK_DEFAULTS = {
  background: DEFAULT_THEME.background,
  textColor: DEFAULT_THEME.textColor ?? "#ffffff",
  locales: [DEFAULT_LOCALE],
  baseLocale: DEFAULT_LOCALE,
  fontId: DEFAULT_THEME.fontId ?? DEFAULT_FONT_ID,
  headlineWeight: DEFAULT_THEME.headlineWeight ?? DEFAULT_HEADLINE_WEIGHT,
  subtitleWeight: DEFAULT_THEME.subtitleWeight ?? DEFAULT_SUBTITLE_WEIGHT,
  textAlign: DEFAULT_THEME.textAlign ?? "center",
  useFrame: true,
  deviceHeightRatio: DEFAULT_DEVICE_HEIGHT_RATIO,
  // Flat, which is the one key here that deliberately ignores DEFAULT_THEME.
  //
  // `aurora` asks for `tilt-right`, so every new deck used to open with the
  // phone turned 9 degrees. No shipped store screenshot does that: of 138 top
  // App Store and Play slides whose product shot has a straight edge to measure,
  // the tilt angle is 0.00 degrees median and 0.05 at p90 — not one is past 1.5.
  // The turn also costs real size, because a rotated device projects a box
  // bigger than `hRatio` describes (see TILT_HEADROOM in src/looks.js), and it
  // is what pushed `compact` off the canvas at its own shipped geometry.
  //
  // It stays a one-click control — `ROTATION_PRESETS` is untouched and the six
  // themes still carry their own transforms — it just is not what a deck starts
  // on.
  deviceTransform: DEFAULT_DEVICE_TRANSFORM,
  headlineRotation: DEFAULT_ROTATION,
  subtitleRotation: DEFAULT_ROTATION,
  frameTint: DEFAULT_THEME.frameTint ?? DEFAULT_FRAME_TINT,
  safeAreaEnabled: false,
  safeAreaTop: DEFAULT_SAFE_AREA.top,
  safeAreaBottom: DEFAULT_SAFE_AREA.bottom,
  safeAreaLeft: DEFAULT_SAFE_AREA.left,
  safeAreaRight: DEFAULT_SAFE_AREA.right,
  // Whether `vitrine check` gates this deck on what the stores accept — see
  // src/storeFit.js. On unless a deck says otherwise: a pitch deck or a website
  // hero legitimately uses a canvas Play would refuse, and a gate with no way
  // out is one people route around instead of switching off honestly.
  storeCheck: true,
  // Export settings belong to the project: saved with the deck, copied with a
  // duplicate, and honoured by the CLI so `render` writes the files the editor's
  // Download would. They were browser-wide before, so every project shared one
  // (N396). "" for the template means the default one.
  exportFormat: "png",
  exportQuality: 0.92,
  exportNameTemplate: DEFAULT_NAME_TEMPLATE,
  exportLocaleScope: "all",
};

export const EXPORT_FORMATS = ["png", "jpeg"];
export const extFor = (format) => (format === "jpeg" ? "jpg" : "png");

// A deck's export settings, normalised the one way both hosts read them: a
// missing or invalid value is the built-in, never an error. 0.3–1 is the CLI's
// --quality range; the editor's slider sits inside it.
export function exportSettings(defaults) {
  const d = withDefaults(defaults);
  const q = Number(d.exportQuality);
  return {
    format: EXPORT_FORMATS.includes(d.exportFormat) ? d.exportFormat : DECK_DEFAULTS.exportFormat,
    quality: Number.isFinite(q) && q >= 0.3 && q <= 1 ? q : DECK_DEFAULTS.exportQuality,
    template: typeof d.exportNameTemplate === "string" ? d.exportNameTemplate : DEFAULT_NAME_TEMPLATE,
    localeScope: EXPORT_LOCALE_SCOPES.includes(d.exportLocaleScope) ? d.exportLocaleScope : DECK_DEFAULTS.exportLocaleScope,
  };
}

export const PROJECT_DEFAULT_KEYS = Object.keys(DECK_DEFAULTS);

// A deck's `defaults` filled out. Null and undefined fall through to the
// fallback rather than overriding it — the same rule applyDeckDefaults follows
// when it loads a deck into the editor, so the two cannot disagree about what a
// missing key means.
export function withDefaults(defaults) {
  const out = { ...DECK_DEFAULTS };
  for (const key of PROJECT_DEFAULT_KEYS) {
    const value = defaults?.[key];
    if (value != null) out[key] = value;
  }
  return out;
}

// Fields a role-carrying layer leaves null so it inherits the project default —
// which is what lets a theme restyle a whole deck. A layer the user added has
// `role: null` and carries its own values instead, so nothing a theme does can
// move or restyle it.
export const INHERITED_KEYS = {
  text: ["color", "fontId", "align", "weight", "rotation"],
  device: ["useFrame", "frameTint", "hRatio", "rotation"],
  image: [],
};

// Placeholder copy. Deliberately a prompt rather than a sentence someone might
// ship by accident, and `isDefaultish` in the editor tests against these to tell
// an untouched slide from an edited one.
export const DEFAULT_HEADLINE = "Your value prop here";
export const DEFAULT_SUBTITLE = "A supporting line";

export function inheriting(layer) {
  const next = { ...layer };
  for (const key of INHERITED_KEYS[layer.type] ?? []) next[key] = null;
  return next;
}

// A fresh slide is the Hero preset, expressed as layers. Landscape (TV) canvases
// are short, so the portrait ratios would collapse the caption onto the device;
// the preset's landscape variant spaces them down a 1920x1080 canvas instead, and
// carries an explicit device height (0.72 rather than the portrait default 0.74)
// so the device still dominates and the caption stays a thin top band.
//
// Here rather than in the editor because the server builds slides too — the
// starter deck a first project opens with (server/starter.js). A second copy of
// this over there would be a fresh slide that drifts from the editor's the first
// time the Hero preset moves.
export function defaultLayersForKind(kind) {
  const orientation = orientationOf(kind);
  const g = presetGeometryFor(getPreset("hero"), orientation, kind);
  const landscape = orientation === "landscape";
  // A banner (an App Store banner or the Play feature graphic) carries a line of
  // copy on a background, and the device mockup that every other kind requires
  // is optional here. Its caption comes from the banner's own block in
  // src/layoutPresets.js, which every preset lands on for the App Store kinds and
  // a device preset lands on for the feature graphic. The line follows its
  // headline: a fixed seed left a gap under a one-line headline and ran over a
  // wrapped one.
  if (DEVICELESS_KINDS.has(kind)) {
    return [
      inheriting(makeTextLayer({ id: HEADLINE_LAYER_ID, role: "headline", text: DEFAULT_HEADLINE, ...g.headline, sizeMul: 1 })),
      inheriting(makeTextLayer({ id: SUBTITLE_LAYER_ID, role: "subtitle", text: DEFAULT_SUBTITLE, ...g.subtitle, sizeMul: 1 })),
    ];
  }
  return [
    inheriting(makeDeviceLayer({
      id: DEVICE_LAYER_ID,
      xRatio: g.device.xRatio,
      yRatio: g.device.yRatio,
      // Portrait inherits the project default; landscape needs its own.
      ...(landscape ? { hRatio: g.device.hRatio } : {}),
      // Same story as the subtitle's `followGap` below: the two ratios above are
      // Hero's seed, for a headline that wraps once, and this is what lets a
      // host re-solve them against the copy the slide actually carries. Only
      // portrait has a stack — there is no measured sample of a landscape store
      // listing to build one from (src/layoutPresets.js).
      stackId: stackFor("hero", orientation, kind) ? "hero" : null,
    })),
    inheriting(makeTextLayer({
      id: HEADLINE_LAYER_ID,
      role: "headline",
      text: DEFAULT_HEADLINE,
      xRatio: g.headline.xRatio,
      yRatio: g.headline.yRatio,
      sizeMul: g.headline.sizeMul,
    })),
    inheriting(makeTextLayer({
      id: SUBTITLE_LAYER_ID,
      role: "subtitle",
      text: DEFAULT_SUBTITLE,
      xRatio: g.subtitle.xRatio,
      yRatio: g.subtitle.yRatio,
      sizeMul: g.subtitle.sizeMul,
      // Hero's `yRatio` above is the seed — the value for a headline that
      // wraps once — and this is what lets a host re-seat it against the copy
      // the slide actually carries. It cannot be resolved here: `inheriting`
      // nulls `fontId` and `weight` so a theme can restyle the layer, and a
      // null font has no measurable advance. See src/captionFlow.js.
      followGap: g.subtitle.followGap ?? null,
    })),
  ];
}

// Fields a translation may carry. Everything else — position, size, colour, the
// screenshot behind the frame — is shared across locales: a locale changes the
// words and what it takes to fit them, not where the device sits. (A solved
// column still re-divides around those words — see solveLocaleStacks.)
//
// `weight` and `uppercase` are here because they are never written alone. The
// font picker writes `{ fontId, weight }` together (LayerSections, CanvasToolbar)
// and the case control writes `{ textCase, uppercase }`, so leaving either out
// would let picking a Japanese font reset the weight in every other language.
export const LOCALIZABLE_KEYS = new Set([
  "text", "fontId", "weight", "sizeMul",
  "lineHeight", "letterSpacing", "textCase", "uppercase", "balance",
]);

export const localizablePart = (patch) => {
  const out = {};
  for (const [k, v] of Object.entries(patch)) if (LOCALIZABLE_KEYS.has(k)) out[k] = v;
  return out;
};

export const sharedPart = (patch) => {
  const out = {};
  for (const [k, v] of Object.entries(patch)) if (!LOCALIZABLE_KEYS.has(k)) out[k] = v;
  return out;
};

// A preset writes only these keys, and only onto role-carrying layers. Clearing
// them from a card's overrides is what makes "apply a preset" mean the same thing
// whether or not that card had been nudged by hand.
export const PRESET_KEYS = ["xRatio", "yRatio", "hRatio", "sizeMul", "align", "followGap", "stackId", "stackLead"];

// A banner's preset also pins the column width (and the feature graphic's places
// its icon and art by width). Without `wRatio` here a per-card override of it
// would mask the preset's column; on a phone presets never write it, so adding it
// globally would wipe a hand-set per-card wRatio.
export const presetKeysFor = (kind) => (DEVICELESS_KINDS.has(kind) ? [...PRESET_KEYS, "wRatio"] : PRESET_KEYS);

// Drop just the keys a wide write is about to set from every per-device
// override on this slide, so the write is actually visible on the cards it
// claimed to reach.
//
// Takes the keys rather than assuming PRESET_KEYS: a preset writes all five and
// clearing all five is right for it, but Polish may write only `sizeMul`, and
// clearing the rest would silently wipe an xRatio a user had set by hand on some
// other card of the same slide.
//
// `patched` narrows it the other way, and is the half that is easy to forget:
// only a layer this write actually touched has anything to unmask. Clearing the
// key on every layer moved a sticker on a card the user was not even looking at,
// which is exactly what both a preset and Polish promise not to do. Same shape
// as clearDeviceOverrides' `layerId` argument in web/src/state.js.
export function withoutKeys(overridesForDevice, keys, patched) {
  if (!overridesForDevice) return undefined;
  const out = {};
  for (const [layerId, patch] of Object.entries(overridesForDevice)) {
    const kept = patched.has(layerId)
      ? Object.fromEntries(Object.entries(patch).filter(([k]) => !keys.includes(k)))
      : patch;
    if (Object.keys(kept).length) out[layerId] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

// The two shapes a fixed-key-set write takes, parameterised on how a layer's
// patch is resolved. Presets resolve it from their geometry table; Polish from a
// search, the CLI's `apply` from a look. Same override bookkeeping every way, so
// there is one copy of it — here, where the editor and the CLI both reach it.
export function applyLayerPatches(slide, patchFor, writtenKeys) {
  // Resolved once, because the override bookkeeping below has to know which
  // layers were touched, not just which keys.
  const patches = new Map();
  for (const l of slide.layers) {
    const patch = patchFor(l);
    if (patch) patches.set(l.id, patch);
  }
  const byDevice = Object.fromEntries(
    Object.entries(slide.layersByDevice ?? {})
      .map(([deviceId, forDevice]) => [deviceId, withoutKeys(forDevice, writtenKeys, patches)])
      .filter(([, v]) => v),
  );
  return {
    ...slide,
    layers: slide.layers.map((l) => {
      const patch = patches.get(l.id);
      return patch ? { ...l, ...patch } : l;
    }),
    layersByDevice: Object.keys(byDevice).length ? byDevice : undefined,
  };
}

// Slide-level fields that survived the move to layers: the background paints the
// canvas rather than an element on it, and the safe-area insets are absolute
// device pixels rather than a property of anything drawn.
export const SLIDE_FIELDS = ["background", "safeAreaTop", "safeAreaBottom", "safeAreaLeft", "safeAreaRight"];

// Apply `patch` to a layer or slide's own fields. Values of null/undefined clear
// the key so it falls back to the project default.
export function applyPatch(target, patch) {
  const next = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) delete next[k];
    else next[k] = v;
  }
  return next;
}

// A slide field, resolved through its per-device override.
export function resolveField(screenshot, deviceId, key, fallback) {
  const dev = screenshot.byDevice?.[deviceId];
  if (dev && dev[key] !== undefined && dev[key] !== null) return dev[key];
  if (screenshot[key] !== undefined && screenshot[key] !== null) return screenshot[key];
  return fallback;
}

// What a role-carrying layer inherits when it hasn't set the field itself. A
// layer the user added (role null) inherits nothing — see INHERITED_KEYS.
function projectDefaultFor(layer, key, defaults) {
  if (!layer.role) return undefined;
  if (layer.type === "text") {
    const headline = layer.role === "headline";
    switch (key) {
      case "color": return defaults.textColor;
      case "fontId": return defaults.fontId;
      case "align": return defaults.textAlign;
      case "weight": return headline ? defaults.headlineWeight : defaults.subtitleWeight;
      case "rotation": return headline ? defaults.headlineRotation : defaults.subtitleRotation;
      default: return undefined;
    }
  }
  if (layer.type === "device") {
    switch (key) {
      case "useFrame": return defaults.useFrame;
      case "frameTint": return defaults.frameTint;
      case "hRatio": return defaults.deviceHeightRatio;
      case "rotation": return defaults.deviceTransform;
      default: return undefined;
    }
  }
  return undefined;
}

export function fillInherited(layer, defaults) {
  const keys = INHERITED_KEYS[layer.type] ?? [];
  let next = null;
  for (const key of keys) {
    if (layer[key] != null) continue;
    const value = projectDefaultFor(layer, key, defaults);
    if (value == null) continue;
    next ??= { ...layer };
    next[key] = value;
  }
  return next ?? layer;
}

// Scale the project default safe area to the device so the inset stays
// proportional across phones, tablets and TVs. Explicit per-slide values are
// absolute and pass through unscaled.
export function defaultSafeAreaFor(device, defaults) {
  // The scaling itself lives in src/safeArea.js, so a candidate layout being
  // scored resolves the same band the editor will clamp it to.
  return scaledSafeArea(device, {
    top: defaults.safeAreaTop,
    bottom: defaults.safeAreaBottom,
    left: defaults.safeAreaLeft,
    right: defaults.safeAreaRight,
  });
}

export function resolveSafeArea(screenshot, deviceId, device, defaults) {
  const def = defaultSafeAreaFor(device, defaults);
  if (artSafeInsets(device)) return { topPx: def.top, bottomPx: def.bottom, leftPx: def.left, rightPx: def.right };
  return {
    topPx:    resolveField(screenshot, deviceId, "safeAreaTop",    def.top),
    bottomPx: resolveField(screenshot, deviceId, "safeAreaBottom", def.bottom),
    leftPx:   resolveField(screenshot, deviceId, "safeAreaLeft",   def.left),
    rightPx:  resolveField(screenshot, deviceId, "safeAreaRight",  def.right),
  };
}

/**
 * The layers of one card, fully materialized: per-device override, then the
 * locale patch, then project defaults, then the role defaults normalizeLayer
 * fills in. Every consumer — the preview, the render payload, the hash, the
 * scorer and the CLI — reads through this, so they cannot disagree about what a
 * card looks like.
 *
 * This does **not** consult the editor's `editScope`. A card looks like what it
 * is, whichever way the scope selector happens to be pointing: the render
 * payload is built from here, so a scope-sensitive read meant the PNG you
 * exported depended on a radio button about where *edits* go.
 *
 * The locale patch lands on top of the device one: a per-device override says
 * this canvas needs different geometry, a locale override says this language
 * needs different words and a different size to fit them. Keys are filtered on
 * read as well as on write — a deck edited by hand, or written by a build that
 * localized more fields, must not be able to move a layer from inside the
 * locale map.
 */
export function resolveLayers(screenshot, { deviceId, device = null, locale = null, defaults, screenshots = null, giveWay = true }) {
  const d = withDefaults(defaults);
  const overrides = screenshot.layersByDevice?.[deviceId];
  const byLocale =
    locale && locale !== d.baseLocale ? screenshot.layersByLocale?.[locale] : null;
  const mergeWith = (forLocale) => screenshot.layers.map((l, i) => {
    let patched = overrides?.[l.id] ? applyPatch(l, overrides[l.id]) : l;
    if (forLocale?.[l.id]) patched = applyPatch(patched, localizablePart(forLocale[l.id]));
    return normalizeLayer(fillInherited(patched, d), i);
  });
  let merged = mergeWith(byLocale);
  let base = byLocale ? null : merged;
  const column = device && baseColumnFor(screenshot, (base ??= mergeWith(null)), device, overrides);
  if (column) {
    merged = placedBy(merged, column.byRole, column.deviceHRatio);
    base = byLocale ? placedBy(base, column.byRole, column.deviceHRatio) : merged;
  }
  if (byLocale && device && screenshot.layers.some((l) => l.role && byLocale[l.id])) {
    merged = reflowedForLocale(merged, base ?? mergeWith(null), { kind: screenshot.kind, device, byLocale, overrides });
    // `giveWay: false` is the cell the give-way is measured on (solveLocaleStacks).
    if (giveWay) merged = gaveWay(merged, base ?? mergeWith(null), device, byLocale);
  }
  return screenshots && device ? homeStrays(merged, spanOf(screenshots, screenshot), device) : merged;
}

// The slide with one language's text sized `mul` times what `layers` (that
// language's resolved cell) draws. Fit scores smaller sizes with this and the
// host writes the same numbers, same set and same rounding, so what is scored
// is what is drawn: a translation's captions and device give way according to
// its sizes (captionsGiveWay, deviceGivesWay), so a frozen layout scored at
// each size reports a device pushed off by the full-size text that the
// smaller size would no longer push.
export function localeTextScaled(screenshot, locale, layers, mul) {
  const byLocale = { ...screenshot.layersByLocale?.[locale] };
  for (const l of layers) {
    if (l.type !== "text" || !l.text) continue;
    byLocale[l.id] = { ...byLocale[l.id], sizeMul: Number((l.sizeMul * mul).toFixed(4)) };
  }
  return { ...screenshot, layersByLocale: { ...screenshot.layersByLocale, [locale]: byLocale } };
}

// A translation that wraps differently from the source re-divides the column on
// a slide whose caption is solved rather than placed — a stack (src/layoutStack.js)
// or a following subtitle (src/captionFlow.js) — so a longer German headline
// pushes the subtitle down instead of running into it. Free-placed text keeps
// the shared geometry: nobody solved it, so there is nothing to re-solve.
//
// Either reads the locale's own solution, measured on the write path like the
// base one (solveLocaleStacks) and stored on the device layer's locale patch —
// while it is current: its key still matches the words, sizes and placements it
// was measured for, and this card has no solve of its own. A deck pushed or
// polished from the CLI changes the words without re-measuring.
//
// Otherwise it is the *difference* between solving the translation and the
// source with the estimator, on top of the stored (measured) ratios. A full
// estimator solve would move an untranslated caption because the estimator and
// the browser disagree by a few pixels; the difference is exactly zero when the
// words are, and every host computes the same number from the same data. Only a
// fallback: the estimator is out by a whole line often enough to leave a long
// headline on the subtitle.
function reflowedForLocale(localized, base, { kind, device, byLocale, overrides }) {
  const dev = localized.find((l) => l.type === "device");
  const stack = dev?.stackId ? stackFor(dev.stackId, orientationOf(kind), kind) : null;
  if (stack) {
    const stored = byLocale[dev.id]?.solved?.byDevice?.[device.id];
    if (stored && !ownStackSolve(stack, localized, overrides) && stored.key === localeStackKey(kind, dev.stackId, stack, localized, device)) {
      return placedBy(localized, stored.byRole, stored.deviceHRatio);
    }
  } else if (dev) {
    const stored = byLocale[dev.id]?.solved?.byDevice?.[device.id];
    if (stored && stored.key === localeFollowKey(kind, localized, device, keptFrom(localized, base))) {
      return placedBy(localized, { subtitle: stored.y });
    }
  }
  const shift = new Map();
  if (stack) {
    const from = solveStack(stack, base, { device });
    const to = solveStack(stack, localized, { device });
    if (!from || !to) return localized;
    for (const [role, y] of Object.entries(to.byRole)) {
      if (from.byRole[role] != null) shift.set(role, { y: y - from.byRole[role] });
    }
    if (shift.has("device")) shift.get("device").h = to.deviceHRatio - from.deviceHRatio;
  } else {
    if (!followsOwnHeadline(localized, base)) return localized;
    const from = flowedSubtitleY(base, { device });
    const free = withoutYieldingDevice(localized, base, device);
    const to = flowedSubtitleY(free, { device });
    if (from == null || to == null) return localized;
    shift.set("subtitle", { y: to - from, max: subtitleCeiling(free, device), min: headlineEnd(localized, device) });
  }
  const round4 = (v) => Math.round(v * 10000) / 10000;
  return localized.map((l) => {
    const by = shift.get(l.role);
    if (!by || (!by.y && !by.h)) return l;
    let y = l.yRatio + by.y;
    if (by.max != null) y = Math.min(y, Math.max(l.yRatio, by.max));
    if (by.min != null) y = Math.max(y, by.min);
    const next = { ...l, yRatio: round4(Math.max(0, Math.min(1, y))) };
    if (by.h && l.hRatio != null) next.hRatio = round4(Math.max(0.05, l.hRatio + by.h));
    return next;
  });
}

// Whether this language's device is one that gives way (deviceGivesWay): not in
// a stack, with a base device that the base's captions all sit above and end at
// or above. One predicate for the give-way and for the follower measured
// against it, so the two cannot disagree about which devices move.
function deviceYields(layers, base, device, measurer = null) {
  const dev = layers.find((l) => l.type === "device");
  const baseDev = base.find((l) => l.type === "device");
  if (!dev || dev.stackId || !baseDev) return false;
  const caps = base.filter((l) => (l.role === "headline" || l.role === "subtitle") && l.text);
  if (!caps.length || caps.some((l) => l.yRatio >= baseDev.yRatio)) return false;
  const { W, H } = canvasOf(device);
  const baseEnd = Math.max(...caps.map((l) => {
    const b = textInkBox(l, { W, H, device, measurer });
    return (b.y + b.h) / H;
  }));
  return baseEnd <= baseDev.yRatio + 1e-3;
}

// A following translation subtitle is measured without the shared device where
// that language's device gives way: flowedSubtitleY closes the gap to hold the
// subtitle off the device's top (9c2b32b), but deviceGivesWay (086bf4c) then
// moves the device under the text anyway, so the gap closed for nothing and the
// subtitle touched its headline (ru hero, device dragged +0.004: subtitle top
// 0.1751 = headline ink end 0.1751, the gap is 0.017 elsewhere).
function withoutYieldingDevice(layers, base, device, measurer = null) {
  return deviceYields(layers, base, device, measurer) ? layers.filter((l) => l.type !== "device") : layers;
}

// A device placed by hand under the captions is one shared placement that
// follows the pointer (N169): it is cleared against the base's captions only,
// so a translation whose copy runs longer than the base's reaches it. Where the
// base's captions on this canvas clear the device, that language's column gives
// way instead: the device goes under that language's own captions by the base's
// gap, its height kept, cropped at the bottom — whether its subtitle follows
// its headline, was placed by hand, or is absent. Gated on the base layout, not
// this language's, because a following subtitle that reflowed past the shared
// device top is exactly the case that must give way. Nothing moves in a
// language that fits, or where the base itself is over the device — the user's
// own drop.
function deviceGivesWay(layers, base, device, measurer = null) {
  const dev = layers.find((l) => l.type === "device");
  if (!deviceYields(layers, base, device, measurer)) return layers;
  const baseDev = base.find((l) => l.type === "device");
  const words = (ls) => ls.filter((l) => (l.role === "headline" || l.role === "subtitle") && l.text);
  const { W, H } = canvasOf(device);
  const end = (l) => {
    const b = textInkBox(l, { W, H, device, measurer });
    return (b.y + b.h) / H;
  };
  const baseEnd = Math.max(...words(base).map(end));
  const mine = Math.max(0, ...words(layers).map(end));
  if (mine <= dev.yRatio + 1e-4) return layers;
  const gap = Math.min(CAPTION_TO_DEVICE, Math.max(0, baseDev.yRatio - baseEnd));
  const yRatio = Math.min(1.5, Math.ceil((mine + gap) * 10000) / 10000);
  return layers.map((l) => (l === dev ? { ...dev, yRatio } : l));
}

// Caption clearance answers to the base language only (N179): a caption moved
// by hand is one shared placement, cleared against the base's columns, so a
// translation whose headline runs longer than the base's reaches a subtitle
// that was placed by hand and would print one caption on the other. In that
// language's own column the lower caption gives way instead — down, by the
// base's gap, its size kept, cropped at the bottom — and nothing above it
// moves. Gated on the base layout of this canvas like deviceGivesWay: where the
// base itself has one caption on the other, that is the user's own drop and
// every language keeps it. A following subtitle is re-seated per language by
// reflowedForLocale and a stack re-divides itself, so both are left alone. The
// device then gives way under the moved caption (deviceGivesWay runs next).
function captionsGiveWay(layers, base, device, measurer = null) {
  if (layers.find((l) => l.type === "device")?.stackId) return layers;
  const pick = (ls, role) => ls.find((l) => l.role === role && l.text);
  const head = pick(layers, "headline");
  const sub = pick(layers, "subtitle");
  const baseHead = pick(base, "headline");
  const baseSub = pick(base, "subtitle");
  if (!head || !sub || !baseHead || !baseSub || sub.followGap != null) return layers;
  const { W, H } = canvasOf(device);
  const span = (l) => {
    const b = textInkBox(l, { W, H, device, measurer });
    return { top: b.y / H, end: (b.y + b.h) / H };
  };
  const [baseUpper, baseLower] = baseHead.yRatio <= baseSub.yRatio ? [span(baseHead), span(baseSub)] : [span(baseSub), span(baseHead)];
  if (baseLower.top < baseUpper.end - 1e-3) return layers;
  const [upper, lower] = baseHead.yRatio <= baseSub.yRatio ? [head, sub] : [sub, head];
  const upperEnd = span(upper).end;
  const lowerTop = span(lower).top;
  if (lowerTop >= upperEnd - 1e-4) return layers;
  const gap = Math.min(CAPTION_GAP, Math.max(0, baseLower.top - baseUpper.end));
  // The ink box is drawn from a rounded pixel top, so the shifted y can land up
  // to a pixel short: stepped on until the ink is truly clear.
  let yRatio = Math.min(1.5, Math.ceil((lower.yRatio + upperEnd + gap - lowerTop) * 10000) / 10000);
  for (let i = 0; i < 20 && yRatio < 1.5 && span({ ...lower, yRatio }).top < upperEnd + gap - 1e-9; i++) {
    yRatio = Math.min(1.5, Math.round((yRatio + 1e-4) * 10000) / 10000);
  }
  return layers.map((l) => (l === lower ? { ...lower, yRatio } : l));
}

// The give-way as measured (solveLocaleStacks), while current; else the
// estimator's. The estimator reads a wrapped line as one (ja) or a short one as
// long (the iPad's en subtitle), so a translation was left on text or on the
// device, or the device was kept off a base it was never over. Where the
// measured answer differs from the estimator's it is stored per canvas like the
// follow place, so the editor, the ZIP and the CLI draw one cell; where it
// agrees nothing is stored and the estimator is already right.
function gaveWay(layers, base, device, byLocale) {
  const dev = layers.find((l) => l.type === "device");
  const stored = dev && !dev.stackId && byLocale[dev.id]?.solved?.gave?.[device.id];
  if (stored && stored.key === localeGiveKey(layers, base, device)) {
    return layers.map((l) => {
      const y = stored.byRole[l.role ?? l.type];
      return y == null ? l : { ...l, yRatio: y };
    });
  }
  return deviceGivesWay(captionsGiveWay(layers, base, device), base, device);
}

// What a stored give-way was measured for: the canvas, both captions' words,
// sizes and places in the language and in the base, and the device they give way
// to. Hashed, since it is stored.
function localeGiveKey(layers, base, device) {
  const { W, H } = canvasOf(device);
  const parts = [1, "give", W, H];
  for (const ls of [layers, base]) {
    for (const [role, keys] of Object.entries(LOCALE_FOLLOW_FIELDS)) {
      const l = ls.find((x) => x.role === role);
      parts.push(l ? [...keys.map((k) => l[k] ?? null), l.yRatio] : null);
    }
    const dev = ls.find((l) => l.type === "device");
    parts.push(dev ? [dev.yRatio, dev.hRatio, dev.stackId ?? null] : null);
  }
  return hashKey(parts);
}

// The lowest top a following subtitle can take in this locale with its own
// (translated) ink still clear of a hand-placed device: the shifted y is stored
// ratio plus an estimated difference, so the cap captionFlow puts on each half
// of that difference does not hold for the sum. The canvas edge when the
// caption sits under the device, as in captionFlow — and, as there, the device
// or the canvas edge gives way to the headline: never above this locale's
// headline ink.
function subtitleCeiling(layers, device) {
  const subtitle = layers.find((l) => l.role === "subtitle");
  const dev = layers.find((l) => l.type === "device");
  const { W, H } = canvasOf(device);
  const ink = textInkBox(subtitle, { W, H, device, measurer: null });
  if (!ink || !Number.isFinite(ink.y) || !Number.isFinite(ink.h)) return null;
  const limit = !dev || subtitle.yRatio >= dev.yRatio ? 1 : dev.yRatio;
  const cap = Math.floor((limit - (ink.y + ink.h) / H + subtitle.yRatio) * 10000) / 10000;
  return Math.max(cap, headlineEnd(layers, device));
}

// Where this locale's headline ink ends: an estimated subtitle shift is the
// base's place plus a difference measured on another basis, and it is never let
// above this, onto its own headline.
function headlineEnd(layers, device) {
  const headline = layers.find((l) => l.role === "headline");
  const { W, H } = canvasOf(device);
  const head = textInkBox(headline, { W, H, device, measurer: null });
  return Math.ceil(((head.y + head.h) / H) * 10000) / 10000;
}

const stackRoles = (stack) => new Set(stack.bands.map((b) => b.layer).filter(Boolean));

// Whether this card solves the column itself: a card-scoped solve or placement
// in its overrides, which no stored solution may write over.
function ownStackSolve(stack, layers, overrides) {
  const roles = stackRoles(stack);
  return layers.some((l) =>
    (l.type === "device" || roles.has(l.role)) &&
    ["yRatio", "hRatio", "stackId", "stackLead"].some((k) => overrides?.[l.id]?.[k] !== undefined),
  );
}

// Whether the base subtitle follows its headline on this canvas with nothing of
// the card's own placing either: a device out of its stack leaves the subtitle
// following, and a headline wraps differently on each canvas, so the place it
// follows to is measured on each (solveBaseStacks) like a translation's.
function followsHere(layers, overrides) {
  const sub = layers.find((l) => l.role === "subtitle");
  if (sub?.followGap == null || !layers.some((l) => l.role === "headline" && l.text)) return false;
  return !layers.some((l) =>
    (l.type === "device" || l.role === "headline" || l.role === "subtitle") &&
    ["yRatio", "followGap"].some((k) => overrides?.[l.id]?.[k] !== undefined),
  );
}

// The base column as measured on this canvas (solveBaseStacks), while it is
// current; null on the canvas the shared ratios were solved on, or wherever
// nothing current is stored — which reads the shared ratios.
function baseColumnFor(screenshot, base, device, overrides) {
  const dev = base.find((l) => l.type === "device");
  const stored = dev && screenshot.layers.find((l) => l.id === dev.id)?.solved?.byDevice?.[device.id];
  if (!stored) return null;
  if (!dev.stackId) {
    return stored.y != null && followsHere(base, overrides) && stored.key === localeFollowKey(screenshot.kind, base, device)
      ? { byRole: { subtitle: stored.y } }
      : null;
  }
  const stack = stackFor(dev.stackId, orientationOf(screenshot.kind), screenshot.kind);
  if (!stack || ownStackSolve(stack, base, overrides)) return null;
  return stored.key === localeStackKey(screenshot.kind, dev.stackId, stack, base, device) ? stored : null;
}

// A solved column written onto layers: every band's top, and the device's height.
function placedBy(layers, byRole, deviceHRatio) {
  return layers.map((l) => {
    const y = byRole[l.role];
    if (y == null) return l;
    return l.type === "device" ? { ...l, yRatio: y, hRatio: deviceHRatio } : { ...l, yRatio: y };
  });
}

// What a locale's stack solution was measured for: the canvas — a column wraps
// differently on each, so it is stored per device — the kind and stack, and
// every field of a measured band that changes its height. Hashed, since it is
// stored.
const LOCALE_STACK_FIELDS = [...STACK_METRIC_KEYS, "uppercase"];
function localeStackKey(kind, stackId, stack, layers, device) {
  // The leading version retires solutions the editor stored before it waited for
  // a sliced font's slices (2), or before a Google family was registered and so
  // measured in Inter (3); either can be a line short.
  const { W, H } = canvasOf(device);
  const parts = [3, kind, stackId, W, H];
  for (const b of stack.bands) {
    if (!b.layer || b.grow) continue;
    const l = layers.find((x) => x.role === b.layer);
    parts.push(l ? LOCALE_STACK_FIELDS.map((k) => l[k] ?? null) : null);
  }
  // Only when set, so a column solved before the lead existed keeps its key.
  const lead = layers.find((l) => l.type === "device")?.stackLead;
  if (lead) parts.push({ lead });
  return hashKey(parts);
}

// What a following subtitle's place in a locale was measured for: the canvas —
// a headline wraps differently on each, so the place is stored per device — and
// everything captionFlow reads there: the headline's wrap and anchor, the
// subtitle's gap and its own height (the device floor), and the device's top.
// Same versioning as localeStackKey, whose cold-measurer retirements it postdates.
const LOCALE_FOLLOW_FIELDS = {
  headline: [...HEADLINE_METRIC_KEYS, "uppercase"],
  subtitle: [...LOCALE_STACK_FIELDS, "followGap"],
};
function localeFollowKey(kind, layers, device, kept = null) {
  const { W, H } = canvasOf(device);
  const parts = [3, kind, "follow", W, H];
  for (const [role, keys] of Object.entries(LOCALE_FOLLOW_FIELDS)) {
    const l = layers.find((x) => x.role === role);
    parts.push(l ? keys.map((k) => l[k] ?? null) : null);
  }
  parts.push(layers.find((l) => l.type === "device")?.yRatio ?? null);
  if (kept != null) parts.push({ kept });
  return hashKey(parts);
}

function hashKey(parts) {
  const str = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

// A measurer that reports whether everything it measured was measured for real.
function tracking(measurer) {
  let real = Boolean(measurer);
  const used = [];
  const tracked = (face) => {
    const m = measurer?.(face) ?? null;
    if (!m) real = false;
    else used.push(m);
    return m;
  };
  // `cold`: a string measured before its font slices loaded (web measureText).
  return { tracked, measured: () => real && !used.some((m) => m.cold) };
}

/**
 * Solve the base copy's stack on every canvas in `canvases` but `device`, the
 * one the shared ratios are solved on, and store each on the device layer:
 * `solved: { byDevice: { [id]: { key, byRole, deviceHRatio } } }`, read back by
 * resolveLayers while current. A phone slide drawn on an iPad wraps its
 * headline taller there, so the phone's ratios put it on the subtitle; each
 * canvas gets its own column, the way each translation does
 * (solveLocaleStacks), with the same keys and rules for text not
 * measured for real. A canvas with none reads the shared ratios.
 */
export function solveBaseStacks(slide, { device, defaults, measurer, canvases = null, onlyStale = false }) {
  const d = withDefaults(defaults);
  const at = slide.layers.findIndex((l) => l.type === "device");
  if (at < 0 || !device) return slide;
  const current = slide.layers[at].solved;
  const byDevice = { ...current?.byDevice };
  delete byDevice[device.id];
  for (const cv of canvases ?? []) {
    delete byDevice[cv.id];
    if (cv.id === device.id) continue;
    const here = resolveLayers(slide, { deviceId: cv.id, device: cv, defaults: d });
    const dev = here.find((l) => l.type === "device");
    const stack = dev?.stackId ? stackFor(dev.stackId, orientationOf(slide.kind), slide.kind) : null;
    const overrides = slide.layersByDevice?.[cv.id];
    if (stack ? ownStackSolve(stack, here, overrides) : !followsHere(here, overrides)) continue;
    const key = stack ? localeStackKey(slide.kind, dev.stackId, stack, here, cv) : localeFollowKey(slide.kind, here, cv);
    const had = current?.byDevice?.[cv.id];
    if (onlyStale && had?.key === key) {
      byDevice[cv.id] = had;
      continue;
    }
    const { tracked, measured } = tracking(measurer);
    let solution = null;
    if (stack) {
      const solved = solveStack(stack, here, { device: cv, measurer: tracked });
      if (solved) solution = { key, byRole: solved.byRole, deviceHRatio: solved.deviceHRatio };
    } else {
      const y = flowedSubtitleY(here, { device: cv, measurer: tracked });
      if (y != null) solution = { key, y };
    }
    if (!solution) continue;
    if (measured()) byDevice[cv.id] = solution;
    else if (had) byDevice[cv.id] = had;
  }
  const next = Object.keys(byDevice).length ? { byDevice } : null;
  if (JSON.stringify(current ?? null) === JSON.stringify(next)) return slide;
  const { solved: _, ...layer } = slide.layers[at];
  const layers = [...slide.layers];
  layers[at] = next ? { ...layer, solved: next } : layer;
  return { ...slide, layers };
}

/**
 * Solve each translated locale's stack — or, on a free-placed slide, its
 * following subtitle — with real text measurement and store it on the device
 * layer's locale patch, which resolveLayers reads back while it is current:
 * `solved: { byDevice: { [id]: … } }`, a stack's `{ key, byRole, deviceHRatio }`
 * or a follower's `{ key, y }`, one per canvas in `canvases` (default `device`
 * alone), since no ratio measured on one canvas holds on another — a canvas
 * with none reads the fallback. `solved.gave: { [id]: { key, byRole } }` is the
 * measured give-way of a caption or the device where it differs from the
 * estimator's (gaveWay). The write half of
 * per-locale solving: the editor runs it beside the base solve and after every
 * translation; the CLI before it renders or grades a deck written elsewhere.
 *
 * Each canvas against its own shape, so a locale is divided the way the base is. A locale whose captions are the base's keeps the base's
 * column, unmeasured. A locale whose text could not be measured for real — a face
 * not loaded yet — keeps what it had and reads the estimator fallback, rather
 * than storing a guess as a measurement. A slide with nothing left to solve
 * drops its solutions. `onlyStale` leaves current ones alone, for a host that
 * may measure on another canvas than the editor did.
 */
export function solveLocaleStacks(slide, { device, defaults, measurer, canvases = null, onlyStale = false }) {
  const d = withDefaults(defaults);
  const devLayer = slide.layers.find((l) => l.type === "device");
  const locales = Object.keys(slide.layersByLocale ?? {}).filter((l) => l !== d.baseLocale);
  if (!devLayer || !locales.length || !device) return slide;
  let byLocale = slide.layersByLocale;
  for (const locale of locales) {
    const current = byLocale[locale]?.[devLayer.id]?.solved;
    let next;
    // Canvases this pass does not measure keep what they had.
    const byDevice = { ...current?.byDevice };
    for (const cv of canvases ?? [device]) {
      delete byDevice[cv.id];
      const resolved = resolveLayers(slide, { deviceId: cv.id, device: cv, locale, defaults: d });
      const base = resolveLayers(slide, { deviceId: cv.id, device: cv, defaults: d });
      const devHere = resolved.find((l) => l.type === "device");
      const stack = devHere?.stackId ? stackFor(devHere.stackId, orientationOf(slide.kind), slide.kind) : null;
      // Out of a stack the device is the shared placement: measured against
      // that, not where it gives way in this language (deviceGivesWay).
      const sharedDev = base.find((l) => l.type === "device");
      const here = stack || !sharedDev ? resolved : resolved.map((l) => (l.type === "device" ? sharedDev : l));
      const kept = stack ? null : keptFrom(here, base);
      if (stack ? !ownStackCopy(stack, here, base) : !followsOwnHeadline(here, base) && kept == null) continue;
      const key = stack
        ? localeStackKey(slide.kind, devHere.stackId, stack, here, cv)
        : localeFollowKey(slide.kind, here, cv, kept);
      const had = current?.byDevice?.[cv.id];
      if (onlyStale && had?.key === key) {
        byDevice[cv.id] = had;
        continue;
      }
      const { tracked, measured } = tracking(measurer);
      let solution = null;
      if (stack) {
        const solved = solveStack(stack, here, { device: cv, measurer: tracked });
        if (solved) solution = { key, byRole: solved.byRole, deviceHRatio: solved.deviceHRatio };
      } else {
        const y = kept == null
          ? flowedSubtitleY(withoutYieldingDevice(here, base, cv, tracked), { device: cv, measurer: tracked })
          : keptSubtitleY(here, kept, { device: cv, measurer: tracked });
        if (y != null && y !== kept) solution = { key, y };
      }
      if (!solution) continue;
      if (measured()) byDevice[cv.id] = solution;
      else if (had) byDevice[cv.id] = had;
    }
    // The give-way is measured on the cell this pass leaves: the follow places
    // just solved are in it, as a reader sees them.
    const gave = { ...current?.gave };
    const nextSolved = (patch) => {
      const out = { ...patch };
      for (const k of Object.keys(out)) if (!Object.keys(out[k]).length) delete out[k];
      return Object.keys(out).length ? out : null;
    };
    const cell = { ...slide, layersByLocale: withSolved(byLocale, locale, devLayer.id, nextSolved({ byDevice })) };
    for (const cv of canvases ?? [device]) {
      delete gave[cv.id];
      const mine = resolveLayers(cell, { deviceId: cv.id, device: cv, locale, defaults: d, giveWay: false });
      const base = resolveLayers(slide, { deviceId: cv.id, device: cv, defaults: d });
      const dev = mine.find((l) => l.type === "device");
      if (!dev || dev.stackId || sameCaptions(mine, base)) continue;
      const key = localeGiveKey(mine, base, cv);
      const had = current?.gave?.[cv.id];
      if (onlyStale && had?.key === key) {
        gave[cv.id] = had;
        continue;
      }
      const { tracked, measured } = tracking(measurer);
      const placed = (ls) => Object.fromEntries(ls.flatMap((l, i) => (l.yRatio === mine[i].yRatio ? [] : [[l.role ?? l.type, l.yRatio]])));
      const byRole = placed(deviceGivesWay(captionsGiveWay(mine, base, cv, tracked), base, cv, tracked));
      if (!measured()) {
        if (had) gave[cv.id] = had;
        continue;
      }
      // Stored only where it differs from what a reader computes without it.
      if (JSON.stringify(byRole) !== JSON.stringify(placed(deviceGivesWay(captionsGiveWay(mine, base, cv), base, cv)))) {
        gave[cv.id] = { key, byRole };
      }
    }
    next = nextSolved({ byDevice, gave });
    if (JSON.stringify(current ?? null) === JSON.stringify(next)) continue;
    byLocale = withSolved(byLocale, locale, devLayer.id, next);
  }
  if (byLocale === slide.layersByLocale) return slide;
  return { ...slide, layersByLocale: Object.keys(byLocale).length ? byLocale : undefined };
}

// `byLocale` with one language's solved record written on the device layer's
// patch, or cleared, dropping what that leaves empty.
function withSolved(byLocale, locale, deviceLayerId, solved) {
  const forLocale = { ...byLocale[locale] };
  const patch = applyPatch(forLocale[deviceLayerId] ?? {}, { solved });
  if (Object.keys(patch).length) forLocale[deviceLayerId] = patch;
  else delete forLocale[deviceLayerId];
  const out = { ...byLocale };
  if (Object.keys(forLocale).length) out[locale] = forLocale;
  else delete out[locale];
  return out;
}

// Whether a language's captions are the base's in everything the follow place and
// the give-way read: nothing of the language's own to give way for.
function sameCaptions(layers, base) {
  return Object.entries(LOCALE_FOLLOW_FIELDS).every(([role, keys]) => {
    const [a, b] = [layers, base].map((ls) => ls.find((l) => l.role === role));
    return JSON.stringify(keys.map((k) => a?.[k] ?? null)) === JSON.stringify(keys.map((k) => b?.[k] ?? null));
  });
}

// Whether a locale's stacked captions differ from the base's in anything that
// sizes a band. One that does not is the base's column, which every host reads
// as the base without measuring it again.
function ownStackCopy(stack, layers, base) {
  const metrics = (ls) => JSON.stringify(stack.bands.map((b) => {
    const l = b.layer && ls.find((x) => x.role === b.layer);
    return l ? LOCALE_STACK_FIELDS.map((k) => l[k] ?? null) : null;
  }));
  return metrics(layers) !== metrics(base);
}

// Whether a locale's subtitle follows a headline of its own. One that reads the
// base headline — a translation of the subtitle alone — keeps the base's place
// (keptFrom) instead of being measured: that place may be a seed nobody has
// measured yet, and the translation sits where the base does.
// The base subtitle's place a subtitle-only translation keeps, or null when the
// locale follows its own headline, or its subtitle is the base's word for word.
// Kept only as far as its own (taller) ink stays off the device, by the same
// floor captionFlow gives a follower (keptSubtitleY); never shifted by the
// estimate, whose difference that floor makes non-zero — it pulled the line onto
// the headline.
function keptFrom(layers, base) {
  if (!layers.some((l) => l.role === "subtitle" && l.followGap != null) || followsOwnHeadline(layers, base)) return null;
  const own = layers.find((l) => l.role === "subtitle");
  const theirs = base.find((l) => l.role === "subtitle");
  const metrics = (l) => JSON.stringify(LOCALE_FOLLOW_FIELDS.subtitle.map((k) => l[k] ?? null));
  return theirs && metrics(own) !== metrics(theirs) ? theirs.yRatio : null;
}

// Where a subtitle-only translation goes: the base's place, lifted only as far
// as captionFlow's device floor needs — the follow gap measured from its own
// headline to that place, so nothing else moves it.
function keptSubtitleY(layers, kept, { device, measurer }) {
  const headline = layers.find((l) => l.role === "headline");
  const { W, H } = canvasOf(device);
  const ink = headline?.text ? textInkBox(headline, { W, H, device, measurer }) : null;
  if (!ink || !Number.isFinite(ink.y + ink.h)) return null;
  const gap = kept - (ink.y + ink.h) / H;
  return flowedSubtitleY(layers.map((l) => (l.role === "subtitle" ? { ...l, followGap: gap } : l)), { device, measurer });
}

function followsOwnHeadline(layers, base) {
  if (!layers.some((l) => l.role === "subtitle" && l.followGap != null)) return false;
  const own = layers.find((l) => l.role === "headline");
  const theirs = base.find((l) => l.role === "headline");
  const metrics = (l) => JSON.stringify(LOCALE_FOLLOW_FIELDS.headline.map((k) => l[k] ?? null));
  return Boolean(own && theirs) && metrics(own) !== metrics(theirs);
}

/**
 * solveBaseStacks and solveLocaleStacks over a whole deck, for the CLI: each slide measured on every
 * one of `devices` that draws it, against its own shape,
 * and only where the stored solution is missing or stale.
 */
export function withLocaleStacks(deck, { devices, measurer }) {
  if (!measurer) return deck;
  return { ...deck, screenshots: (deck.screenshots ?? []).map((s) => withSlideStacks(deck, s, { devices, measurer })) };
}

/**
 * withLocaleStacks for one slide, which need not be the one `deck` holds: a
 * caller scoring a candidate edit of a slide solves the stacks that edit
 * leaves stale, as `check` does on the written deck, instead of scoring it
 * against the estimator fallback. A slide whose stack was never solved (device
 * `hRatio: null`) gets its base column solved too.
 */
export function withSlideStacks(deck, s, { devices, measurer }) {
  if (!measurer) return s;
  const opts = columnOptions(s, {
    devices,
    screenshots: deck.screenshots,
    defaults: withDefaults(deck.defaults),
    measurer,
    onlyStale: true,
  });
  if (!opts) return s;
  // The editor's boot solves an unsolved stack before anything draws it
  // (reflowStackedSlides); the CLI reads the same deck, so it does the same for
  // the one state no host ever stored as a measurement: `hRatio: null` under a
  // stack, the preset seed init and the editor's own new slides carry. Drawn as
  // is, the seed reserves one headline line and a longer one ran into the
  // subtitle (N824). A solved column stays as stored so a deck the editor saved
  // renders byte-identically: re-measuring it here would drift by the measurer.
  const dev = s.layers.find((l) => l.type === "device");
  const base =
    dev?.stackId && dev.hRatio == null
      ? solveBaseColumn(s, {
          device: opts.device,
          locale: opts.defaults.baseLocale,
          defaults: opts.defaults,
          screenshots: deck.screenshots,
          measurer,
        })
      : s;
  return solveColumnStacks(base, opts);
}

// A layer that crossed a seam is stored in its own slide's coordinates, so once
// the panorama it reached into is split or shortened it can sit wholly off the
// strip — drawn nowhere, and with nothing left on screen to grab. It is drawn
// centred on its own slide instead. The stored position is left alone, so
// joining the slides again puts it back where it was.
function homeStrays(layers, span, device) {
  const { W, H } = canvasOf(device);
  const lo = -(span?.index ?? 0) * W;
  const hi = lo + (span?.count ?? 1) * W;
  return layers.map((l) => {
    const box = layerBox(l, { W, H, frame: null });
    return box.x + box.w <= lo || box.x >= hi ? { ...l, xRatio: 0 } : l;
  });
}

/**
 * The panorama a slide belongs to: `{ members, index }`, or null.
 *
 * Membership is derived, never stored as a position. A slide carries a
 * `spanId`; its panorama is the unbroken run of slides around it, in export
 * order, that carry the same one. That is what keeps a panorama honest through
 * everything that moves slides — a reorder, an unselect, a delete — without a
 * single one of those paths knowing panoramas exist: a slide dragged out of the
 * run stops being in it.
 *
 * Selected slides only, because those are the ones exported side by side. A
 * run longer than MAX_SPAN (a deck written by hand) reads as consecutive
 * panoramas, and a run of one is an ordinary slide.
 *
 * The editor also stores each member's `spanIndex`, its place in the panorama
 * when it was joined, and a run only continues where those count up by one. So
 * a slide taken out of the middle — unselected, dragged away, deleted — splits
 * the panorama in two rather than closing the gap: the slides either side were
 * never next to each other in the picture, and whatever crossed onto the one
 * that left would land on the wrong neighbour. Putting it back restores the
 * run. A deck without indices joins as before.
 */
export function spanRun(screenshots, slide) {
  if (!slide?.spanId || !slide.selected) return null;
  const row = selectedRow(screenshots, slide.kind);
  const at = row.findIndex((s) => s.id === slide.id);
  if (at < 0) return null;
  const follows = (a, b) =>
    a.spanId === slide.spanId && b.spanId === slide.spanId &&
    (a.spanIndex == null || b.spanIndex == null || b.spanIndex === a.spanIndex + 1);
  let start = at;
  while (start > 0 && follows(row[start - 1], row[start])) start--;
  let end = at + 1;
  while (end < row.length && follows(row[end - 1], row[end])) end++;
  const chunk = start + Math.floor((at - start) / MAX_SPAN) * MAX_SPAN;
  const members = row.slice(chunk, Math.min(end, chunk + MAX_SPAN));
  return members.length > 1 ? { members, index: at - chunk } : null;
}

// A kind's selected slides in export order. Every card of every row asks for
// its panorama several times a render, so the sort is done once per deck
// snapshot — the editor replaces the array on every write rather than
// mutating it, which is what makes the array a sound cache key.
const rowCache = new WeakMap();
function selectedRow(screenshots, kind) {
  let rows = rowCache.get(screenshots);
  if (!rows) rowCache.set(screenshots, (rows = new Map()));
  if (!rows.has(kind)) {
    rows.set(kind, screenshots.filter((s) => s.kind === kind && s.selected).sort((a, b) => a.order - b.order));
  }
  return rows.get(kind);
}

// `{ index, count }` of a slide's panorama, or null.
function spanOf(screenshots, slide) {
  const run = spanRun(screenshots, slide);
  return run ? { index: run.index, count: run.members.length } : null;
}

// ---- Across the seams --------------------------------------------------------
// A panorama is one picture, so what hangs off one slide's edge carries on onto
// the next: a device dragged halfway past the seam shows its other half on the
// neighbour, which is the "one phone shared by two screenshots" layout. No
// layer is stored twice. Each stays on the slide that owns it, in that slide's
// own coordinates, and every neighbour it reaches paints it shifted by a whole
// canvas per slide between them — the same offset its background window has, so
// the two halves meet exactly.

// What may cross: everything on a slide. A caption that runs across the gap a
// store leaves between screenshots is cut there, which is the author's call —
// a word split by the seam reads as a deliberate panorama headline.
const CROSSING_TYPES = new Set(["device", "image", "text", "lens"]);

/**
 * How far a layer may travel sideways, as xRatio. Half a canvas either way puts
 * its centre on an edge, as far as a lone slide has use for. In a panorama a
 * device or a picture may carry on across the seams to the far slide's centre.
 */
export function xRange(layer, span) {
  const s = normalizeSpan(span);
  if (!s || !CROSSING_TYPES.has(layer?.type)) return { lo: -0.5, hi: 0.5 };
  return { lo: Math.max(-2, -0.5 - s.index), hi: Math.min(2, s.count - 0.5 - s.index) };
}

// Whether a layer drawn `shift` canvases right of its own slide lands on this
// one. The frame isn't known here, so the box is layerBox's canvas-aspect
// estimate, grown to its diagonal when the layer is turned and padded 10% —
// a layer that only nearly reaches costs one element nobody sees, while one
// dropped wrongly would tear the seam.
function reaches(layer, shift, ctx) {
  const box = layerBox(layer, ctx);
  const h = box.h ?? box.w;
  const r = layer.rotation ?? {};
  const w = (r.x || r.y || r.z ? Math.hypot(box.w, h) : box.w) * 1.1;
  const cx = box.x + box.w / 2 + shift * ctx.W;
  return cx + w / 2 > 0 && cx - w / 2 < ctx.W;
}

// The screenshot a slide shows on one device, when it was replaced there alone
// (`shotByDevice`), or null for the slide's own file.
// Only a non-empty string counts: the map comes from a file or a request nobody
// validated, and a number or object as a sourceKey would throw in every path
// that reads it.
export const deviceShotKey = (screenshot, deviceId) => {
  const key = screenshot.shotByDevice?.[deviceId];
  return typeof key === "string" && key ? key : null;
};

// A per-device screenshot is content, not layout, so it is resolved here, on
// what gets drawn, and never in resolveLayers. Held in layersByDevice it would
// be wiped by Reset layout, and a saved look — captured off the resolved
// layers — would carry this slide's screenshot onto every slide it is applied
// to. A device layer with a file of its own keeps it.
function withDeviceShot(layers, screenshot, deviceId) {
  const key = deviceShotKey(screenshot, deviceId);
  if (!key) return layers;
  return layers.map((l) => (l.type === "device" && !l.sourceKey ? { ...l, sourceKey: key } : l));
}

/**
 * What one card paints, back to front: its own layers and, in a panorama, the
 * neighbours' devices and pictures that reach it. Ordered across the whole
 * panorama — the first slide's layers, then the second's — so two layers that
 * overlap on a seam stack the same way on both sides of it. A layer whose
 * centre has moved onto another slide goes over all of them: slide order alone
 * slid a device dragged onto a neighbour under that neighbour's own, and it
 * vanished there — mid-drag and in the export. It is still one order for the
 * whole panorama, decided by the layer and not by the card drawing it.
 *
 * A borrowed layer has no role (it is not this slide's device or headline), an
 * id no own layer can have, `from` naming its slide, `shift` — what was added to
 * its xRatio to draw it here, so subtracting it gets back to its own slide's —
 * and, a device, its own slide's screenshot, which otherwise it would take from
 * whichever card drew it.
 * `resolveLayers` stays the card's own list: what the inspector edits, the
 * scorer grades and a preset moves.
 */
export function resolvePaint(screenshot, { deviceId, device, locale = null, defaults, screenshots = null }) {
  const own = withDeviceShot(resolveLayers(screenshot, { deviceId, device, locale, defaults, screenshots }), screenshot, deviceId);
  const run = screenshots && device ? spanRun(screenshots, screenshot) : null;
  if (!run) return own;
  const { W, H } = canvasOf(device);
  const ctx = { W, H, frame: null };
  const stack = run.members.flatMap((member, j) => {
    if (j === run.index) return own;
    const shift = j - run.index;
    const layers = withDeviceShot(resolveLayers(member, { deviceId, device, locale, defaults, screenshots }), member, deviceId);
    const ids = new Set(layers.filter((l) => CROSSING_TYPES.has(l.type) && reaches(l, shift, ctx)).map((l) => l.id));
    // A lens comes with its device's half, for the spot marked on it, and takes
    // its device along wherever it goes — it draws nothing without one.
    for (const l of layers) {
      if (l.type !== "lens") continue;
      if (ids.has(l.target)) ids.add(l.id);
      else if (ids.has(l.id)) ids.add(l.target);
    }
    return layers
      .filter((l) => ids.has(l.id))
      .map((l) => ({
        ...l,
        id: `${member.id}/${l.id}`,
        role: null,
        from: member.id,
        shift,
        xRatio: l.xRatio + shift,
        ...(l.type === "device" ? { sourceKey: l.sourceKey ?? member.sourceKey } : {}),
        ...(l.type === "lens" ? { target: `${member.id}/${l.target}` } : {}),
        // Text is sized off its role, which a borrowed layer gives up; carry the
        // size over as a multiplier on the role-less base instead. `sizeScale`
        // is that conversion, for an edit made here to undo on the way home.
        ...(l.type === "text" && l.role ? sizeOnRolelessBase(l, device) : {}),
      }));
  });
  // Centred on its own slide's seam is shared, not visiting: it keeps its place.
  // The lifted ones say so, for the editor to raise in place rather than move.
  const visiting = (l) => {
    const box = layerBox({ ...l, xRatio: l.xRatio - (l.shift ?? 0) }, ctx);
    const c = box.x + box.w / 2;
    return c < 0 || c > W;
  };
  return [...stack.filter((l) => !visiting(l)), ...stack.filter(visiting).map((l) => ({ ...l, visiting: true }))];
}

function sizeOnRolelessBase(layer, device) {
  const sizeScale = baseFontSize(layer.role, device) / baseFontSize(null, device);
  return { sizeMul: layer.sizeMul * sizeScale, sizeScale };
}

// The slide-level props of one card: what paints behind the layers.
//
// A slide in a panorama paints its first member's background, whatever its own
// field says — the editor keeps the members in step, but one picture has to
// have one owner or a write that reached only some of them tears the seam.
// `span` says which window of it this card is. Without `screenshots` a slide
// cannot see its neighbours and resolves standalone.
export function resolveSlide(screenshot, { deviceId, defaults, screenshots = null }) {
  const d = withDefaults(defaults);
  const run = screenshots ? spanRun(screenshots, screenshot) : null;
  return {
    background: resolveField(run?.members[0] ?? screenshot, deviceId, "background", d.background),
    span: run ? { index: run.index, count: run.members.length } : null,
  };
}

// A token's value, made safe to sit inside one path segment by the rules an
// upload's name follows, so "Главная" or "ホーム" keeps its name. A slide named
// "a/b" must not quietly become a directory, and a device label ending in a
// quote (`iPhone 6.9"`) must not leave a trailing separator behind.
const safeValue = (v) =>
  cleanNameText(v, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .trim();

// One path segment. Empty, "." and ".." all collapse to nothing: the template is
// user input that becomes a path inside a zip, and a traversal there would write
// outside the folder the archive claims to use.
const safeSegment = (v) => {
  const cleaned = safeValue(v);
  return /^\.*$/.test(cleaned) ? "" : cleaned;
};

// `order` is 1-based and zero-padded, because lexical sorting is what a store's
// upload dialog does — without the padding, slide 10 lands before slide 2.
export function expandNameTemplate(template, { order, slide, device, kind, locale }) {
  const expanded = String(template || DEFAULT_NAME_TEMPLATE)
    .replaceAll("{order}", String(order).padStart(2, "0"))
    .replaceAll("{slide}", safeValue(slide))
    .replaceAll("{device}", safeValue(device))
    .replaceAll("{kind}", safeValue(kind))
    .replaceAll("{locale}", safeValue(locale ?? ""));
  const segments = expanded.split("/").map(safeSegment).filter(Boolean);
  return segments.length ? segments.join("/") : "untitled";
}

// Position within its own kind, 1-based, as { slideId -> n }. Stores sort
// screenshots by filename, so this is what decides the order they appear in.
//
// Driven off KINDS rather than a hand-written list: a kind missing from that
// list doesn't fail loudly, it numbers every one of its slides "01" and the
// store falls back to alphabetical order.
// A hand-written slide may have no name, and "undefined" is not one.
export const slideName = (screenshot, order) => screenshot.name || screenshot.id || `slide-${order}`;

// Two names one filesystem file: on macOS and Windows "Hero.png" and "hero.png"
// are one file, and so are a composed and a decomposed "é".
export const nameKey = (name) => name.normalize("NFC").toLowerCase();

// `base.ext`, or `base_2.ext` and on if that is taken, by nameKey. `_` sorts
// after the `.` of the original, so a copy never lands before it.
export function claimName(seen, base, ext) {
  let name = `${base}.${ext}`;
  for (let n = 2; seen.has(nameKey(name)); n++) name = `${base}_${n}.${ext}`;
  seen.add(nameKey(name));
  return name;
}

export function exportOrder(screenshots) {
  const orderOf = new Map();
  for (const kind of KINDS) {
    screenshots
      .filter((s) => s.kind === kind && s.selected)
      .sort((a, b) => a.order - b.order)
      .forEach((s, i) => orderOf.set(s.id, i + 1));
  }
  return orderOf;
}

const selectedOfKind = (screenshots, kind) =>
  screenshots.filter((s) => s.kind === kind && s.selected).sort((a, b) => a.order - b.order);

// Whether a device draws this slide: its own kind, or the fallback kind on a
// device with no selected slides of its own (slidesForDevice), selected or not.
export function drawsSlide(screenshots, slide, device) {
  if (device.category === slide.kind) return true;
  return FALLBACK_KIND[device.category] === slide.kind && !selectedOfKind(screenshots, device.category).length;
}

// Which slides a device draws, and in which frame. Its own kind if it has any,
// otherwise the phone deck of the same orientation in a phone frame.
export function slidesForDevice(screenshots, device) {
  const own = selectedOfKind(screenshots, device.category);
  if (own.length > 0 || !FALLBACK_KIND[device.category]) {
    return own.map((s) => ({ screenshot: s, frameOverride: null }));
  }
  const { W, H } = canvasOf(device);
  const table = W > H ? PHONE_FRAME_FOR_PLATFORM_LANDSCAPE : PHONE_FRAME_FOR_PLATFORM;
  const phoneFrame = table[device.platform] ?? device.frame;
  return selectedOfKind(screenshots, FALLBACK_KIND[device.category]).map((s) => ({
    screenshot: s,
    frameOverride: phoneFrame,
  }));
}

/**
 * Every image a deck produces: one cell per (slide × device × locale), fully
 * resolved and already named. The single definition of "what does this deck
 * render to" — the editor's render loop, its zip, and the CLI all walk this, so
 * a file that comes out of one comes out of the others byte for byte.
 *
 * `devices` is the device records to render on, in either host's spelling
 * (canvasOf adapts). `locales` defaults to the deck's own languages. `template`
 * and `ext` default to the deck's own export settings; a host passes them to
 * override (the CLI's flags).
 */
export function deckCells(deck, { devices, locales = null, template, ext } = {}) {
  const defaults = withDefaults(deck.defaults);
  const own = exportSettings(deck.defaults);
  template ??= own.template;
  ext ??= extFor(own.format);
  const screenshots = deck.screenshots ?? [];
  const wanted = locales?.length ? locales : defaults.locales;
  const deckLocales = defaults.locales ?? [];

  // Two languages in one export with no {locale} in the template would put every
  // language on the same path, where the de-dupe below quietly renames them _2,
  // _3 — and the store gets a folder of the wrong words in the right order.
  //
  // Keyed off the languages the *deck* has, not the ones this export covers, so
  // a one-language export out of a translated project is foldered too. Exporting
  // German today and English tomorrow otherwise yields two sets with identical
  // paths: unpack the second over the first and every screenshot is replaced by
  // the other language, with nothing anywhere saying so.
  const foldered = new Set(deckLocales.length ? deckLocales : wanted).size > 1;
  const withLocale =
    foldered && !String(template ?? "").includes("{locale}")
      ? `{locale}/${template || DEFAULT_NAME_TEMPLATE}`
      : template;

  const orderOf = exportOrder(screenshots);
  const cells = [];
  // Two slides sharing a name would otherwise silently overwrite each other.
  const seen = new Set();
  // Locale is the outer loop, so a cancelled multi-language export leaves whole
  // languages finished rather than every language half done.
  for (const locale of wanted) {
    for (const device of devices) {
      for (const { screenshot, frameOverride } of slidesForDevice(screenshots, device)) {
        const order = orderOf.get(screenshot.id) ?? 1;
        const slide = slideName(screenshot, order);
        const base = expandNameTemplate(withLocale, {
          order,
          slide,
          device: device.label ?? device.id,
          kind: screenshot.kind,
          locale,
        });
        const name = claimName(seen, base, ext);
        cells.push({
          screenshot,
          slide,
          // The name it would have had, when another cell got there first. The
          // editor's zip lives with the suffix; the CLI refuses the clash.
          clashesWith: name === `${base}.${ext}` ? null : `${base}.${ext}`,
          device,
          deviceId: device.id,
          locale,
          frameOverride,
          name,
          layers: resolveLayers(screenshot, { deviceId: device.id, device, locale, defaults, screenshots }),
          // What the file shows: the layers above plus whatever of a panorama
          // neighbour's reaches across the seam. `layers` stays the slide's own,
          // because that is what gets scored.
          paint: resolvePaint(screenshot, { deviceId: device.id, device, locale, defaults, screenshots }),
          ...resolveSlide(screenshot, { deviceId: device.id, defaults, screenshots }),
          safeArea: resolveSafeArea(screenshot, device.id, device, defaults),
          orientation: orientationOf(screenshot.kind),
        });
      }
    }
  }
  return cells;
}
