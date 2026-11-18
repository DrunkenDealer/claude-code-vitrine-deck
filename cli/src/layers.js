// The slide model. A slide owns one ordered list of layers, back to front, and
// the renderer maps over it — so a new kind of element is data, not a new code
// path through geometry, the template, the preview and the hash.
//
// Two identifiers, doing different jobs:
//   `id`   unique and stable within a slide; keys the per-device override map.
//   `role` semantic — "headline" | "subtitle" | "device" | null. Presets, themes,
//          scene adoption and the project defaults all target roles, which is why
//          a layer can be reordered or restyled without those losing track of it.
//
// A slide holds at most one layer per role. The device role is required; the two
// text roles are optional, which is what makes a headline-only slide expressible.
// Layers with `role: null` are the user's own — presets never move them and
// themes never restyle them, so a logo stays where it was put.
//
// Node-API-free like geometry.js/visual.js/fonts.js: both hosts import it.
import {
  DEFAULT_FONT_ID,
  DEFAULT_HEADLINE_WEIGHT,
  DEFAULT_SUBTITLE_WEIGHT,
  fontFilesFor,
} from "./fonts.js";
import { DEFAULT_FRAME_TINT } from "./frames.js";
import { normalizeTint } from "./stickers.js";
import {
  DEFAULT_DEVICE_HEIGHT_RATIO,
  DEFAULT_DEVICE_SHADOW,
  DEFAULT_TEXT_WRATIO,
} from "./geometry.js";
import { DEFAULT_ROTATION, normalizeRotation } from "./visual.js";
import { cssColor } from "./css.js";

export const LAYER_TYPES = ["device", "text", "image", "lens"];
// `icon` and `art` are a feature graphic's brand mark and key art: image layers a
// banner preset places, as it places the caption.
export const IMAGE_ROLES = ["icon", "art"];
export const LAYER_ROLES = ["device", "headline", "subtitle", ...IMAGE_ROLES];
export const TEXT_ROLES = ["headline", "subtitle"];
export const TEXT_ALIGNS = ["left", "center", "right"];
// No "capitalize": CSS capitalizes every word, articles included, which is the
// wrong answer for a headline and there is no way to spell the right one in CSS.
export const TEXT_CASES = ["none", "upper", "lower"];
export const IMAGE_FITS = ["contain", "cover"];

// Reserved ids, so a deck migrated from the three-slot model keeps ids that its
// old per-device override maps can be folded onto.
export const DEVICE_LAYER_ID = "device";
export const HEADLINE_LAYER_ID = "headline";
export const SUBTITLE_LAYER_ID = "subtitle";

// Per-role starting values. The text ones reproduce what slideHtml.js carried as
// literals before typography was configurable, which is what lets a migrated deck
// render byte-identically.
const TEXT_ROLE_DEFAULTS = {
  headline: {
    yRatio: 0.04,
    weight: DEFAULT_HEADLINE_WEIGHT,
    lineHeight: 1.1,
    letterSpacing: -0.02,
    opacity: 1,
  },
  subtitle: {
    yRatio: 0.11,
    weight: DEFAULT_SUBTITLE_WEIGHT,
    lineHeight: 1.3,
    letterSpacing: 0,
    opacity: 0.78,
  },
  // A text layer the user added: subtitle metrics, but at full opacity and half
  // the width, because it is a deliberate element rather than a caption.
  caption: {
    yRatio: 0.5,
    weight: DEFAULT_SUBTITLE_WEIGHT,
    lineHeight: 1.3,
    letterSpacing: 0,
    opacity: 1,
  },
};

export const textRoleDefaults = (role) =>
  TEXT_ROLE_DEFAULTS[role] ?? TEXT_ROLE_DEFAULTS.caption;

// How long a caption may get in the editor, and what the model may write. Nothing
// stopped a pasted megabyte: every keystroke re-measures it on every card, the deck
// then overflows the 1 MB save limit, and translation can only refuse it. Roughly
// three times what a store caption needs (German included), so only a mistake hits
// them. A cap on input, never applied to a stored value: normalizeLayer leaves a
// longer caption alone, because cutting one on load would rewrite someone's deck.
export const HEADLINE_MAX = 120;
export const SUBTITLE_MAX = 200;
export const TEXT_MAX = 400;

