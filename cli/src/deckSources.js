// Which files a deck names, and how to rename them. Node-API-free on purpose: the
// editor imports it through Vite (state.js), while pushDeck.js pulls in node:fs
// and the session.
import { isStickerKey } from "./stickers.js";
import { isBackgroundImageKey } from "./visual.js";

// App-owned roots. Both resolve on the server without an owner, so uploading
// them would put a second copy under the visitor's directory under a key that
// then points at the wrong file.
// `backgrounds/` is the bundled photo pack: uploading it turned a bundled photo
// into `uploads/asset/…`, which the editor no longer shows as one and which
// lost a panorama's `backgrounds/wide/` twin.
export const isAppOwned = (key) =>
  isStickerKey(key) || key.startsWith("examples/") || isBackgroundImageKey(key);

const isMap = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

const imageBackgroundKey = (bg) =>
  bg && typeof bg === "object" && bg.type === "image" && bg.sourceKey ? bg.sourceKey : null;

// `add(key, kind, where)`: `where` is the path to the key in the deck, for the
// callers that report it (validateDeck); the collectors in pushDeck.js ignore it.
export function walkDeckSources(deck, add) {

  // A file is uploaded once, under one kind, and every reference to it is
  // rewritten to that upload. When it is some slide's own screenshot that kind
  // must be the slide's: uploaded as an "asset" first (because a layer, a
  // background or another slide's per-device shot listed earlier named it), the
  // slide's sourceKey became uploads/asset/… and the editor dropped the slide as
  // a file no longer on the server. So slides claim their files before anything
  // else does; two slides of different kinds sharing a file go to the first.
  // Shape guards: a deck stored before the deck routes checked its shape (N522) can hold a
  // null slide, layer or override map, and this walk runs on claim, duplicate and restore.
  const slides = Array.isArray(deck.screenshots) ? deck.screenshots : [];
  slides.forEach((s, i) => isMap(s) && add(s.sourceKey, s.kind ?? "phone", `screenshots[${i}].sourceKey`));
  add(imageBackgroundKey(deck.defaults?.background), "asset", "defaults.background.sourceKey");
  slides.forEach((s, i) => {
    if (!isMap(s)) return;
    const at = `screenshots[${i}]`;
    add(imageBackgroundKey(s.background), "asset", `${at}.background.sourceKey`);
    for (const [id, patch] of Object.entries(isMap(s.byDevice) ? s.byDevice : {})) {
      if (!isMap(patch)) continue;
      add(imageBackgroundKey(patch.background), "asset", `${at}.byDevice["${id}"].background.sourceKey`);
    }
    (Array.isArray(s.layers) ? s.layers : []).forEach((l, j) => isMap(l) && add(l.sourceKey, "asset", `${at}.layers[${j}].sourceKey`));
    for (const [id, byLayer] of Object.entries(isMap(s.layersByDevice) ? s.layersByDevice : {})) {
      for (const [layerId, patch] of Object.entries(isMap(byLayer) ? byLayer : {})) {
        if (!isMap(patch)) continue;
        add(patch.sourceKey, "asset", `${at}.layersByDevice["${id}"].${layerId}.sourceKey`);
      }
    }
    for (const [id, key] of Object.entries(isMap(s.shotByDevice) ? s.shotByDevice : {})) {
      add(key, "asset", `${at}.shotByDevice["${id}"]`);
    }
  });
}

/** The same deck with every source key run through `fn`. Pure. */
export function mapDeckSources(deck, fn) {
  // Only a string answer renames: callers look keys up in plain objects, where "constructor",
  // "toString" or "__proto__" answer with Object.prototype members that would be stored as the key.
  const key = (k) => {
    if (typeof k !== "string" || !k || isAppOwned(k)) return k;
    const v = fn(k);
    return typeof v === "string" ? v : k;
  };
  const bg = (b) => (imageBackgroundKey(b) ? { ...b, sourceKey: key(b.sourceKey) } : b);
  const layer = (l) => (isMap(l) && l.sourceKey ? { ...l, sourceKey: key(l.sourceKey) } : l);
  const mapValues = (obj, f) =>
    isMap(obj) ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, f(v)])) : obj;

  return {
    ...deck,
    defaults: isMap(deck.defaults) ? { ...deck.defaults, background: bg(deck.defaults.background) } : deck.defaults,
    // Saved decks are not validated, so a stored version can hold a non-list here; leave it as is.
    knownSourceKeys: Array.isArray(deck.knownSourceKeys) ? deck.knownSourceKeys.map(key) : deck.knownSourceKeys,
    screenshots: (Array.isArray(deck.screenshots) ? deck.screenshots : []).map((s) => !isMap(s) ? s : ({
      ...s,
      sourceKey: key(s.sourceKey),
      background: bg(s.background),
      byDevice: mapValues(s.byDevice, (p) => (isMap(p) ? { ...p, background: bg(p.background) } : p)),
      layers: (Array.isArray(s.layers) ? s.layers : []).map(layer),
      layersByDevice: mapValues(s.layersByDevice, (byLayer) => mapValues(byLayer, layer)),
      shotByDevice: isMap(s.shotByDevice) ? mapValues(s.shotByDevice, key) : s.shotByDevice,
    })),
  };
}
