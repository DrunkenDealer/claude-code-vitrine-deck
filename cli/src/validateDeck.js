// What a deck names that this build cannot draw as named.
//
// The engine never refuses a value: an unknown font renders in Inter, an unknown
// frame tint in black, an unknown sticker as nothing, a size past its range at
// the range's edge. That is right for the editor, which only ever writes values
// it offered — and wrong for an agent writing JSON, which got a clean render of
// something other than what it asked for and no way to tell. Errors here are
// the silent substitutions; warnings are values the engine clamps or ignores.
import { EXPORT_LOCALE_SCOPES, KINDS, NAME_TOKENS, deckCells, exportSettings } from "./deck.js";
import { DEVICES, RETIRED_DEVICE_IDS } from "./devices.js";
import { FRAME_TINTS, isFrameTint } from "./frames.js";
import { isKnownFont } from "./fonts.js";
import { lensTarget, normalizeLayer, textMax } from "./layers.js";
import { isLocaleId, isSupportedLocale } from "./locales.js";
import { isStickerKey, stickerIdFromKey } from "./stickers.js";
import { stickerLibrary } from "./template.js";
import { walkDeckSources } from "./deckSources.js";
import { isBackgroundImageKey, isBackgroundSpec } from "./visual.js";
import { uncoercible, withoutPoison } from "./wireScalars.js";

// Checked against their own vocabularies below, so not reported as clamped too.
// `solved` is the engine's own output (src/baseColumn.js), stored on the device
// layer by the editor and by `apply`; a deck either wrote is not misspelling it.
const NAMED_KEYS = new Set(["fontId", "frameTint", "sourceKey", "solved"]);

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

// A value in a message as JSON: a template literal prints an object as
// "[object Object]" (N380). Strings come out quoted, as the messages always had.
const show = (v) => JSON.stringify(v);

/**
 * `[{ level: "error" | "warn", where, message }]`, in deck order.
 *
 * Given `resolveSource` (renderDeck's sourceResolver) the files the deck names
 * are checked too: what a selected slide draws from disk must resolve, or
 * render would refuse it. `devices` extends that to each slide's own
 * screenshot, which only the devices that draw it need — a feature graphic has
 * no device layer, and a tablet slide is not drawn by a phone-only export.
 * `root` is only for the message.
 */
