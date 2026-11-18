// v1 -> v2: three named sockets become a layer list.
//
// One table drives the whole migration, so the slide-level fields and the
// per-device override maps cannot disagree about what an old key meant. A v1 key
// that styled *both* text blocks (textColor, fontId, textAlign) lands on both
// layers — that fan-out is what the old field actually did.
//
// Nulls are preserved rather than filled: a v1 slide that left `fontId` unset was
// inheriting the project default, and the migrated layer has to keep inheriting
// it or a theme would stop reaching the deck. normalizeLayer fills whatever is
// still missing at resolve time.
import {
  DEVICE_LAYER_ID,
  HEADLINE_LAYER_ID,
  SUBTITLE_LAYER_ID,
} from "../../../src/layers.js";
import { KINDS } from "../../../src/deck.js";
import { isSourceKey, normalizeLayer } from "../../../src/layers.js";
import { isBackgroundSpec, normalizeBackground } from "../../../src/visual.js";
import { uncoercible, withoutPoison } from "../../../src/wireScalars.js";
import { DEFAULT_TEXT_WRATIO } from "../../../src/geometry.js";
import { DEVICES, RETIRED_DEVICE_IDS, currentDeviceId } from "../../../src/devices.js";

// v1 key -> [layerId, newKey][]. Keys absent from this table stay on the slide.
const TO_LAYER = {
  headline: [[HEADLINE_LAYER_ID, "text"]],
  subtitle: [[SUBTITLE_LAYER_ID, "text"]],
  textColor: [[HEADLINE_LAYER_ID, "color"], [SUBTITLE_LAYER_ID, "color"]],
  fontId: [[HEADLINE_LAYER_ID, "fontId"], [SUBTITLE_LAYER_ID, "fontId"]],
  textAlign: [[HEADLINE_LAYER_ID, "align"], [SUBTITLE_LAYER_ID, "align"]],
  headlineWeight: [[HEADLINE_LAYER_ID, "weight"]],
  subtitleWeight: [[SUBTITLE_LAYER_ID, "weight"]],
  headlineSizeMul: [[HEADLINE_LAYER_ID, "sizeMul"]],
  subtitleSizeMul: [[SUBTITLE_LAYER_ID, "sizeMul"]],
  headlineRotation: [[HEADLINE_LAYER_ID, "rotation"]],
  subtitleRotation: [[SUBTITLE_LAYER_ID, "rotation"]],
  deviceTransform: [[DEVICE_LAYER_ID, "rotation"]],
  useFrame: [[DEVICE_LAYER_ID, "useFrame"]],
  frameTint: [[DEVICE_LAYER_ID, "frameTint"]],
  headlineXRatio: [[HEADLINE_LAYER_ID, "xRatio"]],
  headlineYRatio: [[HEADLINE_LAYER_ID, "yRatio"]],
  subtitleXRatio: [[SUBTITLE_LAYER_ID, "xRatio"]],
  subtitleYRatio: [[SUBTITLE_LAYER_ID, "yRatio"]],
  deviceXRatio: [[DEVICE_LAYER_ID, "xRatio"]],
  deviceYRatio: [[DEVICE_LAYER_ID, "yRatio"]],
  deviceHeightRatio: [[DEVICE_LAYER_ID, "hRatio"]],
};

// The slide keeps what paints behind the layers and what is measured in device
// pixels rather than canvas ratios.
const SLIDE_KEYS = new Set([
  "background", "safeAreaTop", "safeAreaBottom", "safeAreaLeft", "safeAreaRight",
]);

// Split a flat v1 bag into { forSlide, forLayers: { [layerId]: patch } }.
function split(bag) {
  const forSlide = {};
  const forLayers = {};
  for (const [key, value] of Object.entries(bag ?? {})) {
    if (value === undefined) continue;
    const targets = TO_LAYER[key];
    if (!targets) {
      if (SLIDE_KEYS.has(key)) forSlide[key] = value;
      continue;
    }
    for (const [layerId, newKey] of targets) {
      (forLayers[layerId] ??= {})[newKey] = value;
    }
  }
  return { forSlide, forLayers };
}

