// Every value that reaches a `<style>` block goes through here.
//
// The render page is built by interpolating values into CSS and handed to
// `page.setContent`, and `/api/render` takes those values straight off an
// unvalidated request body. A value carrying `}</style><script>` would break out
// of the stylesheet and run script in a Chromium launched with `--no-sandbox`.
// visual.js already coerces `deviceTransform` for exactly this reason; the layer
// model multiplies the number of CSS-bound values, so the coercion lives in one
// place from here on.
//
// Node-API-free like geometry.js/visual.js/fonts.js — both hosts import it.

// Anything that could end a declaration, a rule, or the stylesheet itself, plus
// the comment delimiters that could hide one of those from a naive check.
const UNSAFE = /[;{}<>\\]|\/\*|\*\/|@import|expression\s*\(|javascript:/i;

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(?:rgb|rgba|hsl|hsla)\(\s*[-0-9.,%\s/degrata]+\)$/i;

export function cssNumber(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// A number plus a unit we choose — the unit never comes from the caller's data,
// so there is nothing to escape.
export function cssLength(value, unit, opts) {
  return `${cssNumber(value, opts)}${unit}`;
}

export function cssEnum(value, allowed, fallback = allowed[0]) {
  return allowed.includes(value) ? value : fallback;
}

// Hex, or one of the four functional notations with nothing but numbers,
// separators and units inside. Named colors are deliberately out: the set is
// large, the gain is nil (every picker emits hex), and allowing bare words means
// allowing a word we didn't think about.
export function cssColor(value, fallback = "#000000") {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (HEX.test(v)) return v;
  if (FUNC_COLOR.test(v) && !UNSAFE.test(v)) return v;
  return fallback;
}

// `url()` is allowed only for an inlined image that is well formed: a known image
// type, optional `;base64`, and a body of the base64 / %-escape charset. Both
// renderers resolve every asset to such a data URL before it reaches the
// template (readFileSync on the server, readAsDataURL in the browser), so
// anything else is a mistake or an attempt to fetch a remote resource. The body
// charset is the point: an earlier `[^)'"]*` let `}`, `<`, `;` through, and
// `url(data:image/png;}</style><script>…)` ended the stylesheet and ran script in
// the render Chromium (N516).
const INLINE_IMAGE_URL =
  /url\(\s*(['"]?)data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml)(?:;base64)?,[A-Za-z0-9+/=%]*\1\s*\)/gi;

// The only CSS functions a background may call: what compileBackground emits
// (linear/radial gradients over colours) plus the data: url() above. Everything
// that can make the render browser fetch something does it through a function —
// image-set(), -webkit-image-set(), cross-fade(), image(), src(), element() —
// so a background naming any other function is refused. `url(` alone was not
// enough: `image-set("http://192.168.1.1/x.png" 1x)` is a request with no url().
const BACKGROUND_FUNCTIONS = new Set([
  "linear-gradient",
  "radial-gradient",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
]);

function callsOnlyBackgroundFunctions(value) {
  for (const [, name] of value.matchAll(/([a-z][\w-]*)\s*\(/gi)) {
    if (!BACKGROUND_FUNCTIONS.has(name.toLowerCase())) return false;
  }
  return true;
}

// Backgrounds are the widest surface: a full CSS `background` shorthand, often a
// comma-stacked list of gradients. Rather than parse it, require that it came out
// of compileBackground — which only ever emits colors, gradients, and (from the
// image spec) a data: url — and reject anything carrying a character that could
// leave the declaration.
export function cssBackground(value, fallback = "#000000") {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (!v) return fallback;
  // A data: URL legitimately contains `;` and `/` — `data:image/png;base64,…` —
  // so each well-formed one is blanked out before the rest of the declaration is
  // checked. Without this the guard silently swallows every photo background and
  // the slide renders on the fallback colour. Any `url(` left over is not
  // well formed, and `url` is not an allowed function below.
  const bare = v.replace(INLINE_IMAGE_URL, "IMG");
  if (UNSAFE.test(bare) || !callsOnlyBackgroundFunctions(bare)) return fallback;
  return v;
}

// The generic guard, for a value we build ourselves but still interpolate: a
// transform, a background-position. Nothing here comes from the user directly,
// which is exactly why it is worth checking — the next caller might.
export function cssSafe(value, fallback = "") {
  if (typeof value !== "string" || UNSAFE.test(value)) return fallback;
  return value;
}

// A font-family stack. Ours are built by fonts.js from a validated id, but the
// stack still lands in CSS, so it gets the same treatment as everything else.
export function cssFontStack(value, fallback = "sans-serif") {
  if (typeof value !== "string" || UNSAFE.test(value)) return fallback;
  return value;
}

// A `transform` value. rotationCss already clamps its numbers; this guards the
// string it produces the same way as everything else, so a future caller passing
// a raw transform can't slip through.
export const cssTransform = (value, fallback = "none") => cssSafe(value, fallback);