export async function validateDeck(rawDeck, { resolveSource = null, devices = null, root = null } = {}) {
  const { loadCatalog } = await import("../server/fonts.js");
  const { isOnDemand, knowsSticker } = await import("../server/stickers.js");
  const families = await loadCatalog().catch(() => new Map());
  const issues = [];
  const error = (where, message) => issues.push({ level: "error", where, message });
  // `{"toString": 1}` throws in every Number()/String() the checks below (and the
  // render after them) run, and a NUL in a source key throws in fs (N517). Said
  // once here, at the object that holds it; the checks then run on a copy without
  // those keys so they still report each field's own type error.
  for (const [where, message] of uncoercible(rawDeck, "")) error(where, message);
  const deck = withoutPoison(rawDeck);
  const warn = (where, message) => issues.push({ level: "warn", where, message });

  const font = (where, id) => {
    if (id == null) return;
    const known = typeof id === "string" && id.startsWith("gf:") ? families.has(id.slice(3).toLowerCase()) : isKnownFont(id);
    if (!known) error(where, `unknown font ${show(id)} — renders in the default face (vitrine search fonts <query>)`);
  };
  const tint = (where, id) => {
    if (id != null && !isFrameTint(id)) error(where, `unknown frame tint ${show(id)} (tints: ${Object.keys(FRAME_TINTS).join(", ")})`);
  };
  const background = (where, spec) => {
    if (!isBackgroundSpec(spec)) error(where, "not a background spec (solid, linear, radial, mesh, image or raw)");
  };
  const sticker = async (where, key) => {
    if (!isStickerKey(key)) return;
    const id = stickerIdFromKey(key);
    const known = isOnDemand(id.split("/")[0]) ? await knowsSticker(id) : stickerLibrary().has(id);
    if (!known) error(where, `unknown sticker "${id}" — draws nothing (vitrine search stickers <query>)`);
  };
  // `raw` is what the deck wrote for a layer; `patch` narrows the report to the
  // keys an override wrote, since the rest are the base layer's own report.
  const layer = async (where, raw, patch = raw) => {
    font(`${where}.fontId`, patch.fontId);
    tint(`${where}.frameTint`, patch.frameTint);
    await sticker(`${where}.sourceKey`, patch.sourceKey);
    // A warning: it still renders as written, and the value is left out of the
    // message because it may be the megabyte this is here to report.
    if (typeof patch.text === "string" && patch.text.length > textMax(raw.role)) {
      warn(`${where}.text`, `${patch.text.length} characters, past the ${textMax(raw.role)} the editor allows here — shorten it`);
    }
    const n = normalizeLayer(raw);
    if (!n) return;
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || NAMED_KEYS.has(key)) continue;
      if (!(key in n)) warn(`${where}.${key}`, `not a ${n.type} layer field — ignored`);
      else if (typeof value === "object" && n[key] !== null && typeof n[key] !== "object") {
        error(`${where}.${key}`, `must be a ${typeof n[key]}, not ${Array.isArray(value) ? "an array" : "an object"}`);
      } else if (typeof value !== "object" && n[key] !== value) {
        warn(`${where}.${key}`, `${JSON.stringify(value)} is out of range or not an option — renders as ${JSON.stringify(n[key])}`);
      }
    }
  };

  const d = deck.defaults ?? {};
  font("defaults.fontId", d.fontId);
  tint("defaults.frameTint", d.frameTint);
  if (d.background != null) background("defaults.background", d.background);
  // A string here was walked one character at a time, ~2 ms and one error line
  // each (N469): a type error says it once, and a long array is cut off.
  const MAX_LOCALE_CHECKS = 100;
  const listed = d.locales ?? [];
  const locales = Array.isArray(listed) ? listed : [];
  if (!Array.isArray(listed)) error("defaults.locales", "must be an array of locale ids");
  for (const l of locales.slice(0, MAX_LOCALE_CHECKS)) {
    if (!isLocaleId(l)) error("defaults.locales", `unknown locale ${show(l).slice(0, 80)} (vitrine capabilities lists them)`);
    else if (!isSupportedLocale(l)) error("defaults.locales", `${show(l)} is right-to-left, which Vitrine does not lay out`);
  }
  if (locales.length > MAX_LOCALE_CHECKS) error("defaults.locales", `${locales.length - MAX_LOCALE_CHECKS} more entries not checked`);
  if (d.baseLocale != null && locales.length && !locales.includes(d.baseLocale)) {
    error("defaults.baseLocale", `${show(d.baseLocale)} is not one of defaults.locales`);
  }
  // Export settings never fail a deck — both hosts read a bad value as the
  // built-in — but an agent that wrote one should hear it was not honoured.
  const exported = exportSettings(d);
  if (d.exportFormat != null && d.exportFormat !== exported.format) {
    warn("defaults.exportFormat", `${JSON.stringify(d.exportFormat)} is not png or jpeg — renders as ${exported.format}`);
  }
  if (d.exportQuality != null && d.exportQuality !== exported.quality) {
    warn("defaults.exportQuality", `${JSON.stringify(d.exportQuality)} is not a number from 0.3 to 1 — renders as ${exported.quality}`);
  }
  if (d.exportLocaleScope != null && !EXPORT_LOCALE_SCOPES.includes(d.exportLocaleScope)) {
    warn("defaults.exportLocaleScope", `${JSON.stringify(d.exportLocaleScope)} is not ${EXPORT_LOCALE_SCOPES.join(" or ")} — the editor uses ${exported.localeScope}`);
  }
  if (d.exportNameTemplate != null && typeof d.exportNameTemplate !== "string") {
    warn("defaults.exportNameTemplate", `${JSON.stringify(d.exportNameTemplate)} is not a string — the default template is used`);
  } else if (typeof d.exportNameTemplate === "string") {
    const stray = (d.exportNameTemplate.match(/\{[^}]*\}/g) ?? []).filter((t) => !NAME_TOKENS.includes(t));
    if (stray.length) {
      warn("defaults.exportNameTemplate", `${stray.join(", ")} ${stray.length > 1 ? "aren't name tokens" : "isn't a name token"} — written as text (tokens are lowercase: ${NAME_TOKENS.join(", ")})`);
    }
  }
  // A non-array crashed the loader with a raw "...map is not a function", and
  // a huge array printed one line per id (N478): one type error, and a cut-off.
  const listedDevices = deck.projectDevices ?? [];
  const projectDevices = Array.isArray(listedDevices) ? listedDevices : [];
  if (!Array.isArray(listedDevices)) error("projectDevices", "must be an array of device ids");
  for (const id of projectDevices.slice(0, MAX_LOCALE_CHECKS)) {
    if (typeof id === "string" && Object.hasOwn(DEVICES, id)) continue;
    const now = typeof id === "string" && Object.hasOwn(RETIRED_DEVICE_IDS, id) ? RETIRED_DEVICE_IDS[id] : null;
    error("projectDevices", now ? `${show(id)} is now "${now}"` : `unknown device ${show(id).slice(0, 80)}`);
  }
  if (projectDevices.length > MAX_LOCALE_CHECKS) error("projectDevices", `${projectDevices.length - MAX_LOCALE_CHECKS} more entries not checked`);

  let namesBad = false;
  for (const [i, s] of (deck.screenshots ?? []).entries()) {
    const at = `screenshots[${i}]`;
    if (s.kind != null && !KINDS.includes(s.kind)) error(`${at}.kind`, `unknown kind ${show(s.kind)} (kinds: ${KINDS.join(", ")})`);
    // The name fills the export file name: an object there threw out of the
    // cell walk below with a raw "Cannot convert object to primitive value" (N509).
    if (s.name != null && typeof s.name === "object") {
      error(`${at}.name`, "must be a string");
      namesBad = true;
    }
    if (s.background != null) background(`${at}.background`, s.background);
    for (const [deviceId, fields] of Object.entries(s.byDevice ?? {})) {
      if (isObject(fields) && fields.background != null) background(`${at}.byDevice["${deviceId}"].background`, fields.background);
    }
    const layers = s.layers ?? [];
    for (const [j, l] of layers.entries()) {
      await layer(`${at}.layers[${j}]`, l);
      if (l.type === "lens" && !lensTarget(l, layers)) {
        warn(`${at}.layers[${j}].target`, `no device layer "${l.target}" on this slide — the lens draws nothing`);
      }
    }
    for (const [mapKey, own] of [["layersByDevice", null], ["layersByLocale", locales]]) {
      for (const [scope, byLayer] of Object.entries(s[mapKey] ?? {})) {
        if (own && !own.includes(scope)) warn(`${at}.${mapKey}["${scope}"]`, `"${scope}" is not one of defaults.locales — never rendered`);
        for (const [id, patch] of Object.entries(isObject(byLayer) ? byLayer : {})) {
          const base = layers.find((l) => l.id === id);
          const where = `${at}.${mapKey}["${scope}"].${id}`;
          if (!base) warn(where, `no layer "${id}" on this slide — ignored`);
          else if (isObject(patch)) {
            // `from` is the base text a translation was made from — the editor's stale-translation mark, not a layer field.
            const fields = own ? Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "from")) : patch;
            await layer(where, { ...base, ...fields }, fields);
          }
        }
      }
    }
  }
  // The cell walk reads defaults.locales too: a string there made one cell per
  // character, and a name-clash scan quadratic in them (N469).
  if (resolveSource && locales === listed && locales.length <= MAX_LOCALE_CHECKS && !namesBad) await missingFiles(deck, { resolveSource, devices, root }, error);
  return issues;
}

