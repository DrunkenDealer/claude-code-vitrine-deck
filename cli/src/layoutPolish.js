// Finding the smallest edit that fixes what src/layoutScore.js says is wrong.
//
// Warm-started from the slide as it is, because "tidy this up" and "lay this out
// again" are different requests and only the first one is a repair. The search
// is coordinate descent over a handful of single-axis edits rather than the
// product of all of them: the product is 500+ combinations, and almost all of
// them are edits no designer would author — shrink the headline *and* the
// subtitle *and* the device *and* move everything. Descending one axis at a time
// finds the single-axis fix first, which is exactly the minimal-edit property a
// repair should have.
//
// Every step is relative to the layer's **original** value, never to the current
// candidate, so revisiting an axis on the second pass cannot compound into a
// headline shrunk to nothing.
import { boxesFor, canvasOf, scoreLayout, APPLY_MARGIN, FAULTS, FAULT_SEVERITY, TOL } from "./layoutScore.js";
import { textInkBox } from "./textMetrics.js";
import { PRESETS, presetGeometryFor } from "./layoutPresets.js";

// What one unit of "how different does this look" costs against the penalty.
//
// This is the mechanism that stops Polish stamping a preset over a slide someone
// tuned by hand. A whole preset lands about 1.5 units away, so it costs ~60 and
// has to beat the local repair by a full cheap term to win; an 8% headline
// shrink costs ~6. Small local fix wins unless the wholesale relayout is
// decisively better.
const EDIT_COST = 40;

// The faults a shorter string would actually have fixed, and the only ones that
// justify saying so. A big gap or a crowded margin is not a copy problem, and
// reporting one as "copy too long" sends the reader off to rewrite a line that
// was never the trouble.
//
// An overlap is filed on the text layer, but what it hit decides: a sticker, an
// image or a text box the user added (no `role`) sits where they put it, and a
// shorter headline does not move it. Counting that as an overflow answered
// "copy too long" for three words under a sticker.
const OVERFLOW_FAULTS = new Set([FAULTS.OVERLAP, FAULTS.SAFE_AREA, FAULTS.OFF_CANVAS]);
const overflowing = (faults, layers) => {
  const added = new Set(layers.filter((l) => !l.role).map((l) => l.id));
  return faults.some(
    (f) => OVERFLOW_FAULTS.has(f.code) && !(f.code === FAULTS.OVERLAP && added.has(f.detail?.otherId)),
  );
};

// Denominators for edit distance — roughly "a change this big is one unit".
const RATIO_UNIT = 0.2;
const SIZE_UNIT = 0.5;
// No single layer may dominate the distance; a preset that moves everything
// should read as a big change, not an unbounded one.
const PER_LAYER_CAP = 2;

const ROLES = ["headline", "subtitle", "device"];
const roleOf = (layers, role) => layers.find((l) => l.role === role) ?? null;

function mergePatch(patches, role, extra) {
  return { ...patches, [role]: { ...(patches[role] ?? {}), ...extra } };
}

// A candidate's layers: the patches laid over what is there.
function materialise(layers, patches) {
  return layers.map((l) => (l.role && patches[l.role] ? { ...l, ...patches[l.role] } : l));
}

function editDistance(layers, patches) {
  let total = 0;
  for (const role of ROLES) {
    const layer = roleOf(layers, role);
    const patch = patches[role];
    if (!layer || !patch) continue;
    let d = 0;
    if (patch.xRatio !== undefined) d += Math.abs(patch.xRatio - layer.xRatio) / RATIO_UNIT;
    if (patch.yRatio !== undefined) d += Math.abs(patch.yRatio - layer.yRatio) / RATIO_UNIT;
    if (patch.hRatio !== undefined) d += Math.abs(patch.hRatio - layer.hRatio) / RATIO_UNIT;
    if (patch.sizeMul !== undefined) d += Math.abs(patch.sizeMul - layer.sizeMul) / SIZE_UNIT;
    if (patch.align !== undefined && patch.align !== layer.align) d += 1;
    total += Math.min(PER_LAYER_CAP, d);
  }
  return total;
}

// ---- the ladder -------------------------------------------------------------

