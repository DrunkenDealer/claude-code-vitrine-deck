// Visual primitives shared by the Node render (src/template.js) and the web
// bundle (ScreenshotCard preview, Inspector). Like fonts.js, this stays free of
// node-only APIs so the browser can import it directly. Everything here compiles
// down to plain CSS strings, which both renderers drop straight into the same
// `background` / `transform` slots — that's what keeps preview and output in sync.

// ---- Backgrounds -----------------------------------------------------------
// A background is stored as a *spec*, never as compiled CSS. Two reasons: an
// editor can't reliably reopen `linear-gradient(180deg,#a 0%,#b 100%)` into the
// stops that made it, and keeping the compiler the only producer of background
// CSS means the sanitizer in css.js only ever sees its own output.
//
//   { type: "solid",  color }
//   { type: "linear", angle, stops: [[color, pct], ...] }
//   { type: "radial", x, y, r, stops: [[color, pct], ...] }
//   { type: "mesh",   base, blobs: [{ c, x, y, r }, ...] }   // soft radial blobs
//   { type: "image",  sourceKey, fit, scale, x, y, blur, dim }
//   { type: "raw",    css }                                   // a pre-layers deck

const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

// Every number is clamped here as well as in normalizeBackground: the render
// compiles a normalized spec, the canvas the stored one, and the two have to
// land on the same CSS.
const stopsCss = (stops, scale = 1) =>
  (stops ?? []).map(([c, p]) => `${c} ${Math.round(clampNum(p, 0, 100, 0) * scale * 100) / 100}%`).join(", ");

function linearCss({ angle = 180, stops = [] }) {
  return `linear-gradient(${clampNum(angle, 0, 360, 180)}deg, ${stopsCss(stops)})`;
}

// `r` is the spread, as a percentage of the circle's own size (farthest corner).
// A circle takes no percentage radius in CSS, so the spread scales the stops.
function radialCss({ x = 50, y = 50, r = 75, stops = [] }) {
  const spread = clampNum(r, 1, 200, 75) / 100;
  return `radial-gradient(circle at ${clampNum(x, -50, 150, 50)}% ${clampNum(y, -50, 150, 50)}%, ${stopsCss(stops, spread)})`;
}

function meshCss({ base = "#0f172a", blobs = [] }) {
  // Comma-stacked radial gradients (each fading to transparent) painted over the
  // base color. Order matters: earlier blobs sit on top.
  const layers = blobs.map(
    (b) => `radial-gradient(circle at ${clampNum(b.x, -50, 150, 50)}% ${clampNum(b.y, -50, 150, 50)}%, ${b.c} 0px, transparent ${clampNum(b.r, 1, 200, 50)}%)`,
  );
  return `${layers.join(", ")}, ${base}`;
}

// The dim wash sits above the photo, as its own gradient layer in the same
// shorthand — one declaration rather than an extra element to keep in sync.
// Black under the photo: a `contain` fit leaves bands the photo doesn't cover,
// and bare they export as alpha, which the App Store rejects.
function imageCss({ imageUrl, dim = 0 }) {
  if (!imageUrl) return "#000000";
  const d = clampNum(dim, 0, 1, 0);
  const wash = d > 0 ? `linear-gradient(rgba(0,0,0,${d}), rgba(0,0,0,${d})), ` : "";
  return `${wash}url(${imageUrl}) #000000`;
}

// The CSS `background` value for a spec. `imageUrl` is only consulted by the
// image type, and must already be a data: URL — see cssBackground in css.js.
export function compileBackground(spec, { imageUrl } = {}) {
  if (!spec) return null;
  if (typeof spec === "string") return spec; // a deck saved before specs
  switch (spec.type) {
    case "solid":
      return spec.color;
    case "linear":
      return linearCss(spec);
    case "radial":
      return radialCss(spec);
    case "mesh":
      return meshCss(spec);
    case "image":
      return imageCss({ ...spec, imageUrl });
    case "raw":
      return spec.css ?? null;
    default:
      return null;
  }
}

