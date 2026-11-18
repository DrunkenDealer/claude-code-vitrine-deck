// A slide's shared column: where its headline, subtitle and device sit on the
// canvas the shared ratios are solved on, and the per-canvas and per-language
// columns stored beside it.
//
// The write half of src/layoutStack.js and src/captionFlow.js, shared by both
// hosts. The editor runs it on every write (web/src/state.js wraps it with
// signal reads and the warm-font guard), and `vitrine apply` runs it after a
// look or layout, because check and render read a solved base canvas as stored
// (withSlideStacks solves it only while the stack is unsolved, hRatio null). One function, so the two cannot drift: a column
// the CLI stores is the column the editor would have drawn (applyParity).
//
// Pure: no signal, no global. Every input is a parameter, and a slide that does
// not move comes back as the same object — an equal-but-new slide would still be
// a new identity and land in the editor's undo history as an edit nobody made.
import { baseCanvasFor } from "./devices.js";
import { flowedSubtitleY } from "./captionFlow.js";
import { stackFor } from "./layoutPresets.js";
import { captionIntoBand } from "./layoutPolish.js";
import { artSafeInsets } from "./safeArea.js";
import { solveStack } from "./layoutStack.js";
import { drawsSlide, orientationOf, resolveLayers, resolveSlide, solveBaseStacks, solveLocaleStacks } from "./deck.js";
import { LOW_CONTRAST, contrastFaults } from "./contrast.js";
import { boxesFor, canvasOf } from "./layoutScore.js";
import { thumbnailScale } from "./thumbnail.js";

// What solveBaseStacks and solveLocaleStacks take for one slide, or null when no
// device can measure it. `devices` are the project's own; `fallback` is a device
// of the kind to measure on when the project has none (the editor, which keeps
// a catalogue beside the selection, passes one).
export function columnOptions(slide, { devices, fallback = null, screenshots, defaults, measurer, onlyStale = false }) {
  const device = baseCanvasFor(slide.kind, devices) ?? fallback;
  if (!device) return null;
  return {
    device,
    defaults,
    measurer,
    // Each canvas the slide is drawn on has its own columns.
    canvases: [device, ...devices.filter((d) => d.id !== device.id && drawsSlide(screenshots, slide, d))],
    onlyStale,
  };
}

export const solveColumnStacks = (slide, opts) => solveLocaleStacks(solveBaseStacks(slide, opts), opts);

// Write one solved ratio per layer, shared or card-scoped, and return the slide
// unchanged when nothing actually moved.
function writeSolved(slide, byLayer, deviceId) {
  if (deviceId) {
    const forDevice = slide.layersByDevice?.[deviceId] ?? {};
    let moved = false;
    const next = { ...forDevice };
    for (const [layerId, patch] of byLayer) {
      const current = forDevice[layerId] ?? {};
      if (Object.entries(patch).every(([k, v]) => current[k] === v)) continue;
      next[layerId] = { ...current, ...patch };
      moved = true;
    }
    if (!moved) return slide;
    return { ...slide, layersByDevice: { ...(slide.layersByDevice ?? {}), [deviceId]: next } };
  }
  let moved = false;
  const layers = slide.layers.map((l) => {
    const patch = byLayer.get(l.id);
    if (!patch || Object.entries(patch).every(([k, v]) => l[k] === v)) return l;
    moved = true;
    return { ...l, ...patch };
  });
  return moved ? { ...slide, layers } : slide;
}

/**
 * Re-seat a following subtitle under its headline.
 *
 * Returns the slide unchanged when nothing is following, when there is no device
 * to measure against, or when the number has not moved.
 *
 * Measured against `device`, one canvas per slide, and written to the shared
 * layer rather than into `layersByDevice`. A headline wraps differently on a 4:3
 * tablet than on a 19.5:9 phone, so the exact gap only holds on the canvas it was
 * measured on — which is the same compromise every preset ratio already makes
 * (see the header of src/layoutPresets.js). Writing eleven per-device overrides
 * instead would put a reset arrow on the subtitle's Y for every device and hand
 * the next wide write eleven values to clear.
 */
