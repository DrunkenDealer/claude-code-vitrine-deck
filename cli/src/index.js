#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { open, readFile, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Command, CommanderError } from "commander";
import sharp from "sharp";
import { DEVICES, currentDeviceId, lookupDevice, resolveDevice } from "./devices.js";
import { IMAGE_ROLES, LAYER_TYPES, layersFromFlat, normalizeLayers } from "./layers.js";
import { estimatingMeasurer, textInkBox } from "./textMetrics.js";
import { CAPTION_GAP } from "./captionFlow.js";
import { CAPTION_TO_DEVICE } from "./layoutStack.js";
import { DEFAULT_FRAME_TINT, FRAME_TINTS, isFrameTint } from "./frames.js";
import { renderSlide, withBrowser } from "./render.js";
import { generateHeadline } from "./headline.js";
import { capabilities } from "./capabilities.js";
import { checkDeck, devicesFor, polishDeck } from "./checkDeck.js";
import { applyToDeck } from "./applyDeck.js";
import { SCREENSHOT_EXTENSIONS, initDeck } from "./initDeck.js";
import { validateDeck } from "./validateDeck.js";
import { guardStreams } from "./termSafe.js";
import { SEARCH_KINDS, searchAssets } from "./searchAssets.js";
import { renderDeck, sourceResolver } from "./renderDeck.js";
import { measuredRun } from "./measure.js";
import { collectDeckAssets, collectDeckSources, insecureServer, pushDeck } from "./pushDeck.js";
import { clearSession, readSession, serverKey, sessionFile } from "./session.js";
import { FAULT_LABEL } from "./layoutScore.js";
import { STORE_FAULT_LABEL } from "./storeFit.js";
import { isStickerKey } from "./stickers.js";
import { fontIdFor, isKnownFont } from "./fonts.js";
import { HIDDEN_NAME_CHARS } from "./fileName.js";
import { NAME_TOKENS, deckCells, exportSettings, extFor, nameKey, withDefaults, withLocaleStacks } from "./deck.js";
import { DECK_VERSION, migrateDeck } from "../web/src/lib/deckMigration.js";

const DEFAULT_BACKGROUND = "linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)";

// Below this share of the canvas the device is a speck in flat mode, not a screenshot.
const MIN_FLAT_DEVICE_HEIGHT = 0.25;

// Local by default. Pushing creates a project on whatever this points at, and a
// public instance is not somewhere an agent run should write without being told
// to — so reaching vitrine.mashlab.app takes an explicit --server.
const DEFAULT_SERVER = process.env.VITRINE_SERVER ?? "http://localhost:3001";

// Every deck value the CLI echoes leaves through these two streams.
guardStreams();

const program = new Command();
// Options belong to whatever they follow: the program's own --device and --open
// would otherwise swallow the identically-named options of every subcommand, and
// `render --device iphone-6.9` would quietly render the deck's whole device set.
program.enablePositionalOptions();
// Commander throws a CommanderError instead of exiting and prints nothing itself,
// so a usage error leaves through the same handler (and the same --json envelope)
// as every other failure. Before the first .command(): a subcommand copies both
// settings when it is created.
program.exitOverride();
program.configureOutput({ outputError: () => {} });
program
  .name("vitrine")
  .description("Generate app store screenshot mockups locally.")
  .version("0.1.0");

program
  .option("--input <path>", "raw app screenshot PNG")
  .option(
    "--device <id>",
    `device id (${Object.keys(DEVICES).join(", ")}); comma-separated for multiple`
  )
  .option("--headline <text>", "headline text")
  .option(
    "--headline-from-description <text>",
    "generate headline via Claude Haiku (requires ANTHROPIC_API_KEY)"
  )
  .option("--subtitle <text>", "subtitle text")
  .option(
    "--background <css>",
    "CSS background value (gradient, color, url())",
    DEFAULT_BACKGROUND
  )
  .option("--text-color <css>", "text color", "#ffffff")
  .option(
    "--frame-tint <id>",
    `device frame finish (${Object.keys(FRAME_TINTS).join(", ")})`,
    DEFAULT_FRAME_TINT
  )
  .option(
    "--output <path>",
    "output PNG path (use {device} placeholder when rendering multiple devices)"
  )
  .option("--config <path>", "batch config JSON")
  .option(
    "--debug-html <path>",
    "also write the templated HTML to this path (use {device} placeholder); open in a browser to iterate visually"
  )
  .option(
    "--open",
    "open the output PNG (or debug HTML if --debug-html is set) when done"
  );

// One error type for every way the CLI says no. `code` picks the exit status and
// the envelope's "code" (see report()); the default is a bad input.
class CliError extends Error {
  constructor(message, { code = "input", issues, status, cause } = {}) {
    super(message, { cause });
    this.code = code;
    if (issues) this.issues = issues;
    if (status) this.status = status;
  }
}

const EXIT = { usage: 2, input: 2, "invalid-deck": 2, network: 3, server: 3 };

function fail(msg, opts) {
  throw new CliError(msg, opts);
}

// What each command prints on stdout under --json when it succeeds, declared
// beside the command that builds it and served by `help <command> --json`
// (helpDoc). A key ending in "?" is present only sometimes. A test runs push,
// check and init and compares the keys of the real document to this table
// (N361), so a field added to an output without a line here fails there.
const JSON_RESULTS = new Map();

// The failure envelope on stdout under --json, as the top-level `help --json`
// describes it; the writer at the bottom of this file builds the same keys.
const ERROR_ENVELOPE = '{"ok":false,"error":{"code":"usage|input|invalid-deck|network|server","message","issues?","status?","projectId?"}} on stdout under --json';
function jsonResult(command, note, fields) {
  const optional = Object.keys(fields).filter((k) => k.endsWith("?")).map((k) => k.slice(0, -1));
  JSON_RESULTS.set(command, {
    note,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.replace(/\?$/, ""), v])),
    optional,
  });
}

// ---------------------------------------------------------------------------
// Deck subcommands.
//
// The flat options above are the shape this CLI has always spoken: one
// screenshot, one headline, one background. A deck is what the editor actually
// holds — layers, stickers, themes, per-device and per-locale overrides — and
// until these existed the only way to drive Vitrine from a script was through
// the poorer of the two languages. The flat form stays: it is the contract the
// ASO chain writes against, and nothing here breaks it.
// ---------------------------------------------------------------------------

const list = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);

// A deck written in place with writeFile is truncated first, so a kill mid-write
// left a 0-byte deck where the author's work was. Write beside it, flush, and
// rename over: a reader sees the old deck or the new one. A symlinked deck keeps
// its symlink (its target is replaced) and the file keeps its mode.
async function writeDeckFile(path, value) {
  const real = await realpath(path).catch(() => path);
  const st = await stat(real).catch(() => null);
  // "wx" and a random suffix: a predictable name opened with "w" follows a
  // symlink planted there beforehand and overwrites its target (N471).
  const tmp = `${real}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const fh = await open(tmp, "wx", st?.mode ?? 0o666);
    try {
      await fh.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, real);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    // The temp file beside the deck is ours, not the author's: name the deck.
    fail(`can't write ${path} (${err.code ?? err.message})`);
  }
}