// The three layers a v1 slide always had, back to front: the device painted at
// z-index 2 and the text blocks at 3.
function layersFor(slide) {
  const { forLayers } = split({ ...slide.layout, ...slide });
  const base = {
    [DEVICE_LAYER_ID]: {
      id: DEVICE_LAYER_ID, role: "device", type: "device",
      xRatio: 0, yRatio: 0.24, opacity: 1, sourceKey: null,
    },
    [HEADLINE_LAYER_ID]: {
      id: HEADLINE_LAYER_ID, role: "headline", type: "text",
      xRatio: 0, yRatio: 0.04, wRatio: DEFAULT_TEXT_WRATIO, text: "",
    },
    [SUBTITLE_LAYER_ID]: {
      id: SUBTITLE_LAYER_ID, role: "subtitle", type: "text",
      xRatio: 0, yRatio: 0.11, wRatio: DEFAULT_TEXT_WRATIO, text: "",
    },
  };
  return [DEVICE_LAYER_ID, HEADLINE_LAYER_ID, SUBTITLE_LAYER_ID].map((id) => ({
    ...base[id],
    ...(forLayers[id] ?? {}),
  }));
}

function overridesFor(slide) {
  const deviceIds = new Set([
    ...Object.keys(slide.byDevice ?? {}),
    ...Object.keys(slide.layoutByDevice ?? {}),
  ]);
  const layersByDevice = {};
  const byDevice = {};
  for (const deviceId of deviceIds) {
    const { forSlide, forLayers } = split({
      ...(slide.layoutByDevice?.[deviceId] ?? {}),
      ...(slide.byDevice?.[deviceId] ?? {}),
    });
    if (Object.keys(forLayers).length) layersByDevice[deviceId] = forLayers;
    if (Object.keys(forSlide).length) byDevice[deviceId] = forSlide;
  }
  return {
    layersByDevice: Object.keys(layersByDevice).length ? layersByDevice : undefined,
    byDevice: Object.keys(byDevice).length ? byDevice : undefined,
  };
}

const V1_ONLY = new Set([...Object.keys(TO_LAYER), "layout", "layoutByDevice"]);

export function migrateSlideToLayers(slide) {
  if (Array.isArray(slide.layers)) return slide;
  const kept = Object.fromEntries(
    Object.entries(slide).filter(([k]) => !V1_ONLY.has(k)),
  );
  return { ...kept, layers: layersFor(slide), ...overridesFor(slide) };
}

// v2 -> v3: a background stops being compiled CSS and becomes a spec, so the
// background editor can reopen what a slide is actually using. A string can't be
// parsed back into stops, so it is preserved verbatim as a `raw` spec and simply
// isn't editable until it is replaced.
const toSpec = (v) => (typeof v === "string" ? { type: "raw", css: v } : v);

function migrateSlideBackground(slide) {
  const byDevice = slide.byDevice
    ? Object.fromEntries(Object.entries(slide.byDevice).map(([id, patch]) => [
        id,
        "background" in patch ? { ...patch, background: toSpec(patch.background) } : patch,
      ]))
    : slide.byDevice;
  return { ...slide, background: toSpec(slide.background), byDevice };
}

// v3 -> v4: safe area became opt-in. Every deck saved while it was on by default
// carries `safeAreaEnabled: true`, which would keep turning the guides — and the
// text clamp — back on for a deck nobody chose it for. Written as `false` rather
// than dropped so the deck states it instead of leaving it to a default.
const migrateDefaults = (defaults) =>
  defaults && { ...defaults, background: toSpec(defaults.background), safeAreaEnabled: false };

export const DECK_VERSION = 4;

// N537: a v4 deck written outside the editor (or by a raw API POST, which the
// server accepts) can name a slide with no `layers`. The v4 early return skipped
// the only fill, and the first `.layers` read at boot then threw. Only `layers`
// is set: the full slide migration would overwrite an existing layersByDevice.
export function migrateDeckToLayers(deck) {
  if (!deck) return deck;
  if (deck.v === DECK_VERSION) {
    const bare = (s) => s && typeof s === "object" && !Array.isArray(s.layers);
    if (!Array.isArray(deck.screenshots) || !deck.screenshots.some(bare)) return deck;
    return {
      ...deck,
      screenshots: deck.screenshots.map((s) => (bare(s) ? { ...s, layers: layersFor(s) } : s)),
    };
  }
  return {
    ...deck,
    v: DECK_VERSION,
    screenshots: (deck.screenshots ?? []).map((s) =>
      migrateSlideBackground(migrateSlideToLayers(s)),
    ),
    defaults: migrateDefaults(deck.defaults),
    ...(deck.defaultBackground === undefined
      ? {}
      : { defaultBackground: toSpec(deck.defaultBackground) }),
  };
}

