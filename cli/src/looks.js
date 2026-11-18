// The Look library — one click that makes a deck look designed.
//
// A look is a *composition over the audited libraries*, never a copy of them.
// It names a `BACKGROUND_PRESETS` id (or a photo from the bundled pack) and a
// layout preset, and adds the one thing neither of those can carry: a type
// style. Node-free like visual.js and layoutPresets.js, so the web bundle
// imports it directly.
//
// ---------------------------------------------------------------------------
// Why this is not src/themes.js with more entries
//
// A theme is a bag of project defaults, and src/deck.js's INHERITED_KEYS decides
// which of those a layer can pick up: `color`, `fontId`, `align`, `weight`,
// `rotation`. Five. Everything that makes one typographic treatment different
// from another — tracking, leading, case, size, opacity, a shadow, a highlight
// pill — is layer-owned and cannot reach a slide through a default at all.
//
// That is the real reason six themes read as six backgrounds: the container had
// room for about three decisions, and the one it showed off was the axis the
// background picker already covers 66 ways.
//
// So a look compiles to **two** patches:
//
//   `defaults`   the keys that genuinely *are* project defaults. Written to the
//                deck, so the Defaults panel stays live and every reset arrow
//                still means something.
//   `patchFor`   the keys that cannot inherit, stamped onto the role layers —
//                and it writes `null` for the inheritable five, handing them
//                back to the defaults just written instead of burning them in.
//                A layout preset writes `align` as a *value*, which is how a
//                deck ends up impossible to restyle; a look must not.
//
// The background is a reference, not a spec. src/themes.js kept its own copy,
// four of the six were byte-equal to a preset, and the two that had drifted were
// the pre-audit versions — which is exactly why they were the only two entries
// in test/contrast.test.js's KNOWN_LOW_CONTRAST. A library that cannot fork
// cannot rot.
import { DEFAULT_TEXT_WRATIO } from "./geometry.js";
import { textRoleDefaults } from "./layers.js";
import { getPreset, presetGeometryFor, stackFor } from "./layoutPresets.js";
import {
  BACKGROUND_PRESETS,
  DEFAULT_ROTATION,
  backgroundImageSpec,
  rotationCss,
} from "./visual.js";

// Browsing bands, and they are a different question from the background groups.
// BACKGROUND_GROUPS sort by *tone*, because tone is what picks the text colour.
// A look has already made that call, so sorting by tone again would say nothing.
// These sort by **register** — what the thing is made of and who it is for —
// which is the only axis on which forty entries stay browsable.
//
// A family is declared here only once it has entries. An empty band is a label
// with nothing under it, and test/looks.test.js refuses one.
export const LOOK_FAMILIES = [
  {
    id: "bloom",
    label: "Bloom",
    blurb: "Light behind the product. The strongest default a store listing has.",
  },
];

// Per-role fallbacks, so an entry declares only what it changes. Forty looks
// each spelling out nine typographic fields is forty places for a typo to hide.
const roleDefaults = (role) => {
  const d = textRoleDefaults(role);
  return {
    sizeMul: 1,
    wRatio: DEFAULT_TEXT_WRATIO,
    lineHeight: d.lineHeight,
    letterSpacing: d.letterSpacing,
    opacity: d.opacity,
    textCase: "none",
    shadow: null,
    highlight: null,
    xRatio: null,
    yRatio: null,
  };
};

// A narrowed text column, flush to the canvas's normal text margin.
//
// geometry.js lays a column out as `x = W(1-wRatio)/2 + W*xRatio`, so the
// padding is always centred and narrowing `wRatio` alone pulls *both* edges in —
// a left-aligned headline in a 0.72 column starts a seventh of the canvas from
// the edge and reads as floating rather than as an edge. This is what
// decoration.md means by "narrow wRatio and move xRatio; setting align alone
// changes nothing the scorer can see", and it is arithmetic worth deriving
// rather than writing out per entry.
const flushLeft = (wRatio) => Math.round(((wRatio - DEFAULT_TEXT_WRATIO) / 2) * 10000) / 10000;

const DEVICE_DEFAULTS = {
  transform: "flat",
  frameTint: "black",
  useFrame: true,
  yRatio: null, // null = take the layout preset's
  hRatio: null, //         "
  hRatioScale: null, // null = derive from the tilt, below
};