async function loadDeck(path) {
  const raw = await readFile(path, "utf8").catch((err) => {
    fail(err.code === "ENOENT" ? `no such deck: ${path}` : err.message);
  });
  // A structural refusal carries its issues, so `validate` can print the list a
  // script would get from the envelope instead of nothing.
  const refuse = (message, issues) => fail(message, {
    code: "invalid-deck",
    issues: issues.map(([where, text]) => ({ level: "error", where, message: text })),
  });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    refuse(`${path} is not valid JSON: ${err.message}`, [["deck", `not valid JSON: ${err.message}`]]);
  }
  // A deck saved by the server sits inside an envelope; one written by hand or
  // by an agent is the deck itself. Both are things people will point this at.
  const deck = parsed?.deck ?? parsed;
  if (!Array.isArray(deck?.screenshots)) {
    refuse(`${path} is not a deck: no "screenshots" array`, [["screenshots", 'no "screenshots" array']]);
  }
  const notSlides = deck.screenshots.flatMap((s, i) => (s && typeof s === "object" && !Array.isArray(s) ? [] : [i]));
  if (notSlides.length) {
    refuse(`${path}: screenshots[${notSlides.join("], [")}] is not a slide object`, notSlides.map((i) => [`screenshots[${i}]`, "is not a slide object"]));
  }
  // The rest are collected together, so one run names every problem.
  const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
  const notLayers = deck.screenshots.flatMap((s, i) => {
    if (s.layers === undefined) return [];
    if (!Array.isArray(s.layers)) return [[`screenshots[${i}].layers`, "is not a layer object"]];
    return s.layers.flatMap((l, j) => (isObject(l) ? [] : [[`screenshots[${i}].layers[${j}]`, "is not a layer object"]]));
  });
  const untyped = deck.screenshots.flatMap((s, i) =>
    (Array.isArray(s.layers) ? s.layers : []).flatMap((l, j) =>
      !isObject(l) || LAYER_TYPES.includes(l.type) ? [] : [[`screenshots[${i}].layers[${j}].type`, `must be one of ${LAYER_TYPES.join(", ")}`]]),
  );
  // A per-device override patches a layer's geometry and style; one that names a
  // different type (or null, which deletes it) resolves to a layer nothing can draw.
  const retyped = deck.screenshots.flatMap((s, i) => {
    if (s.layersByDevice == null) return [];
    if (!isObject(s.layersByDevice)) return [[`screenshots[${i}].layersByDevice`, "is not an object"]];
    return Object.entries(s.layersByDevice).flatMap(([deviceId, byLayer]) => {
      const where = `screenshots[${i}].layersByDevice["${deviceId}"]`;
      if (!isObject(byLayer)) return [[where, "is not an object"]];
      return Object.entries(byLayer).flatMap(([id, patch]) => {
        if (!isObject(patch)) return [[`${where}.${id}`, "is not an object"]];
        if (!("type" in patch)) return [];
        const base = Array.isArray(s.layers) ? s.layers.find((l) => l?.id === id) : undefined;
        return patch.type === base?.type ? [] : [[`${where}.${id}.type`, "cannot change a layer's type"]];
      });
    });
  });
  // `null` is a layers list too, and every later `.map` over it threw (N498).
  const badKeys = deck.screenshots.flatMap((s, i) =>
    s.sourceKey == null || typeof s.sourceKey === "string" ? [] : [[`screenshots[${i}].sourceKey`, "is not a source key"]]);
  const badShots = deck.screenshots.flatMap((s, i) => {
    if (s.shotByDevice == null) return [];
    if (!isObject(s.shotByDevice)) return [[`screenshots[${i}].shotByDevice`, "is not an object"]];
    return Object.entries(s.shotByDevice).flatMap(([deviceId, key]) =>
      typeof key === "string" && key ? [] : [[`screenshots[${i}].shotByDevice["${deviceId}"]`, "is not a source key"]]);
  });
  // The migration maps this list, so a non-array died there with Node's own
  // "...map is not a function" (N478).
  const badDevices = deck.projectDevices == null || Array.isArray(deck.projectDevices) ? [] : [["projectDevices", "must be an array of device ids"]];
  // Mapped by the migration too (N503).
  // Its entries too: the editor builds a Set from them (N510).
  const badKnown = deck.knownSourceKeys == null || (Array.isArray(deck.knownSourceKeys) && deck.knownSourceKeys.every((k) => typeof k === "string"))
    ? [] : [["knownSourceKeys", "must be an array of source keys"]];
  const joined = (pairs) => `${path}: ${pairs.map(([where]) => where).join(", ")} ${pairs[0][1]}`;
  const spelled = (pairs) => `${path}: ${pairs.map(([where, text]) => `${where} ${text}`).join(", ")}`;
  const lines = [
    notLayers.length && joined(notLayers),
    untyped.length && joined(untyped),
    retyped.length && spelled(retyped),
    badKeys.length && spelled(badKeys),
    badShots.length && spelled(badShots),
    badDevices.length && spelled(badDevices),
    badKnown.length && spelled(badKnown),
  ].filter(Boolean);
  if (lines.length) refuse(lines.join("\n"), [...notLayers, ...untyped, ...retyped, ...badKeys, ...badShots, ...badDevices, ...badKnown]);
  // The editor's own migration, so a deck it saved at any version reads here the
  // way it reads there. A deck written by hand carries no `v`; one whose slides
  // already have layers is current, and stamping it keeps the v3→v4 step from
  // switching off a safe area the author asked for.
  const current = deck.v == null && deck.screenshots.every((s) => Array.isArray(s?.layers));
  // The envelope comes back too, so a deck written back out keeps its shape.
  return { deck: migrateDeck(current ? { ...deck, v: DECK_VERSION } : deck), envelope: deck === parsed ? null : parsed };
}

// Run ahead of check, render, push, polish and apply: a value the engine silently replaces
// would otherwise grade and render clean as something the deck did not ask for.
const issueLine = (i) => `${i.level === "error" ? "error" : "warning"}: ${i.where}: ${i.message}`;
async function validated(deck, opts) {
  const issues = await validateDeck(deck, opts);
  for (const i of issues.filter((i) => i.level === "warn")) process.stderr.write(`${issueLine(i)}\n`);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) fail(`the deck names what this build cannot draw (vitrine validate):\n${errors.map(issueLine).join("\n")}`, { code: "invalid-deck", issues: errors });
  return deck;
}

// What validate and check need to look for the files a render would open: the
// same resolver as render's, and the devices it would draw. A deck that names
// no usable device is left to devicesFor's own message, after validation.
function fileChecks(deck, o) {
  const root = o.assets ?? dirname(resolve(o.deck));
  let devices = null;
  try {
    devices = devicesFor(deck, o.device);
  } catch {
    // reported by validateDeck or by the caller's own devicesFor
  }
  return { resolveSource: sourceResolver(root), devices, root };
}

const formatOf = (value) => {
  const f = String(value).toLowerCase();
  if (f === "png") return "png";
  if (f === "jpeg" || f === "jpg") return "jpeg";
  return fail(`--format must be png or jpeg, got "${value}"`);
};

// A locale the deck has no copy for renders the base text into a folder named
// for it, and grades clean — a pass on a translation that does not exist.
function checkLocales(deck, locales) {
  if (!locales?.length) return;
  const own = withDefaults(deck.defaults).locales ?? [];
  const missing = locales.filter((l) => !own.includes(l));
  if (missing.length) fail(`--locale ${missing.join(", ")} not in this deck (it has ${own.join(", ") || "none"})`);
}

function checkNameTemplate(template) {
  const unknown = (String(template ?? "").match(/\{[^}]*\}/g) ?? []).filter((t) => !NAME_TOKENS.includes(t));
  if (unknown.length) fail(`--name-template: unknown ${unknown.join(", ")} (tokens: ${NAME_TOKENS.join(", ")})`);
  // What is left once the tokens are out is literal text, and a brace there is
  // a token that lost its other half.
  if (/[{}]/.test(String(template ?? "").replace(/\{[^{}]*\}/g, ""))) {
    fail(`--name-template: unbalanced brace in "${template}" (tokens: ${NAME_TOKENS.join(", ")})`);
  }
}

// A clash is renamed with a suffix in the editor's zip, where an export must not
// fail. Here it is refused: a script asked for names, and a silent `_2` is not
// the name it asked for.
function checkNameClashes(deck, opts, hint) {
  const cells = deckCells(deck, opts);
  // Without case, the way deckCells found the clash.
  const byName = new Map(cells.map((c) => [nameKey(c.name), c]));
  const clashes = cells
    .filter((c) => c.clashesWith)
    .map((c) => {
      const first = byName.get(nameKey(c.clashesWith));
      return `slides "${first.slide}" and "${c.slide}" both render ${first.name}`;
    });
  if (clashes.length) fail(`two cells would write one file:\n  - ${[...new Set(clashes)].join("\n  - ")}\n  ${hint}`);
}

// Grading runs against the real faces by default. The estimator is out by a
// whole line often enough that a deck can pass `check` with its headline
// sitting inside the device, so measuring is worth a browser launch — see
// src/measure.js. `--fast` is the way out when there is no Chromium.
async function graded(fast, fn) {
  if (fast) return { result: fn(null), estimated: ["--fast"] };
  await registerCachedFonts();
  return withBrowser((browser) => measuredRun(browser, fn));
}

// A translation's stack is solved on real faces where the deck carries no current
// solution — it was pushed, polished or written by hand rather than measured in
// the editor. On the deck's own devices when it names them, because the editor
// solves against every device the project has, not the subset being rendered.
const measuringDevices = (deck, devices) => (deck.projectDevices?.length ? devicesFor(deck) : devices);

async function localeStacksMeasured(browser, deck, devices) {
  const { result } = await measuredRun(browser, (measurer) =>
    withLocaleStacks(deck, { devices: measuringDevices(deck, devices), measurer }),
  );
  return result;
}

// Google fonts fetched earlier (`vitrine font`, or the server) are known to the
// font table only once registered; until then a gf: id renders as the fallback.
// A stale Latin-only copy gets a short try at its slices, then renders as it is.
async function registerCachedFonts() {
  const fonts = await import("../server/fonts.js");
  await fonts.registerCachedFonts({ wait: true, timeout: 4000 });
}

// A gf: font nobody has fetched yet renders as the fallback face, exit 0 — so
// fetch it first, the way stickers are below.
async function cacheFonts(deck) {
  const missing = collectDeckAssets(deck).fonts.filter((family) => !isKnownFont(fontIdFor(family)));
  if (!missing.length) return;
  const { ensureFamily } = await import("../server/fonts.js");
  for (const family of missing) {
    process.stderr.write(`caching font ${family}\n`);
    await ensureFamily(family).catch((err) =>
      fail(`font ${family}: ${err.message === "unknown family" ? "not a family Vitrine can fetch (assets/google-fonts.json lists them)" : err.message}`, {
        code: /^unknown /.test(err.message) ? "input" : "network",
        cause: err,
      }),
    );
  }
}

// Icon and emoji stickers are fetched on demand, and the renderer draws an
// uncached one as nothing — so fetch them first, the way the editor does before
// a layer points at one.
async function cacheStickers(deck) {
  const { stickers } = collectDeckAssets(deck);
  if (!stickers.length) return;
  const { ensureSticker } = await import("../server/stickers.js");
  for (const id of stickers) {
    process.stderr.write(`caching sticker ${id}\n`);
    await ensureSticker(id).catch((err) =>
      fail(`sticker ${id}: ${err.message}`, { code: /^unknown /.test(err.message) ? "input" : "network", cause: err }));
  }
}

const estimatedNote = (result, estimated) => {
  if (!estimated.length && !result.estimated) return null;
  const why = estimated.includes("--fast")
    ? "--fast"
    : estimated.length
      ? `no cached face for ${estimated.join(", ")}`
      : "no measurable face";
  return `text sized by the glyph estimator (${why}) — a clean cell is a weaker claim here`;
};

const faultLine = (f, strict) => {
  const where = f.layerId ? ` [${f.layerId}]` : "";
  const detail = f.detail
    ? ` (${Object.entries(f.detail).map(([k, v]) => `${k}=${typeof v === "number" ? Number(v.toFixed?.(3) ?? v) : v}`).join(", ")})`
    : "";
  const review = f.severity === "warn" && !strict ? " — to review" : "";
  return `      ${FAULT_LABEL[f.code] ?? f.code}${where}${detail}${review}`;
};

// `!!` blocks and `??` is worth a look — the same two marks the deck skill's own
// gates used, so a reader who has seen one recognises the other.
const mark = (f, strict) => (strict || f.severity === "block" ? "!!" : "??");