// Each axis yields patch fragments off the *original* layers. Ordered cheapest
// visual change first, so descent reaches for a size nudge before it moves
// anything.
function axesFor(layers) {
  const head = roleOf(layers, "headline");
  const sub = roleOf(layers, "subtitle");
  const dev = roleOf(layers, "device");
  const axes = [];

  if (head) {
    axes.push([0.92, 0.84, 0.76].map((k) => ({ headline: { sizeMul: head.sizeMul * k } })));
  }
  if (sub) {
    axes.push([0.92, 0.84].map((k) => ({ subtitle: { sizeMul: sub.sizeMul * k } })));
  }
  if (dev) {
    axes.push([0.95, 0.9, 0.85].map((k) => ({ device: { hRatio: dev.hRatio * k } })));
    axes.push([-0.04, -0.02, 0.02, 0.04].map((d) => ({ device: { yRatio: dev.yRatio + d } })));
  }
  if (head) {
    // Both text layers together, so the caption band keeps its internal spacing.
    axes.push(
      [-0.04, -0.02, 0.02, 0.04].map((d) => {
        const p = { headline: { yRatio: head.yRatio + d } };
        return sub ? { ...p, subtitle: { yRatio: sub.yRatio + d } } : p;
      }),
    );
  }
  return axes;
}

/**
 * Re-stack the slide from the measured height of the text, rather than from the
 * ratios a preset guessed. This is the only composite repair, and it is
 * *computed* rather than searched — which is why it doesn't blow up the space.
 */
function restack(layers, { device, measurer }) {
  const head = roleOf(layers, "headline");
  const dev = roleOf(layers, "device");
  if (!head || !dev) return null;
  const { W, H } = canvasOf(device);
  const sub = roleOf(layers, "subtitle");

  const ink = textInkBox(head, { W, H, device, measurer });
  if (!ink.lineCount) return null;

  const patches = {};
  let bottom = ink.y + ink.h;
  let gapFrom = ink.fontSizePx;

  if (sub) {
    const subY = (bottom + 0.35 * gapFrom) / H;
    patches.subtitle = { yRatio: subY };
    const subInk = textInkBox({ ...sub, yRatio: subY }, { W, H, device, measurer });
    if (subInk.lineCount) {
      bottom = subInk.y + subInk.h;
      gapFrom = subInk.fontSizePx;
    }
  }

  const deviceY = (bottom + 0.6 * gapFrom) / H;
  patches.device = {
    yRatio: deviceY,
    // Never taller than the room left below it — a re-stack that pushes the
    // device off the bottom has traded one fault for another.
    hRatio: Math.min(dev.hRatio, Math.max(0.05, 1 - deviceY - 0.01)),
  };
  return patches;
}

// The smallest shift that brings [start, start+len] inside [lo, lo+room]: 0 when
// it already is, and 0 when it cannot fit at all. `slack` is the overshoot the
// safe-area check forgives at EACH end (TOL of the canvas): a block taller than
// the room by up to twice that, centred, overshoots each end by no more than the
// check allows (N902) — one 25 px too tall stayed a blocking fault because it
// "didn't fit", and block heights step ~171 px so a one-slack band is never hit.
const shiftInto = (start, len, lo, room, slack = 0) => {
  if (len > room) {
    if (len > room + 2 * slack) return 0;
    const over = Math.max(lo - start, start + len - (lo + room));
    return over > slack ? lo + (room - len) / 2 - start : 0;
  }
  if (start < lo) return lo - start;
  if (start + len > lo + room) return lo + room - (start + len);
  return 0;
};

const unionOf = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x, y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
};

// The role captions' ink boxes, measured the way the scorer measures them.
function captionBoxes(layers, ctx) {
  const captions = layers.filter((l) => l.role === "headline" || l.role === "subtitle");
  const byId = new Map(captions.map((l) => [l.id, l]));
  return boxesFor(captions, ctx).map((b) => ({ ...b, layer: byId.get(b.id) }));
}

// Moves `boxes` (one block) by the minimal shift that brings their union into the
// safe band — the band scoreLayout grades against: the safe-area insets, or the
// canvas. Null when nothing is outside it, or the block is too big for it.
function shiftBlock(boxes, { device, safeArea }) {
  if (!boxes.length) return null;
  const { W, H } = canvasOf(device);
  const u = unionOf(boxes);
  const left = safeArea?.leftPx ?? 0;
  const top = safeArea?.topPx ?? 0;
  const dx = shiftInto(u.x, u.w, left, W - left - (safeArea?.rightPx ?? 0), TOL * W);
  const dy = shiftInto(u.y, u.h, top, H - top - (safeArea?.bottomPx ?? 0), TOL * H);
  if (!dx && !dy) return null;
  const patches = {};
  for (const { layer } of boxes) {
    patches[layer.role] = {
      ...(dx ? { xRatio: layer.xRatio + dx / W } : {}),
      ...(dy ? { yRatio: layer.yRatio + dy / H } : {}),
    };
  }
  return patches;
}