export const textMax = (role) =>
  role === "headline" ? HEADLINE_MAX : role === "subtitle" ? SUBTITLE_MAX : TEXT_MAX;

// The part of `text` that fits in `room`, never ending on half a surrogate pair.
export const clipToRoom = (text, room) =>
  text.length <= room ? text : text.slice(0, Math.max(0, room)).replace(/[\ud800-\udbff]$/, "");

// A line break typed at the end of a caption is dropped when the text is read
// back, so it must leave room for the character that follows it — otherwise that
// character is refused and the break did nothing but eat the last slot.
export const canBreakLine = (room) => room >= 2;

// Text is sized off the device's own scale, not the layer's, so one slide reads
// the same on a phone and a TV. `sizeMul` is the layer's multiplier on top.
export function baseFontSize(role, device) {
  return role === "headline" ? device.headlineFontSize : device.subtitleFontSize;
}

// The px the renderer actually emits. One function so the export, the live
// preview and the inspector's readout are the same number rather than three
// roundings of it — the preview used to skip the rounding and drift off the
// export at any fractional sizeMul, which a corner-drag produces constantly.
export const fontSizePx = (role, sizeMul, device) =>
  Math.round(baseFontSize(role, device) * sizeMul);

// The inverse, for a control that speaks px: what multiplier lands on that size.
export const sizeMulForPx = (px, role, device) => px / baseFontSize(role, device);

let seq = 0;
export const newLayerId = () => `l-${++seq}`;

// Bump the counter past ids already in a deck so newLayerId can't collide with a
// rehydrated layer.
export function seedLayerIds(ids) {
  for (const id of ids) {
    const n = Number(String(id).split("-").pop());
    if (Number.isFinite(n) && n > seq) seq = n;
  }
}

export function makeTextLayer({ id, role = null, text = "", ...rest } = {}) {
  const d = textRoleDefaults(role);
  return {
    id: id ?? newLayerId(),
    role,
    type: "text",
    xRatio: 0,
    yRatio: d.yRatio,
    wRatio: role ? DEFAULT_TEXT_WRATIO : 0.5,
    rotation: { ...DEFAULT_ROTATION },
    opacity: d.opacity,
    text,
    fontId: DEFAULT_FONT_ID,
    weight: d.weight,
    sizeMul: 1,
    align: "center",
    color: "#ffffff",
    lineHeight: d.lineHeight,
    letterSpacing: d.letterSpacing,
    textCase: "none",
    balance: false,
    shadow: null,
    highlight: null,
    accent: null,
    // Only a subtitle ever sets this, and only a preset or a look sets it for
    // them — see src/captionFlow.js. Null means "my yRatio is mine".
    followGap: null,
    ...rest,
  };
}

export function makeImageLayer({ id, sourceKey, aspect = 1, ...rest } = {}) {
  return {
    id: id ?? newLayerId(),
    role: null,
    type: "image",
    xRatio: 0,
    yRatio: 0.5,
    wRatio: 0.25,
    // null means "as tall as the bitmap is" — the box then matches the image's
    // own proportions, which is why `fit` only starts to mean anything once a
    // height is set explicitly.
    hRatio: null,
    rotation: { ...DEFAULT_ROTATION },
    opacity: 1,
    sourceKey,
    aspect,
    fit: "contain",
    radius: 0,
    // Only a sticker has anything to tint: an uploaded bitmap has no slots, so
    // this stays null for one and is set per slot for the other.
    tint: null,
    ...rest,
  };
}