// Store and copy faults are reported apart from the cells because they are not
// about a cell: a canvas is refused once however many locales render on it, and
// a headline claiming "#1" claims it on every device.
function reportStore(store, strict) {
  if (!store.faults.length) return;
  console.log("  store");
  for (const f of store.faults) {
    const where = f.deviceId ? ` [${f.deviceId}]` : "";
    const why = f.detail?.reason
      ?? (f.detail?.count != null
        ? `${f.detail.count} slides — ${f.detail.store} takes ${f.detail.min}-${f.detail.max}`
        : "");
    const alt = f.detail?.alternative ? ` — try ${f.detail.alternative}` : "";
    console.log(`    ${mark(f, strict)} ${STORE_FAULT_LABEL[f.code] ?? f.code}${where}: ${why}${alt}`);
  }
}

function reportCopy(copy, strict) {
  if (!copy.faults.length) return;
  console.log(`  copy — ${copy.note}`);
  for (const f of copy.faults) {
    const where = `${f.slide}/${f.layerId}${f.locale ? ` · ${f.locale}` : ""} · ${f.detail.stores.join("+")}`;
    console.log(`    ${mark(f, strict)} ${f.rule} [${where}]: ${f.detail.why} — “${f.detail.text}”`);
  }
}

// The last line, which is the one a person actually reads.
//
// "worst penalty N" alone stopped being the whole story once a deck could fail
// on things that carry no penalty: a canvas Play refuses scores 0, and so does
// a headline claiming "#1". Printing "2 cells, worst penalty 0" over a list of
// blocking faults is the kind of summary that teaches people to ignore it.
function summary(result) {
  const counts = (list) => {
    let block = 0;
    let warn = 0;
    for (const f of list) (result.strict || f.severity === "block" ? block++ : warn++);
    return { block, warn };
  };
  const store = counts(result.store.faults);
  const copy = counts(result.copy.faults);
  const cell = counts(result.cells.flatMap((c) => c.faults));
  const blocking = cell.block + store.block + copy.block;
  const warnings = cell.warn + store.warn + copy.warn;

  const parts = [`${result.cells.length} cell${result.cells.length === 1 ? "" : "s"}`];
  // Zero cells exits 1, and the line a person reads has to say so.
  if (!result.cells.length) parts.push("failed: nothing to check");
  if (result.worst > 0) parts.push(`worst penalty ${Math.round(result.worst)}`);
  if (blocking) parts.push(`${blocking} blocking`);
  else if (result.clean) parts.push("all clean");
  if (warnings) parts.push(`${warnings} to review`);
  return parts.join(", ");
}

function reportCheck(result, { json, note, storeFlag }) {
  if (json) {
    console.log(JSON.stringify({ ok: true, ...result, note }, null, 2));
    return;
  }
  for (const cell of result.cells) {
    if (cell.penalty === 0 && cell.faults.length === 0) continue;
    console.log(`  ${cell.name} — penalty ${Math.round(cell.penalty)}`);
    for (const f of cell.faults) console.log(faultLine(f, result.strict));
  }
  if (!result.cells.length) console.log("  nothing to check: no selected slide renders on these devices");
  reportStore(result.store, result.strict);
  reportCopy(result.copy, result.strict);
  console.log(summary(result));
  if (!result.store.checked) {
    const why = storeFlag ? "--no-store-check" : "defaults.storeCheck: false";
    process.stderr.write(`note: store checks are off for this run (${why})\n`);
  }
  if (note) process.stderr.write(`warning: ${note}\n`);
}

jsonResult("capabilities", "always JSON; --json is accepted so a script can say so. Failures use the error envelope.", {
  ok: "true",
  version: "number — the document's schema version",
  devices: "object[] — every device id with its canvas and frame",
  kinds: "object[] — {id, orientation, fallback, deviceLayer, screenshot} per slide kind; the devices a kind draws on are the `devices` rows with that `kind`",
  themes: "object[]",
  defaultThemeId: "string",
  layoutPresets: "object[] — ids for `apply --layout`",
  featureGraphicPresets: "object[] — the feature graphic's own ids for `apply --layout`; they place its icon and art image layers too",
  looks: "object — ids for `apply --look`, with what each sets",
  backgrounds: "object — the background specs a deck may hold",
  fonts: "object — bundled fonts and the Google catalogue rule",
  frameTints: "string[]",
  rotation: "object — the rotation clamp",
  locales: "object[]",
  defaultLocale: "string",
  stickers: "object — packs and how to address them",
  safeArea: "object",
  layers: "object — the layer schema with every clamp",
  deck: "object — deck-level fields",
  export: "object — formats and the file-name tokens",
  stores: "object — the stores' own limits, with sources",
  thumbnail: "object — the store-thumbnail scale check and render use",
  faults: "object — the fault table: code, severity, hint",
});

program
  .command("capabilities")
  .description("everything a slide is allowed to be: devices, themes, presets, fonts, locales, stickers, the layer schema")
  .option("--json", "machine-readable (the default; the flag exists so a script can be explicit)")
  .action((o) => {
    void o;
    console.log(JSON.stringify({ ok: true, ...capabilities() }, null, 2));
  });

jsonResult("validate", "exit 0 when valid, 1 when valid is false; a deck too broken to load still answers valid:false with the structural issues. ok:true says the command ran, valid says the answer.", {
  ok: "true",
  valid: "boolean — no issue has level error",
  issues: "object[] — {level: error|warn, where, message}",
});

program
  .command("validate")
  .description("list what a deck names that this build cannot draw: fonts, tints, stickers, devices, locales, backgrounds, out-of-range values")
  .requiredOption("--deck <path>", "deck JSON")
  .option("--assets <dir>", "where the deck's source keys resolve (default: the deck file's directory)")
  .option("--json", "machine-readable")
  .action(async (o) => {
    // A deck too broken to load is still an answer: valid false, with the
    // structural issues loadDeck found, rather than an error and no list.
    let loaded;
    try {
      loaded = await loadDeck(o.deck);
    } catch (err) {
      if (err.code !== "invalid-deck") throw err;
      if (o.json) console.log(JSON.stringify({ ok: true, valid: false, issues: err.issues }, null, 2));
      else console.log(err.issues.map(issueLine).join("\n"));
      process.exitCode = 1;
      return;
    }
    const { deck } = loaded;
    const issues = await validateDeck(deck, fileChecks(deck, o));
    if (o.json) console.log(JSON.stringify({ ok: true, valid: !issues.some((i) => i.level === "error"), issues }, null, 2));
    else console.log(issues.length ? issues.map(issueLine).join("\n") : "valid");
    if (issues.some((i) => i.level === "error")) process.exitCode = 1;
  });

jsonResult("check", "exit 1 when clean is false, with the same document; a cell or fault carries code, severity and hint. ok:true says the command ran, clean says the answer.", {
  ok: "true",
  cells: "object[] — {name, slideId, slideIndex, slide, deviceId, locale, penalty, terms, estimated, faults[]}",
  worst: "number — the largest cell penalty",
  total: "number — the sum of the cell penalties",
  store: "object — {checked: boolean, faults[]}: canvas sizes, slot counts",
  copy: "object — {faults[], language, note}: the store-policy copy gate",
  strict: "boolean — --strict was passed",
  clean: "boolean — nothing blocking (everything, under strict)",
  estimated: "boolean — some text was sized by the glyph estimator",
  note: "string|null — why the run is a weaker claim (--fast, missing face)",
});

program
  .command("check")
  .description("score every cell of a deck: layout faults from layoutScore, colour faults from contrast")
  .requiredOption("--deck <path>", "deck JSON")
  .option("--assets <dir>", "where the deck's source keys resolve (default: the deck file's directory)")
  .option("--device <ids>", "comma-separated device ids (default: the deck's own)", list)
  .option("--locale <ids>", "comma-separated locales (default: the deck's own)", list)
  .option("--format <fmt>", "name cells the way this format renders them: png | jpeg (default: the deck's defaults.exportFormat, else png)")
  .option("--fast", "skip the browser and size text with the glyph estimator")
  .option("--strict", "make every warning blocking — the copy gate is warnings by default because its false positives are certain")
  .option("--no-store-check", "skip what the stores accept: canvas sizes, slot counts, featuring. Same as defaults.storeCheck: false on the deck")
  .option("--json", "machine-readable")
  .action(async (o) => {
    const ext = o.format != null ? extFor(formatOf(o.format)) : undefined;
    const loaded = (await loadDeck(o.deck)).deck;
    const deck = await validated(loaded, fileChecks(loaded, o));
    checkLocales(deck, o.locale);
    const devices = devicesFor(deck, o.device);
    checkNameClashes(deck, { devices, locales: o.locale, ext }, "rename one of the slides");
    const { result, estimated } = await graded(o.fast, (measurer) =>
      // --fast has no browser to measure with, and withLocaleStacks leaves the
      // deck untouched without a measurer, so every canvas would be graded on the
      // phone's shared ratios while a full check and render use each canvas's
      // own column. The estimator solves them; checkDeck still marks the cells
      // estimated.
      checkDeck(withLocaleStacks(deck, { devices: measuringDevices(deck, devices), measurer: measurer ?? estimatingMeasurer }), {
        devices,
        locales: o.locale,
        measurer,
        ext,
        strict: Boolean(o.strict),
        // Only when the flag was actually passed: commander defaults a --no-x
        // option to true, and passing true would override a deck that had
        // deliberately turned the gate off.
        storeCheck: o.storeCheck === false ? false : null,
      }),
    );
    reportCheck(result, { json: o.json, note: estimatedNote(result, estimated), storeFlag: o.storeCheck === false });
    // An exit code so the loop that drives this is a shell condition rather than
    // a parse of the output.
    if (!result.clean) process.exitCode = 1;
  });

jsonResult("polish", "printed after any --write/--out; nothing is written without one.", {
  ok: "true",
  changes: "object[] — {kind: layout|locale-fit|unmeasurable|copy-too-long|no-better|base-hurts, slide, deviceId, …}; only layout and locale-fit change the deck",
  note: "string|null — set when text was sized by the glyph estimator",
  estimated: "boolean — note is set",
  "wrote?": "string — the deck file written, absolute; present only when polish wrote one",
});