/**
 * Moves the headline and its line, as one block, just far enough that their ink
 * is inside the safe band. The ladder's only vertical move is 0.02-0.04, which is
 * 33-66 px on a 1646 px App Store header, so a caption a few hundred px outside
 * Apple's art safe box was out of its reach and the descent shrank the headline
 * instead, leaving it still outside (N890). The block moves together so a
 * following subtitle keeps its gap, as the ladder's y axis does.
 *
 * Returns `{ headline?, subtitle? }` patches of xRatio/yRatio, or null when no
 * caption is outside the band or the block does not fit it (see
 * `captionsEachIntoBand`).
 */
export function captionIntoBand(layers, ctx) {
  return shiftBlock(captionBoxes(layers, ctx), ctx);
}

// Each caption alone, for a pair taller or wider than the band. The text-on-text
// wall in `evaluate` rejects the ones that land on the other caption.
export function captionsEachIntoBand(layers, ctx) {
  const boxes = captionBoxes(layers, ctx);
  return boxes.length < 2 ? [] : boxes.map((b) => shiftBlock([b], ctx)).filter(Boolean);
}

function presetPatches(layers, orientation, kind) {
  const out = [];
  for (const preset of PRESETS) {
    const g = presetGeometryFor(preset, orientation, kind);
    const patches = {};
    for (const role of ROLES) {
      const layer = roleOf(layers, role);
      if (!layer || !g[role]) continue;
      patches[role] =
        layer.type === "text" ? { ...g[role], align: preset.textAlign } : { ...g[role] };
    }
    if (Object.keys(patches).length) out.push(patches);
  }
  return out;
}

// ---- the search -------------------------------------------------------------

/**
 * @returns {{
 *   applied: boolean, reason: string|null, before: number, after: number,
 *   patches: Record<string, object>, keys: string[], fixed: string[]
 * }}
 */
