// Real glyph advances for the CLI, measured by the browser that will render.
//
// Without this, `vitrine check` grades with src/textMetrics.js's estimator —
// a per-character table accurate to ~5% on the bundled families. Five percent
// on an *advance* is not five percent on a *layout*: line breaks are discrete,
// so a small width error becomes a whole extra line, and the block height is
// then out by a third. A measured deck put its hero headline 280px inside the
// device while `check` reported overlap 0. The estimator is the right fallback
// and the wrong default.
//
// The awkward part is that scoreLayout wants a **synchronous** measurer —
// `({fontId, weight}) => (str) => em` — and Playwright has no synchronous
// evaluate. Enumerating the strings up front doesn't work either: wrapLines
// asks for whatever the previous measurement made it ask for, including
// mid-word fragments after an `overflow-wrap: anywhere` break.
//
// So this iterates instead of guessing. Run the caller with a measurer that
// records every string it couldn't answer, measure that batch for real, run
// again. Better numbers change the wrap, which asks for different strings, so
// it repeats until a run asks for nothing new — two or three rounds in
// practice, and the table only ever grows, so it terminates.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateEm } from "./textMetrics.js";
import { fontFamilyStack, fontFilesFor, getFont, isKnownFont, nearestWeight, UNICODE_RANGE } from "./fonts.js";

const FONTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");

// What a caller that names no size is measured at. Advances are cached in em
// per face *and px size*: they are not linear in font-size for every face. The
// bundled families are Latin-only subsets, so Cyrillic falls through to the
// system face, and on macOS that is a variable font with an optical-size axis
// whose em advances grow below ~80px. A one-size table under-counted a Cyrillic
// headline's lines and put it over its subtitle (N782).
const REF_PX = 100;

// Enough rounds for the wrap to settle. Each round can only add entries, so
// this is a guard against a pathological deck rather than a real limit.
const MAX_ROUNDS = 8;

const faceKey = (fontId, weight) => `${fontId}|${weight}`;
const sizedKey = (fontId, weight, px) => `${faceKey(fontId, weight)}|${px}`;

/**
 * `@font-face` blocks for the faces that have files on disk, and the ids of
 * the ones that don't.
 *
 * A `gf:` family is registered from its cache directory, so a family whose
 * metadata survived but whose woff2 didn't is a real shape — and embedding
 * nothing for it would measure it in the default serif rather than fail.
 *
 * Each face carries the `text` it will measure, so a sliced (CJK) family
 * inlines only the slices that text draws instead of every one — megabytes
 * per face. `loaded` maps each face to the text its slices cover.
 */
export async function faceCss(faces) {
  const decls = [];
  const loaded = new Map();
  const missing = new Set();

  for (const { fontId, weight, text } of faces) {
    let files;
    try {
      files = fontFilesFor(fontId, [weight], text);
    } catch {
      missing.add(fontId);
      continue;
    }
    const bytes = await Promise.all(
      files.map((f) => readFile(join(FONTS_DIR, f.file)).catch(() => null)),
    );
    if (bytes.some((b) => b == null)) {
      missing.add(fontId);
      continue;
    }
    files.forEach((f, i) => {
      decls.push(
        `@font-face { font-family: "${f.family}"; font-style: normal;` +
          ` font-weight: ${f.range ?? f.weight}; font-display: block;` +
          ` src: url(data:font/woff2;base64,${bytes[i].toString("base64")}) format("woff2");` +
          `${UNICODE_RANGE.test(f.unicodeRange ?? "") ? ` unicode-range: ${f.unicodeRange};` : ""} }`,
      );
    });
    loaded.set(faceKey(fontId, weight), text);
  }
  return { css: decls.join("\n"), loaded, missing };
}

/**
 * Advances for a batch of (face, string) pairs, in em.
 *
 * **Every face is loaded explicitly and then checked.** `document.fonts.ready`
 * is not the signal it looks like: it answers for the faces the document
 * *uses*, and a page that only declares `@font-face` renders no text, so it
 * resolves immediately with nothing loaded. Canvas then silently measures the
 * default serif — which is narrower than a heavy display face, predicts four
 * lines where the browser lays out six, and reports the wrong answer with
 * `estimated: false` on it. That is worse than the estimator, because it is a
 * guess wearing a measurement's clothes.
 *
 * A face that refuses to load comes back in `failed` so the caller can fall
 * back to the estimator honestly instead of trusting a fallback advance.
 *
 * The whole batch crosses into the page once: a round trip per string would be
 * thousands of them for a deck.
 */