export function makeDeviceLayer({ id, ...rest } = {}) {
  return {
    id: id ?? DEVICE_LAYER_ID,
    role: "device",
    type: "device",
    xRatio: 0,
    yRatio: 0.24,
    hRatio: DEFAULT_DEVICE_HEIGHT_RATIO,
    rotation: { ...DEFAULT_ROTATION },
    opacity: 1,
    useFrame: true,
    frameTint: DEFAULT_FRAME_TINT,
    // Which preset's vertical stack owns this layer's y and height — see
    // src/layoutStack.js. Null means "these are mine", which is what a
    // hand-placed device, a landscape slide and every deck saved before the
    // field existed all carry.
    stackId: null,
    // null means "the slide's own screenshot" — the common case. A device layer
    // can point somewhere else once a slide is allowed more than one.
    sourceKey: null,
    shot: { ...DEFAULT_SHOT },
    shadow: { ...DEFAULT_DEVICE_SHADOW },
    ...rest,
  };
}

// A magnified crop of a device's screen, drawn as its own box — the "look at
// this message" callout. It carries no bitmap of its own: it reads whatever the
// target device shows, through the same fit, so it can never disagree with the
// phone it points at.
//
// `area` is the part of the screen it magnifies, in fractions of the device's
// screen opening: its centre and its width. Its height is not stored — it
// follows from the lens box's own proportions — so the lens can be stretched
// without the picture inside it ever squashing, and the same ratios hold on
// every canvas the slide is drawn on.
export const DEFAULT_LENS_AREA = { cx: 0.5, cy: 0.5, w: 0.8 };
// A faint hairline rather than a solid white line, which framed the lens like
// a box drawn round it; the shadow is what lifts it off the slide.
export const DEFAULT_LENS_BORDER = { width: 0.003, color: "#ffffff", opacity: 0.3 };
export const DEFAULT_LENS_SHADOW = { opacity: 0.35, blur: 0.08, y: 0.04 };

export const LENS_CONNECTORS = ["none", "line", "wedge"];

// Looks a lens can take in one click. Style only: where it sits and what it
// shows stay put, and so does the border colour, which is usually the brand's.
export const LENS_PRESETS = [
  { id: "card", label: "Card", patch: { radius: 0.16, border: { width: 0.003, opacity: 0.3 }, shadow: true, markSource: true, dim: 0, blur: 0, connector: "none" } },
  { id: "pill", label: "Pill", patch: { radius: 0.5, border: { width: 0.003, opacity: 0.3 }, shadow: true, markSource: true, dim: 0, blur: 0, connector: "none" } },
  { id: "callout", label: "Callout", patch: { radius: 0.12, border: { width: 0.004, opacity: 0.45 }, shadow: true, markSource: true, dim: 0, blur: 0, connector: "wedge" } },
  { id: "spotlight", label: "Spotlight", patch: { radius: 0.12, border: { width: 0.004, opacity: 0.4 }, shadow: true, markSource: true, dim: 0.45, blur: 0.5, connector: "line" } },
  { id: "bare", label: "Bare", patch: { radius: 0.04, border: false, shadow: false, markSource: false, dim: 0, blur: 0, connector: "none" } },
];

export function lensPresetPatch(lens, id) {
  const preset = LENS_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  const { border, shadow, ...rest } = preset.patch;
  return {
    ...rest,
    border: border === false ? false : { color: lens.border?.color ?? DEFAULT_LENS_BORDER.color, ...border },
    shadow: shadow ? { ...DEFAULT_LENS_SHADOW } : false,
  };
}

export function makeLensLayer({ id, target = DEVICE_LAYER_ID, ...rest } = {}) {
  return {
    id: id ?? newLayerId(),
    role: null,
    type: "lens",
    xRatio: 0,
    yRatio: 0.4,
    wRatio: 0.8,
    hRatio: 0.15,
    rotation: { ...DEFAULT_ROTATION },
    opacity: 1,
    target,
    area: { ...DEFAULT_LENS_AREA },
    // Of the lens box's shorter side, so 0.5 is a pill whatever its shape.
    radius: 0.16,
    // Width as a fraction of canvas width: a stroke weight, not a proportion of
    // the lens, so two lenses of different sizes draw the same line.
    border: { ...DEFAULT_LENS_BORDER },
    shadow: { ...DEFAULT_LENS_SHADOW },
    // Outline the magnified spot on the device itself, so the eye can find
    // where the callout came from.
    markSource: true,
    // How much to darken the rest of the device's screen, 0..0.9.
    dim: 0,
    blur: 0,
    // What joins the spot to the lens: nothing, a line, or a translucent wedge.
    connector: "none",
    ...rest,
  };
}

