// Grading a whole deck, and repairing what the grade says is wrong.
//
// This is the half of the CLI that makes "let something else design it" a safe
// idea rather than a hopeful one. Anything can write a deck; what stops a bad
// one shipping is that every cell is measured — src/layoutScore.js for the
// layout, src/contrast.js for the colours — and that the repair is the editor's
// own, not a second opinion invented here.
//
// Two repairs, because a deck has two kinds of problem and only one of them is
// geometric:
//
//   * **Geometry** is shared across languages — where the device sits belongs to
//     the design, not to the words — so polishLayout runs once per (slide,
//     device) at the base locale and writes to `layersByDevice`.
//   * **A translation that overflows** can only own its size: `sizeMul` is
//     localizable and xRatio/yRatio/hRatio are not. fitTextScale searches that
//     one axis, re-resolving the language's give-way at each size, and writes
//     to `layersByLocale`.
//
// A cell still faulting after both is a copy problem, and the honest thing is to
// say so rather than to shrink type until it disappears.
//
// Two graders sit *beside* the cells rather than inside them, for the same
// reason contrast sits beside the layout penalty — they measure something else,
// and neither is something a geometric repair may act on:
//
//   * **Store fit** (src/storeFit.js) is a property of a canvas and of how many
//     images a row holds. A canvas is refused once, not once per locale.
//   * **Copy** (src/storeCopy.js) is a property of the words, which do not vary
//     by device. Warnings by default; `strict` makes them count.
import { currentDeviceId, resolveDevice } from "./devices.js";
import { deckCells, localeTextScaled, needsDeviceLayer, resolveLayers, withDefaults, withSlideStacks } from "./deck.js";
import { FAULTS, FAULT_HINT, FAULT_SEVERITY, boxesFor, canvasOf, scoreLayout } from "./layoutScore.js";
import { fitTextScale, polishLayout } from "./layoutPolish.js";
import { estimatingMeasurer, textInkBox } from "./textMetrics.js";
import { CONTRAST_HINT, backgroundColorsAt, contrastFaults, relativeLuminance, toHex } from "./contrast.js";
import { thumbnailScale } from "./thumbnail.js";
import { storeFaults } from "./storeFit.js";
import { COPY_LANGUAGE, COPY_LANGUAGE_NOTE, copyFaults } from "./storeCopy.js";
import { frameMeta } from "./template.js";
import { captionText, usesFrame } from "./layers.js";
import { safeAreaApplies } from "./safeArea.js";

// A retired id is graded as its replacement, under the replacement's id: that is
// the key the editor moved its per-device overrides to.
export const deviceRecords = (ids) =>
  [...new Set(ids.map(currentDeviceId))].map((id) => ({ id, ...resolveDevice(id) }));

// Which devices a deck renders on, filtered by an optional CLI selection.
export function devicesFor(deck, only = null) {
  const ids = only?.length ? only : deck.projectDevices ?? [];
  if (!ids.length) throw new Error("no devices: the deck has no projectDevices and none were given");
  return deviceRecords(ids);
}

const frameFor = (cell) => {
  const name = cell.frameOverride ?? cell.device.frame;
  return usesFrame(cell.layers) ? frameMeta(name) : null;
};

// Scripts that break between characters rather than at spaces: a one-"word"
// last line there is just the last few glyphs.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

// A caption that wraps onto a single word ("Habits that / stick"). A line the
// author ended with a newline is theirs to keep, so only a wrap counts.
function orphanFaults(layers, { device, measurer }) {
  const { W, H } = canvasOf(device);
  return layers
    .filter((l) => l.type === "text" && l.opacity !== 0 && (l.role === "headline" || l.role === "subtitle"))
    .filter((l) => !UNSPACED.test(captionText(l)))
    .filter((l) => {
      const { lines = [] } = textInkBox(l, { W, H, device, measurer });
      const last = lines.at(-1)?.trim() ?? "";
      const ownLine = captionText(l).split("\n").at(-1).trim();
      return lines.length > 1 && last && !/\s/.test(last) && ownLine.includes(" ");
    })
    .map((l) => ({ code: FAULTS.ORPHAN, layerId: l.id, detail: null }));
}