// What a tilt costs, as a fraction of the device's height.
//
// A rotated device projects a box larger than `hRatio` describes, so a geometry
// that clears the canvas flat can hang off it once tilted — the layout presets
// are tuned to about 1% of headroom for a flat device, which a 9-degree turn
// eats. This is the one place a look can walk into that, because it is the only
// control that sets a layout and a tilt in the same click.
//
// 0.99 is measured, not chosen. test/looks.test.js sweeps every preset against
// all four rotation presets on every graded device: at full height a batch of
// combinations hang off the canvas (`compact` and `hero` on the iPads, which
// carry the biggest devices relative to their canvas), and the overflow is gone
// somewhere between 0.998 and 0.995.
//
// No look shipping today tilts, and that is a finding rather than an oversight:
// across 138 top App Store and Play slides whose product shot has a straight
// edge to fit a line to, the median tilt is 0.00 degrees and the p90 is 0.05 —
// not one is past 1.5. See the corpus note in test/storeShape.test.js. This
// stays because a tilt is still one click away in the editor, and because a
// future family may want one; if a look ever declares a rotation, this is what
// keeps it on the canvas.
//
// So this is deliberately *not* that minimum. Sitting on the exact boundary
// would put the whole library one pixel of frame geometry away from failing, and
// `layoutScore.TOL` already spends 1.5% on measurement noise. Double the
// measured margin is still one percent of a device's height, which nobody can
// see — and the test brackets it from both sides so it can neither drift up into
// uselessness nor grow into a way of fixing layout bugs by shrinking the device.
export const TILT_HEADROOM = 0.99;

export const LOOKS = [
  // ---- bloom ---------------------------------------------------------------
  // One hue lit from behind the device (`rad` in visual.js). The ground does the
  // work, so the type stays out of the way: one weight, one size, no case tricks
  // except where a variant is explicitly about that.
  {
    id: "bloom-indigo",
    family: "bloom",
    label: "Indigo bloom",
    background: "indigo-bloom",
    layout: "caption-top",
    font: "sora",
    headline: { weight: 800, letterSpacing: -0.035, lineHeight: 1.05 },
    subtitle: { weight: 400 },
    device: { transform: "flat" },
  },
  {
    id: "bloom-emerald",
    family: "bloom",
    label: "Emerald bloom",
    background: "emerald-bloom",
    layout: "thirds",
    font: "manrope",
    headline: { weight: 800, letterSpacing: -0.025, lineHeight: 1.06 },
    subtitle: { weight: 400 },
    device: { transform: "flat" },
  },
  {
    // The case variant. Caps plus 0.08em of tracking cost about a fifth of the
    // line, so the size comes down to pay for it — `caption-top` is 1.34 and
    // 0.8 of that lands at ~1.07, still a large headline for the family.
    // Wide-tracked caps also need the leading opened up or the lines lock
    // together, which is why lineHeight goes the other way from bloom-indigo's.
    id: "bloom-violet-caps",
    family: "bloom",
    label: "Violet caps",
    background: "violet-bloom",
    layout: "caption-top",
    font: "space-grotesk",
    // Caps run about 15% wider than mixed case and the tracking adds more, so on
    // a tablet — where type is sized off the short edge and is proportionally
    // ~1.6x taller relative to the canvas — the block takes a third line and
    // walks into the device. It pays for the caps twice: once in size, once in
    // the device sitting lower than `caption-top` would put it.
    //
    // Those three ratios are the **seed** — what a host that cannot measure text
    // renders, and what has to be independently safe on every device. In the
    // editor the vertical stack measures the block and divides the canvas around
    // it, so the device recovers whatever height the caps did not actually need
    // (0.7 seeded, 0.786 solved on a 6.9" phone with a one-line claim).
    headline: { weight: 700, sizeMul: 0.8, letterSpacing: 0.06, lineHeight: 1.2, textCase: "upper" },
    subtitle: { weight: 400, letterSpacing: 0.01, sizeMul: 0.85, yRatio: 0.19 },
    device: { transform: "flat", yRatio: 0.283, hRatio: 0.7 },
  },
  {
    // The layout variant. `bold-left` already sets align, so the look says
    // nothing about it — but a left-aligned headline still occupies the full
    // centred column, so the column has to come in with it or the ragged edge
    // sits a third of the canvas from the text. See the note on wRatio in the
    // vitrine-deck decoration notes: setting `align` alone changes nothing the
    // layout scorer can see.
    id: "bloom-rose-left",
    family: "bloom",
    label: "Rose editorial",
    background: "rose-bloom",
    layout: "bold-left",
    font: "outfit",
    headline: {
      weight: 800, sizeMul: 1.05, wRatio: 0.84, xRatio: flushLeft(0.84),
      letterSpacing: -0.03, lineHeight: 1.06, yRatio: 0.05,
    },
    subtitle: { weight: 400 },
    device: { transform: "flat" },
  },
  {
    // The layout the family was missing.
    //
    // Rendering the first five as a contact sheet made the problem obvious: all
    // of `hero`, `big-headline` and `bold-left` are top-caption layouts, so five
    // entries read as five colours of one slide — which is the exact complaint
    // that started this rework. Within a family the varying dial has to include
    // *structure*, or "one parameter at a time" just produces sameness.
    //
    // `lower-banner` inverts it: device at the top, claim beneath. That puts the
    // caption at yRatio 0.72, nearer the bloom's bright centre than any other
    // layout gets — which is exactly the case the `rad` stops were chosen to
    // survive, and test/looks.test.js is what confirms it rather than hope.
    id: "bloom-cyan-banner",
    family: "bloom",
    label: "Cyan banner",
    background: "cyan-bloom",
    layout: "lower-banner",
    font: "dm-sans",
    headline: { weight: 700, sizeMul: 1.18, letterSpacing: -0.02, lineHeight: 1.1, yRatio: 0.69 },
    subtitle: { weight: 400, opacity: 0.86, yRatio: 0.8 },
    device: { transform: "flat", yRatio: 0.04, hRatio: 0.61 },
  },
  {
    // The quiet one: no hue to argue with the app's own, a titanium bezel
    // instead of black, and the subtitle at full opacity. That last one is not a
    // taste call — 0.78 is real contrast given away, and on the one ground in
    // the family with no colour to carry the slide, the supporting line is doing
    // more of the work.
    id: "bloom-slate-quiet",
    family: "bloom",
    label: "Slate quiet",
    background: "slate-bloom",
    // `thirds`, not `caption-top`: three of six entries were on caption-top and
    // the family read as one slide in six colours, which is the complaint that
    // started this library. Two per structure is the ceiling, and
    // test/looks.test.js holds it.
    layout: "thirds",
    font: "inter",
    headline: { weight: 800, letterSpacing: -0.025, lineHeight: 1.06 },
    subtitle: { weight: 400, opacity: 1, lineHeight: 1.35 },
    device: { transform: "flat", frameTint: "titanium" },
  },
];