program
  .command("polish")
  .description("repair what check found: geometry at the base locale, size for a translation that overflows")
  .requiredOption("--deck <path>", "deck JSON")
  .option("--device <ids>", "comma-separated device ids", list)
  .option("--locale <ids>", "comma-separated locales", list)
  .option("--write", "write the repaired deck back over --deck")
  .option("--out <path>", "write the repaired deck here instead")
  .option("--fast", "skip the browser and size text with the glyph estimator")
  .option("--json", "machine-readable")
  .action(async (o) => {
    const { deck: loaded, envelope } = await loadDeck(o.deck);
    const deck = await validated(loaded);
    checkLocales(deck, o.locale);
    const devices = devicesFor(deck, o.device);
    const { result, estimated } = await graded(o.fast, (measurer) =>
      polishDeck(deck, { devices, locales: o.locale, measurer }),
    );
    const { deck: next, changes } = result;
    const note = estimatedNote({ estimated: false }, estimated);
    // Advisories say what polish could not do; only the rest change the deck,
    // and only they are counted, written, or worth a dry-run hint.
    const writable = changes.filter((c) => c.kind === "layout" || c.kind === "locale-fit");

    // `--out` always produces a file, even when there was nothing to repair.
    // The loop this exists for is check → polish → re-check, and a step that
    // silently writes nothing leaves the next one reading a path that isn't
    // there. `--write` in place is the one case where no changes means no
    // write, because the file is already what it would be written as.
    // The write comes before anything is printed: a failed write is the only
    // thing --json may say, not a result followed by the error.
    const target = o.out ?? (o.write && writable.length ? o.deck : null);
    if (target) await writeDeckFile(target, envelope ? { ...envelope, deck: next } : next);

    if (o.json) {
      console.log(JSON.stringify({ ok: true, changes, note, estimated: Boolean(note), ...(target && { wrote: resolve(target) }) }, null, 2));
    } else if (!changes.length) {
      console.log("nothing to repair");
    } else {
      for (const c of changes) {
        if (c.kind === "unmeasurable") {
          console.log(`  ${c.slide} · ${c.deviceId} · ${c.locale}: cannot measure this script without a loaded font`);
        } else if (c.kind === "copy-too-long") {
          const at = c.locale ? ` · ${c.locale}` : "";
          const floor = c.blockedBy?.length > 1 ? "are already at the floor" : "is already at the floor";
          const pinned = c.blockedBy?.length ? ` (${c.blockedBy.join(", ")} ${floor})` : "";
          console.log(`  ${c.slide} · ${c.deviceId}${at}: copy too long — the only fix left was type under the store floor${pinned}. Shorten the longest string on this slide.`);
        } else if (c.kind === "no-better") {
          console.log(`  ${c.slide} · ${c.deviceId}: penalty ${Math.round(c.before)}, and nothing polish tried scored better — fix it by hand`);
        } else if (c.kind === "base-hurts") {
          console.log(`  ${c.slide} · ${c.deviceId}: penalty ${Math.round(c.before)}, and the repair found would leave a translation on this card worse — fix it by hand`);
        } else if (c.kind === "locale-fit") {
          console.log(`  ${c.slide} · ${c.deviceId} · ${c.locale}: text ×${c.scale}${c.fitted ? "" : " (still not clean)"}`);
        } else {
          console.log(`  ${c.slide} · ${c.deviceId}: ${Math.round(c.before)} → ${Math.round(c.after)} (${c.keys.join(", ")})`);
        }
      }
      console.log(`${writable.length} change${writable.length === 1 ? "" : "s"}`);
    }
    if (note && !o.json) process.stderr.write(`warning: ${note}\n`);
    if (target) process.stderr.write(`wrote ${target}\n`);
    else if (writable.length) process.stderr.write("(dry run — pass --write to keep these)\n");
  });

// The column a look or layout leaves is solved on the faces check will grade it
// with: an estimator-solved column fails the full check. One path for apply and
// init, so a deck styled at birth is the deck apply would have left (N352, N374).
async function applySolved(deck, o) {
  const solves = Boolean(o.look || o.layout);
  const { result, estimated } = await graded(o.fast || !solves, (measurer) =>
    applyToDeck(deck, { look: o.look, layout: o.layout, lens: o.lens, slides: o.slide, measurer: measurer ?? estimatingMeasurer }),
  );
  return { result, note: solves ? estimatedNote({ estimated: false }, estimated) : null };
}

jsonResult("init", "printed after the deck file is written.", {
  ok: "true",
  path: "string — the deck file, absolute",
  slides: "number — slides written",
  devices: "string[] — the deck's projectDevices",
  "look?": "string — present only when --look was passed",
  "layout?": "string — the layout applied: --layout, or the one --icon/--art picks without it",
  estimated: "boolean — the column was solved with the glyph estimator (--fast)",
  warnings: "string[] — why the run is a weaker claim, as the line init prints on stderr",
});

program
  .command("init")
  .description("write a deck to start from: one selected slide per screenshot, the editor's own fresh layers")
  .option("--screenshots <dir>", "folder of PNG/JPEG/WebP screenshots, one slide each in name order (optional for the banner kinds: page-header, search-result, feature-graphic)")
  .option("--out <path>", "deck file to write; the screenshots folder must be inside its folder", "deck.json")
  .option("--kind <kind>", "slide kind (capabilities.kinds)", "phone")
  .option("--device <ids>", "comma-separated device ids (default: the kind's first row)", list)
  .option("--locale <ids>", "comma-separated locales, base first (default: en-US)", list)
  .option("--look <id>", "apply a look straight away (see `vitrine apply`)")
  .option("--layout <id>", "apply a layout preset straight away (see `vitrine apply`); with --look, overrides its geometry")
  .option("--icon <file>", "feature-graphic only: the app icon as an image layer (role icon, rounded); without --layout, fg-icon-left places it")
  .option("--art <file>", "feature-graphic only: key art as an image layer (role art); without --layout, fg-art-right places it")
  .option("--fast", "with --look/--layout: solve the column with the glyph estimator instead of the real faces")
  .option("--force", "overwrite an existing --out")
  .option("--json", "machine-readable: one document, printed after the deck is written")
  .action(async (o) => {
    const out = resolve(o.out);
    if (!o.force && (await stat(out).catch(() => null))) fail(`${o.out} exists — pass --force to overwrite it`);
    const root = await realpath(dirname(out)).catch(() => dirname(out));
    const within = (path) => path === root || path.startsWith(root + sep);
    // The same rule as the screenshots: a key that resolves outside the deck's
    // folder is one render and push refuse.
    const images = {};
    for (const role of IMAGE_ROLES) {
      if (!o[role]) continue;
      const path = await realpath(resolve(o[role])).catch(() => fail(`--${role} not found: ${o[role]}`));
      if (!within(path)) fail(`--${role} ${o[role]} is not inside ${root} — put --out beside it`);
      await checkImage(path, `--${role}`);
      const { width, height, orientation } = await sharp(path).metadata();
      images[role] = { key: relative(root, path).split(sep).join("/"), aspect: orientation >= 5 ? height / width : width / height };
    }
    if (!o.layout && (images.icon || images.art)) o.layout = images.art ? "fg-art-right" : "fg-icon-left";
    if (images.art && o.layout !== "fg-art-right") fail(`--art is placed only by --layout fg-art-right, not ${o.layout}`);
    let sources = [];
    if (o.screenshots) {
      // Real paths, as the resolver judges them: a symlinked folder or file
      // pointing out would write a deck render and push then refuse, and a
      // symlinked --out path would call a folder outside that is inside.
      const dir = await realpath(resolve(o.screenshots)).catch(() => fail(`no such folder: ${o.screenshots}`));
      // realpath succeeds on a file, and readdir below would then die as a raw ENOTDIR.
      if (!(await stat(dir)).isDirectory()) fail(`no such folder: ${o.screenshots} (it is a file, not a directory)`);
      // Source keys resolve inside the deck's folder (render and push refuse
      // anything outside it), so a folder elsewhere would write a dead deck.
      if (!within(dir)) {
        fail(`${o.screenshots} is not inside ${root} — put --out beside the screenshots folder`);
      }
      const files = (await readdir(dir))
        .filter((f) => SCREENSHOT_EXTENSIONS.includes(f.split(".").pop().toLowerCase()))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
      if (!files.length) fail(`no ${SCREENSHOT_EXTENSIONS.join("/")} files in ${o.screenshots}`);
      for (const f of files) {
        const target = await realpath(join(dir, f)).catch(() => null);
        if (target && !within(target)) fail(`${o.screenshots}/${f} is not inside ${root} — put --out beside the screenshots folder`);
      }
      sources = files.map((f) => ({
        key: relative(root, join(dir, f)).split(sep).join("/"),
        name: f.replace(/\.[^.]+$/, ""),
      }));
    }
    let deck = initDeck({ sources, kind: o.kind, devices: o.device, locales: o.locale, images });
    let note = null;
    if (o.look || o.layout) {
      const applied = await applySolved(deck, o);
      deck = applied.result.deck;
      note = applied.note;
      if (note) process.stderr.write(`warning: ${note}\n`);
    }
    await writeDeckFile(out, deck);
    if (o.json) {
      console.log(JSON.stringify({
        ok: true,
        path: out,
        slides: deck.screenshots.length,
        devices: deck.projectDevices,
        ...(o.look && { look: o.look }),
        ...(o.layout && { layout: o.layout }),
        estimated: Boolean(note),
        warnings: note ? [note] : [],
      }, null, 2));
      return;
    }
    console.log(`wrote ${o.out}: ${deck.screenshots.length} ${o.kind} slide${deck.screenshots.length === 1 ? "" : "s"} on ${deck.projectDevices.join(", ")}`);
  });