export const layerByRole = (layers, role) => layers.find((l) => l.role === role) ?? null;
export const layerById = (layers, id) => layers.find((l) => l.id === id) ?? null;

// ---------------------------------------------------------------------------
// Legacy adapter
// ---------------------------------------------------------------------------

// The three-slot shape -> layers. Used by the CLI and batch config (which still
// speak flat options) and by the deck migration, so there is one definition of
// what the old model meant.
//
// Order is back to front: the device painted at z-index 2 and the text blocks at
// 3, so the device goes first.
export function layersFromFlat({
  layout = {},
  headline = "",
  subtitle = "",
  textColor = "#ffffff",
  fontId = DEFAULT_FONT_ID,
  headlineWeight = DEFAULT_HEADLINE_WEIGHT,
  subtitleWeight = DEFAULT_SUBTITLE_WEIGHT,
  textAlign = "center",
  headlineSizeMul = 1,
  subtitleSizeMul = 1,
  deviceTransform,
  headlineRotation,
  subtitleRotation,
  useFrame = true,
  frameTint = DEFAULT_FRAME_TINT,
  deviceHeightRatio,
} = {}) {
  const text = (role, id, value, weight, sizeMul, rotation, yKey, xKey) =>
    makeTextLayer({
      id,
      role,
      text: value ?? "",
      xRatio: layout[xKey] ?? 0,
      yRatio: layout[yKey] ?? textRoleDefaults(role).yRatio,
      rotation: normalizeRotation(rotation),
      color: textColor,
      fontId,
      weight,
      sizeMul,
      align: textAlign,
    });

  return [
    makeDeviceLayer({
      id: DEVICE_LAYER_ID,
      xRatio: layout.deviceXRatio ?? 0,
      yRatio: layout.deviceYRatio ?? 0.24,
      hRatio: layout.deviceHeightRatio ?? deviceHeightRatio ?? DEFAULT_DEVICE_HEIGHT_RATIO,
      rotation: normalizeRotation(deviceTransform),
      useFrame,
      frameTint,
    }),
    text("headline", HEADLINE_LAYER_ID, headline, headlineWeight, headlineSizeMul,
      headlineRotation, "headlineYRatio", "headlineXRatio"),
    text("subtitle", SUBTITLE_LAYER_ID, subtitle, subtitleWeight, subtitleSizeMul,
      subtitleRotation, "subtitleYRatio", "subtitleXRatio"),
  ];
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const num = (v, fallback, min = -Infinity, max = Infinity) => {
  // An object whose toString is not a function threw "Cannot convert object to
  // primitive value" out of Number() (N509); validate names the field instead.
  const n = v !== null && typeof v === "object" ? NaN : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

// The device shadow distinguishes absent from off: a layer that never mentions
// it gets the default (which is what every slide had when the shadow was a
// literal in the template), while `false` is the user switching it off. It has to
// be `false` and not null, because applyPatch reads null as "clear this key" and
// deletes it — which lands the layer back on "absent", i.e. the default, and left
// the checkbox unable to turn itself off. Null still reads as off for decks
// written before the toggle had a value it could actually persist.
function normalizeShadow(v, d = DEFAULT_DEVICE_SHADOW) {
  if (v === null || v === false) return null;
  if (!v || typeof v !== "object") return { ...d };
  return {
    opacity: num(v.opacity, d.opacity, 0, 1),
    blur: num(v.blur, d.blur, 0, 0.5),
    y: num(v.y, d.y, -0.5, 0.5),
  };
}

function normalizeLensArea(v) {
  if (!v || typeof v !== "object") return { ...DEFAULT_LENS_AREA };
  return {
    cx: num(v.cx, DEFAULT_LENS_AREA.cx, 0, 1),
    cy: num(v.cy, DEFAULT_LENS_AREA.cy, 0, 1),
    w: num(v.w, DEFAULT_LENS_AREA.w, 0.02, 1),
  };
}

function normalizeLensBorder(v) {
  if (v === null || v === false) return null;
  if (!v || typeof v !== "object") return { ...DEFAULT_LENS_BORDER };
  return {
    width: num(v.width, DEFAULT_LENS_BORDER.width, 0, 0.05),
    color: str(v.color, DEFAULT_LENS_BORDER.color),
    opacity: num(v.opacity, DEFAULT_LENS_BORDER.opacity, 0, 1),
  };
}

function normalizeTextShadow(v) {
  if (!v || typeof v !== "object") return null;
  return {
    x: num(v.x, 0, -1, 1),
    y: num(v.y, 0.02, -1, 1),
    blur: num(v.blur, 0.04, 0, 1),
    color: str(v.color, "rgba(0,0,0,0.45)"),
  };
}

function normalizeHighlight(v) {
  if (!v || typeof v !== "object") return null;
  return {
    color: str(v.color, "#000000"),
    padX: num(v.padX, 0.35, 0, 3),
    padY: num(v.padY, 0.12, 0, 3),
    radius: num(v.radius, 0.25, 0, 3),
  };
}

/*
 * Accent markup: one keyword in a caption drawn in another colour, the way
 * Headspace, Flighty or Things colour a word inside an otherwise plain headline.
 *
 *   { "text": "Habits that {stick}", "accent": "#ffd23c" }
 *
 * - `{` opens and `}` closes an accented run. Several runs are allowed; they
 *   don't nest, and a run may cross a newline.
 * - Only while the layer has an `accent` colour. Without one the text is taken
 *   literally, braces and all, so no caption saved before the field existed
 *   changes. Braces were picked over `*word*` because an asterisk is ordinary
 *   caption copy ("Free*") and a brace practically never is.
 * - With an accent the braces are reserved: never drawn and never measured. A
 *   stray one, which is what a translation that lost its pair leaves behind, is
 *   dropped, so the caption degrades to plain text rather than showing a brace.
 * - Parsed before HTML escaping and outside any CSS, so neither escaping nor
 *   the style guards see it.
 *
 * Every reader of caption text that measures, draws or counts words goes
 * through `accentRuns` or `captionText`: the wrap engine (textMetrics.js), the
 * render (slideHtml.js), the editor preview, contrast and `check`.
 */
const ACCENT_RUN = /\{([^{}]*)\}/g;
const STRAY_BRACE = /[{}]/g;

export function accentRuns(text, accent) {
  const s = text ?? "";
  // Asked of the colour itself, not its presence: a host that hands over an
  // unnormalized layer must not strip braces the render would draw.
  if (!cssColor(accent, null)) return [{ text: s, accent: false }];
  const runs = [];
  const push = (t, on) => {
    if (!t) return;
    const last = runs.at(-1);
    if (last?.accent === on) last.text += t;
    else runs.push({ text: t, accent: on });
  };
  let at = 0;
  for (const m of s.matchAll(ACCENT_RUN)) {
    push(s.slice(at, m.index).replace(STRAY_BRACE, ""), false);
    push(m[1], true);
    at = m.index + m[0].length;
  }
  push(s.slice(at).replace(STRAY_BRACE, ""), false);
  return runs;
}

// The words a caption shows, markup removed.
export const captionText = (layer) =>
  accentRuns(layer?.text, layer?.accent).map((r) => r.text).join("");

// How the screenshot sits inside the frame's opening. `x`/`y` are object-position
// fractions, so the defaults reproduce the `object-position: top` that was hard
// coded before the fit was adjustable; `zoom` multiplies the cover scale.
export const DEFAULT_SHOT = { zoom: 1, x: 0.5, y: 0 };

function normalizeShot(v) {
  if (!v || typeof v !== "object") return { ...DEFAULT_SHOT };
  return {
    zoom: num(v.zoom, DEFAULT_SHOT.zoom, 1, 4),
    x: num(v.x, DEFAULT_SHOT.x, 0, 1),
    y: num(v.y, DEFAULT_SHOT.y, 0, 1),
  };
}

const DEFAULT_Y = { device: 0.24, image: 0.5, lens: 0.4 };

// One layer off the wire -> a fully materialized layer of the right shape. The
// renderer never resolves defaults: whatever reaches buildSlideHtml is already
// complete, whether it came from the CLI, the deck, or a request body.
export function normalizeLayer(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const type = oneOf(raw.type, LAYER_TYPES, null);
  if (!type) return null;
  // An image role names an image layer, and an image layer takes no other role.
  const role = (type === "image") === IMAGE_ROLES.includes(raw.role) ? oneOf(raw.role, LAYER_ROLES, null) : null;
  const id = str(raw.id) || `l-${index}`;
  const common = {
    id,
    role,
    type,
    xRatio: num(raw.xRatio, 0, -2, 2),
    // A layer written by hand may leave its height on the canvas out; it lands
    // where the make* factory for its kind would have put it, not on the top edge.
    yRatio: num(raw.yRatio, DEFAULT_Y[type] ?? textRoleDefaults(role).yRatio, -2, 2),
    rotation: normalizeRotation(raw.rotation),
    opacity: num(raw.opacity, 1, 0, 1),
  };

  if (type === "text") {
    const d = textRoleDefaults(role);
    return {
      ...common,
      wRatio: num(raw.wRatio, role ? DEFAULT_TEXT_WRATIO : 0.5, 0.02, 2),
      opacity: num(raw.opacity, d.opacity, 0, 1),
      text: str(raw.text),
      fontId: str(raw.fontId, DEFAULT_FONT_ID),
      weight: num(raw.weight, d.weight, 100, 900),
      sizeMul: num(raw.sizeMul, 1, 0.1, 6),
      align: oneOf(raw.align, TEXT_ALIGNS, "center"),
      color: str(raw.color, "#ffffff"),
      lineHeight: num(raw.lineHeight, d.lineHeight, 0.6, 3),
      letterSpacing: num(raw.letterSpacing, d.letterSpacing, -0.3, 1),
      // A deck saved before the case was an enum carries `uppercase` instead;
      // reading it here is what saves the deck format a version bump, since
      // every host resolves its layers through this function.
      textCase: oneOf(raw.textCase, TEXT_CASES, raw.uppercase ? "upper" : "none"),
      balance: bool(raw.balance, false),
      shadow: normalizeTextShadow(raw.shadow),
      highlight: normalizeHighlight(raw.highlight),
      // A colour the renderer can draw, or null. Null also switches the `{…}`
      // markup off, so braces in a caption without an accent stay literal.
      accent: cssColor(raw.accent, null),
      // How far under the headline's ink this layer keeps itself, as a fraction
      // of canvas height — or null for "wherever yRatio says", which is what
      // every deck saved before the field existed carries. Resolved on the
      // write path (src/captionFlow.js), never here: this function feeds the
      // render payload, and a position computed at read time would depend on
      // which host measured the headline.
      //
      // `false` is the explicit "placed by hand" a card-scoped detach writes,
      // and it has to be matched before `num` gets it: `Number(false)` is 0, so
      // the sentinel would otherwise clamp to a *zero* gap and glue the line to
      // the headline's descenders. The device's `stackId` below takes a string,
      // which is how it sidesteps the same trap.
      followGap:
        raw.followGap == null || raw.followGap === false
          ? null
          : num(raw.followGap, null, 0, 0.5),
    };
  }

  if (type === "image") {
    return {
      ...common,
      wRatio: num(raw.wRatio, 0.25, 0.01, 2),
      hRatio: raw.hRatio == null ? null : num(raw.hRatio, null, 0.01, 2),
      sourceKey: str(raw.sourceKey, ""),
      aspect: num(raw.aspect, 1, 0.01, 100),
      fit: oneOf(raw.fit, IMAGE_FITS, "contain"),
      radius: num(raw.radius, 0, 0, 0.5),
      tint: normalizeTint(raw.tint),
    };
  }

  if (type === "lens") {
    return {
      ...common,
      role: null,
      wRatio: num(raw.wRatio, 0.8, 0.02, 2),
      hRatio: num(raw.hRatio, 0.15, 0.01, 2),
      target: str(raw.target, DEVICE_LAYER_ID),
      area: normalizeLensArea(raw.area),
      radius: num(raw.radius, 0.16, 0, 0.5),
      border: normalizeLensBorder(raw.border),
      shadow: normalizeShadow(raw.shadow, DEFAULT_LENS_SHADOW),
      markSource: bool(raw.markSource, true),
      dim: num(raw.dim, 0, 0, 0.9),
      blur: num(raw.blur, 0, 0, 1),
      connector: oneOf(raw.connector, LENS_CONNECTORS, "none"),
    };
  }

  return {
    ...common,
    role: "device",
    hRatio: num(raw.hRatio, DEFAULT_DEVICE_HEIGHT_RATIO, 0.05, 2),
    // The preset whose vertical stack solved this layer's y and height, or null
    // for "placed by hand". Only a preset or a look writes it, and writing a
    // yRatio or hRatio by hand clears it (STACK_DETACH_KEYS) — the same bargain
    // a dragged subtitle makes with `followGap`. Like that field it is resolved
    // on the write path, never here: this function feeds the render payload, so
    // a height computed at read time would depend on which host measured the
    // caption above it.
    // `false` is the explicit "placed by hand" a card-scoped detach writes, and
    // reads back as null here — see the note in updateLayerShared.
    stackId: typeof raw.stackId === "string" && raw.stackId ? raw.stackId : null,
    // How far a caption resized from its top handle moved the stack's leading
    // edge (leadFor in src/layoutStack.js). null = the preset's own margin.
    stackLead: raw.stackLead == null ? null : num(raw.stackLead, null, -1, 1),
    useFrame: bool(raw.useFrame, true),
    frameTint: str(raw.frameTint, DEFAULT_FRAME_TINT),
    sourceKey: typeof raw.sourceKey === "string" ? raw.sourceKey : null,
    shot: normalizeShot(raw.shot),
    shadow: normalizeShadow(raw.shadow),
  };
}

// What one render will take. Far past any real slide (a busy one carries a few
// dozen layers), and there so a request body cannot fan one small file out into
// thousands of inlined copies: /api/render is open to anonymous owners.
export const MAX_RENDER_LAYERS = 200;
export const MAX_RENDER_IMAGE_LAYERS = 100;
// Real slides draw one to three devices; each is a shadowed, framed screen, and
// 200 of them take longer than the render deadline to paint.
export const MAX_RENDER_DEVICE_LAYERS = 12;
export const countDeviceLayers = (layers) => layers.filter((l) => l.type === "device").length;
// Bytes of image data one render may carry, each distinct file counted once.
// 48 MB: the render runs in one shared Chromium under a 2 GB container limit with
// several renders at once, and a legit slide (a few photos, a screenshot) is a
// few MB — a 97 MB slide measured >1.2 GB peak and killed the browser. Without
// an asset map (data URLs) every use is counted, so no path lets it be multiplied.
export const MAX_RENDER_INLINE_BYTES = 48 * 1024 * 1024;

export class RenderTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.name = "RenderTooLargeError";
  }
}