// Everything a background needs to paint, including the parts a single
// `background` declaration can't express. A photo background is blurred with a
// filter, and a filter fades a full-bleed element at its own edges — so it is
// scaled past the canvas to keep the blur off the border.
export function compileBackgroundStyle(spec, { imageUrl } = {}) {
  const background = compileBackground(spec, { imageUrl }) ?? "#000000";
  if (spec?.type !== "image") {
    return { background, size: "auto", position: "0 0", filter: "none", transform: "none" };
  }
  const blur = clampNum(spec.blur, 0, 100, 0);
  const scale = clampNum(spec.scale, 1, 4, 1);
  // Grow enough to hide the blur's own soft edge, plus whatever zoom was asked
  // for. 2.2 x the radius is past where the falloff is visible.
  const grow = 1 + (blur * 2.2) / 100;
  return {
    background,
    size: spec.fit === "contain" ? "contain" : "cover",
    position: `${clampNum(spec.x, 0, 100, 50)}% ${clampNum(spec.y, 0, 100, 50)}%`,
    filter: blur > 0 ? `blur(${blur}px)` : "none",
    transform: scale * grow > 1 ? `scale(${(scale * grow).toFixed(3)})` : "none",
  };
}

// ---- Panoramas -------------------------------------------------------------
// A panorama is one background running across neighbouring slides. Each slide
// still renders on its own; it paints the background `count` canvases wide and
// shows its own window of it — slide `index` from the left. The offset is a
// whole canvas width, so the last pixel column of one slide and the first of
// the next are neighbouring columns of the same picture and the seam lines up
// exactly.
//
// `span` is resolved per cell (see resolveSlide in deck.js), never stored: it
// comes from where the slide sits among its neighbours, not from the slide.
export const MAX_SPAN = 3;

// Arrives from an unvalidated render body, so both numbers are coerced here.
// Null is "not a panorama", including every shape that could only draw a
// broken one.
export function normalizeSpan(span) {
  const count = Math.trunc(Number(span?.count));
  const index = Math.trunc(Number(span?.index));
  if (!(count >= 2 && count <= MAX_SPAN) || !(index >= 0 && index < count)) return null;
  return { index, count };
}

/** Where the background element sits on a canvas `W` wide: `x` and `w` in px. */
export function backdropBox(span, W) {
  const s = normalizeSpan(span);
  return s ? { x: -s.index * W, w: s.count * W } : { x: 0, w: W };
}

// A spec off the wire -> a spec of the right shape. The render server takes this
// from an unvalidated body and it ends up in a stylesheet, so every number is
// coerced here and every colour is checked by css.js on the way out.
export function normalizeBackground(spec) {
  if (typeof spec === "string") return { type: "raw", css: spec };
  if (!spec || typeof spec !== "object") return null;
  const stops = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((s) => Array.isArray(s) && typeof s[0] === "string")
      .map(([c, p]) => [c, clampNum(p, 0, 100, 0)]);
  switch (spec.type) {
    case "solid":
      return { type: "solid", color: String(spec.color ?? "#000000") };
    case "linear":
      return { type: "linear", angle: clampNum(spec.angle, 0, 360, 180), stops: stops(spec.stops) };
    case "radial":
      return {
        type: "radial",
        x: clampNum(spec.x, -50, 150, 50),
        y: clampNum(spec.y, -50, 150, 50),
        r: clampNum(spec.r, 1, 200, 75),
        stops: stops(spec.stops),
      };
    case "mesh":
      return {
        type: "mesh",
        base: String(spec.base ?? "#0f172a"),
        blobs: (Array.isArray(spec.blobs) ? spec.blobs : []).map((b) => ({
          c: String(b?.c ?? "#ffffff"),
          x: clampNum(b?.x, -50, 150, 50),
          y: clampNum(b?.y, -50, 150, 50),
          r: clampNum(b?.r, 1, 200, 50),
        })),
      };
    case "image":
      return {
        type: "image",
        sourceKey: typeof spec.sourceKey === "string" ? spec.sourceKey : "",
        fit: spec.fit === "contain" ? "contain" : "cover",
        scale: clampNum(spec.scale, 1, 4, 1),
        x: clampNum(spec.x, 0, 100, 50),
        y: clampNum(spec.y, 0, 100, 50),
        blur: clampNum(spec.blur, 0, 100, 0),
        dim: clampNum(spec.dim, 0, 1, 0),
      };
    case "raw":
      return { type: "raw", css: String(spec.css ?? "") };
    default:
      return null;
  }
}