jsonResult("apply", "printed after any --write/--out; nothing is written without one.", {
  ok: "true",
  slides: "string[] — names of the slides written",
  targets: "object[] — {id, index, name} for each",
  estimated: "boolean — the column was solved with the glyph estimator (--fast)",
  warnings: "string[] — why the run is a weaker claim, as the line apply prints on stderr without --json",
  "wrote?": "string — the deck file written, absolute; present only when apply wrote one",
});

program
  .command("apply")
  .description("apply a look, a layout preset or a lens preset the way the editor's one-click styling does")
  .requiredOption("--deck <path>", "deck JSON")
  .option("--look <id>", "a look id (capabilities.looks): ground, layout and type style in one")
  .option("--layout <id>", "a layout preset id (capabilities.layoutPresets, or featureGraphicPresets on a feature graphic); with --look, overrides its geometry")
  .option("--lens <id>", "a lens preset id (capabilities.layers.lensPresets), for every lens layer")
  .option("--slide <ids>", "comma-separated slide ids or names (default: every selected slide)", list)
  .option("--write", "write the result back over --deck")
  .option("--out <path>", "write the result here instead")
  .option("--fast", "skip the browser and size text with the glyph estimator")
  .option("--json", "machine-readable")
  .action(async (o) => {
    const { deck: loaded, envelope } = await loadDeck(o.deck);
    const deck = await validated(loaded);
    const { result, note } = await applySolved(deck, o);
    const { deck: next, slides, targets } = result;
    const target = o.out ?? (o.write ? o.deck : null);
    // Written before printed, so a failed write leaves --json one document.
    if (target) await writeDeckFile(target, envelope ? { ...envelope, deck: next } : next);
    if (o.json) {
      console.log(JSON.stringify({
        ok: true,
        slides,
        targets,
        estimated: Boolean(note),
        warnings: note ? [note] : [],
        ...(target && { wrote: resolve(target) }),
      }, null, 2));
    }
    else console.log(slides.length ? `applied to ${slides.length} slide${slides.length === 1 ? "" : "s"}: ${slides.join(", ")}` : "no selected slide to apply to");
    if (note && !o.json) process.stderr.write(`warning: ${note}\n`);
    if (target) process.stderr.write(`wrote ${target}\n`);
    else process.stderr.write("(dry run — pass --write to keep this)\n");
  });

jsonResult("render", "printed after the last file is written; per-file progress goes to stderr.", {
  ok: "true",
  outDir: "string — the output directory, absolute",
  files: "object[] — {slide, slideId, device, deviceId, locale, path} per cell, in render order; device and deviceId are the same id (check's cells say deviceId)",
  count: "number — files.length",
});

program
  .command("render")
  .description("render every cell of a deck, named the way the editor's Download names it")
  .requiredOption("--deck <path>", "deck JSON")
  .option("--out <dir>", "output directory", "out/deck")
  .option("--assets <dir>", "where the deck's source keys resolve (default: the deck file's directory)")
  .option("--device <ids>", "comma-separated device ids (default: the deck's own)", list)
  .option("--locale <ids>", "comma-separated locales (default: the deck's own; the editor's \"current language only\" setting is not read here)", list)
  .option("--name-template <t>", "e.g. {device}/{order}_{slide} (default: the deck's defaults.exportNameTemplate, else that)")
  .option("--format <fmt>", "png | jpeg (default: the deck's defaults.exportFormat, else png)")
  .option("--quality <q>", "JPEG quality 0.3-1 (default: the deck's defaults.exportQuality, else 0.92)")
  .option("--open", "open the output directory when done")
  .option("--json", "machine-readable: one document on stdout after the last file is written (progress stays on stderr)")
  .action(async (o) => {
    const quality = o.quality != null ? Number(o.quality) : undefined;
    if (quality != null && (!Number.isFinite(quality) || quality < 0.3 || quality > 1)) {
      fail(`--quality must be a number between 0.3 and 1, got "${o.quality}"`);
    }
    const format = o.format != null ? formatOf(o.format) : undefined;
    checkNameTemplate(o.nameTemplate);
    const loaded = (await loadDeck(o.deck)).deck;
    const deck = await validated(loaded, fileChecks(loaded, o));
    checkLocales(deck, o.locale);
    const devices = devicesFor(deck, o.device);
    // A flag wins; what it didn't say is the deck's own setting, else the built-in.
    const own = exportSettings(deck.defaults);
    const used = { format: format ?? own.format, quality: quality ?? own.quality, template: o.nameTemplate ?? own.template };
    checkNameClashes(
      deck,
      { devices, locales: o.locale, template: used.template, ext: extFor(used.format) },
      o.nameTemplate != null
        ? "rename one of the slides, or put {order} in --name-template"
        : "rename one of the slides, or put {order} in the deck's defaults.exportNameTemplate (or pass --name-template)",
    );
    const outDir = resolve(o.out);
    // The same faces check measured, or the gate graded a different font.
    await registerCachedFonts();
    await cacheFonts(deck);
    await cacheStickers(deck);
    const resolveSource = sourceResolver(o.assets ?? dirname(resolve(o.deck)));
    // Files that are missing were refused by validated(), above. A slide's own
    // screenshot needs it only when a device layer on it draws it.
    const selected = { ...deck, screenshots: deck.screenshots.filter((s) => s?.selected) };
    // A file cut short past its header resolves, and paints as a blank screen.
    const found = [...collectDeckSources(selected).keys()].filter((key) => resolveSource(key));
    const broken = [];
    for (const key of found) if (!(await decodes(resolveSource(key)))) broken.push(key);
    if (broken.length) fail(`not an image (PNG, JPEG or WebP): ${broken.join(", ")}`);
    const files = [];
    const written = await withBrowser(async (browser) =>
      renderDeck(browser, await localeStacksMeasured(browser, deck, devices), {
        devices,
        locales: o.locale,
        template: used.template,
        outDir,
        format: used.format,
        quality: used.quality,
        resolveSource,
        onCell: (cell, output) => {
          files.push({ slide: cell.slide, slideId: cell.screenshot.id, device: cell.deviceId, deviceId: cell.deviceId, locale: cell.locale, path: output });
          process.stderr.write(`rendering ${output}\n`);
        },
      }),
    );
    // No selected slide of a kind these devices draw is a deck that renders to
    // nothing, and "done" over an empty folder reads as success.
    if (!written.length) fail("nothing to render: no selected slide for these devices and locales");
    process.stderr.write(`done. output: ${outDir}\n`);
    if (o.json) console.log(JSON.stringify({ ok: true, outDir, files, count: files.length }, null, 2));
    if (o.open) openInOs(outDir);
  });