export function flowCaption(slide, { device, deviceId = null, locale, defaults, screenshots, measurer }) {
  const subtitle = slide.layers.find((l) => l.role === "subtitle");
  if (!subtitle || !device) return slide;
  const resolved = resolveLayers(slide, { deviceId: device.id, device, locale, defaults, screenshots });
  // Whether the line is following is a question for the *resolved* layer, which
  // is why there is no cheaper guard on the shared one here: a card-scoped
  // preset can set `followGap` on the override alone, and a card-scoped drag can
  // clear it there while the shared layer still follows. `flowedSubtitleY` reads
  // the resolved value and answers null when it is absent, so both directions
  // fall out of the one check it already makes.
  const y = flowedSubtitleY(resolved, { device, measurer });
  if (y == null) return slide;

  // A card-scoped headline edit has to re-seat the line *on that card*. Writing
  // the shared layer instead would make "this card only" move the supporting
  // line on every other device, which is the one thing the scope control
  // promises it will not do.
  if (deviceId) {
    const current = slide.layersByDevice?.[deviceId]?.[subtitle.id] ?? {};
    if (current.yRatio === y) return slide;
    return {
      ...slide,
      layersByDevice: {
        ...(slide.layersByDevice ?? {}),
        [deviceId]: {
          ...(slide.layersByDevice?.[deviceId] ?? {}),
          [subtitle.id]: { ...current, yRatio: y },
        },
      },
    };
  }

  if (y === subtitle.yRatio) return slide;
  return {
    ...slide,
    layers: slide.layers.map((l) => (l.id === subtitle.id ? { ...l, yRatio: y } : l)),
  };
}

/**
 * Re-divide a slide's vertical budget on `device`, or fall back to re-seating
 * the caption.
 *
 * A slide is under a stack when its device layer names one; everything else takes
 * the narrower caption flow, which is also what a stacked slide degrades to the
 * moment the device is placed by hand. Measured against one canvas per slide,
 * like the caption flow and for the same reason.
 *
 * `trusted` is asked after the solve: false leaves the slide alone. The editor's
 * boot re-solve uses it so a column measured in a fallback face (one not loaded
 * yet) is never stored over one solved with the real metrics.
 */
export function solveBaseColumn(slide, { device, deviceId = null, locale, defaults, screenshots, measurer, trusted = () => true }) {
  if (!device) return slide;
  const resolved = resolveLayers(slide, { deviceId: device.id, device, locale, defaults, screenshots });

  // Read off the *resolved* device layer, not the shared one. A card-scoped
  // detach writes `stackId: null` into `layersByDevice`, leaving the shared
  // layer still naming the stack — so reading the shared value would keep
  // solving that card and write the solved ratios straight over the placement
  // that had just opted out of them.
  const dev = resolved.find((l) => l.type === "device");
  const stack = dev?.stackId ? stackFor(dev.stackId, orientationOf(slide.kind), slide.kind) : null;
  if (!stack) return flowCaption(slide, { device, deviceId, locale, defaults, screenshots, measurer });

  // Each other canvas reads its own column (solveBaseStacks), so the shared one
  // answers for the base canvas only: no margin floor widened for a sibling (N815).
  const solved = solveStack(stack, resolved, { device, measurer });
  // Null is "leave everything alone" — no canvas, or a band naming a role this
  // slide does not have. Never a guess, and never a partial write.
  if (!solved || !trusted()) return slide;

  const byLayer = new Map();
  for (const l of slide.layers) {
    const y = solved.byRole[l.role];
    if (y == null) continue;
    byLayer.set(l.id, l.type === "device" ? { yRatio: y, hRatio: solved.deviceHRatio } : { yRatio: y });
  }
  return writeSolved(slide, byLayer, deviceId);
}

