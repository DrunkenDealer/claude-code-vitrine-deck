// Rendering a deck from the command line, exactly as the editor's Download
// would render it.
//
// "Exactly" is the whole claim, and it rests on src/deck.js: the cells, their
// resolved layers and their file names all come from the same function the
// editor walks, so the only thing left here is putting bytes on disk.
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deckCells, exportSettings, extFor } from "./deck.js";
import { usesSlideScreenshot } from "./layers.js";
import { renderSlide } from "./render.js";
import { BACKGROUNDS_DIR } from "./template.js";
import { isBackgroundImageKey } from "./visual.js";

// The screenshots the starter deck (server/starter.js) names as `examples/…`;
// the server serves the same folder (server/index.js EXAMPLES_DIR).
const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "examples");

// A folder key (`backgrounds/wide`) passed existsSync and failed later as a raw
// EISDIR; a bundled key must name a file.
const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

/**
 * A deck's source keys, mapped to files.
 *
 * Keys are project-relative (`uploads/phone/Home.png`) so a deck carries no
 * identity and can move between machines — which means the CLI has to be told
 * where "here" is. Two candidates, because there are two shapes a person
 * plausibly has on disk: a folder laid out the way the key reads, and a copy of
 * a server owner directory, where the same key lives under `images/`.
 *
 * Everything resolves inside `root` — absolute keys included. A key is data
 * from a file, very often one a model wrote, and `push` hands whatever this
 * returns to a server: a deck naming `/Users/me/.ssh/id_rsa` must neither read
 * one nor upload one. An absolute key that does point inside `root` still
 * works, so pointing `--assets` at the folder the deck came from is enough.
 */
export function sourceResolver(root) {
  const base = resolve(root);
  // Containment is judged on real paths: a symlink in the folder pointing at
  // ~/.ssh or any file elsewhere passes a lexical check yet reads (and, on
  // push, uploads) what is outside. A link that resolves inside stays allowed;
  // a dangling one has no real path and reads as missing, like any absent file.
  const real = (path) => { try { return realpathSync(path); } catch { return null; } };
  const inside = (path) => {
    if (path !== base && !path.startsWith(base + sep)) return false;
    const target = real(path);
    const realBase = real(base);
    return target !== null && realBase !== null && (target === realBase || target.startsWith(realBase + sep));
  };

  return (key) => {
    if (!key) return null;
    // `backgrounds/…` is the app's bundled photo pack, as `stickers/` is its
    // art: the key `capabilities` documents, resolved from the install like the
    // server does (identity.js resolveSource), never from the deck's folder. It
    // also serves the panorama's `backgrounds/wide/…` twin, which the template
    // swaps in by key. Before this a deck naming one failed render and push
    // unless a copy sat beside it, and a copy was uploaded as a plain asset.
    if (isBackgroundImageKey(key)) {
      if (key.split("/").includes("..")) return null;
      const full = resolve(BACKGROUNDS_DIR, key.slice(key.indexOf("/") + 1));
      return full.startsWith(BACKGROUNDS_DIR + sep) && isFile(full) ? full : null;
    }
    // `examples/…` is the same kind of key: the bundled screenshots the starter
    // deck uses, resolved from the install like the server does and skipped by
    // push as app-owned. Read from the deck's folder it failed render with
    // "screenshot not found" unless an examples/ copy sat beside the deck. The
    // install wins over such a copy, as it does for backgrounds and as the
    // server would draw it.
    if (key.startsWith("examples/")) {
      if (key.split("/").includes("..")) return null;
      const full = resolve(EXAMPLES_DIR, key.slice("examples/".length));
      return full.startsWith(EXAMPLES_DIR + sep) && isFile(full) ? full : null;
    }
    if (isAbsolute(key)) {
      const full = resolve(key);
      return inside(full) && existsSync(full) ? full : null;
    }
    const candidates = [join(base, key)];
    if (key.startsWith("uploads/")) candidates.push(join(base, "images", key.slice("uploads/".length)));
    for (const path of candidates) {
      const full = resolve(path);
      if (inside(full) && existsSync(full)) return full;
    }
    return null;
  };
}

// Only insist on the screenshot when something on the slide would draw it.
// A feature graphic is a banner: it may hold no device layer at all, and
// failing it for a missing file nothing opens would make the kind unusable.
// One definition for render's loop and for validate/check, so what they call
// clean is what render does not refuse.
export const cellNeedsMissingShot = (cell, resolveSource) =>
  usesSlideScreenshot(cell.layers) && !resolveSource(cell.screenshot.sourceKey);

/**
 * Render every cell. `onCell` is called before each one so a caller can report
 * progress; a cell whose screenshot is missing fails loudly rather than
 * rendering a slide with a hole in it.
 */
export async function renderDeck(browser, deck, {
  devices,
  locales = null,
  template,
  outDir,
  format,
  quality,
  resolveSource,
  onCell = null,
} = {}) {
  // What a flag didn't say is what the deck says, else the built-ins.
  const own = exportSettings(deck.defaults);
  format ??= own.format;
  quality ??= own.quality;
  template ??= own.template;
  const ext = extFor(format);
  const cells = deckCells(deck, { devices, locales, template, ext });
  const written = [];

  for (const cell of cells) {
    const input = resolveSource(cell.screenshot.sourceKey);
    if (cellNeedsMissingShot(cell, resolveSource)) {
      throw new Error(
        `screenshot not found for slide "${cell.slide}": ${cell.screenshot.sourceKey}`,
      );
    }
    const output = join(outDir, cell.name);
    onCell?.(cell, output);
    await renderSlide(browser, {
      input,
      device: cell.deviceId,
      layers: cell.paint,
      background: cell.background,
      span: cell.span,
      frameOverride: cell.frameOverride,
      output,
      format,
      quality,
      resolveSource,
    });
    written.push(output);
  }

  return written;
}