// The server a push or session names is an origin: a path would be glued to
// every /api call, and a query or fragment into the middle of them.
function serverOrigin(value) {
  let url = null;
  try { url = new URL(value); } catch { /* reported below */ }
  if (!url || !/^https?:$/.test(url.protocol) || !/^\/*$/.test(url.pathname) || url.search || url.hash) {
    fail("--server must be an http(s) origin like http://localhost:3001");
  }
  const insecure = insecureServer(url.origin);
  if (insecure) fail(`--server: ${insecure}`);
  return url.origin;
}

jsonResult("push", "a failure after the project exists carries error.projectId in the error envelope.", {
  ok: "true",
  projectId: "string",
  reused: "boolean — the project is the one an earlier push made",
  replaced: "boolean — a deck an earlier push saved was overwritten (false on the first save, including the retry of a push that failed before saving)",
  session: "string — resumed | new | not-saved: about the owner, not the project",
  url: "string — the editor link; the claim link when claimed",
  claimed: "boolean — url is a one-use claim link",
  expiresAt: "number|null — claim expiry, epoch ms",
});

program
  .command("push")
  .description("upload a deck to a running Vitrine and print a link that opens it in the editor")
  .requiredOption("--deck <path>", "deck JSON")
  .option("--server <url>", "where to push", DEFAULT_SERVER)
  .option("--name <name>", "project name (default: the deck file's name); every push updates the same project, renaming it to this")
  .option("--assets <dir>", "where the deck's source keys resolve (default: the deck file's directory)")
  .option("--json", "machine-readable (`session` — resumed, new or not-saved — is about the owner; `reused` is about the project)")
  .action(async (o) => {
    const server = serverOrigin(o.server);
    const deck = await validated((await loadDeck(o.deck)).deck);
    const resolveSource = sourceResolver(o.assets ?? dirname(resolve(o.deck)));
    const name = o.name ?? basename(o.deck).replace(/\.[^.]+$/, "");

    let projectId = null;
    const result = await pushDeck(deck, {
      server,
      name,
      resolveSource,
      onStep: (step, info) => {
        // A wait can run to half a minute; under --json too, silence that long
        // reads as a hang. stderr, so stdout stays the one JSON document.
        if (step === "wait") return process.stderr.write(`server busy, retrying in ${info.seconds}s\n`);
        // Also under --json: a push that cannot be remembered is a new owner
        // next time, and the document alone would not say why.
        if (step === "session") {
          return process.stderr.write(info.warning === "unread"
            ? `warning: can't read the session file ${info.file} (${info.reason}) — this push starts a new owner; the file will be rewritten\n`
            : `warning: can't save the session to ${info.file} (${info.reason}) — the next push will start a new owner and project; set VITRINE_SESSION_FILE to a writable path\n`);
        }
        if (step === "project") projectId = info.projectId;
        if (o.json) return;
        if (step === "upload") process.stderr.write(`uploading ${info.index}/${info.total} ${info.key}\n`);
        else if (step === "font") process.stderr.write(`caching font ${info.family}\n`);
        else if (step === "sticker") process.stderr.write(`caching sticker ${info.id}\n`);
        else if (step === "project" && info.unsaved) process.stderr.write(`finishing “${name}”, which an earlier push created${info.renamed ? " (renamed)" : ""}\n`);
        else if (step === "project" && info.reused) process.stderr.write(`updating “${name}”${info.renamed ? " (renamed)" : ""}\n`);
        else if (step === "deck") process.stderr.write(`saved ${info.slides} slides\n`);
      },
    }).catch((err) => {
      // A failure past project creation says which project, so the retry that
      // reuses it is no surprise to an agent reading the envelope.
      if (projectId && err && typeof err === "object") err.projectId = projectId;
      throw err;
    });

    if (o.json) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
      return;
    }
    console.log(result.url);
    if (result.reused && !result.replaced) {
      console.log(`\nSaved “${name}” as its first deck — an earlier push created the project but never saved into it, so nothing was replaced.`);
    } else if (result.reused) {
      // True of the account's project too, not just the anonymous one: claiming
      // the same deck twice updates the copy the first link made rather than
      // adding a second card to the grid (`server/adopt.js`).
      console.log(`\nUpdated “${name}” in place — the deck it replaced is in the project's history.`);
    }
    if (result.claimed) {
      const mins = result.expiresAt == null ? null : Math.max(1, Math.round((result.expiresAt - Date.now()) / 60000));
      // Worth saying out loud: the link *is* the credential. Anyone who confirms
      // it gets a copy of the one deck it names. The last sentences are the
      // deadline on the work rather than on the link — a different clock, and the
      // one that costs something when it runs out — and the one-deck limit.
      console.log(
        `\nOpens the deck in the editor after a confirm. Signed in, it lands in your projects;` +
        `\notherwise it joins that browser's projects — a link brings only the deck it names. One use, expires ${mins == null ? "soon" : `in ~${mins} min`}.` +
        `\nThe deck is temporary — deleted within 24 h unless you sign in and keep it (your first project is free). A browser or account holds one: opening a link for a different deck asks before replacing it.`,
      );
    }
  });

jsonResult("session", "no network; the cookie itself is never printed.", {
  ok: "true",
  server: "string — the origin, normalised",
  file: "string — the session file",
  held: "boolean — a cookie is stored for this server",
  project: "object|null — {id, name} of the project push will reuse",
  problem: "string|null — why the session file could not be read",
  "cleared?": "true — present only after --clear",
});

program
  .command("session")
  .description("show which session and project `push` will reuse on a server, or forget them")
  .option("--server <url>", "which server's session", DEFAULT_SERVER)
  .option("--clear", "forget it — the next push starts a new owner and project; what it already pushed stays on the server until swept")
  .option("--json", "machine-readable")
  .action(async (o) => {
    // No network, and the cookie itself is never printed: it is a live credential.
    const server = serverOrigin(o.server);
    let cleared = false;
    if (o.clear) {
      const r = await clearSession(server);
      if (!r.saved) fail(`can't write ${sessionFile()} (${r.reason})`);
      cleared = true;
    }
    const s = await readSession(server);
    const [name, id] = Object.entries(s.projects).at(-1) ?? [];
    const info = {
      ok: true,
      server: serverKey(server),
      file: sessionFile(),
      held: Boolean(s.cookie),
      project: id ? { id, name } : null,
      problem: s.problem ?? null,
      ...(cleared ? { cleared } : {}),
    };
    if (o.json) return console.log(JSON.stringify(info, null, 2));
    console.log(`server:  ${info.server}`);
    console.log(`session: ${info.held ? "held" : "not held"} (${info.file})`);
    console.log(`project: ${info.project ? `“${name}” ${id}` : "none"}`);
    if (cleared) console.log("forgotten — the next push starts a new owner and project.");
    if (info.problem) console.error(`warning: can't read the session file ${info.file} (${info.problem})`);
  });

jsonResult("search", "results are capped by --limit; total is the match count before the cap.", {
  ok: "true",
  kind: "string — fonts | icons | emoji | stickers",
  total: "number",
  results: "object[] — fonts: {fontId, name, bundled, category?, scripts?}; icons: {sourceKey, name}; emoji: {sourceKey, name, char?}; stickers: {sourceKey, name, pack, aspect}. Write fontId or sourceKey into the deck",
});

program
  .command("search <kind> [query...]")
  .description(`find the value a deck writes for a font or sticker by what it is (${SEARCH_KINDS.join(", ")})`)
  .option("--limit <n>", "at most this many results", "20")
  .option("--weight <w>", "icons only: thin, light, regular, bold, fill or duotone (default: the picker's)")
  .option("--json", "machine-readable")
  .action(async (kind, words, o) => {
    const limit = Number(o.limit);
    if (!Number.isInteger(limit) || limit < 1) fail(`--limit must be a positive whole number, got "${o.limit}"`);
    const found = await searchAssets(kind, words.join(" "), { limit, weight: o.weight ?? null });
    if (o.json) return console.log(JSON.stringify({ ok: true, ...found }, null, 2));
    if (!found.results.length) return console.log(`no ${kind} match "${words.join(" ")}"`);
    for (const r of found.results) console.log(`${r.fontId ?? r.sourceKey}\t${r.char ? `${r.char} ` : ""}${r.name}`);
    if (found.total > found.results.length) console.log(`… ${found.total - found.results.length} more (--limit)`);
  });

jsonResult("font", "the cached family; an unknown family is an input error, a failed download a network error.", {
  ok: "true",
  family: "string — the catalogue's spelling; write it as the deck's font",
  weights: "number[]",
  variable: "boolean",
  slices: "string[]|null — the unicode-range strings of a non-Latin family's slices; null for Latin only",
});

program
  .command("font <family>")
  .description("cache a Google font so a deck using it renders without touching the network")
  .option("--json", "machine-readable: the cached family")
  .action(async (family, o) => {
    const { ensureFamily, fontPayload } = await import("../server/fonts.js");
    const font = await ensureFamily(family).catch((err) =>
      fail(err.message, { code: /^unknown /.test(err.message) ? "input" : "network", cause: err }));
    if (o.json) return console.log(JSON.stringify({ ok: true, ...fontPayload(font) }, null, 2));
    console.log(`cached ${font.family} (${font.weights.join(", ")})`);
  });

// The flat form, as the program's own action. It has to be an action rather than
// code after parse(): a program with subcommands and no action of its own prints
// help and exits, which is how `--input … --output …` stopped working the moment
// the deck subcommands were added. An operand that is not a command never gets
// here (routeCheck), so a mistyped command is not read as the one-shot form.
program.action(async () => {
  const opts = program.opts();
  checkFrameTint(opts);
  if (opts.config) await runBatch(opts.config, opts);
  else await runSingle(opts);
});

// One wording for the root help and the `help --json` document.
const EXIT_CODES = {
  0: "ok",
  1: "the answer is no: check not clean, validate found errors",
  2: "could not run: usage, bad input, or a deck check/render/push/polish/apply refuse",
  3: "network or server failure (push, font and sticker downloads)",
};

// With an action of its own the program adds no implicit help command, which is
// why `vitrine help check` used to fall through to the flat form.
program.helpCommand(true);
// The one-shot options stay parsed but leave the root help: they are the legacy
// shape, and listing them first made a typo'd command read as a missing --input.
for (const o of program.options) if (o.long !== "--version") o.hideHelp();
program.addHelpText("after", `
One-shot form (one screenshot, one headline; see README "Batch mode"):
  vitrine --input shot.png --device iphone-6.9 --headline "Hello" --output out.png

Exit codes:
${Object.entries(EXIT_CODES).map(([code, text]) => `  ${code}  ${text}`).join("\n")}
With --json a failure also prints {"ok":false,"error":{"code","message"}} on stdout.

Environment:
  VITRINE_SERVER        default --server for push and session
  VITRINE_SESSION_FILE  where push remembers its session
`);

// A word that is not a command is a typo, not a flat-form run: commander would
// hand it to the program's action and the user would read "--input is required".
// Option values are skipped by the program's own option table, so
// `--headline validate` stays the flat form.
//
// Help is answered here too, and returns true. Commander's own help command is
// created lazily and never in program.commands, so `help help` was an unknown
// command, and `help --json` reached it with "--json" as the command to show:
// root help on stderr, exit 2, no document. A help request under --json prints
// one document instead (helpDoc); without --json --help stays commander's.
function helpDoc(cmd) {
  const h = program.createHelp();
  if (cmd === program) {
    return {
      name: "vitrine",
      version: program.version(),
      usage: h.commandUsage(program),
      description: program.description(),
      commands: h.visibleCommands(program).map((c) => ({ name: c.name(), usage: h.commandUsage(c), description: c.description(), json: JSON_RESULTS.get(c.name()) ?? null })),
      exitCodes: EXIT_CODES,
      error: ERROR_ENVELOPE,
      capabilities: "vitrine capabilities — every value a deck may hold, and the fault table",
    };
  }
  return {
    name: cmd.name(),
    usage: h.commandUsage(cmd),
    description: cmd.description(),
    arguments: cmd.registeredArguments.map((a) => ({ name: a.name(), required: a.required, variadic: a.variadic })),
    options: h.visibleOptions(cmd).map((o) => ({
      flags: o.flags,
      description: o.description,
      required: Boolean(o.mandatory),
      value: o.required ? "required" : o.optional ? "optional" : null,
      default: o.defaultValue ?? null,
    })),
    json: JSON_RESULTS.get(cmd.name()) ?? null,
  };
}

function routeCheck(argv, json) {
  if (!argv.length) {
    program.outputHelp({ error: true });
    fail("no command given — pick one of the commands above", { code: "usage" });
  }
  let operand = null;
  let next = null;
  const end = argv.includes("--") ? argv.indexOf("--") : argv.length;
  for (let i = 0; i < end; i++) {
    const tok = argv[i];
    if (tok.startsWith("-")) {
      if (tok.includes("=")) continue;
      const o = program.options.find((opt) => opt.long === tok || opt.short === tok);
      if (o && (o.required || o.optional)) i++;
      continue;
    }
    operand = tok;
    next = argv.slice(i + 1, end).find((t) => !t.startsWith("-")) ?? null;
    break;
  }
  const names = [...program.commands.map((c) => c.name()), "help"];
  const unknown = (word) => fail(`unknown command '${word}'${didYouMean(word, names)}`, { code: "usage" });
  const commandNamed = (word) => program.commands.find((c) => c.name() === word) ?? program;
  if (operand != null && !names.includes(operand)) unknown(operand);
  if (operand === "help") {
    if (next != null && !names.includes(next)) unknown(next);
    const cmd = next == null ? program : commandNamed(next);
    if (json) console.log(JSON.stringify(helpDoc(cmd), null, 2));
    else cmd.outputHelp();
    return true;
  }
  if (json && argv.slice(0, end).some((t) => t === "-h" || t === "--help")) {
    console.log(JSON.stringify(helpDoc(operand == null ? program : commandNamed(operand)), null, 2));
    return true;
  }
  return false;
}

function didYouMean(word, names) {
  const w = word.toLowerCase();
  const distance = (a, b) => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return prev[b.length];
  };
  const close = names.map((n) => [n, distance(w, n)]).filter(([, d]) => d <= 2).sort((a, b) => a[1] - b[1])[0]?.[0]
    ?? names.find((n) => n.startsWith(w) || w.startsWith(n));
  return close ? ` (did you mean '${close}'?)` : "";
}

// A boolean flag takes no value in commander, so `--json=true` was an unknown
// option and, with nothing recognising it as --json, no envelope either (N382).
// Spelled true/1 it is --json, false/0 drops it; any other value stays an unknown
// option, now answered in the envelope.
const rawArgv = process.argv.slice(2);
const flagsEnd = rawArgv.includes("--") ? rawArgv.indexOf("--") : rawArgv.length;
const argv = rawArgv.flatMap((t, i) => {
  const m = i < flagsEnd && /^--json=(.*)$/.exec(t);
  if (!m) return [t];
  const v = m[1].toLowerCase();
  return v === "true" || v === "1" ? ["--json"] : v === "false" || v === "0" ? [] : [t];
});
const json = argv.slice(0, argv.includes("--") ? argv.indexOf("--") : undefined).some((t) => t === "--json" || t.startsWith("--json="));
try {
  if (!routeCheck(argv, json)) await program.parseAsync(argv, { from: "user" });
} catch (err) {
  report(err, json);
}
// Every command has closed its browser by now. What can still hold the loop open
// is a font upgrade abandoned at its deadline: an aborted fetch through a proxy
// that never answers keeps its socket. Exit once what was printed is flushed.
process.stderr.write("", () => process.stdout.write("", () => process.exit()));

function codeOf(err) {
  if (err instanceof CommanderError) return "usage";
  if (err instanceof CliError) return err.code;
  if (err?.kind === "network" || err?.kind === "server") return err.kind;
  return "input";
}

// The one place a failure leaves the CLI. Before this a rejected action was a
// raw Node stack, and every failure exited 1 — the same code as "check found
// something wrong", so a loop on the exit status could not tell a deck to polish
// from a deck it could not read. Now: 1 is an answer (check not clean, validate
// found errors), 2 is "could not run it" (usage, input, invalid deck), 3 is the
// network or the server. With --json stdout also gets one {ok:false,error}
// document, so a script parses the same shape for every failure. Never a stack,
// and exitCode rather than exit(): stdout is flushed by the last line of this file.
function report(err, json) {
  if (err instanceof CommanderError && /^commander\.(helpDisplayed|version|help)$/.test(err.code)) {
    process.exitCode = err.exitCode === 0 ? 0 : EXIT.usage;
    return;
  }
  const code = codeOf(err);
  const message = String(err?.message ?? err).replace(/^error: /, "");
  process.stderr.write(`error: ${message}\n`);
  if (json) {
    const error = { code, message, ...(err?.issues && { issues: err.issues }), ...(err?.status && { status: err.status }), ...(err?.projectId && { projectId: err.projectId }) };
    process.stdout.write(`${JSON.stringify({ ok: false, error }, null, 2)}\n`);
  }
  process.exitCode = EXIT[code];
}

function checkFrameTint(opts) {
  if (!isFrameTint(opts.frameTint)) {
    fail(
      `unknown --frame-tint "${opts.frameTint}". Available: ${Object.keys(FRAME_TINTS).join(", ")}`
    );
  }
}

async function resolveHeadline(slide) {
  if (slide.headline) return slide.headline;
  if (slide.headlineFromDescription) {
    process.stderr.write(
      `  generating headline for "${slide.headlineFromDescription}"...\n`
    );
    return generateHeadline(slide.headlineFromDescription);
  }
  return "";
}

// The flat form's three slots sit at fixed ratios tuned on a 19.5:9 phone. On a
// squarer canvas a headline that wraps runs into the subtitle, and on Play's
// 1024×500 banner the caption runs into the device and the device off the
// canvas. So what would collide is moved apart, measured the way `check`
// measures; a slide that already clears renders exactly where it always has.
async function flatLayers(browser, flat, deviceId) {
  const device = resolveDevice(deviceId);
  const W = device.canvasWidth;
  const H = device.canvasHeight;
  const { result } = await measuredRun(browser, (measurer) => {
    const layers = normalizeLayers(layersFromFlat(flat));
    const inkBottom = (role) => {
      const layer = layers.find((l) => l.role === role);
      if (!layer?.text) return null;
      const ink = textInkBox(layer, { W, H, device, measurer });
      return (ink.y + ink.h) / H;
    };
    const subtitle = layers.find((l) => l.role === "subtitle");
    const headline = inkBottom("headline");
    if (headline != null) subtitle.yRatio = Math.max(subtitle.yRatio, headline + CAPTION_GAP);

    const caption = Math.max(headline ?? 0, inkBottom("subtitle") ?? 0);
    const dev = layers.find((l) => l.type === "device");
    const top = caption + CAPTION_TO_DEVICE;
    if (caption && dev.yRatio < top) {
      // Its bottom edge stays put (or comes back onto the canvas), so the
      // device gives up height rather than running further off the bottom.
      dev.hRatio = Math.min(dev.yRatio + dev.hRatio, 1) - top;
      dev.yRatio = top;
    }
    // Moving things apart has run out of canvas: say so rather than render a
    // slide with no device or half a subtitle.
    const problem = caption > 1
      ? "the caption runs off the bottom of the canvas"
      : dev.hRatio <= 0
        ? "the caption leaves no room for the device"
        : dev.hRatio < MIN_FLAT_DEVICE_HEIGHT
          ? `the caption leaves the device ${Math.round(dev.hRatio * H)}px of ${H}px tall`
          : null;
    return { layers, problem };
  });
  if (result.problem) throw new Error(`${result.problem} on ${deviceId} — shorten the headline or subtitle`);
  return result.layers;
}

async function checkImage(path, label) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) fail(`${label} not found: ${path}`);
  if (!(await decodes(path))) fail(`${label} is not an image (PNG, JPEG or WebP): ${path}`);
}

// A value CSS drops renders as the default without a word, so ask the browser
// that is about to paint it. `checks` is [label, property, value][].
async function checkCss(browser, checks) {
  const page = await browser.newPage();
  try {
    /* global CSS */
    const bad = await page.evaluate(
      (list) => list.filter(([, prop, value]) => !CSS.supports(prop, value)),
      checks.filter(([, , value]) => value != null),
    );
    if (bad.length) fail(bad.map(([label, prop, value]) => `${label}: "${value}" is not a CSS ${prop}`).join("\n       "));
  } finally {
    await page.close();
  }
}