export function polishLayout({ layers, device, frame, safeArea = null, measurer = null, orientation = "portrait", span = null, repaired = false }) {
  const ctx = { device, frame, safeArea, measurer };
  const score = (patches) =>
    scoreLayout({
      layers: materialise(layers, patches),
      device,
      frame,
      safeArea,
      measurer,
      span,
    });

  const baseline = score({});
  const empty = { patches: {}, keys: [], fixed: [], codes: baseline.faults.map((f) => f.code), before: baseline.penalty, after: baseline.penalty };

  if (!Number.isFinite(baseline.penalty)) {
    return { ...empty, applied: false, reason: "no-frame" };
  }
  // The cheap exit, and the common one: a clean slide costs exactly one score
  // and never generates a candidate.
  if (baseline.penalty === 0) return { ...empty, applied: false, reason: "clean" };

  // The store floor is a wall, not a cost. A candidate that puts a layer under
  // it is not a worse repair to be outranked — it is a deck that cannot be read
  // in a search result, which is the thing the deck exists for. Rejecting rather
  // than penalising is also what keeps SMALL_TEXT unweighted (see layoutScore.js):
  // the search cannot reach for it, so it never has to be priced.
  //
  // Only newly-introduced ones. A slide already under the floor is a copy problem
  // this cannot fix, and refusing to move anything on it would trade a repairable
  // overlap for an unrepairable size.
  const alreadySmall = new Set(
    baseline.faults.filter((f) => f.code === FAULTS.SMALL_TEXT).map((f) => f.layerId),
  );
  let clamped = false;

  // Text on text is a wall too (N803). A preset one-shot sized for a two-line
  // headline can win round 0 by clearing a device that was off the canvas while
  // a five-line CJK headline lands on its subtitle anchor; later rounds could
  // shrink it but never clear it, so Polish wrote an overlap the slide did not
  // have. captionFlow.js holds the rule: the line may reach the device, never
  // the other caption. Only pairs the slide did not already have, so a slide
  // that starts with the fault can still be repaired. `clamped` stays false:
  // this is about placement, not size, and must not read as copy-too-long.
  // Keyed by the sorted pair: scoreLayout files it from whichever end is first.
  const captionIds = new Set(
    layers.filter((l) => l.role === "headline" || l.role === "subtitle").map((l) => l.id),
  );
  const textOnText = (faults) =>
    faults
      .filter((f) => f.code === FAULTS.OVERLAP && captionIds.has(f.layerId) && captionIds.has(f.detail?.otherId))
      .map((f) => [f.layerId, f.detail.otherId].sort().join("|"));
  const hadTextOnText = new Set(textOnText(baseline.faults));

  const evaluate = (patches) => {
    const r = score(patches);
    if (r.faults.some((f) => f.code === FAULTS.SMALL_TEXT && !alreadySmall.has(f.layerId))) {
      clamped = true;
      return null;
    }
    if (textOnText(r.faults).some((k) => !hadTextOnText.has(k))) return null;
    return {
      patches,
      penalty: r.penalty,
      faults: r.faults,
      rank: r.penalty + EDIT_COST * editDistance(layers, patches),
    };
  };

  let best = { patches: {}, penalty: baseline.penalty, faults: baseline.faults, rank: baseline.penalty };
  const axes = axesFor(layers);

  for (let pass = 0; pass < 2; pass++) {
    for (const variants of axes) {
      let winner = null;
      for (const fragment of variants) {
        let candidate = best.patches;
        for (const [role, extra] of Object.entries(fragment)) {
          candidate = mergePatch(candidate, role, extra);
        }
        const r = evaluate(candidate);
        if (r && r.rank < (winner?.rank ?? best.rank)) winner = r;
      }
      if (winner) best = winner;
    }
  }

  // One-shots are measured against the slide as it is, not against whatever
  // descent has already accumulated — they are alternatives to it, not
  // refinements of it. Presets come last so a tie goes to the local repair.
  // A device's `category` is the same vocabulary as a slide's kind, so it is
  // what tells the presets a landscape phone from a TV.
  // The moves into the band come first, so a tie goes to the move.
  const oneShots = [
    captionIntoBand(layers, ctx),
    ...captionsEachIntoBand(layers, ctx),
    restack(layers, ctx),
    ...presetPatches(layers, orientation, device.category),
  ].filter(Boolean);
  for (const patches of oneShots) {
    const r = evaluate(patches);
    if (r && r.rank < best.rank) best = r;
  }

  // A caption outside the safe band is the one fault whose repair can be worth
  // less than the margin and still be the only thing wrong: a 41 px breach scores
  // ~18, yet check blocks on it. So clearing it is applied below the margin; every
  // other fault (overlap, tight margin) stays under it on purpose (N774).
  const clearsSafeArea =
    baseline.faults.some((f) => f.code === FAULTS.SAFE_AREA) &&
    !best.faults.some((f) => f.code === FAULTS.SAFE_AREA) &&
    best.penalty < baseline.penalty &&
    !hurts(baseline, best);
  const applied = best.penalty <= baseline.penalty - APPLY_MARGIN || clearsSafeArea;
  if (!applied) {
    // Saying *why* nothing was applied is the whole value here. "no-better"
    // reads as "the slide is fine"; it isn't — the only fix left was to shrink
    // the type out of the store, and the honest answer is that the copy is too
    // long for the space, which is a thing a person can act on.
    //
    // Only when the slide was bad enough to be worth a repair. Under the margin
    // nothing can be applied whatever the copy is, so a clamped candidate says
    // nothing about the copy: a three-word headline whose iPad overlap cost 21
    // answered "copy too long" because the shrinks it tried were refused (N774).
    //
    // `repaired` is a slide a search has already moved: the remainder of a
    // partial repair can sit under the margin while the copy is still too long,
    // and the margin guard would lose the verdict (N778).
    const tooLong = clamped && (repaired || baseline.penalty >= APPLY_MARGIN) && overflowing(baseline.faults, layers);
    return { ...empty, applied: false, reason: tooLong ? "copy-too-long" : "no-better" };
  }

  const had = new Set(baseline.faults.map((f) => f.code));
  const left = new Set(best.faults.map((f) => f.code));
  const keys = new Set();
  for (const patch of Object.values(best.patches)) {
    for (const k of Object.keys(patch)) keys.add(k);
  }

  return {
    applied: true,
    reason: null,
    before: baseline.penalty,
    after: best.penalty,
    codes: [...had],
    patches: best.patches,
    // Only the keys Polish actually wrote, so clearing per-device overrides can
    // be narrowed to them rather than wiping every geometry key a card had.
    keys: [...keys],
    fixed: [...had].filter((c) => !left.has(c)),
  };
}