// Whether a stored spec is one compileBackground can paint without throwing.
// normalizeBackground repairs a spec for the render; this is for data that is
// kept as-is and compiled later, where a bad one would throw at paint time.
// Absent is fine: a slide without a background inherits one.
export function isBackgroundSpec(spec) {
  if (spec == null || typeof spec === "string") return true;
  if (typeof spec !== "object" || Array.isArray(spec)) return false;
  const str = (v) => v === undefined || typeof v === "string";
  const list = (v, ok) => v === undefined || (Array.isArray(v) && v.every(ok));
  switch (spec.type) {
    case "solid":
      return str(spec.color);
    case "linear":
    case "radial":
      return list(spec.stops, (s) => Array.isArray(s) && typeof s[0] === "string");
    case "mesh":
      return str(spec.base) && list(spec.blobs, (b) => b && typeof b === "object" && str(b.c));
    case "image":
      return str(spec.sourceKey);
    case "raw":
      return str(spec.css);
    default:
      return false;
  }
}

// The file a background paints from. A bundled photo in a panorama paints from
// its wide twin instead: the pack's own crop is a portrait 1500px wide, and
// stretched across three phones it upsamples 2.6x. The stored spec keeps the
// portrait key either way — the picker, the ink and a split panorama all mean
// that one — so the swap happens here, where a key becomes a file, and every
// host that turns one into bytes passes the cell's `span`.
export function backgroundImageKey(spec, span = null) {
  const key = spec?.type === "image" && spec.sourceKey ? spec.sourceKey : null;
  const id = normalizeSpan(span) ? backgroundImageId(spec) : null;
  return id ? `${BACKGROUND_IMAGE_ROOT}/wide/${id}.webp` : key;
}

// ---- The bundled photo pack ------------------------------------------------
// Photographs are not a sixth background type. They are an ordinary `image`
// spec whose sourceKey points into assets/backgrounds/ instead of the owner's
// uploads — the same trick a sticker plays on the image *layer* — so the crop,
// focus, blur, dim and zoom controls the editor already has work on a bundled
// photo exactly as they do on one you dragged in, and the CLI, the render and
// the export need no second path.
//
// The catalogue itself (labels, groups, inks, credits) lives in
// assets/backgrounds/index.json and is served to the client at boot, because it
// is data about files on disk rather than something to hard-code twice.
export const BACKGROUND_IMAGE_ROOT = "backgrounds";

// Every photo in the pack also ships a wide twin (see backgroundImageKey) at
// this shape, and at this size where the original allows it — three iPad-13"
// slides are 6192px across, so 4000 had them upsampling 1.55x. It is never
// enlarged: an original narrower than this ships its largest crop of this
// shape at its own size, so only the aspect is a promise.
export const WIDE_PHOTO = { width: 6000, height: 3900 };

/**
 * Where each slide of a `count`-slide panorama sees a cover-cropped photo, as
 * `[{ x0, x1 }]` fractions of the photo's width, left to right. What the pack's
 * grader measures a wide photo over, so the ink it picks is judged on the
 * pixels each slide's headline will actually sit on. Assumes the default
 * centred focus, like the portrait grade does.
 */
export function panoramaWindows(count, canvas, photo = WIDE_PHOTO) {
  const scale = Math.max((count * canvas.width) / photo.width, canvas.height / photo.height);
  const seen = (count * canvas.width) / (photo.width * scale);
  const left = (1 - seen) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x0: left + (i * seen) / count,
    x1: left + ((i + 1) * seen) / count,
  }));
}

export const isBackgroundImageKey = (sourceKey) =>
  typeof sourceKey === "string" && sourceKey.startsWith(`${BACKGROUND_IMAGE_ROOT}/`);

/** The spec a picked photo stores. `dim` starts at 0 — the pack is chosen so the
 *  ink reads without a wash, and a caller that wants one has the slider. */
export const backgroundImageSpec = (id) => ({
  type: "image",
  sourceKey: `${BACKGROUND_IMAGE_ROOT}/${id}.webp`,
  fit: "cover",
  scale: 1,
  x: 50,
  y: 50,
  blur: 0,
  dim: 0,
});

/** The id back out of a spec, or null — what the picker highlights with. */
export const backgroundImageId = (spec) => {
  const key = backgroundImageKey(spec);
  return key && isBackgroundImageKey(key) && key.endsWith(".webp")
    ? key.slice(BACKGROUND_IMAGE_ROOT.length + 1, -".webp".length)
    : null;
};