// A whole list, with the invariants enforced: at most one layer per role, ids
// unique, at least one device. Anything unrecognizable is dropped rather than
// rendered as a hole.
export function normalizeLayers(raw, { requireDevice = true } = {}) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seenIds = new Set();
  const seenRoles = new Set();
  for (const [i, item] of list.entries()) {
    const layer = normalizeLayer(item, i);
    if (!layer) continue;
    if (seenIds.has(layer.id)) layer.id = `${layer.id}-${i}`;
    seenIds.add(layer.id);
    if (layer.role) {
      if (seenRoles.has(layer.role)) layer.role = null;
      else seenRoles.add(layer.role);
    }
    out.push(layer);
  }
  // "A device layer is always present" was an invariant of the model until the
  // Play feature graphic, which is a banner rather than a picture of an app
  // running and most often has none. The default is unchanged — a list that
  // forgot one still gets one, which is what carries a deck migrated from the
  // three-slot shape — but a kind that legitimately has none must be able to say
  // so, or the renderer draws a device frame around a screenshot that isn't
  // there. See DEVICELESS_KINDS in src/deck.js.
  if (requireDevice && !out.some((l) => l.type === "device")) out.unshift(makeDeviceLayer());
  return out;
}

// ---------------------------------------------------------------------------
// Asset collection
// ---------------------------------------------------------------------------