async function measureBatch(browser, css, jobs) {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!DOCTYPE html><meta charset="utf-8"><style>${css}</style>`, {
      waitUntil: "load",
    });
    return await page.evaluate(
      async ({ jobs: js }) => {
        /* global document */
        const out = {};
        const failed = [];
        const ctx = document.createElement("canvas").getContext("2d");
        for (const job of js) {
          // Readiness is asked of the quoted family alone: if the face is missing
          // this has to fail rather than quietly resolve to a fallback.
          const face = `${job.weight} ${job.px}px "${job.family}"`;
          // With the strings, both times: a sliced (CJK) family loads only the
          // slices the text names, and the default probe text is a lone space —
          // whose Latin slice a headline with no spaces never loaded.
          const text = job.strings.join("");
          try {
            await document.fonts.load(face, text);
          } catch {
            // A shorthand the parser rejects — check() will say so too.
          }
          if (!document.fonts.check(face, text)) {
            failed.push(job.fontId);
            continue;
          }
          // But the advances come from the render's whole stack. Characters the
          // face doesn't draw — Cyrillic in Sora — fall through to the same
          // system faces slideHtml.js and the editor fall through to; measured
          // in the default serif instead they came out ~12% narrower, and a
          // translated headline grew into its subtitle.
          ctx.font = `${job.weight} ${job.px}px ${job.stack}`;
          // Chromium accepts a font shorthand it cannot honour by leaving
          // ctx.font at its previous value, so this is the second half of the
          // same question: did the face we asked for actually take?
          if (!ctx.font.includes(job.family)) {
            failed.push(job.fontId);
            continue;
          }
          const byString = {};
          for (const s of job.strings) byString[s] = ctx.measureText(s).width / job.px;
          out[job.key] = byString;
        }
        return { out, failed };
      },
      { jobs },
    );
  } finally {
    await page.close();
  }
}

/**
 * A measurer factory over `table`, recording what it could not answer.
 *
 * Returns null for a face that cannot be measured at all — an unknown family,
 * or a `gf:` one that was never cached — because that is the answer
 * textMetrics understands, and a half-real measurement is worse than a
 * consistently estimated one: the error stops being uniform and the scorer's
 * tolerance no longer covers it.
 */
function recordingMeasurer(table, misses, unmeasurable) {
  return ({ fontId, weight, sizePx = REF_PX }) => {
    if (!isKnownFont(fontId) || unmeasurable.has(fontId)) {
      unmeasurable.add(fontId);
      return null;
    }
    const w = nearestWeight(fontId, weight);
    const px = Math.max(1, Math.round(sizePx));
    const key = sizedKey(fontId, w, px);
    const known = table.get(key);
    return (str) => {
      const hit = known?.get(str);
      if (hit !== undefined) return hit;
      let want = misses.get(key);
      if (!want) misses.set(key, (want = { fontId, weight: w, px, strings: new Set() }));
      want.strings.add(str);
      return estimateEm(str);
    };
  };
}

/**
 * Run `fn(measurer)` against real font metrics.
 *
 * `fn` must be synchronous and free of side effects outside its return value —
 * it is called once per round and only the last result is kept. `checkDeck`
 * and `polishDeck` are both pure, which is what makes this possible.
 *
 * Resolves `{ result, estimated, rounds }`. `estimated` lists the font ids that
 * could not be measured for real; it is empty on a clean run, and it is what
 * the CLI reports rather than calling a deck clean on numbers it guessed.
 */
export async function measuredRun(browser, fn) {
  const table = new Map();
  const unmeasurable = new Set();
  // The faces the embedded CSS already covers, and the text each one's slices
  // were picked for, so a round that turns up a new face — or a character the
  // loaded slices don't draw — rebuilds rather than measuring in a fallback.
  let css = "";
  let covered = new Map();
  let result;
  let rounds = 0;

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const misses = new Map();
    rounds = i + 1;
    result = fn(recordingMeasurer(table, misses, unmeasurable));
    if (misses.size === 0) break;

    // One entry per face however many sizes asked: the CSS is per face.
    const byFace = new Map();
    for (const { fontId, weight, strings } of misses.values()) {
      const key = faceKey(fontId, weight);
      const text = [...strings].join("");
      byFace.set(key, { fontId, weight, text: (byFace.get(key)?.text ?? "") + text });
    }
    const wanted = [...byFace.values()];
    const fresh = wanted.filter(({ fontId, weight, text }) => {
      const had = covered.get(faceKey(fontId, weight));
      return had == null || [...text].some((ch) => !had.includes(ch));
    });
    if (fresh.length) {
      // Rebuilt from every face this round asks for, not just the new ones:
      // one page has to answer for the whole batch below.
      const built = await faceCss(wanted);
      css = built.css;
      covered = built.loaded;
      for (const id of built.missing) unmeasurable.add(id);
    }

    const jobs = [...misses.entries()]
      .filter(([, { fontId, weight }]) => covered.has(faceKey(fontId, weight)))
      .map(([key, { fontId, weight, px, strings }]) => ({
        key,
        px,
        fontId,
        family: getFont(fontId).family,
        stack: fontFamilyStack(fontId),
        weight,
        strings: [...strings],
      }));
    // Every face fell through to unmeasurable — nothing left to ask the browser.
    if (!jobs.length) {
      result = fn(recordingMeasurer(table, new Map(), unmeasurable));
      break;
    }

    const { out: measured, failed } = await measureBatch(browser, css, jobs);
    for (const id of failed) unmeasurable.add(id);
    for (const [key, byString] of Object.entries(measured)) {
      let entry = table.get(key);
      if (!entry) table.set(key, (entry = new Map()));
      for (const [str, em] of Object.entries(byString)) entry.set(str, em);
    }
    // Nothing landed and nothing can: another round would ask the same
    // questions and get the same silence.
    if (!Object.keys(measured).length && failed.length) {
      result = fn(recordingMeasurer(table, new Map(), unmeasurable));
      break;
    }
  }

  return { result, estimated: [...unmeasurable], rounds };
}