// Decks saved before a device row was retired still name the old id in
// projectDevices and in the per-device override maps, so remap on load. The map
// itself is src/devices.js's, so resolveDevice and this agree about what an old
// id means; if a deck carries both an old id and its replacement, the first
// one's overrides win.
function migrateDeviceIds(byDevice) {
  if (!byDevice || typeof byDevice !== "object" || !Object.keys(RETIRED_DEVICE_IDS).some((id) => id in byDevice)) return byDevice;
  const out = { ...byDevice };
  for (const [from, to] of Object.entries(RETIRED_DEVICE_IDS)) {
    if (!(from in out)) continue;
    if (!(to in out)) out[to] = out[from];
    delete out[from];
  }
  return out;
}

// A per-device screenshot map is { deviceId: sourceKey }. The server stores a
// deck as sent, so a string, an array or a number for a value reaches here, and
// `id in "string"` threw ("The editor couldn't start") while a non-string value
// threw in every key.startsWith downstream. Whatever is not a non-empty string
// under a device id is dropped, as the slide's own file shows there instead.
function cleanShotByDevice(map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return undefined;
  const kept = Object.entries(map).filter(([, key]) => typeof key === "string" && key);
  return kept.length ? Object.fromEntries(kept) : undefined;
}

// Keys briefly carried the session id (`uploads/sessions/<sid>/phone/x.png`)
// before decks were made identity-free. Strip it: the owner comes from the
// request now, and a key that names one can never resolve again.
const SESSION_KEY_RE = /^uploads\/sessions\/[0-9a-f]{32}\//;
const migrateKey = (key) =>
  typeof key === "string" ? key.replace(SESSION_KEY_RE, "uploads/") : key;

// Every migration a stored deck needs. Runs on whichever copy the editor's boot
// ends up using — the local one *or* the server's — and on every deck the CLI
// loads, so a deck that has only ever lived on the server or on disk still
// reaches the current version.
export function migrateDeck(blob) {
  if (!blob) return blob;
  const devices = new Set((blob.projectDevices ?? []).map(currentDeviceId));
  // Device ids first, layers second: the layer migration folds byDevice and
  // layoutByDevice together, so their keys have to be current before it runs.
  return migrateDeckToLayers({
    ...blob,
    projectDevices: [...devices],
    // A deck stored before the server and CLI checked this field may hold an
    // object or non-string entries; the editor's Set/spread would throw on open
    // (N510), so anything but a list of keys is dropped here.
    knownSourceKeys: (Array.isArray(blob.knownSourceKeys) ? blob.knownSourceKeys : []).filter((k) => typeof k === "string").map(migrateKey),
    screenshots: (blob.screenshots ?? []).map((s) => ({
      ...s,
      sourceKey: migrateKey(s.sourceKey),
      byDevice: migrateDeviceIds(s.byDevice),
      layoutByDevice: migrateDeviceIds(s.layoutByDevice),
      layersByDevice: migrateDeviceIds(s.layersByDevice),
      shotByDevice: migrateDeviceIds(cleanShotByDevice(s.shotByDevice)),
    })),
  });
}

// A deck the editor boots from may not have come from the editor: the server stored a deck
// as sent (before N522 it checked no shapes) and the localStorage boot cache is anyone's to
// edit. The render tree reads raw shapes — a null layer, a gradient whose stops aren't
// pairs, a slide that is a string — and a throw there, after boot() resolved, unmounted the
// editor to a blank page. This brings a deck to what the render engine already treats it as:
// layers are what normalizeLayers keeps, a background is what normalizeBackground paints (an
// unknown type becomes null, so it inherits the project default), poison keys are gone.
// Editor-only and run before migrateDeck, which itself throws on a null slide. Not called
// from migrateDeck: the CLI runs that before validation and must still see the poison
// (N517). An honest deck comes back untouched (same objects), so a repair adds no dirty diff.
const isMap = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isDeviceId = (id) => typeof id === "string" && (Object.hasOwn(DEVICES, id) || Object.hasOwn(RETIRED_DEVICE_IDS, id));
const fixBg = (b) => (isBackgroundSpec(b) ? b : normalizeBackground(b));

