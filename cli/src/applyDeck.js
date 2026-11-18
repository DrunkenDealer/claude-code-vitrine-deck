// The editor's one-click styling, for a deck on disk.
//
// A look's type style — tracking, case, size, shadow, highlight — is layer-owned
// and cannot reach a slide through `defaults` (see the header of src/looks.js),
// so an agent that wanted one had to copy nine keys onto every role layer by
// hand and remember to clear them from each card's overrides. This is the
// editor's own apply: the same patches, the same keys cleared, the same scope
// (selected slides), so a deck styled here opens in the editor as if the click
// had been made there.
//
// The column is solved here, by the function the editor runs on every write
// (src/baseColumn.js). A preset or look writes its seed geometry and a `stackId`,
// and check, render and push read the base canvas as stored — they solve the
// other canvases and the translations, never that one — so a deck left at the
// seed is graded and drawn at the seed: a lower-banner leaves a band the editor
// never shows (N352). Translations and the other canvases are still solved on
// read.
import { applyLayerPatches, orientationOf, presetKeysFor, withDefaults } from "./deck.js";
import { reflowColumn, seatInArtSafe } from "./baseColumn.js";
import { deviceRecords } from "./checkDeck.js";
import { lookupDevice } from "./devices.js";
import { FEATURE_GRAPHIC_PRESETS, PRESETS, getPreset, presetPatchFor } from "./layoutPresets.js";
import { COMPILED_LOOKS, LOOK_LAYER_KEYS, getLook } from "./looks.js";
import { LENS_PRESETS, lensPresetPatch } from "./layers.js";

const LENS_KEYS = ["radius", "border", "shadow", "markSource", "dim", "blur", "connector"];

const ids = (list) => list.map((x) => x.id).join(", ");

/**
 * Apply a look, a layout preset and/or a lens preset to a deck.
 *
 * `slides` narrows the write to slides matched by id or name; otherwise every
 * selected slide, as in the editor. A look is applied first, so a layout preset
 * named alongside it overrides the look's geometry and keeps its type style.
 *
 * With a look or layout and a `measurer`, each written slide's column is solved
 * on the deck's project devices, as the editor does; ids this build does not know
 * are skipped. Without a measurer, or with neither, the seed is left as written.
 *
 * Returns `{ deck, slides, targets }` — `slides` the names written, `targets`
 * the same slides as `{ id, index, name }`, because two slides can share a name
 * and only the id (or the index in the deck's array) says which one — or throws
 * naming the unknown id.
 */
export function applyToDeck(deck, { look: lookId = null, layout = null, lens = null, slides = null, measurer = null } = {}) {
  const look = lookId == null ? null : getLook(lookId);
  if (lookId != null && !look) throw new Error(`unknown look "${lookId}" (looks: ${ids(COMPILED_LOOKS)})`);
  const preset = layout == null ? null : getPreset(layout);
  // getPreset falls back to Hero for an unknown id; a typo must not restyle a deck.
  if (layout != null && preset?.id !== layout) {
    throw new Error(`unknown layout preset "${layout}" (presets: ${ids(PRESETS)}; feature graphic: ${ids(FEATURE_GRAPHIC_PRESETS)})`);
  }
  if (lens != null && !LENS_PRESETS.some((p) => p.id === lens)) {
    throw new Error(`unknown lens preset "${lens}" (lens presets: ${ids(LENS_PRESETS)})`);
  }
  if (!look && !preset && lens == null) throw new Error("nothing to apply: pass --look, --layout or --lens");

  const wanted = slides?.length ? new Set(slides) : null;
  if (wanted) {
    const known = new Set(deck.screenshots.flatMap((s) => [s.id, s.name]));
    const unknown = [...wanted].filter((x) => !known.has(x));
    if (unknown.length) throw new Error(`no slide ${unknown.map((x) => `"${x}"`).join(", ")} in this deck`);
  }
  const targeted = (s) => (wanted ? wanted.has(s.id) || wanted.has(s.name) : s.selected);
  // A feature-graphic layout places nothing on any other kind, so naming one
  // where it cannot land is a mistake to say, not a silent no-op.
  if (FEATURE_GRAPHIC_PRESETS.includes(preset) && !deck.screenshots.some((s) => targeted(s) && s.kind === "feature-graphic")) {
    throw new Error(`layout preset "${layout}" is for feature-graphic slides, and none is ${wanted ? "named" : "selected"}`);
  }

  const written = [];
  const targets = [];
  const screenshots = deck.screenshots.map((s, index) => {
    if (!targeted(s)) return s;
    written.push(s.name ?? s.id);
    targets.push({ id: s.id, index, name: s.name ?? null });
    const orientation = orientationOf(s.kind);
    let next = s;
    if (look) next = applyLayerPatches(next, (l) => look.patchFor(l, orientation, s.kind), LOOK_LAYER_KEYS);
    if (preset) next = applyLayerPatches(next, (l) => presetPatchFor(preset, l, orientation, s.kind), presetKeysFor(s.kind));
    if (lens != null) {
      next = applyLayerPatches(next, (l) => (l.type === "lens" ? lensPresetPatch(l, lens) : null), LENS_KEYS);
    }
    return next;
  });

  // The editor's applyDeckDefaults: a null in the look leaves the deck's own value.
  const defaults = look
    ? { ...deck.defaults, ...Object.fromEntries(Object.entries(look.defaults).filter(([, v]) => v != null)) }
    : deck.defaults;

  const devices = deviceRecords((deck.projectDevices ?? []).filter((id) => lookupDevice(id)));
  if ((look || preset) && measurer && devices.length) {
    const merged = withDefaults(defaults);
    const ctx = { devices, screenshots, defaults: merged, locale: merged.baseLocale, measurer };
    const at = new Set(targets.map((t) => t.index));
    return {
      deck: { ...deck, defaults, screenshots: screenshots.map((s, i) => (at.has(i) ? seatInArtSafe(reflowColumn(s, ctx), ctx) : s)) },
      slides: written,
      targets,
    };
  }

  return { deck: { ...deck, defaults, screenshots }, slides: written, targets };
}