/**
 * polishLayout repeated until a round has nothing to write — what one editor
 * click does, so that a second click on the written slide finds nothing to do.
 *
 * Every step of a search is relative to the layers it starts from, so one search
 * reaches one ladder (a headline down to x0.76) and the next click, starting
 * from the written size, reached further; a headline set to x3 took three clicks
 * to arrive at its smallest size. polishDeck loops for the same reason, so the
 * CLI was at its fixed point and the editor was not (layout.md, N208/N209). This
 * deliberately composes ladders, which the header comment rules out only within
 * one search.
 *
 * No round cap: each applied round lowers a finite penalty by at least
 * APPLY_MARGIN, so the loop ends, and a cap would bring back a click that stops
 * short of where the next one goes. `fixed` is judged first-round against last:
 * a code round one introduced and round two cleared was never the user's, and a
 * code still present at the end was not fixed.
 */
export function polishToRest(args) {
  const first = polishLayout(args);
  if (!first.applied) return first;
  let patches = first.patches;
  let after = first.after;
  const keys = new Set(first.keys);
  let rest;
  for (;;) {
    rest = polishLayout({ ...args, layers: materialise(args.layers, patches), repaired: true });
    if (!rest.applied) break;
    for (const [role, extra] of Object.entries(rest.patches)) patches = mergePatch(patches, role, extra);
    for (const k of rest.keys) keys.add(k);
    after = rest.after;
  }
  return {
    ...first,
    after,
    patches,
    keys: [...keys],
    fixed: first.codes.filter((c) => !rest.codes.includes(c)),
  };
}

const faultKey = (f) => `${f.code}|${f.layerId}|${f.detail?.otherId ?? ""}`;

// A write that leaves a canvas worse is not a repair for that canvas: a higher
// penalty, or a blocking fault it did not have before. The second half is what a
// penalty alone misses — a card at 300 that comes out at 77 is a net gain with a
// new overlap in it, and that overlap is the write's doing.
function hurts(before, after) {
  if (after.penalty > before.penalty + 1e-9) return true;
  const had = new Set(before.faults.map(faultKey));
  return after.faults.some((f) => FAULT_SEVERITY[f.code] !== "warn" && !had.has(faultKey(f)));
}

/**
 * One write that reaches several canvases (All devices, a kind, a scene),
 * judged on every canvas that draws the slide, each as it draws it. polishToRest
 * on one canvas writes a placement computed from that canvas's own ink, and the
 * write is shared, so the others were never measured: an iPad's subtitle that
 * had followed its own taller headline came out of a phone's repair on top of
 * its device, and a second click asked the phone again and said "nothing to fix".
 *
 * `canvases[i]` is `{ id, args, layersAfter(result) }`: `args` is what
 * polishToRest takes, `layersAfter` that canvas's layers after a shared write of
 * `result`, and `canvases[0]` is the one the user is on. Each canvas's own
 * answer is a candidate for the shared write; one that hurts any other canvas is
 * out, and the lowest total penalty of the rest wins (ties to canvas order, so
 * the focused canvas's answer wins when it suits). Whatever the shared write
 * leaves, or all of it when no single write suits, each canvas then repairs on
 * its own card — what polishDeck does per cell and "This card" does, so no
 * canvas is sacrificed for another.
 *
 * With one canvas this is polishToRest.
 */