// The preset library. Every entry carries three things, and the last two are
// what make it a *design* rather than a colour: the group it browses under, and
// the ink that reads on it.
//
// **The ink is not decoration.** White at the deck's default subtitle opacity
// needs a genuinely dark backdrop to clear WCAG AA where the listing is actually
// met (a 55px subtitle arrives in a store search result at ~12.6px, which is
// ordinary text, not large — see contrast.js). That is why the saturated entries
// here are deep rather than bright: a mid-tone brand gradient with white on it
// is the mistake this library exists to stop someone making by accident.
// test/backgrounds.test.js holds every preset to that bar with its own ink, so a
// new one cannot be added without clearing it.
//
// Colours are Tailwind's open-source palette, which is where the shipped themes
// already drew from — keeping one vocabulary means a preset and a theme can be
// mixed without a clash.
//
// Shorthands, so the entries stay readable and a blob's numbers line up down the
// column. Local to this block; the stored spec is the same plain object it
// always was.
const mesh = (base, ...blobs) => ({ type: "mesh", base, blobs });
const blob = (c, x, y, r) => ({ c, x, y, r });
const lin = (angle, from, to) => ({ type: "linear", angle, stops: [[from, 0], [to, 100]] });
const solid = (color) => ({ type: "solid", color });

// A bloom: one hue at two lightnesses, lit from behind where the device sits.
// The library had no `radial` entry at all, which meant the one ground shape
// that lights the product was the one shape nobody could pick.
//
// Three numbers are fixed rather than per-entry, and each is load-bearing:
//
//   * `y: 44` puts the light behind the device's optical centre, not the
//     canvas's. A bloom centred at 50 lights the bottom bezel.
//   * the bright stop is **held to 18% before it starts falling off**, and the
//     dark has arrived by 72%. Two bare stops make a bloom that reads as a
//     vignette rather than a light: a `circle` gradient is sized to the farthest
//     corner, which on a 1320x2868 canvas is ~1730px, so a single ramp from the
//     centre point spends the whole canvas getting dark and the bright colour
//     exists only at one pixel. Holding it gives the light a disc to be.
//   * the stops are **one hue's 800 and 950**, and that pairing is the promise:
//     at 800 the centre is dark enough that white clears AA for text laid
//     directly across it, so a bloom carries any layout preset rather than only
//     the top-caption ones. At 700 the centre only clears the caption band, and
//     a `lower-banner` over it would be the picker handing out an unreadable
//     slide — the exact failure BACKGROUND_PRESETS exists to prevent.
const rad = (from, to) => ({
  type: "radial",
  x: 50,
  y: 44,
  r: 100,
  stops: [[from, 0], [from, 18], [to, 72]],
});

const WHITE = "#ffffff";

// Browsing order. Dark leads because it is what a store listing wants most
// often and the one group where no ink decision can go wrong.
//
// Four of the six bands are **tonal** — they answer "how dark is this", which is
// the question that picks the text colour. `graphic` and `swatch` are **subject**
// bands instead: things you go looking for by name rather than by luminance.
// They sit in opposite mediums, and that is the point — `graphic` is
// colour-blocked print, which only a photograph has; `swatch` is one flat
// colour, which only a spec has, and a photograph of a colour card is neither.
// A band with nothing in the medium on screen is skipped rather than rendered
// empty, so the Colour tab shows five and the Photo tab five.
// `tonal` is not decoration either: a tonal band answers "how dark is this",
// so the colour presets have to cover all four or the picker cannot change the
// deck's mind about being dark. A subject band carries no such duty, which is
// what test/backgrounds.test.js checks each of them against.
export const BACKGROUND_GROUPS = [
  { id: "dark", label: "Dark", tonal: true },
  { id: "vivid", label: "Vivid", tonal: true },
  { id: "graphic", label: "Graphic", tonal: false },
  { id: "swatch", label: "Swatch", tonal: false },
  { id: "light", label: "Light", tonal: true },
  { id: "neutral", label: "Neutral", tonal: true },
];

