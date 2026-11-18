// The editor's pickers, for an agent: a font, icon, emoji or sticker found by
// what it is, answered with the exact value a deck writes for it.
//
// Capabilities can list the bundled fonts and the authored stickers, but not
// the Google allowlist, 1,512 icons or ~3.9k emoji — so an agent guessed ids,
// and a guessed `icons/sparkles` that is really `icons/sparkle` draws nothing.
// Matching is the pickers' own (substring over name and keywords, or a font's
// family, scripts and the languages they cover); results are ranked so the
// closest name comes first, which a picker leaves to the eye.
import { FONTS, fontIdFor } from "./fonts.js";
import { LOCALES } from "./locales.js";
import { EMOJI_PACK, ICONS_PACK, emojiChar, stickerKeyFromId } from "./stickers.js";

export const SEARCH_KINDS = ["fonts", "icons", "emoji", "stickers"];

// Hyphen, underscore, slash and space are one separator; the emoji variation
// selector is dropped so a glyph matches with or without it.
const norm = (s) => s.replace(/\uFE0F/g, "").toLowerCase().replace(/[\s\-_/]+/g, " ").trim();
const compact = (s) => s.replace(/ /g, "");

// "stickers/emoji/1f3c5.svg" is also asked for as "emoji/1f3c5" or "1f3c5".
const idsOf = (key) => {
  const bare = key.replace(/\.svg$/, "");
  return [key, bare, bare.replace(/^stickers\//, ""), bare.split("/").pop()];
};

// Best first: 0 an exact name or id (glyph, sourceKey, slug, fontId); 1 a name that starts with the query; 2 a name
// that holds it (spaces ignored, so "thumbsup" finds "thumbs up"); 3 a keyword or
// slug that holds it; 4 every word of the query found somewhere in name or keywords.
// null for a miss.
function rank(item, needle) {
  const name = norm(item.name);
  if (name === needle || (item.ids ?? []).some((id) => norm(id) === needle)) return 0;
  if (name.startsWith(needle)) return 1;
  const flat = compact(needle);
  if (compact(name).includes(flat)) return 2;
  const rest = [...item.keywords, ...(item.slug ? [item.slug] : [])].map(norm);
  if (rest.some((k) => k.includes(needle) || compact(k).includes(flat))) return 3;
  const hay = [name, ...rest].join(" ");
  return needle.split(" ").every((w) => hay.includes(w)) ? 4 : null;
}

const languagesOf = (scripts) =>
  LOCALES.filter((l) => scripts.includes(l.script)).flatMap((l) => [l.label, l.native]);

/** `{ kind, total, results }`; each result carries the field a deck sets. */
export async function searchAssets(kind, query = "", { limit = 20, weight = null } = {}) {
  if (!SEARCH_KINDS.includes(kind)) throw new Error(`search what? (${SEARCH_KINDS.join(", ")})`);
  const needle = norm(query);
  let items;

  if (kind === "fonts") {
    const { catalogList } = await import("../server/fonts.js");
    const bundled = new Set(FONTS.map((f) => f.family));
    items = [
      ...FONTS.map((f) => ({ fontId: f.id, name: f.family, bundled: true, keywords: [], ids: [f.id] })),
      ...(await catalogList())
        .filter((c) => !bundled.has(c.family))
        .map((c) => ({
          fontId: fontIdFor(c.family),
          ids: [fontIdFor(c.family)],
          name: c.family,
          category: c.category,
          scripts: c.scripts ?? [],
          bundled: false,
          keywords: [c.category ?? "", ...(c.scripts ?? []), ...languagesOf(c.scripts ?? [])],
        })),
    ];
  } else if (kind === "stickers") {
    const { loadManifest } = await import("../server/stickers.js");
    const { packs, stickers } = await loadManifest();
    const authored = new Set(packs.filter((p) => !p.onDemand).map((p) => p.id));
    items = stickers
      .filter((s) => authored.has(s.pack))
      .map((s) => ({ sourceKey: stickerKeyFromId(s.id), name: s.name, pack: s.pack, aspect: s.aspect, keywords: s.tags ?? [], ids: idsOf(stickerKeyFromId(s.id)), slug: s.id.split("/").pop() }));
  } else {
    const { loadManifest, stickerCatalog } = await import("../server/stickers.js");
    const pack = kind === "icons" ? ICONS_PACK : EMOJI_PACK;
    const { items: entries, weights } = await stickerCatalog(pack);
    let suffix = "";
    if (kind === "icons") {
      const spec = (await loadManifest()).packs.find((p) => p.id === ICONS_PACK)?.weights;
      const w = weight ?? spec?.default ?? null;
      if (w && !weights.includes(w)) throw new Error(`unknown icon weight "${w}" (weights: ${weights.join(", ")})`);
      suffix = w && w !== spec?.bare ? `-${w}` : "";
    } else if (weight) {
      throw new Error("--weight is for icons");
    }
    items = entries.map((e) => {
      const sourceKey = stickerKeyFromId(`${pack}/${e.id}${suffix}`);
      const char = kind === "emoji" ? emojiChar(sourceKey) : null;
      return { sourceKey, name: e.name, ...(char && { char }), keywords: e.keywords, slug: e.id, ids: [...idsOf(sourceKey), ...idsOf(stickerKeyFromId(`${pack}/${e.id}`)), e.id, ...(char ? [char] : [])] };
    });
  }

  const matched = items
    .map((item) => ({ item, r: needle ? rank(item, needle) : 0 }))
    .filter((x) => x.r != null)
    .sort((a, b) => a.r - b.r);
  return {
    kind,
    total: matched.length,
    results: matched.slice(0, limit).map(({ item: { keywords: _k, ids: _i, slug: _s, ...rest } }) => rest),
  };
}