export function polishAcross(canvases) {
  const before = canvases.map((c) => scoreLayout(c.args));
  const solo = canvases.map((c) => polishToRest(c.args));

  let shared = null;
  let sharedTotal = Infinity;
  solo.forEach((candidate, author) => {
    if (!candidate.applied) return;
    let total = 0;
    for (let i = 0; i < canvases.length; i++) {
      const after = scoreLayout({ ...canvases[i].args, layers: canvases[i].layersAfter(candidate) });
      if (i !== author && hurts(before[i], after)) return;
      total += after.penalty;
    }
    if (total < sharedTotal) {
      shared = candidate;
      sharedTotal = total;
    }
  });

  const own = [];
  const fixed = new Set();
  let refusal = null;
  canvases.forEach((c, i) => {
    const layers = shared ? c.layersAfter(shared) : c.args.layers;
    const rest = polishToRest({ ...c.args, layers });
    const start = shared ? scoreLayout({ ...c.args, layers }).faults.map((f) => f.code) : before[i].faults.map((f) => f.code);
    if (rest.applied) own.push({ deviceId: c.id, patches: rest.patches, keys: rest.keys });
    else if (!refusal && rest.reason !== "clean") refusal = { reason: rest.reason, deviceId: c.id, codes: rest.codes };
    const end = rest.applied ? start.filter((code) => !rest.fixed.includes(code)) : start;
    for (const code of before[i].faults.map((f) => f.code)) if (!end.includes(code)) fixed.add(code);
  });

  const applied = Boolean(shared) || own.length > 0;
  return {
    applied,
    reason: applied ? null : refusal?.reason ?? "clean",
    deviceId: applied ? null : refusal?.deviceId ?? null,
    shared,
    own,
    fixed: [...fixed],
    codes: refusal?.codes ?? [],
  };
}

// Fitting a translation. Layout is shared across languages — where the device
// sits belongs to the design, not to the words — so this searches the one axis a
// language may own: size. It is the reason the locale axis is usable at all.
// German runs about 30% longer than English, so a caption tuned on the source
// overflows once translated, and polishLayout above cannot help: it writes
// position and device height, which every language shares.
//
// One multiplier for both text layers, not one each: the caption is a band, and
// shrinking the headline alone re-weights a design somebody already balanced.
const FIT_STEPS = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58];

// Text the bundled families cannot measure. The estimator behind a null measurer
// scores every non-ASCII character at the same advance as a Latin letter, but a
// CJK ideograph is nearly twice that — so on an unloaded face it would report a
// comfortable fit for a line that overflows. Refusing is the honest answer.
export const NON_LATIN =
  /[^\p{Script_Extensions=Latin}\p{Script_Extensions=Common}\p{Script_Extensions=Inherited}]/u;

/**
 * The one multiplier that best fits this slide's text, or a reason there isn't
 * one. Shrinking only — growing text is a design decision, not a fit.
 *
 * `{ scale, before, after, fitted }` when it found something better, else
 * `{ scale: null, reason }`. The caller decides where the write lands: the
 * editor routes it through updateLayer into the locale map, the CLI writes
 * layersByLocale directly. Both write `sizeMul`, which is localizable — the
 * geometry keys polishLayout writes are not, which is exactly why this is a
 * separate search.
 *
 * It writes only size, but a translation's caption and device positions are
 * derived from its sizes (give-way, reflow). `relayout(mul)` returns the cell's
 * layers re-resolved at that size, so each candidate is scored where the host
 * would draw it; without it the candidate is the frozen layers with sizeMul
 * scaled, which reports a device the smaller size would no longer push off.
 */