export const BACKGROUND_PRESETS = [
  // ---- dark: deep, cinematic, white ink ------------------------------------
  { id: "aurora", label: "Aurora", group: "dark", ink: WHITE,
    spec: mesh("#0b1224",
      blob("#4338ca", 18, 16, 55), blob("#7e22ce", 82,  8, 50),
      blob("#ec4899", 70, 80, 55), blob("#22d3ee", 10, 88, 45)) },
  { id: "slate-glow", label: "Slate glow", group: "dark", ink: WHITE,
    spec: mesh("#0f172a", blob("#1e3a8a", 30, 10, 60), blob("#334155", 80, 80, 55)) },
  { id: "deep-space", label: "Deep space", group: "dark", ink: WHITE,
    spec: mesh("#030712", blob("#1e1b4b", 20, 18, 58), blob("#312e81", 84, 82, 52)) },
  { id: "obsidian", label: "Obsidian", group: "dark", ink: WHITE,
    spec: mesh("#08090d", blob("#1f2937", 22, 20, 55), blob("#27272a", 80, 78, 52)) },
  { id: "ocean-deep", label: "Ocean deep", group: "dark", ink: WHITE,
    spec: mesh("#082f49", blob("#0c4a6e", 22, 18, 55), blob("#164e63", 80, 78, 52)) },
  { id: "forest-night", label: "Forest night", group: "dark", ink: WHITE,
    spec: mesh("#022c22", blob("#064e3b", 20, 18, 56), blob("#065f46", 82, 80, 50)) },
  { id: "wine", label: "Wine", group: "dark", ink: WHITE,
    spec: mesh("#190a12", blob("#4c0519", 22, 16, 56), blob("#581c87", 80, 84, 52)) },
  // The warm pair sits low on purpose: an ember under the caption band is the
  // one place a dark background stops being dark.
  { id: "ember", label: "Ember", group: "dark", ink: WHITE,
    spec: mesh("#180a06", blob("#7c2d12", 24, 84, 50), blob("#991b1b", 80, 90, 46)) },
  { id: "midnight-cobalt", label: "Midnight → Cobalt", group: "dark", ink: WHITE,
    spec: lin(160, "#0f172a", "#1e40af") },
  { id: "noir-plum", label: "Noir plum", group: "dark", ink: WHITE, spec: lin(165, "#2e1065", "#020617") },
  { id: "teal-abyss", label: "Teal abyss", group: "dark", ink: WHITE, spec: lin(180, "#042f2e", "#0f172a") },

  // The blooms. Tonally dark, so they browse here — the *shape* is what makes
  // them worth having, and the Looks library is where that gets a name.
  { id: "emerald-bloom", label: "Emerald bloom", group: "dark", ink: WHITE, spec: rad("#065f46", "#022c22") },
  { id: "cyan-bloom", label: "Cyan bloom", group: "dark", ink: WHITE, spec: rad("#155e75", "#083344") },
  { id: "indigo-bloom", label: "Indigo bloom", group: "dark", ink: WHITE, spec: rad("#3730a3", "#1e1b4b") },
  { id: "violet-bloom", label: "Violet bloom", group: "dark", ink: WHITE, spec: rad("#5b21b6", "#2e1065") },
  { id: "fuchsia-bloom", label: "Fuchsia bloom", group: "dark", ink: WHITE, spec: rad("#86198f", "#4a044e") },
  { id: "rose-bloom", label: "Rose bloom", group: "dark", ink: WHITE, spec: rad("#9f1239", "#4c0519") },
  { id: "amber-bloom", label: "Amber bloom", group: "dark", ink: WHITE, spec: rad("#9a3412", "#431407") },

  // ---- vivid: saturated, still readable ------------------------------------
  { id: "sunset", label: "Sunset", group: "vivid", ink: WHITE,
    spec: mesh("#2a1240",
      blob("#f97316", 20, 82, 55), blob("#fb7185", 80, 72, 50), blob("#92400e", 50, 16, 44)) },
  { id: "mint", label: "Mint", group: "vivid", ink: WHITE,
    spec: mesh("#04201c",
      blob("#115e59", 22, 20, 55), blob("#155e75", 82, 30, 50), blob("#10b981", 55, 90, 50)) },
  { id: "electric", label: "Electric", group: "vivid", ink: WHITE, spec: lin(160, "#4338ca", "#7c3aed") },
  { id: "royal", label: "Royal", group: "vivid", ink: WHITE,
    spec: mesh("#1e1b4b", blob("#4338ca", 24, 20, 56), blob("#6d28d9", 78, 78, 52)) },
  { id: "violet-dusk", label: "Violet dusk", group: "vivid", ink: WHITE,
    spec: mesh("#2e1065", blob("#6d28d9", 20, 18, 55), blob("#9d174d", 80, 82, 52)) },
  { id: "indigo-pink", label: "Indigo → Pink", group: "vivid", ink: WHITE, spec: lin(180, "#4338ca", "#9d174d") },
  { id: "cobalt", label: "Cobalt", group: "vivid", ink: WHITE, spec: lin(180, "#1d4ed8", "#1e3a8a") },
  { id: "emerald-teal", label: "Emerald → Teal", group: "vivid", ink: WHITE, spec: lin(180, "#065f46", "#115e59") },
  { id: "pine", label: "Pine", group: "vivid", ink: WHITE, spec: lin(180, "#166534", "#14532d") },
  { id: "crimson", label: "Crimson", group: "vivid", ink: WHITE, spec: lin(170, "#991b1b", "#7f1d1d") },
  { id: "flame", label: "Flame", group: "vivid", ink: WHITE, spec: lin(175, "#9a3412", "#7c2d12") },
  // The one saturated entry that takes dark ink — an amber bright enough to be
  // worth having is far too bright to put white on.
  { id: "coral-amber", label: "Coral → Amber", group: "vivid", ink: "#431407",
    spec: lin(180, "#fb923c", "#fcd34d") },

  // ---- light: pale, dark ink -----------------------------------------------
  { id: "ivory", label: "Ivory", group: "light", ink: "#1f2937", spec: solid("#f5f5f4") },
  { id: "linen", label: "Linen", group: "light", ink: "#1c1917", spec: solid("#faf7f2") },
  { id: "mist", label: "Mist", group: "light", ink: "#0f172a", spec: lin(180, "#f8fafc", "#e2e8f0") },
  { id: "bloom", label: "Bloom", group: "light", ink: "#3b0764",
    spec: mesh("#fdf2f8",
      blob("#f9a8d4", 18, 22, 55), blob("#c4b5fd", 84, 18, 52), blob("#a5f3fc", 60, 88, 50)) },
  { id: "peach", label: "Peach", group: "light", ink: "#431407",
    spec: mesh("#fff7ed",
      blob("#fdba74", 20, 25, 55), blob("#fca5a5", 82, 70, 52), blob("#fcd34d", 60, 12, 45)) },
  { id: "sky-wash", label: "Sky wash", group: "light", ink: "#082f49",
    spec: mesh("#f0f9ff", blob("#bae6fd", 20, 22, 55), blob("#ddd6fe", 82, 74, 52)) },
  { id: "sage", label: "Sage", group: "light", ink: "#052e16",
    spec: mesh("#f0fdf4", blob("#bbf7d0", 22, 20, 55), blob("#a7f3d0", 80, 78, 52)) },
  { id: "lavender-haze", label: "Lavender haze", group: "light", ink: "#3b0764",
    spec: mesh("#faf5ff", blob("#e9d5ff", 20, 20, 56), blob("#c7d2fe", 82, 78, 52)) },
  { id: "blush", label: "Blush", group: "light", ink: "#881337", spec: lin(180, "#fff1f2", "#ffe4e6") },
  { id: "sand", label: "Sand", group: "light", ink: "#451a03", spec: lin(170, "#fefce8", "#fde68a") },

  // ---- swatch: one flat colour, nothing else -------------------------------
  // The chip band. No gradient, no blobs, no photograph — a single field of
  // colour, which is what a headline sits on most cleanly and what a brand with
  // one colour actually wants. Deep enough for white, or pale enough for ink;
  // the mid-tones a flat colour is most tempting at are exactly the ones no ink
  // survives, so there are none here.
  //
  // Pale entries take a dark of their own hue family rather than a generic
  // near-black — #431407 on apricot reads as the same design decision, #0f172a
  // reads as a default nobody chose.
  { id: "ink-blue", label: "Ink blue", group: "swatch", ink: WHITE, spec: solid("#1e3a8a") },
  { id: "indigo", label: "Indigo", group: "swatch", ink: WHITE, spec: solid("#312e81") },
  { id: "violet", label: "Violet", group: "swatch", ink: WHITE, spec: solid("#4c1d95") },
  { id: "plum", label: "Plum", group: "swatch", ink: WHITE, spec: solid("#581c87") },
  { id: "fuchsia", label: "Fuchsia", group: "swatch", ink: WHITE, spec: solid("#9d174d") },
  { id: "oxblood", label: "Oxblood", group: "swatch", ink: WHITE, spec: solid("#7f1d1d") },
  { id: "terracotta", label: "Terracotta", group: "swatch", ink: WHITE, spec: solid("#9a3412") },
  { id: "ochre", label: "Ochre", group: "swatch", ink: WHITE, spec: solid("#854d0e") },
  { id: "moss", label: "Moss", group: "swatch", ink: WHITE, spec: solid("#166534") },
  { id: "teal", label: "Teal", group: "swatch", ink: WHITE, spec: solid("#115e59") },
  { id: "rosewater", label: "Rosewater", group: "swatch", ink: "#4c0519", spec: solid("#fecdd3") },
  { id: "bubblegum", label: "Bubblegum", group: "swatch", ink: "#4c0519", spec: solid("#fbcfe8") },
  { id: "apricot", label: "Apricot", group: "swatch", ink: "#431407", spec: solid("#fed7aa") },
  { id: "honey", label: "Honey", group: "swatch", ink: "#431407", spec: solid("#fde68a") },
  { id: "butter", label: "Butter", group: "swatch", ink: "#422006", spec: solid("#fef08a") },
  { id: "celery", label: "Celery", group: "swatch", ink: "#052e16", spec: solid("#d9f99d") },
  { id: "spearmint", label: "Spearmint", group: "swatch", ink: "#052e16", spec: solid("#a7f3d0") },
  { id: "powder", label: "Powder", group: "swatch", ink: "#082f49", spec: solid("#bae6fd") },
  { id: "wisteria", label: "Wisteria", group: "swatch", ink: "#3b0764", spec: solid("#ddd6fe") },
  { id: "orchid", label: "Orchid", group: "swatch", ink: "#3b0764", spec: solid("#f5d0fe") },

  // ---- neutral: no hue to clash with the app's own -------------------------
  { id: "slate", label: "Slate", group: "neutral", ink: WHITE, spec: solid("#1f2937") },
  { id: "graphite", label: "Graphite", group: "neutral", ink: WHITE, spec: solid("#27272a") },
  { id: "warm-grey", label: "Warm grey", group: "neutral", ink: WHITE, spec: solid("#44403c") },
  { id: "steel", label: "Steel", group: "neutral", ink: WHITE, spec: lin(180, "#475569", "#1e293b") },
  { id: "stone", label: "Stone", group: "neutral", ink: "#1c1917", spec: solid("#d6d3d1") },
  // The hueless bloom — depth without a colour to argue with the app's own.
  //
  // Slate 600 -> 800 rather than a zinc 800 -> 950, which is what this was
  // first: that version bottomed out at a relative luminance of 0.003, near
  // enough to black that the slide dissolved into the App Store's own dark
  // chrome and lost its edges. This one bottoms out at 0.022 and still clears
  // AA for white by a factor of two. See the store-chrome bound in
  // test/looks.test.js.
  { id: "slate-bloom", label: "Slate bloom", group: "neutral", ink: WHITE, spec: rad("#475569", "#1e293b") },
];