/**
 * The shared column after a write that reached the whole slide: the base canvas
 * solved, then every translation beside it and the base on every other canvas —
 * whatever moved the base (a size, a preset, a caption the locale never
 * translated) moves theirs too. `ctx` is columnOptions' (without onlyStale) plus
 * `locale`.
 */
export function reflowColumn(slide, ctx) {
  const opts = columnOptions(slide, ctx);
  if (!opts) return slide;
  const { locale, screenshots } = ctx;
  const base = solveBaseColumn(slide, { device: opts.device, locale, defaults: opts.defaults, screenshots, measurer: opts.measurer });
  return solveColumnStacks(base, opts);
}

/**
 * Seat a slide's caption pair inside the art safe area of an App Store banner,
 * or return the slide unchanged on any other canvas.
 *
 * A preset or look writes the banner's seed, which is inside the box for a
 * headline that wraps once; a longer headline pushes its line out under it. Apply
 * is the one moment the user asked for a layout, so it is the moment to shift the
 * pair in (src/layoutPolish.js `captionIntoBand`, the same minimal move Polish
 * makes). Never run from `reflowCaptions`: a drag or a keystroke must not be
 * pinned into the box, because nothing moves a layer into a safe area on its own
 * (src/safeArea.js). A pair taller than the box is left as it is.
 */
export function seatInArtSafe(slide, ctx, deviceId = null) {
  const opts = columnOptions(slide, ctx);
  const insets = artSafeInsets(opts?.device);
  if (!insets) return slide;
  const { device } = opts;
  const resolved = resolveLayers(slide, { deviceId: device.id, device, locale: ctx.locale, defaults: opts.defaults, screenshots: ctx.screenshots });
  const patches = captionIntoBand(resolved, {
    device,
    frame: null,
    safeArea: { topPx: insets.top, bottomPx: insets.bottom, leftPx: insets.left, rightPx: insets.right },
    measurer: opts.measurer,
  });
  const seated = patches ? writeSolved(slide, byLayerOf(slide, patches), deviceId) : slide;
  return inkSubtitle(seated, { device, deviceId, ctx, opts });
}

const byLayerOf = (slide, patches) => {
  const byLayer = new Map();
  for (const l of slide.layers) if (patches[l.role]) byLayer.set(l.id, patches[l.role]);
  return byLayer;
};

// Where the seat puts the line is where the ground is: the default ground has a
// teal blob a subtitle at its 0.78 opacity can land on at 2.92:1, under the 3:1
// floor, and the seat is what moved it there (N899). Raise the opacity to the
// first step that reads, never past full; a line that already reads, or a ground
// the check cannot judge, is left as it is.
const SUBTITLE_OPACITY_STEPS = [0.86, 0.94, 1];
function inkSubtitle(slide, { device, deviceId, ctx, opts }) {
  const resolve = (s) => resolveLayers(s, { deviceId: device.id, device, locale: ctx.locale, defaults: opts.defaults, screenshots: ctx.screenshots });
  const layers = resolve(slide);
  const sub = layers.find((l) => l.role === "subtitle");
  if (!sub?.text) return slide;
  const { background, span } = resolveSlide(slide, { deviceId: device.id, defaults: opts.defaults, screenshots: ctx.screenshots });
  const reads = (opacity) => {
    const next = layers.map((l) => (l.id === sub.id ? { ...l, opacity } : l));
    const boxes = boxesFor(next.filter((l) => l.role === "headline" || l.role === "subtitle"), { device, frame: null, measurer: opts.measurer });
    return !contrastFaults(next, background, { boxes, canvas: canvasOf(device), thumbScale: thumbnailScale(device), span })
      .some((f) => f.code === LOW_CONTRAST && f.layerId === sub.id);
  };
  if (reads(sub.opacity ?? 1)) return slide;
  const opacity = SUBTITLE_OPACITY_STEPS.find((o) => o > (sub.opacity ?? 1) && reads(o));
  if (opacity == null) return slide;
  const target = slide.layers.find((l) => l.role === "subtitle");
  return writeSolved(slide, new Map([[target.id, { opacity }]]), deviceId);
}
