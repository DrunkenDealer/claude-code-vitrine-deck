// The bundled sticker library: small SVG art a slide carries as an ordinary
// image layer, recoloured to the slide's palette.
//
// A sticker is not its own layer type. It is an `image` layer whose sourceKey
// points into assets/stickers/ instead of the owner's uploads, which is what
// lets it inherit geometry, canvas handles, the per-device override map, undo
// and the CLI without a second code path — the same rule frames follow.
//
// Recolouring: art is authored with real colours and the manifest says which of
// them are slots. A slot's default hex must appear nowhere else in that file, so
// retinting is a plain string replace and the raw .svg still opens correctly in
// any viewer. Custom properties would read tidier, but whether var() resolves
// inside an SVG loaded as an <img> — and inside a presentation attribute — is
// engine-dependent, and these files get rasterized through foreignObject.
//
// Node-API-free like frames.js/geometry.js/visual.js: both hosts import it.

export const STICKER_ROOT = "stickers";
// The two packs whose art is fetched on demand rather than bundled, so they are
// the ones that can be missing from a fresh checkout. Emoji is full-colour and
// declares nothing to recolour; icons are line art with one ink slot, and their
// weight rides in the id (`icons/trophy-duotone`) rather than being a pack of
// its own — six more tabs is not a control anyone can use in a 320px panel.
export const EMOJI_PACK = "emoji";
export const ICONS_PACK = "icons";

// At most this many slots per sticker. A colour control per slot has to fit a
// 320px panel, and a file needing more than a handful is art, not a sticker.
export const MAX_SLOTS = 8;

const HEX_RE = /^#[0-9a-f]{6}$/i;

export const isStickerKey = (sourceKey) =>
  typeof sourceKey === "string" && sourceKey.startsWith(`${STICKER_ROOT}/`);

// `{ token: "#rrggbb" }`, with anything unrecognizable dropped and the keys in a
// fixed order. Exported because the layer model, the render hash and the URL
// builder must agree on canonical form — two equal tints that serialize
// differently would render twice and never share a cache entry.
export function normalizeTint(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const token of Object.keys(raw).sort()) {
    const value = raw[token];
    if (typeof value !== "string" || !HEX_RE.test(value)) continue;
    out[token] = value.toLowerCase();
    if (Object.keys(out).length >= MAX_SLOTS) break;
  }
  return Object.keys(out).length ? out : null;
}

// The manifest's sticker list -> a lookup by id. `id` doubles as the path under
// assets/stickers/, so "objects/trophy" is trophy.svg in objects/.
export function indexStickers(manifest) {
  const list = Array.isArray(manifest?.stickers) ? manifest.stickers : [];
  return new Map(list.map((s) => [s.id, s]));
}

// What a sticker declares to recolour when the manifest does not name it one by
// one. The authored pack is 36 entries, each carrying its own slots; an
// on-demand pack is thousands of files that all took the same treatment on the
// way to disk, so the slots live on the pack and every file in it inherits them.
export const packSlotsFor = (id, packs) =>
  (typeof id === "string" ? (packs ?? []) : []).find((p) => id.startsWith(`${p.id}/`))?.slots ?? null;

export const stickerIdFromKey = (sourceKey) =>
  isStickerKey(sourceKey)
    ? sourceKey.slice(STICKER_ROOT.length + 1).replace(/\.svg$/i, "")
    : null;

export const stickerKeyFromId = (id) => `${STICKER_ROOT}/${id}.svg`;

// The emoji itself, decoded from the codepoints its file is named by. Lets a
// layer in the tree read "🚀" without the ~3.9k-entry catalog being loaded —
// which, on a restored deck, it has not been.
export function emojiChar(sourceKey) {
  const id = stickerIdFromKey(sourceKey);
  if (!id?.startsWith(`${EMOJI_PACK}/`)) return null;
  const points = id.slice(EMOJI_PACK.length + 1).split("_").map((p) => parseInt(p, 16));
  if (!points.length || points.some((n) => !Number.isInteger(n))) return null;
  try {
    return String.fromCodePoint(...points);
  } catch {
    return null;
  }
}

// Substitutes each slot's sentinel hex for the colour chosen for it. Untouched
// when nothing is tinted, so an untinted sticker is served byte-for-byte and a
// slotless one (every emoji) can never be rewritten at all.
//
// One scan, not one per slot. Substituting slot by slot lets a slot's *output*
// be matched by a later slot's *sentinel*: hand a two-slot sticker
// { a: b's own hex, b: something else } and a's colour is gone, because b's pass
// replaces what a's pass just wrote. The authoring rule keeps sentinels distinct
// within a file; it cannot stop a user picking one. Nothing shipped declares two
// slots today — an object has none and an icon has one ink — but the substitution
// is what makes adding one safe.
export function applyTint(svgText, slots, tint) {
  const chosen = normalizeTint(tint);
  if (!chosen || !Array.isArray(slots) || !slots.length) return svgText;

  // Lower-cased sentinel -> the colour asked for, resolved before anything is
  // written so every match is decided against the original text.
  const by = new Map();
  for (const slot of slots) {
    const next = chosen[slot.token];
    // HEX_RE is the guard: this string is interpolated into a document that gets
    // served to a browser, so a value that isn't a plain hex is not "escaped",
    // it is ignored.
    if (!next || !HEX_RE.test(slot.default ?? "")) continue;
    by.set(slot.default.toLowerCase(), next);
  }
  if (!by.size) return svgText;

  // A sentinel is `/^#[0-9a-f]{6}$/i`, so it carries no regex metacharacters and
  // needs no escaping. `i` catches whatever case the file wrote it in — mixed
  // case included, which three passes over lower/upper/as-declared missed. The
  // lookahead keeps `#111827` from eating the first six digits of `#111827ff`,
  // which is a different colour.
  const re = new RegExp(`(?:${[...by.keys()].join("|")})(?![0-9a-f])`, "gi");
  return svgText.replace(re, (m) => by.get(m.toLowerCase()) ?? m);
}

// Percent-encoded rather than base64, for frames.js's reason: btoa is
// browser-only and Buffer is node-only, and this module runs on both sides.
export const stickerSvgUrl = (svgText, slots, tint) =>
  `data:image/svg+xml,${encodeURIComponent(applyTint(svgText, slots, tint))}`;

// The URL the browser asks for. Tinting happens on the server — the live canvas
// preview paints an <img> synchronously and cannot await the file's text, so
// doing it here would cost every first paint a flash of untinted art.
export function stickerUrl(sourceKey, tint) {
  const chosen = normalizeTint(tint);
  if (!chosen) return `/${sourceKey}`;
  const query = Object.entries(chosen)
    .map(([token, value]) => `${encodeURIComponent(token)}=${encodeURIComponent(value)}`)
    .join("&");
  return `/${sourceKey}?${query}`;
}

// The inverse, for the route: a query string back to a tint. Same normalizer, so
// a hand-typed URL cannot express a tint the editor could not.
export function tintFromQuery(query, slots) {
  if (!slots?.length) return null;
  const raw = {};
  for (const slot of slots) {
    const value = query?.[slot.token];
    if (typeof value === "string") raw[slot.token] = value;
  }
  return normalizeTint(raw);
}