// Near-neutral and at either end of the scale: Play's white and dark surfaces.
// A tinted ground (navy, cream) passes; a gradient fails only if all of it is dull.
const dull = (c) => {
  const l = relativeLuminance(c);
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 24 && (l <= 0.07 || l >= 0.8);
};

function featureGraphicFaults(cell) {
  if (cell.device.category !== "feature-graphic") return [];
  const shown = cell.layers.filter((l) => l.opacity !== 0);
  const device = shown.find((l) => l.type === "device");
  const words = shown.some((l) => l.type === "text" && l.text?.trim());
  const ground = backgroundColorsAt(cell.background);
  return [
    ...(device ? [{ code: FAULTS.FG_DEVICE, layerId: device.id }] : []),
    ...(!words && shown.some((l) => l.type === "image") ? [{ code: FAULTS.FG_NO_TEXT }] : []),
    ...(ground.length && ground.every(dull) ? [{ code: FAULTS.FG_DULL_GROUND, detail: { color: toHex(ground[0]) } }] : []),
  ];
}

/**
 * Every cell of a deck, graded. `penalty` is the layout penalty — 0 is clean and
 * larger is worse — and `faults` merges the layout and contrast lists, which are
 * shaped the same on purpose.
 *
 * Contrast is reported beside the penalty rather than folded into it: the two
 * measure different things, and a colour is not something a geometric repair may
 * touch.
 *
 * `estimated` on a cell means its text was sized by the glyph estimator rather
 * than a real face — see src/measure.js. A penalty of 0 means something weaker
 * on such a cell, and saying so is the difference between a gate and a guess.
 * `ext` only names the files: it has to match what `render` will write, or a
 * caller cannot match a fault to the image it is about. Without it the deck's own
 * export format names them, which is what `render` writes absent a flag.
 */
export function checkDeck(
  deck,
  { devices, locales = null, measurer = null, ext, strict = false, storeCheck = null } = {},
) {
  const defaults = withDefaults(deck.defaults);
  // Position in the deck's own array, the `screenshots[i]` validate reports:
  // not the export order, and counting slides that are not selected.
  const indexOf = new Map(deck.screenshots.map((s, i) => [s.id, i]));
  // Every fault leaves here with a severity and a hint, so a caller reading the
  // JSON never has to know that a bare fault means block.
  const graded = (f) => ({
    code: f.code,
    severity: f.severity ?? FAULT_SEVERITY[f.code] ?? "block",
    layerId: f.layerId ?? null,
    detail: f.detail ?? null,
    hint: FAULT_HINT[f.code] ?? CONTRAST_HINT[f.code] ?? null,
  });
  const cells = deckCells(deck, { devices, locales, ext }).map((cell) => {
    const frame = frameFor(cell);
    const score = scoreLayout({
      layers: cell.layers,
      device: cell.device,
      frame,
      safeArea: safeAreaApplies(defaults.safeAreaEnabled, cell.device) ? cell.safeArea : null,
      measurer,
      span: cell.span,
    });
    // The same boxes the scorer used, so contrast is judged where the ink
    // actually is rather than against every colour the background mentions.
    const boxes = boxesFor(cell.layers, { device: cell.device, frame, measurer });
    return {
      name: cell.name,
      slideId: cell.screenshot.id,
      slideIndex: indexOf.get(cell.screenshot.id) ?? null,
      slide: cell.slide,
      deviceId: cell.deviceId,
      locale: cell.locale,
      penalty: score.penalty,
      terms: score.terms,
      estimated: boxes.some((b) => b.estimated),
      faults: [
        ...score.faults,
        // The thumbnail scale decides which WCAG floor each layer has to clear:
        // a headline is large text where the listing is met, a subtitle is not.
        ...contrastFaults(cell.layers, cell.background, {
          boxes,
          canvas: canvasOf(cell.device),
          thumbScale: thumbnailScale(cell.device),
          span: cell.span,
          unverified: true,
        }),
        // A phone slide with its device deleted is often a slip, sometimes a
        // choice — so it is one to review, not one that fails the deck. The
        // feature graphic needs no device at all.
        ...(needsDeviceLayer(cell.device.category ?? cell.device.kind) && !cell.layers.some((l) => l.type === "device")
          ? [{ code: FAULTS.NO_DEVICE, layerId: null, detail: null }]
          : []),
        ...orphanFaults(cell.layers, { device: cell.device, measurer }),
        ...featureGraphicFaults(cell),
      ].map(graded),
    };
  });

  // A deck built for a pitch or a website legitimately uses a canvas Play would
  // refuse. Off is a deck-level decision that travels with the file rather than
  // a flag someone has to remember, and it disables the whole store section —
  // the slot counts and the featuring notes are about a listing too.
  // null = whatever the deck says; a boolean = the caller overriding it, which
  // is what `check --no-store-check` is for.
  const gateStore = storeCheck == null ? defaults.storeCheck !== false : storeCheck;
  const store = gateStore ? storeFaults(deck, devices) : [];
  // The same languages the cells were limited to: a `--locale de-DE` run that
  // fails on an English claim is grading copy it was told to leave out.
  const copy = copyFaults(deck, devices).filter((f) => !locales?.length || locales.includes(f.locale));

  const blocking = (f) => (strict ? true : f.severity === "block");
  const cellBlocking = (f) => strict || f.severity === "block";
  const worst = cells.reduce((m, c) => (c.penalty > m ? c.penalty : m), 0);
  return {
    cells,
    worst,
    total: cells.reduce((n, c) => n + (Number.isFinite(c.penalty) ? c.penalty : 0), 0),
    store: { checked: gateStore, faults: store },
    copy: { faults: copy, language: COPY_LANGUAGE, note: COPY_LANGUAGE_NOTE },
    strict,
    // A clean deck is one where nothing is measurably wrong — including the
    // colours, which carry no penalty of their own and so cannot show up in
    // `worst`, and including the things the store refuses about the file rather
    // than about the design. A warning does not make a deck dirty unless the
    // caller asked for that with `strict`: certain false positives that fail a
    // build are how a gate gets switched off.
    // A deck with nothing to render has nothing to be clean about.
    clean:
      cells.length > 0 &&
      cells.every((c) => (strict ? c.penalty === 0 : Number.isFinite(c.penalty)) && !c.faults.some(cellBlocking)) &&
      !store.some(blocking) &&
      !copy.some(blocking),
    // Not folded into `clean`: an estimated cell is not a fault, it is a
    // weaker claim about one. The caller decides whether that is good enough.
    estimated: cells.some((c) => c.estimated),
  };
}