// Every (family, weight) pair the slide's text layers need, deduped. A slide can
// now mix fonts, so this replaces the old "headline weight + subtitle weight"
// pair that both asset resolvers used to build their @font-face list from.
export function fontFilesForLayers(layers) {
  const seen = new Map();
  for (const layer of layers) {
    if (layer.type !== "text") continue;
    // Both cases ride along: `textCase` is applied by CSS after the files are
    // picked, and a sliced family must already hold the glyphs it turns into.
    const text = `${layer.text}${layer.text.toUpperCase()}${layer.text.toLowerCase()}`;
    for (const f of fontFilesFor(layer.fontId, [layer.weight], text)) {
      seen.set(`${f.family}-${f.weight}-${f.file}`, f);
    }
  }
  return [...seen.values()];
}

// Image layers that need their bitmap inlined, as [{ id, sourceKey, tint }].
// The tint rides along because a sticker's bytes depend on it — the same key at
// two tints is two different files, and both hosts resolve one from the other.
export function imageLayerSources(layers) {
  return layers
    .filter((l) => l.type === "image" && l.sourceKey)
    .map((l) => ({ id: l.id, sourceKey: l.sourceKey, tint: l.tint ?? null }));
}

// The shapes a stored deck names its files in (docs/architecture.md, server/identity.js
// resolveSource): a root the server serves, then path segments, none empty or `.`/`..`.
// A traversal key drew the bundled example in the editor's ZIP while the server dropped it,
// and an https URL drew a broken box (N825). Not the CLI's rule: its keys are paths under
// --assets until push remaps them (src/renderDeck.js sourceResolver). Lenient past the root
// on purpose: it must never refuse a key the app wrote; resolveSource stays the strict one.
const SOURCE_KEY_ROOTS = new Set(["uploads", "looks", "examples", "stickers", "backgrounds"]);
export const isSourceKey = (key) => {
  if (typeof key !== "string") return false;
  const parts = key.split("/");
  return parts.length > 1 && SOURCE_KEY_ROOTS.has(parts[0]) && parts.every((p) => p && p !== "." && p !== "..");
};

