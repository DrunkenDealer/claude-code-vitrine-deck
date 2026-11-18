// The six original themes, kept as the compatibility layer under src/looks.js.
//
// A theme bundles the project-level style knobs (background, font, weights,
// colour, alignment, device transform) plus a layout preset id, so applying one
// restyles a deck while leaving per-slide text and explicit overrides intact.
// Node-free; imported by the web bundle.
//
// **This list is closed.** New entries belong in src/looks.js, which can express
// a type style — tracking, leading, case, size, a shadow — where a theme, being
// nothing but project defaults, structurally cannot (see that file's header).
// These six stay because `capabilities.themes` is a served contract that agent
// prompts read, and nothing is gained by breaking it. No deck stores a theme id,
// so there is no migration underneath this.
//
// What changed: a theme no longer carries its own copy of a background. It names
// one from BACKGROUND_PRESETS and takes that preset's graded ink with it.
//
// The fork this closes was not hypothetical. Four of the six backgrounds here
// were byte-equal to a preset, and the two that had drifted — `aurora`'s
// `#6366f1` blob and `sunset`'s `#fbbf24` — were the pre-audit versions, which
// is precisely why they were the only two entries in test/contrast.test.js's
// KNOWN_LOW_CONTRAST. `aurora` also seeds DECK_DEFAULTS, so the unaudited copy
// was what every new deck started on: a subtitle at 3.02:1 against a 4.5 floor,
// while the corrected spec sat in the picker two sections below. Referencing the
// library instead of copying it is what makes that unrepeatable.
import { BACKGROUND_PRESETS, compileBackground } from "./visual.js";

// A theme's ground: the preset's spec and the ink measured against it. Throwing
// on an unknown id is deliberate — this list is fixed and evaluated at module
// load, so a typo is a boot failure in every host at once rather than a theme
// that quietly renders on nothing.
function ground(presetId) {
  const preset = BACKGROUND_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`themes.js: no background preset "${presetId}"`);
  return { background: preset.spec, textColor: preset.ink };
}

export const THEMES = [
  {
    id: "aurora",
    label: "Aurora",
    ...ground("aurora"),
    fontId: "sora",
    headlineWeight: 800,
    subtitleWeight: 400,
    textAlign: "center",
    deviceTransform: "tilt-right",
    frameTint: "black",
    layoutPreset: "hero",
  },
  {
    id: "ivory",
    label: "Clean Ivory",
    ...ground("ivory"),
    fontId: "inter",
    headlineWeight: 800,
    subtitleWeight: 400,
    textAlign: "center",
    deviceTransform: "flat",
    frameTint: "silver",
    layoutPreset: "hero",
  },
  {
    id: "sunset",
    label: "Sunset",
    ...ground("sunset"),
    fontId: "outfit",
    headlineWeight: 800,
    subtitleWeight: 400,
    textAlign: "center",
    deviceTransform: "perspective",
    frameTint: "black",
    layoutPreset: "big-headline",
  },
  {
    id: "pastel",
    label: "Pastel Soft",
    ...ground("bloom"),
    fontId: "jakarta",
    headlineWeight: 700,
    subtitleWeight: 400,
    textAlign: "center",
    deviceTransform: "tilt-left",
    frameTint: "silver",
    layoutPreset: "hero",
  },
  {
    id: "editorial",
    label: "Editorial Serif",
    ...ground("linen"),
    fontId: "fraunces",
    headlineWeight: 700,
    subtitleWeight: 400,
    textAlign: "left",
    deviceTransform: "flat",
    frameTint: "titanium",
    layoutPreset: "bold-left",
  },
  {
    id: "midnight",
    label: "Midnight Bold",
    ...ground("slate-glow"),
    fontId: "space-grotesk",
    headlineWeight: 700,
    subtitleWeight: 400,
    textAlign: "center",
    deviceTransform: "tilt-right",
    frameTint: "black",
    layoutPreset: "compact",
  },
];

// Compiled once here rather than at every paint: the theme grid renders on every
// inspector keystroke.
for (const t of THEMES) t.preview = compileBackground(t.background);

export const DEFAULT_THEME_ID = "aurora";

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));
export function getTheme(id) {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_THEME_ID);
}