const patchLayer = (map, key, layerId, patch) => ({
  ...map,
  [key]: { ...(map?.[key] ?? {}), [layerId]: { ...(map?.[key]?.[layerId] ?? {}), ...patch } },
});

const round4 = (n) => Number(n.toFixed(4));

/**
 * Repair what can be repaired, and report the rest.
 *
 * Pure: returns a new deck rather than editing the one it was given, so a caller
 * can show the diff before writing it back.
 *
 * A base repair is shared by every language, and where a translation ends up
 * depends on what the language fit then does with it (one size for all of the
 * language's devices). So whether a card's base repair hurts its translations
 * is only known from the finished polish: each repair taken is tried withheld,
 * and kept only if no translation on its card ends worse with it than without.
 * The base repair search scores the base alone, which is how an iPad headline
 * size that cleared the base left a translation further off the canvas.
 */
export function polishDeck(deck, options = {}) {
  // A translation's size is stored as an absolute number, and a cell polish
  // refused is searched again from that number: the ladder composes (x0.88 of
  // x0.76) and reaches sizes the first ladder stepped over, and a base repair the
  // guard withheld is judged against translations that are by now pinned. So a
  // second run fitted what the first refused. Polish runs to its own fixed point
  // instead, which makes the file it writes the one a re-run leaves alone.
  const written = new Map();
  let current = deck;
  let result;
  for (let round = 0; round < MAX_POLISH_ROUNDS; round++) {
    result = polishRound(current, options);
    for (const c of result.changes) {
      if (c.kind !== "layout" && c.kind !== "locale-fit") continue;
      const key = [c.kind, c.slideId, c.deviceId, c.locale ?? ""].join("\0");
      const earlier = written.get(key);
      written.set(key, !earlier ? c : { ...c, before: earlier.before, ...(c.kind === "locale-fit" ? { scale: round4(earlier.scale * c.scale) } : {}) });
    }
    if (JSON.stringify(result.deck.screenshots) === JSON.stringify(current.screenshots)) break;
    current = result.deck;
  }
  // A cell a round repaired already carries its own line (with the penalty it was
  // left at); the round after it saying "nothing better" about the same cell
  // would only repeat that.
  const touched = new Set([...written.values()].map((c) => [c.slideId, c.deviceId, c.locale ?? ""].join("\0")));
  const diagnostics = result.changes.filter(
    (c) => c.kind !== "layout" && c.kind !== "locale-fit" && !(c.kind === "no-better" && touched.has([c.slideId, c.deviceId, c.locale ?? ""].join("\0"))),
  );
  // The slide's place in the deck's array, as check reports it. A name is
  // what a person reads; the id and index are what say which slide it was.
  const indexOf = new Map(deck.screenshots.map((s, i) => [s.id, i]));
  return {
    deck: result.deck,
    changes: [...written.values(), ...diagnostics].map((c) => ({ ...c, slideIndex: indexOf.get(c.slideId) ?? null })),
  };
}