export function fitTextScale({ layers, device, frame, safeArea = null, measurer = null, span = null, relayout = null }) {
  const none = (reason, extra = null) => ({ scale: null, reason, ...extra });
  const text = layers.filter((l) => l.type === "text" && l.text);
  if (!text.length) return none("no-text");
  if (text.some((l) => NON_LATIN.test(l.text) && !(measurer && measurer(l)))) {
    return none("cannot-measure");
  }

  const scaled = (mul) =>
    mul === 1 ? layers
      : relayout ? relayout(mul)
      : layers.map((l) => (l.type === "text" ? { ...l, sizeMul: l.sizeMul * mul } : l));
  const scoreAt = (mul) =>
    scoreLayout({ layers: scaled(mul), device, frame, safeArea, measurer, span });

  const base = scoreAt(1);
  const before = base.penalty;
  if (!Number.isFinite(before)) return none("no-frame");
  if (before === 0) return none("clean");

  // Only a fault the text has a hand in is this search's to fix, or to call a
  // copy problem. A fault on a text layer is. One on another layer is only when
  // the size moves it — a long caption that gives way pushes the device off the
  // canvas, and shrinking it pulls the device back. A device the user cropped by
  // hand is cropped the same at every size: ordinary work, not a copy problem,
  // and it answered "copy too long" before, for a headline of three words.
  const textIds = new Set(text.map((l) => l.id));
  const textFaults = base.faults.filter((f) => textIds.has(f.layerId));
  const otherOverflow = (r) =>
    JSON.stringify(
      r.faults
        .filter((f) => OVERFLOW_FAULTS.has(f.code) && !textIds.has(f.layerId))
        .map((f) => [f.code, f.layerId, Math.round((f.detail?.fraction ?? 0) * 1e4)]),
    );
  const otherAtBase = otherOverflow(base);
  let sizeMovesOther = false;

  // Same wall as polishLayout's, and it matters more here: this is the ladder
  // that reaches 0.58 in one step, applied to every text layer on the slide at
  // once, which is how a German subtitle ends up half the size of its English
  // original with `check` reporting the cell clean.
  const alreadySmall = new Set(
    base.faults.filter((f) => f.code === FAULTS.SMALL_TEXT).map((f) => f.layerId),
  );
  const newlySmall = (r) =>
    r.faults.filter((f) => f.code === FAULTS.SMALL_TEXT && !alreadySmall.has(f.layerId));

  let best = null;
  // Which layers the floor stopped. One multiplier covers the whole caption, so
  // the layer that *binds* is routinely not the one that overflows — a subtitle
  // sitting near the floor pins a headline that had room to shrink. Naming it is
  // the difference between "copy too long" and "shorten this string".
  const blockedBy = new Set();
  let clamped = false;
  for (const mul of FIT_STEPS) {
    const r = scoreAt(mul);
    if (otherOverflow(r) !== otherAtBase) sizeMovesOther = true;
    const small = newlySmall(r);
    if (small.length) {
      clamped = true;
      for (const f of small) blockedBy.add(f.layerId);
      continue;
    }
    const left = r.faults.filter((f) => textIds.has(f.layerId)).length + (otherOverflow(r) !== otherAtBase ? 1 : 0);
    if (r.penalty === 0) { best = { mul, penalty: r.penalty, left }; break; }
    if (!best || r.penalty < best.penalty) best = { mul, penalty: r.penalty, left };
  }

  // Shrinking further was the only move left and the floor stops it. Declining
  // is the point: half a shrink leaves a cell that still faults *and* is harder
  // to read, and the fix — a shorter string in this language — is one only a
  // person can make. Consistent with the rule the whole repair rests on, that a
  // cell still faulting after a real repair is a copy problem.
  // `before` rides along on a fit so a shared size chosen for the other devices
  // is judged against what this one already was.
  if (!textFaults.length && !sizeMovesOther) return none("clean", { before });
  // A rung that clears every fault on the text layers is a fit even when a fault
  // the size does not move is left (a hand-cropped device): that is ordinary
  // work, and the floor stopping the rungs below it says nothing about the copy.
  // Only a rung still faulting on text, or one the size still moves a fault on, is
  // a copy problem (N791). "Cleared" needs a rung below 1: the unchanged cell is
  // not a fit.
  if (clamped && best?.penalty !== 0 && !(best && best.mul !== 1 && best.left === 0) && (overflowing(textFaults, layers) || sizeMovesOther)) {
    return none("copy-too-long", { blockedBy: [...blockedBy] });
  }
  if (!best || best.mul === 1 || best.penalty >= before) return none("no-better");

  return { scale: best.mul, before, after: best.penalty, fitted: best.left === 0, reason: null };
}

/**
 * fitTextScale repeated until a round has nothing to write — what one editor
 * click does. The ladder stops at x0.58 of the size it starts from, so copy that
 * needs more took a second click starting a new ladder from the written size,
 * and a third (layout.md, N745 made the same call for Polish). `relayout` is
 * required: each round is scored at the product of the scales so far, which
 * `localeTextScaled` takes for any multiplier.
 *
 * No round cap: each applied round shrinks by at least x0.94 and strictly lowers
 * the penalty, so the store floor or TINY_TEXT ends it. `fitted` is also true
 * when the last round found only a fault the size no longer moves (`clean`), so
 * the report matches what the next click would say.
 */
export function fitTextToRest(args) {
  const first = fitTextScale(args);
  if (!first.scale) return first;
  let scale = first.scale;
  let last = first;
  let rest;
  for (;;) {
    const at = scale;
    rest = fitTextScale({ ...args, layers: args.relayout(at), relayout: (m) => args.relayout(at * m) });
    if (!rest.scale) break;
    scale *= rest.scale;
    last = rest;
  }
  return { ...first, scale, after: last.after, fitted: last.fitted || rest.reason === "clean" };
}