// The app's own folders (backgrounds/, examples/) are resolved from the install,
// so a miss there is not about the deck's folder.
const notFound = (key, what, root) =>
  isBackgroundImageKey(key) ? `bundled background not found: ${key}`
    : key.startsWith("examples/") ? `bundled example not found: ${key}`
    : `${what}not found under ${root ?? "the assets folder"}: ${key}`;

// Render's source preflight, run on the same selected slides, so that a deck
// validate and check call clean is one render does not refuse after writing
// the cells before the bad one.
async function missingFiles(deck, { resolveSource, devices, root }, error) {
  // Unselected slides stay in place as empty ones, so the indexes in `where`
  // are the deck's own.
  const selected = { ...deck, screenshots: (deck.screenshots ?? []).map((s) => (s?.selected ? s : {})) };
  walkDeckSources(selected, (key, kind, where) => {
    if (kind !== "asset" || typeof key !== "string" || !key || isStickerKey(key) || resolveSource(key)) return;
    error(where, notFound(key, "", root));
  });
  if (!devices?.length) return;
  const { cellNeedsMissingShot } = await import("./renderDeck.js");
  const slides = deck.screenshots ?? [];
  const reported = new Set();
  for (const cell of deckCells(deck, { devices })) {
    const i = slides.indexOf(cell.screenshot);
    if (reported.has(i) || !cellNeedsMissingShot(cell, resolveSource)) continue;
    reported.add(i);
    const key = cell.screenshot.sourceKey;
    error(`screenshots[${i}].sourceKey`, key
      ? notFound(key, "screenshot ", root)
      : "no sourceKey, but a device layer draws the slide's screenshot");
  }
}