function expandOutputPath(template, deviceId, index) {
  return template
    .replaceAll("{device}", deviceId)
    .replaceAll("{index}", String(index + 1).padStart(2, "0"));
}

// A box with no `open`/`xdg-open` (a container, a CI runner) makes spawn emit
// "error" later, which with no listener crashed the CLI with a stack after the
// render had already succeeded (N497). The files are written; say so and go on.
function openInOs(path) {
  const launch = (cmd, args) =>
    spawn(cmd, args, { detached: true, stdio: "ignore" })
      .on("error", (err) => process.stderr.write(`warning: couldn't open ${path} (${err.code ?? err.message})\n`))
      .unref();
  if (process.platform === "win32") {
    // `start` is a cmd builtin, not an executable — invoke it through cmd. The
    // empty "" is the window-title argument `start` expects before the path.
    launch("cmd", ["/c", "start", "", path]);
    return;
  }
  launch(process.platform === "darwin" ? "open" : "xdg-open", [path]);
}

// Named for the row that renders, not the retired id that asked for it.
function batchDevices(slide, cfg) {
  return [...new Set((slide.devices ?? cfg.devices ?? ["iphone-6.3"]).map(currentDeviceId))];
}

function batchName(slide, i) {
  return slide.name ?? String(i + 1).padStart(2, "0");
}

// The header alone passes metadata(); a file cut short past it renders blank.
function decodes(path) {
  return sharp(path).raw().toBuffer().then(() => true, () => false);
}