// Device layers pointing at something other than the slide's own screenshot.
export function deviceLayerSources(layers) {
  return layers
    .filter((l) => l.type === "device" && l.sourceKey)
    .map((l) => ({ id: l.id, sourceKey: l.sourceKey }));
}

// The device a lens magnifies, or null when it is gone — a lens without its
// device draws nothing rather than guessing at another one.
export const lensTarget = (lens, layers) =>
  layers.find((l) => l.type === "device" && l.id === lens.target) ?? null;

// The frame a slide renders with: the first device layer that wants one. A slide
// has exactly one device today, so this is that device's answer.
export function usesFrame(layers) {
  return layers.some((l) => l.type === "device" && l.useFrame !== false);
}

// Whether anything on the slide will read the slide's own screenshot. A device
// layer with its own sourceKey draws that instead, and a slide with no device
// layer at all — a Play feature graphic, which is a banner rather than a picture
// of an app running — draws nothing from it. Without this, render insists on a
// file that would never be opened.
export function usesSlideScreenshot(layers) {
  return layers.some((l) => l.type === "device" && !l.sourceKey);
}

// The tint that frame is drawn in.
export function frameTintOf(layers) {
  return layers.find((l) => l.type === "device")?.frameTint ?? DEFAULT_FRAME_TINT;
}