// Shape the web UI consumes. `spec` is what gets stored on a slide; `value` is
// the compiled CSS, for painting the swatch itself; `ink` is the text colour the
// picker offers when the current one would not read on it.
export function backgroundOptions() {
  return BACKGROUND_PRESETS.map((p) => ({
    id: p.id,
    label: p.label,
    group: p.group,
    ink: p.ink,
    spec: p.spec,
    value: compileBackground(p.spec),
  }));
}

// ---- Device transforms -----------------------------------------------------
// The device mockup's 3D angle, and the same knob for the headline/subtitle
// blocks. Stored per project/slide/device as a rotation object
// ({ x, y, z, depth }); decks and themes written before the sliders existed hold
// a preset id instead, so every entry point runs through normalizeRotation and
// there is exactly one place that compiles CSS.
//
// The transform goes on an OUTER wrapper; the drop-shadow stays on an INNER
// element so Chromium composites the shadow from the already-transformed plane
// (otherwise it detaches and renders flat). Both template.js and
// ScreenshotCard.js rely on this split.

export const DEFAULT_DEVICE_TRANSFORM = "flat";
export const DEFAULT_ROTATION = { x: 0, y: 0, z: 0, depth: 2200 };

// Chips that seed the sliders, and the lookup table legacy preset ids resolve
// through. The old "bleed right" is deliberately absent: it was a translate
// riding in an angle enum, and layout.deviceXRatio already moves the device, so
// a deck still naming it resolves to flat rather than keeping a 22% shift no
// slider can show or clear.
export const ROTATION_PRESETS = [
  { id: "flat", label: "Flat", rotation: { x: 0, y: 0, z: 0, depth: 2200 } },
  { id: "tilt-left", label: "Tilt left", rotation: { x: 3, y: -9, z: 0, depth: 2200 } },
  { id: "tilt-right", label: "Tilt right", rotation: { x: 3, y: 9, z: 0, depth: 2200 } },
  { id: "perspective", label: "Perspective", rotation: { x: 7, y: 0, z: 0, depth: 2000 } },
];