const MAX_POLISH_ROUNDS = 6;

function polishRound(deck, options) {
  const { devices, locales = null, measurer = null } = options;
  const defaults = withDefaults(deck.defaults);
  const skip = new Set();
  let run = polishPass(deck, { ...options, skip });
  if (!measurer) return { deck: run.deck, changes: run.changes };
  const others = (locales ?? defaults.locales).filter((l) => l !== defaults.baseLocale);
  if (!others.length) return { deck: run.deck, changes: run.changes };
  const stackDevices = deck.projectDevices?.length ? devicesFor(deck) : devices;
  const ends = (result) => {
    const shots = result.deck.screenshots.map((s) => withSlideStacks(result.deck, s, { devices: stackDevices, measurer }));
    const out = new Map();
    for (const c of deckCells({ ...result.deck, screenshots: shots }, { devices, locales: others })) {
      const { penalty } = scoreLayout({
        layers: c.layers,
        device: c.device,
        frame: frameFor(c),
        safeArea: safeAreaApplies(defaults.safeAreaEnabled, c.device) ? c.safeArea : null,
        measurer,
        span: c.span,
      });
      out.set(`${c.screenshot.id}\0${c.deviceId}\0${c.locale}`, penalty);
    }
    return out;
  };
  for (const key of [...run.patched]) {
    const without = polishPass(deck, { ...options, skip: new Set([...skip, key]) });
    const [withEnds, withoutEnds] = [ends(run), ends(without)];
    const worse = [...withEnds].some(([k, penalty]) => k.startsWith(`${key}\0`) && penalty > withoutEnds.get(k) + 1e-9);
    if (!worse) continue;
    skip.add(key);
    run = without;
  }
  return { deck: run.deck, changes: run.changes };
}

