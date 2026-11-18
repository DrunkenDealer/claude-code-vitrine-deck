// Curated set, self-hosted from assets/fonts/. Imported by both the Node render
// and the web bundle, so it has to stay free of node-only APIs.

// Bundled families: shipped in the image, always available, never fetched.
export const FONTS = [
  { id: "inter",         label: "Inter",             family: "Inter",             slug: "Inter",            dir: "Inter",            weights: [400, 600, 700, 800] },
  { id: "manrope",       label: "Manrope",           family: "Manrope",           slug: "Manrope",          dir: "Manrope",          weights: [400, 700, 800] },
  { id: "sora",          label: "Sora",              family: "Sora",              slug: "Sora",             dir: "Sora",             weights: [400, 600, 800] },
  { id: "space-grotesk", label: "Space Grotesk",     family: "Space Grotesk",     slug: "SpaceGrotesk",     dir: "SpaceGrotesk",     weights: [400, 700] },
  { id: "jakarta",       label: "Plus Jakarta Sans", family: "Plus Jakarta Sans", slug: "PlusJakartaSans",  dir: "PlusJakartaSans",  weights: [400, 700, 800] },
  { id: "dm-sans",       label: "DM Sans",           family: "DM Sans",           slug: "DMSans",           dir: "DMSans",           weights: [400, 700] },
  { id: "outfit",        label: "Outfit",            family: "Outfit",            slug: "Outfit",           dir: "Outfit",           weights: [400, 700, 800] },
  { id: "fraunces",      label: "Fraunces (serif)",  family: "Fraunces",          slug: "Fraunces",         dir: "Fraunces",         weights: [400, 700] },
];

// Families fetched from Google Fonts and cached to assets/fonts/cache. Held in a
// registry rather than a constant because the set grows at runtime — the server
// registers whatever is already on disk at boot, and both sides register a family
// the moment it is cached. Rendering still reads local woff2 either way, so a
// picked family costs one download, ever, and never a fetch at render time.
const DYNAMIC = new Map();

export const fontIdFor = (family) => `gf:${family}`;

export function registerFont({ family, weights, label, variable = false, slices = null }) {
  const slug = family.replace(/[^A-Za-z0-9]/g, "");
  const sorted = [...weights].sort((a, b) => a - b);
  const font = {
    id: fontIdFor(family),
    label: label ?? family,
    family,
    slug,
    dir: `cache/${slug}`,
    weights: sorted,
    // Google serves one variable file for every weight of a variable family.
    // Declaring it once with a weight *range* is what lets the browser reach the
    // heavy end; six @font-face rules pointing at the same file each resolve to
    // the default instance instead, which reads as "the font didn't load".
    variable,
    range: variable ? `${sorted[0]} ${sorted[sorted.length - 1]}` : null,
    // A family drawing a non-Latin script (CJK, Cyrillic, Greek) is cached the
    // way Google slices it: one file per unicode-range, in this order. Null for
    // a Latin-only family.
    slices: Array.isArray(slices) && slices.length ? slices : null,
    google: true,
  };
  DYNAMIC.set(font.id, font);
  return font;
}

export const dynamicFonts = () => [...DYNAMIC.values()];
export const allFonts = () => [...FONTS, ...DYNAMIC.values()];

export const DEFAULT_FONT_ID = "inter";
export const DEFAULT_HEADLINE_WEIGHT = 800;
export const DEFAULT_SUBTITLE_WEIGHT = 400;

export const FALLBACK_STACK =
  `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

const BY_ID = new Map(FONTS.map((f) => [f.id, f]));

export function getFont(id) {
  return BY_ID.get(id) ?? DYNAMIC.get(id) ?? BY_ID.get(DEFAULT_FONT_ID);
}

// True when the id names a family that isn't loaded here yet — the caller should
// ask the server to cache it before rendering, or the slide falls back to Inter.
export const isKnownFont = (id) => BY_ID.has(id) || DYNAMIC.has(id);

export function fontFamilyStack(id) {
  const f = getFont(id);
  return `"${f.family}", ${FALLBACK_STACK}`;
}

// Snap a requested weight to the nearest available weight for the family.
export function nearestWeight(id, weight) {
  const f = getFont(id);
  let best = f.weights[0];
  let bestD = Math.abs(best - weight);
  for (const w of f.weights) {
    const d = Math.abs(w - weight);
    if (d < bestD) { best = w; bestD = d; }
  }
  return best;
}

// Repo-relative path of the woff2 file ("Inter/Inter-700.woff2", or
// "cache/Lora/Lora-700.woff2" for a fetched family). Server resolves against
// ROOT/assets/fonts, browser against /fonts. A slice of a sliced family carries
// its index: "cache/NotoSansSC/NotoSansSC-var.12.woff2".
function fontFile(id, weight, slice = null) {
  const f = getFont(id);
  const base = f.variable ? `${f.slug}-var` : `${f.slug}-${nearestWeight(id, weight)}`;
  return `${f.dir}/${base}${slice == null ? "" : `.${slice}`}.woff2`;
}

// A slice's range reaches CSS from the client's copy of the registry, so it is
// held to the descriptor's own grammar before it lands in a stylesheet.
export const UNICODE_RANGE = /^U\+[0-9a-f?]+(?:-[0-9a-f]+)?(?:,\s*U\+[0-9a-f?]+(?:-[0-9a-f]+)?)*$/i;

// "U+4e00-4e3f, U+ff01" as [[lo, hi], …], parsed once per range string.
const SPANS = new Map();
function spansOf(range) {
  let spans = SPANS.get(range);
  if (!spans) {
    spans = range.split(",").flatMap((part) => {
      const m = part.trim().match(/^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i);
      return m ? [[parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)]] : [];
    });
    SPANS.set(range, spans);
  }
  return spans;
}

const draws = (range, codePoints) =>
  codePoints.some((c) => spansOf(range).some(([lo, hi]) => c >= lo && c <= hi));

// Distinct font files this slide needs, deduped. A variable family collapses to
// one entry whatever weights are asked for: one file, one @font-face, declared
// across the whole range.
//
// A sliced family answers an entry per slice, each with its `unicodeRange`.
// Given `text`, only the slices drawing some character of it come back: both
// renderers inline every file they are handed, and a whole CJK family is
// megabytes where a headline needs a few dozen kilobytes of it.
export function fontFilesFor(id, weights, text = null) {
  const f = getFont(id);
  const codePoints = text == null ? null : [...new Set(Array.from(text, (ch) => ch.codePointAt(0)))];
  const seen = new Map();
  for (const w of weights) {
    const snapped = nearestWeight(id, w);
    const key = f.variable ? id : `${id}-${snapped}`;
    if (seen.has(key)) continue;
    const entry = {
      family: f.family,
      // `range` is what goes in the @font-face descriptor; `weight` still names
      // the snapped value so a caller can tell what it asked for.
      weight: snapped,
      range: f.range ?? null,
    };
    seen.set(
      key,
      f.slices
        ? f.slices.flatMap((unicodeRange, i) =>
            codePoints && !draws(unicodeRange, codePoints) ? [] : [{ ...entry, unicodeRange, file: fontFile(id, w, i) }],
          )
        : [{ ...entry, file: fontFile(id, w) }],
    );
  }
  return [...seen.values()].flat();
}