// x and y are bounded because they lean the plane toward the camera and the
// frames are flat art (frames.js draws a zero-depth rect, so past ~30deg the
// device reads as a paper cutout).
//
// z is not one of those. A roll stays in the plane of the canvas — nothing is
// foreshortened, no frame is asked to have a thickness it doesn't have — so the
// only thing bounding it did was stop a rotate gesture halfway round. A full
// turn either way, which is what a handle you can drag means.
export const ROTATION_LIMITS = {
  x: { min: -30, max: 30, step: 1, unit: "°" },
  y: { min: -30, max: 30, step: 1, unit: "°" },
  z: { min: -180, max: 180, step: 1, unit: "°" },
  depth: { min: 800, max: 5000, step: 100, unit: "px" },
};

const AXES = ["x", "y", "z", "depth"];

// A preset id -> its rotation. An array find rather than an object lookup so an
// id like "constructor" or "__proto__" can't reach Object.prototype and return a
// truthy non-preset.
const presetRotation = (id) => ROTATION_PRESETS.find((p) => p.id === id)?.rotation;

// Any stored value -> a full rotation object of finite, clamped numbers, so the
// sliders always have numbers to show even when the deck still holds a legacy
// preset id. The coercion is load-bearing, not tidiness: /api/render takes
// deviceTransform straight off an unvalidated request body and the result is
// interpolated into the render page's <style>, so a component that stayed a
// string would be a CSS injection.
function clampAxis(v, axis) {
  const { min, max } = ROTATION_LIMITS[axis];
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_ROTATION[axis];
}