function polishPass(deck, { devices, locales = null, measurer = null, skip }) {
  const defaults = withDefaults(deck.defaults);
  const patched = new Set();
  const safeAreaOf = (cell) => (safeAreaApplies(defaults.safeAreaEnabled, cell.device) ? cell.safeArea : null);
  const changes = [];
  let screenshots = deck.screenshots ?? [];
  const patch = (slideId, fn) => {
    screenshots = screenshots.map((s) => (s.id === slideId ? fn(s) : s));
  };

  // Every cell is scored the way `check` scores it: on the stacks solved for the
  // words and sizes it holds. A translation's column and each canvas's own base
  // column are stored keyed, so an edit leaves them stale, and a score that reads
  // the estimator fallback instead sees faults `check` does not (a cell polish
  // refused, clean as written; an iPad headline "repaired" for a fault it never
  // had) and repairs them again on the next run. With no browser the estimator
  // solves them, as `check --fast` does: left unsolved, every canvas is scored on
  // the phone's shared ratios and --fast "repaired" android and iPad cells for
  // faults the canvas does not have, writing per-device position overrides that
  // pinned those canvases out of the editor's caption column for good. The
  // solutions only score: the deck written is built from `screenshots`, never
  // from a solved copy, so a guessed solution is not stored.
  const stackDevices = deck.projectDevices?.length ? devicesFor(deck) : devices;
  const solved = (slide, shots) =>
    withSlideStacks({ ...deck, screenshots: shots }, slide, { devices: stackDevices, measurer: measurer ?? estimatingMeasurer });
  const solveAll = (shots) => shots.map((s) => solved(s, shots));
  const others = (locales ?? defaults.locales).filter((l) => l !== defaults.baseLocale);
  const resolveCell = (cell, slide, shots) => resolveLayers(solved(slide, shots), {
    deviceId: cell.deviceId,
    device: cell.device,
    locale: cell.locale,
    defaults,
    screenshots: shots,
  });

  // 1. Geometry, at the base locale, once per (slide, device). Every language
  //    shares it, so measuring a translation here would fit the layout to the
  //    wrong copy.
  for (const cell of deckCells({ ...deck, screenshots: solveAll(screenshots) }, { devices, locales: [defaults.baseLocale] })) {
    const frame = frameFor(cell);
    const result = polishLayout({
      layers: cell.layers,
      device: cell.device,
      frame,
      safeArea: safeAreaOf(cell),
      measurer,
      orientation: cell.orientation,
      span: cell.span,
    });
    if (!result.applied) {
      // The one refusal worth surfacing here: the search had a fix and the only
      // way to it was shrinking type out of the store (src/thumbnail.js). Saying
      // "nothing to repair" would be false — the cell still faults, and the fix
      // is a shorter string rather than a smaller one.
      if (result.reason === "copy-too-long") {
        changes.push({ kind: "copy-too-long", slide: cell.slide, slideId: cell.screenshot.id, deviceId: cell.deviceId, locale: null });
      } else if (result.reason === "no-better") {
        // Faulted, and nothing the search tried scored better. Silence here read
        // as "nothing to repair" over a cell that still fails check. Only a
        // blocking fault earns it: telling a user to fix a warning by hand (a
        // big-gap polish cannot close by design) is the N352 dead end.
        if (!result.codes.some((c) => (FAULT_SEVERITY[c] ?? "block") === "block")) continue;
        changes.push({ kind: "no-better", slide: cell.slide, slideId: cell.screenshot.id, deviceId: cell.deviceId, locale: null, before: result.before });
      }
      continue;
    }

    // Withheld by polishDeck: the translations on this card ended worse with it.
    const key = `${cell.screenshot.id}\0${cell.deviceId}`;
    if (skip.has(key)) {
      changes.push({ kind: "base-hurts", slide: cell.slide, slideId: cell.screenshot.id, deviceId: cell.deviceId, locale: null, before: result.before });
      continue;
    }
    patched.add(key);

    patch(cell.screenshot.id, (s) => {
      let byDevice = s.layersByDevice;
      for (const [role, p] of Object.entries(result.patches)) {
        const layer = s.layers.find((l) => l.role === role);
        if (layer) byDevice = patchLayer(byDevice, cell.deviceId, layer.id, p);
      }
      return { ...s, layersByDevice: byDevice };
    });
    changes.push({
      kind: "layout",
      slide: cell.slide,
      slideId: cell.screenshot.id,
      deviceId: cell.deviceId,
      before: result.before,
      after: result.after,
      fixed: result.fixed,
      keys: result.keys,
    });
  }

  // 2. Translations, on the geometry step 1 just settled. One multiplier for the
  //    whole caption: shrinking the headline alone re-weights a band somebody
  //    already balanced.
  if (others.length) {
    const settled = solveAll(screenshots);
    // A language's size is one number for the slide, not one per device:
    // `sizeMul` lives in layersByLocale[locale], which every device reads. Each
    // device's own fit used to be written in turn and the last one won, so the
    // report said "android x0.82, fitted" while the file carried the iPad's
    // x0.88 and `check` faulted the android cell. So the cells of one
    // (slide, language) are fitted separately, then settled on one scale that
    // all of them are scored at.
    const groups = new Map();
    for (const cell of deckCells({ ...deck, screenshots: settled }, { devices, locales: others })) {
      const key = `${cell.screenshot.id}\0${cell.locale}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cell);
    }
    for (const cells of groups.values()) {
      const members = cells.map((cell) => {
        const frame = frameFor(cell);
        const resolveAt = (slide) => resolveCell(cell, slide, settled);
        const relayout = (mul) => resolveAt(localeTextScaled(cell.screenshot, cell.locale, cell.layers, mul));
        // The stored value is an absolute size, not a ratio, and a device's
        // layers may start from different sizes (a polished android card), so
        // the shared value is scored as the absolute sizes every device reads.
        const relayoutAbs = (sizes) => {
          const byLocale = { ...cell.screenshot.layersByLocale?.[cell.locale] };
          for (const [id, sizeMul] of Object.entries(sizes)) byLocale[id] = { ...byLocale[id], sizeMul };
          return resolveAt({ ...cell.screenshot, layersByLocale: { ...cell.screenshot.layersByLocale, [cell.locale]: byLocale } });
        };
        const args = { layers: cell.layers, device: cell.device, frame, safeArea: safeAreaOf(cell), measurer, span: cell.span };
        return { cell, relayout, relayoutAbs, args, fit: fitTextScale({ ...args, relayout }) };
      });

      // `written` is the size another device of the group fitted, when there is
      // one: a device that refused on its own may be clean at that size, and
      // then it is neither a refusal to report nor a cell to fit again.
      const refusals = (penaltyAt = null, written = null) => {
        for (const m of members) {
          const { cell, fit } = m;
          if (fit.scale) continue;
          // "cannot-measure" is the one worth surfacing: a CJK translation cannot
          // be fitted without a real measurer, and reporting it clean would be a
          // lie the render then tells in pixels.
          if (fit.reason === "cannot-measure") {
            changes.push({ kind: "unmeasurable", slide: cell.slide, slideId: cell.screenshot.id, deviceId: cell.deviceId, locale: cell.locale });
          } else if (fit.reason === "copy-too-long" && !(written && penaltyAt(m, written) === 0)) {
            // This is the common one. A translation runs ~30% long, the only axis
            // it owns is size, and the store floor is where that axis runs out.
            changes.push({
              kind: "copy-too-long",
              slide: cell.slide,
              slideId: cell.screenshot.id,
              deviceId: cell.deviceId,
              locale: cell.locale,
              blockedBy: fit.blockedBy ?? [],
            });
          }
        }
      };

      // Only a device that was faulting and found a fit, or one already clean,
      // has a target: a device that refused (copy too long, unmeasurable) keeps
      // whatever the shared scale does to it, as it always did.
      const judged = members.filter((m) => m.fit.scale || m.fit.reason === "clean");
      const fitted = members.filter((m) => m.fit.scale);
      if (!fitted.length) {
        refusals();
        continue;
      }
      const penaltyAt = (m, sizes) => scoreLayout({ ...m.args, layers: m.relayoutAbs(sizes) }).penalty;
      const target = (m) => (m.fit.scale ? m.fit.after : m.fit.before ?? 0);
      const sizesOf = (m) =>
        Object.fromEntries(
          m.cell.layers.filter((l) => l.type === "text" && l.text).map((l) => [l.id, round4(l.sizeMul * m.fit.scale)]),
        );
      const total = (sizes) => Object.values(sizes).reduce((n, v) => n + v, 0);
      const candidates = [...new Map(fitted.map((m) => [JSON.stringify(sizesOf(m)), sizesOf(m)])).values()]
        .sort((x, y) => total(y) - total(x));
      let chosen = null;
      for (const sizes of candidates) {
        const scores = judged.map((m) => penaltyAt(m, sizes));
        const over = scores.reduce((n, p, i) => n + Math.max(0, p - target(judged[i])), 0);
        if (!chosen || over < chosen.over) chosen = { sizes, over };
        if (over === 0) break;
      }

      refusals(penaltyAt, chosen.sizes);
      patch(cells[0].screenshot.id, (s) => {
        let byLocale = s.layersByLocale;
        for (const [id, sizeMul] of Object.entries(chosen.sizes)) {
          byLocale = patchLayer(byLocale, cells[0].locale, id, { sizeMul });
        }
        return { ...s, layersByLocale: byLocale };
      });
      for (const m of fitted) {
        const after = penaltyAt(m, chosen.sizes);
        const own = m.cell.layers.find((l) => chosen.sizes[l.id] != null);
        changes.push({
          kind: "locale-fit",
          slide: m.cell.slide,
          slideId: m.cell.screenshot.id,
          deviceId: m.cell.deviceId,
          locale: m.cell.locale,
          scale: round4(chosen.sizes[own.id] / own.sizeMul),
          before: m.fit.before,
          after,
          fitted: after === 0,
        });
      }
    }
  }

  return { deck: { ...deck, screenshots }, changes, patched };
}