async function validateBatch(cfg, base) {
  if (!Array.isArray(cfg?.slides) || cfg.slides.length === 0) {
    fail("config.slides must be a non-empty array");
  }
  const errors = [];
  const written = new Map();
  const resolveSource = sourceResolver(base);
  const outputDir = resolve(base, typeof cfg.outputDir === "string" ? cfg.outputDir : "out");
  if (cfg.frameTint && !isFrameTint(cfg.frameTint)) {
    errors.push(`unknown frameTint "${cfg.frameTint}"`);
  }
  if (cfg.useFrame != null && typeof cfg.useFrame !== "boolean") {
    errors.push("useFrame must be true or false");
  }
  for (const [i, slide] of cfg.slides.entries()) {
    const where = `slides[${i}]`;
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    if (slide.name != null && typeof slide.name !== "string") {
      errors.push(`${where}.name must be a string`);
      continue;
    }
    if (slide.frameTint && !isFrameTint(slide.frameTint)) {
      errors.push(`${where}: unknown frameTint "${slide.frameTint}"`);
    }
    for (const key of ["headline", "subtitle", "headlineFromDescription"]) {
      if (slide[key] != null && typeof slide[key] !== "string") errors.push(`${where}.${key} must be a string`);
    }
    if (slide.useFrame != null && typeof slide.useFrame !== "boolean") {
      errors.push(`${where}.useFrame must be true or false`);
    }
    // The name becomes a file name: a NUL byte got past here and failed in the
    // write with Node's "...without null bytes" (N427). Line/paragraph separators
    // and bidi overrides/isolates/marks reach the file name and reorder it in a
    // listing just as invisibly (N470).
    if (slide.name != null && (HIDDEN_NAME_CHARS.test(slide.name) || /[\u2028\u2029]/.test(slide.name))) {
      errors.push(`${where}.name must not contain control, invisible or bidi characters or line separators (got ${JSON.stringify(slide.name)})`);
    }
    // A layer normalizeLayer cannot read is dropped, and a list of nothing but
    // those renders an empty slide.
    if (slide.layers !== undefined) {
      if (!Array.isArray(slide.layers) || slide.layers.length === 0) {
        errors.push(`${where}.layers must be a non-empty array`);
      } else {
        for (const [j, layer] of slide.layers.entries()) {
          if (!LAYER_TYPES.includes(layer?.type)) {
            errors.push(`${where}.layers[${j}].type must be one of ${LAYER_TYPES.join(", ")}`);
          }
          // Resolved the way the render resolves it: contained in the config's
          // folder on real paths, like a deck's keys. Layers are deck-like data
          // (often model-written); `input` is a path like --input (N320) and
          // stays unconfined. A device layer draws its sourceKey the same way.
          const key = layer?.type === "image" || layer?.type === "device" ? layer.sourceKey : null;
          if (key && typeof key === "string" && !isStickerKey(key)) {
            const path = resolveSource(key);
            if (!path) {
              const exists = await stat(resolve(base, key)).catch(() => null);
              errors.push(exists
                ? `${where}.layers[${j}].sourceKey is outside the config's folder: ${key}`
                : `${where}.layers[${j}].sourceKey not found: ${key}`);
            } else if (!(await stat(path).catch(() => null))?.isFile()) {
              errors.push(`${where}.layers[${j}].sourceKey not found: ${key}`);
            } else if (!(await decodes(path))) {
              errors.push(`${where}.layers[${j}].sourceKey is not an image: ${key}`);
            }
          }
        }
      }
    }
    if (!slide.input) {
      errors.push(`${where}.input is required`);
    } else {
      const info = await stat(resolve(base, slide.input)).catch(() => null);
      if (!info?.isFile()) errors.push(`${where}.input not found: ${slide.input}`);
      else if (!(await decodes(resolve(base, slide.input)))) {
        errors.push(`${where}.input is not an image: ${slide.input}`);
      }
    }
    const devices = slide.devices ?? cfg.devices ?? ["iphone-6.3"];
    if (!Array.isArray(devices) || devices.length === 0) {
      errors.push(`${where}.devices must be a non-empty array (or set config.devices)`);
    } else {
      for (const d of devices) {
        if (!lookupDevice(d)) errors.push(`${where}: unknown device "${d}"`);
      }
      // Two slides writing one file would leave only the last of them on disk.
      for (const device of batchDevices(slide, cfg)) {
        // Without case: on macOS and Windows "Hero" and "hero" are one file.
        const file = `${batchName(slide, i)}-${device}.png`;
        // The name is the one part of the output path a config can steer past
        // outputDir ("../../x"); deck names are sanitized, this one is refused
        // (N320). outputDir itself stays the config author's choice.
        const rel = relative(outputDir, resolve(outputDir, file));
        if (rel.startsWith("..") || isAbsolute(rel)) {
          errors.push(`${where}.name would write outside outputDir (${file}) — a name is a file name, not a path out of it`);
          continue;
        }
        const key = file.toLowerCase();
        if (written.has(key)) errors.push(`${where} writes ${file}, as slides[${written.get(key)}] does — give it its own name`);
        else written.set(key, i);
      }
    }
  }
  if (errors.length) fail(`invalid config:\n  - ${errors.join("\n  - ")}`);
}

async function runBatch(configPath, opts) {
  const raw = await readFile(configPath, "utf8").catch((err) => {
    fail(err.code === "ENOENT" ? `no such config: ${configPath}` : err.message);
  });
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    fail(`${configPath} is not valid JSON: ${err.message}`);
  }
  const base = dirname(resolve(configPath));
  await validateBatch(cfg, base);
  // Layers are deck-like data (often model-written) and get the deck's
  // containment; `input` is a path like --input (N320), so it stays unconfined.
  const resolveSource = sourceResolver(base);
  const outputDir = resolve(base, cfg.outputDir ?? "out");
  const defaultBg = cfg.background ?? DEFAULT_BACKGROUND;
  const defaultTextColor = cfg.textColor ?? "#ffffff";
  const defaultUseFrame = cfg.useFrame ?? true;
  const defaultFrameTint = cfg.frameTint ?? opts.frameTint;

  const debugHtmlDir = cfg.debugHtmlDir
    ? resolve(base, cfg.debugHtmlDir)
    : null;
  const writeDebug = Boolean(cfg.debugHtmlDir);
  await cacheStickers({ screenshots: cfg.slides });

  await withBrowser(async (browser) => {
    await checkCss(browser, [
      ["background", "background", defaultBg],
      ["textColor", "color", defaultTextColor],
      ...cfg.slides.flatMap((slide, i) => [
        [`slides[${i}].background`, "background", slide.background],
        [`slides[${i}].textColor`, "color", slide.textColor],
      ]),
    ]);
    // Every slide is laid out before the first is rendered, so one that cannot
    // be fails without leaving the ones before it on disk.
    const jobs = [];
    for (const [i, slide] of cfg.slides.entries()) {
      const headline = await resolveHeadline(slide);
      const subtitle = slide.subtitle ?? "";
      const background = slide.background ?? defaultBg;
      const textColor = slide.textColor ?? defaultTextColor;
      const useFrame = slide.useFrame ?? defaultUseFrame;
      const frameTint = slide.frameTint ?? defaultFrameTint;
      const input = resolve(base, slide.input);
      const name = batchName(slide, i);
      for (const device of batchDevices(slide, cfg)) {
        jobs.push({
          input,
          device,
          background,
          output: join(outputDir, `${name}-${device}.png`),
          debugHtmlPath: writeDebug ? join(debugHtmlDir, `${name}-${device}.html`) : null,
          resolveSource,
          // A slide may spell out its own layer list instead of leaning on the
          // three flat slots — which is the only way a batch config can say
          // "a sticker here", since the flat shape has no word for one. The
          // config's colour and finish still reach a layer that names none of
          // its own.
          layers: slide.layers
            ? slide.layers.map((l) => {
                if (l?.type === "text") return { color: textColor, ...l };
                if (l?.type === "device") return { useFrame, frameTint, ...l };
                return l;
              })
            : await flatLayers(browser, { headline, subtitle, textColor, useFrame, frameTint }, device)
              .catch((err) => fail(`slides[${i}]: ${err.message}`)),
        });
      }
    }
    for (const job of jobs) {
      process.stderr.write(`rendering ${job.output}\n`);
      await renderSlide(browser, job);
    }
  });
  process.stderr.write(`done. output: ${outputDir}\n`);
  if (opts.open) {
    if (writeDebug) openInOs(debugHtmlDir);
    else openInOs(outputDir);
  }
}

async function runSingle(opts) {
  if (!opts.input) fail("--input is required (or use --config for batch mode)", { code: "usage" });
  if (!opts.device) fail("--device is required", { code: "usage" });
  if (!opts.output)
    fail(
      "--output is required (use {device} placeholder when --device has multiple ids)",
      { code: "usage" },
    );

  // Everything checked before the first render, so a bad second device or a
  // missing input fails without leaving a partial set of files behind.
  const requested = opts.device.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = requested.filter((id) => !lookupDevice(id));
  if (unknown.length) {
    fail(`unknown device ${unknown.map((id) => `"${id}"`).join(", ")}. Available: ${Object.keys(DEVICES).join(", ")}`);
  }
  // A retired id renders as its replacement, so the file is named for what it is.
  for (const id of requested) {
    if (currentDeviceId(id) !== id) process.stderr.write(`note: ${id} is retired — rendering ${currentDeviceId(id)}\n`);
  }
  const deviceIds = [...new Set(requested.map(currentDeviceId))];
  const placeheld = (path) => path.includes("{device}") || path.includes("{index}");
  if (deviceIds.length > 1 && !placeheld(opts.output)) {
    fail("--output needs a {device} or {index} placeholder when --device has multiple ids");
  }
  if (deviceIds.length > 1 && opts.debugHtml && !placeheld(opts.debugHtml)) {
    fail("--debug-html needs a {device} or {index} placeholder when --device has multiple ids");
  }
  await checkImage(opts.input, "--input");
  const headline = await resolveHeadline({
    headline: opts.headline,
    headlineFromDescription: opts.headlineFromDescription,
  });

  const lastWritten = { html: null, png: null };

  await withBrowser(async (browser) => {
    await checkCss(browser, [
      ["--background", "background", opts.background],
      ["--text-color", "color", opts.textColor],
    ]);
    // Laid out for every device first, so one that cannot be fails before any
    // file is written.
    const layersFor = [];
    for (const device of deviceIds) {
      layersFor.push(await flatLayers(browser, {
        headline,
        subtitle: opts.subtitle ?? "",
        textColor: opts.textColor,
        frameTint: opts.frameTint,
      }, device));
    }
    for (const [i, device] of deviceIds.entries()) {
      const outPath = resolve(expandOutputPath(opts.output, device, i));
      const debugPath = opts.debugHtml
        ? resolve(expandOutputPath(opts.debugHtml, device, i))
        : null;
      process.stderr.write(`rendering ${outPath}\n`);
      if (debugPath) process.stderr.write(`  + debug html ${debugPath}\n`);
      await renderSlide(browser, {
        input: resolve(opts.input),
        device,
        background: opts.background,
        output: outPath,
        debugHtmlPath: debugPath,
        layers: layersFor[i],
      });
      lastWritten.png = outPath;
      lastWritten.html = debugPath;
    }
  });

  if (opts.open) {
    openInOs(lastWritten.html ?? lastWritten.png);
  }
}