// A look's ground, resolved to the spec that gets stored and the ink that was
// graded against it.
//
// A string is a colour preset id and carries the preset's own measured ink —
// that is the whole anti-fork rule. `{ photo }` is the bundled pack, whose inks
// live in assets/backgrounds/index.json; that file is read at runtime by the
// server and cannot be imported here, so the entry restates the ink and
// test/looks.test.js asserts it against the manifest.
function resolveGround(background) {
  if (typeof background === "string") {
    const preset = BACKGROUND_PRESETS.find((p) => p.id === background);
    if (!preset) return null;
    return { spec: preset.spec, ink: preset.ink, ref: background, medium: "colour" };
  }
  if (background?.photo && background.ink) {
    return {
      spec: backgroundImageSpec(background.photo),
      ink: background.ink,
      ref: background.photo,
      medium: "photo",
    };
  }
  return null;
}

/**
 * One look -> everything needed to apply it, preview it, or grade it.
 *
 * Returns null for an entry whose ground does not resolve, so a bad reference is
 * a visible absence rather than a slide painted on nothing.
 */
export function compileLook(look) {
  const ground = resolveGround(look.background);
  if (!ground) return null;

  const preset = getPreset(look.layout);
  const headline = { ...roleDefaults("headline"), ...look.headline };
  const subtitle = { ...roleDefaults("subtitle"), ...look.subtitle };
  const device = { ...DEVICE_DEFAULTS, ...look.device };
  const align = look.align ?? preset.textAlign;
  // `rotationCss` is the same test the renderer uses to decide whether to enter
  // a 3D context at all, so "does this tilt" means exactly one thing repo-wide.
  const tilted = rotationCss(device.transform).transform !== "none";
  const hRatioScale = device.hRatioScale ?? (tilted ? TILT_HEADROOM : 1);
  // Whether the layout preset's vertical stack owns the column.
  //
  // Opting out is explicit — `stack: false` on the look — and not inferred from
  // the look carrying its own ratios. That distinction was worth a bug: the
  // ratios a look sets are its **seed**, the geometry a host with no way to
  // measure text renders and which therefore has to be sound on every device on
  // its own. Reading them as "this look has measured the column itself" dropped
  // `bloom-violet-caps`' tablet compensation and put its caps headline 0.34 into
  // the device on three iPads, which test/looks.test.js caught.
  //
  // `hRatioScale` is the one implicit opt-out, and it is not a seed: it exists to
  // buy headroom for a *tilted* device's corners, so a solved height that
  // ignored it would rotate the mockup off the canvas. Every bloom look is flat,
  // so nothing uses it yet.
  const stacked = hRatioScale === 1 && look.stack !== false;

  // Every key, every time, even where the value is the library default.
  //
  // A look has to *replace* the one before it, not land on top of it. Emitting
  // only the fields an entry mentions would leave the previous look's tilt or
  // tint behind, so picking two looks in a row would produce a third thing that
  // is neither.
  const defaults = {
    background: ground.spec,
    textColor: ground.ink,
    fontId: look.font,
    headlineWeight: headline.weight,
    subtitleWeight: subtitle.weight,
    textAlign: align,
    useFrame: device.useFrame,
    deviceTransform: device.transform,
    frameTint: device.frameTint,
    headlineRotation: look.headlineRotation ?? DEFAULT_ROTATION,
    subtitleRotation: look.subtitleRotation ?? DEFAULT_ROTATION,
  };

  // The patch for one layer, or null for a layer the look has no business
  // touching — which is every layer the user added, the same rule
  // presetPatchFor follows.
  const patchFor = (layer, orientation, kind = null) => {
    if (!layer.role) return null;
    const g = presetGeometryFor(preset, orientation, kind);

    if (layer.type === "device") {
      // A banner has no device block: a device someone added by hand is left
      // where it is, and only the look's frame and tint are handed back.
      if (!g.device) return { useFrame: null, frameTint: null, rotation: null };
      return {
        xRatio: g.device.xRatio,
        yRatio: device.yRatio ?? g.device.yRatio,
        hRatio: Math.round((device.hRatio ?? g.device.hRatio) * hRatioScale * 10000) / 10000,
        // Both ratios above are the seed the stack starts from; when one governs
        // it re-divides the canvas on the write path. See src/layoutStack.js.
        stackId: stacked && stackFor(preset.id, orientation, kind) ? preset.id : null,
        stackLead: null,
        // Handed back to the defaults above rather than written here.
        useFrame: null,
        frameTint: null,
        rotation: null,
      };
    }
    if (layer.type !== "text") return null;

    const t = layer.role === "headline" ? headline : subtitle;
    const geom = g[layer.role];
    if (!geom) return null;

    // A kind that pins the column (the App Store banners) pins the placement
    // too: a look's ratios are portrait seeds, authored for a caption above a
    // device, and on a banner they put the pair outside Apple's art safe box
    // (a 0.84 column, a headline at 0.05) with nothing to anchor them to.
    const pinned = geom.wRatio != null;
    return {
      xRatio: pinned ? geom.xRatio : t.xRatio ?? geom.xRatio,
      yRatio: pinned ? geom.yRatio : t.yRatio ?? geom.yRatio,
      wRatio: pinned ? geom.wRatio : t.wRatio,
      // The look's multiplier rides on top of the layout's, so a type style
      // composes with any preset instead of replacing its proportions.
      sizeMul: Math.round(geom.sizeMul * t.sizeMul * 10000) / 10000,
      lineHeight: t.lineHeight,
      letterSpacing: t.letterSpacing,
      textCase: t.textCase,
      opacity: t.opacity,
      shadow: t.shadow,
      highlight: t.highlight,
      // Whether the supporting line follows the claim is a property of the
      // *structure*, so it comes from the layout preset and a look never
      // overrides it: `thirds` puts the device between the two lines and its
      // subtitle belongs to the bottom of the canvas. See src/captionFlow.js.
      followGap: geom.followGap ?? null,
      align: null,
      color: null,
      fontId: null,
      weight: null,
      rotation: null,
    };
  };

  return {
    id: look.id,
    family: look.family,
    label: look.label,
    layout: preset,
    align,
    font: look.font,
    ground,
    headline,
    subtitle,
    device,
    defaults,
    patchFor,
  };
}

// Every key `patchFor` can write. The apply path hands this to
// applyLayerPatches (src/deck.js) so a wide write also clears these keys from a card's
// per-device overrides — otherwise a look lands everywhere except the one card
// somebody had already nudged.
export const LOOK_LAYER_KEYS = [
  "xRatio", "yRatio", "wRatio", "hRatio", "sizeMul", "followGap", "stackId", "stackLead",
  "lineHeight", "letterSpacing", "textCase", "opacity", "shadow", "highlight",
  "align", "color", "fontId", "weight", "rotation", "useFrame", "frameTint",
];

export const COMPILED_LOOKS = LOOKS.map(compileLook).filter(Boolean);

const BY_ID = new Map(COMPILED_LOOKS.map((l) => [l.id, l]));
export const getLook = (id) => BY_ID.get(id) ?? null;

export const DEFAULT_LOOK_ID = "bloom-indigo";