export function normalizeRotation(value) {
  const rot =
    value && typeof value === "object"
      ? value
      : presetRotation(value) ?? DEFAULT_ROTATION;
  return {
    x: clampAxis(rot.x, "x"),
    y: clampAxis(rot.y, "y"),
    z: clampAxis(rot.z, "z"),
    depth: clampAxis(rot.depth, "depth"),
  };
}

// perspective() leftmost so it projects the already-rotated plane, and as a
// function rather than the parent property so the vanishing point sits at the
// device's own centre. All-zero stays `none`, keeping the flat render out of a
// 3D context entirely.
//
// Legacy ids compile through normalizeRotation like everything else rather than
// keeping their own hand-written CSS: rotations don't commute, so a preset that
// wrote rotateY before rotateX (or pivoted about `center top`) rendered
// differently from the slider values the chips claim are the same thing —
// nudging one axis then silently moved the others.
export function rotationCss(value) {
  const { perspective, transform } = rotationParts(value);
  return {
    transform: perspective === "none" ? "none" : `perspective(${perspective}) ${transform}`,
    origin: "center center",
  };
}

// The same projection split across two boxes: `perspective` for a wrapper exactly
// the layer's size, whose default perspective-origin is the centre the function
// form projects from, and the turn alone for the layer inside it. The picture is
// identical. The cost isn't: Chromium re-rasterizes a composited layer on every
// frame it moves while perspective() sits in its own transform, and the editor's
// device is the biggest thing on the canvas — dragged, it repainted from scratch
// each frame and blinked. Moved inside a wrapper, its tiles are reused.
export function rotationParts(value) {
  const { x, y, z, depth } = normalizeRotation(value);
  if (!x && !y && !z) return { perspective: "none", transform: "none" };
  return { perspective: `${depth}px`, transform: `rotateX(${x}deg) rotateY(${y}deg) rotateZ(${z}deg)` };
}

export function detectRotationPreset(value) {
  const r = normalizeRotation(value);
  return ROTATION_PRESETS.find((p) => AXES.every((k) => p.rotation[k] === r[k]))?.id ?? null;
}