// Stored before the server checked layer keys (N825): a key that resolves nowhere on the
// server is cleared so the deck opens, draws nothing there, and its next save passes. Judged
// as migrateDeck will leave it (repairDeck runs first), so a legacy session key survives.
const strayKey = (k) => k != null && k !== "" && !isSourceKey(migrateKey(k));

function repairSlide(s) {
  let out = s;
  const set = (k, v) => { if (out === s) out = { ...s }; out[k] = v; };
  if (s.sourceKey != null && typeof s.sourceKey !== "string") set("sourceKey", null);
  // The editor shows a slide only on devices of its kind and, unlike the CLI, never
  // reads a missing kind as phone: an unknown one hid the slide (N525).
  if (!KINDS.includes(s.kind)) set("kind", "phone");
  if (Array.isArray(s.layers)) {
    const kept = s.layers.filter((l) => normalizeLayer(l));
    const cleared = kept.map((l) => (strayKey(l.sourceKey) ? { ...l, sourceKey: null } : l));
    if (cleared.some((l, i) => l !== kept[i]) || kept.length !== s.layers.length) set("layers", cleared);
  } else if (s.layers !== undefined) {
    set("layers", migrateSlideToLayers({ ...s, layers: undefined }).layers);
  }
  if (!isBackgroundSpec(s.background)) set("background", fixBg(s.background));
  if (s.byDevice != null) {
    if (!isMap(s.byDevice)) set("byDevice", undefined);
    else {
      const patches = Object.entries(s.byDevice)
        .filter(([, p]) => isMap(p))
        .map(([id, p]) => [id, isBackgroundSpec(p.background) ? p : { ...p, background: fixBg(p.background) }]);
      if (patches.length !== Object.keys(s.byDevice).length || patches.some(([id, p]) => p !== s.byDevice[id])) set("byDevice", Object.fromEntries(patches));
    }
  }
  if (s.layersByDevice != null) {
    if (!isMap(s.layersByDevice)) set("layersByDevice", undefined);
    else {
      const cleaned = Object.entries(s.layersByDevice)
        .filter(([, m]) => isMap(m))
        .map(([id, m]) => [id, Object.fromEntries(Object.entries(m).filter(([, p]) => isMap(p)).map(([lid, p]) => {
          if (!strayKey(p.sourceKey)) return [lid, p];
          const { sourceKey: _, ...rest } = p;
          return [lid, rest];
        }))]);
      const same = cleaned.length === Object.keys(s.layersByDevice).length
        && cleaned.every(([id, m]) => Object.keys(m).length === Object.keys(s.layersByDevice[id]).length
          && Object.entries(m).every(([lid, p]) => p === s.layersByDevice[id][lid]));
      if (!same) set("layersByDevice", Object.fromEntries(cleaned));
    }
  }
  return out;
}

export function repairDeck(deck) {
  if (!isMap(deck)) return deck;
  const d = uncoercible(deck, "", { nul: false }).length ? withoutPoison(deck) : deck;
  let out = d;
  const set = (k, v) => { if (out === d) out = { ...d }; out[k] = v; };
  if (d.screenshots !== undefined) {
    const fixed = (Array.isArray(d.screenshots) ? d.screenshots.filter(isMap) : []).map(repairSlide);
    if (!Array.isArray(d.screenshots) || fixed.length !== d.screenshots.length || fixed.some((s, i) => s !== d.screenshots[i])) set("screenshots", fixed);
  }
  if (d.projectDevices != null) {
    const ids = Array.isArray(d.projectDevices) ? d.projectDevices.filter(isDeviceId) : [];
    if (ids.length !== d.projectDevices.length) set("projectDevices", ids);
  }
  if (d.defaults != null && !isMap(d.defaults)) set("defaults", undefined);
  else if (isMap(d.defaults) && !isBackgroundSpec(d.defaults.background)) set("defaults", { ...d.defaults, background: fixBg(d.defaults.background) });
  if (!isBackgroundSpec(d.defaultBackground)) set("defaultBackground", fixBg(d.defaultBackground));
  return out;
}
