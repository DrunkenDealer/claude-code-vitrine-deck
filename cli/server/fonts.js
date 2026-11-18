// Google Fonts, cached to disk once and served locally forever after.
//
// The point is that rendering never touches the network: both renderers inline a
// local woff2, so a family costs exactly one download the first time anyone picks
// it and nothing thereafter. That also keeps the client and server renders on
// byte-identical font files, which a CDN link could not promise.
//
// The family name is matched against assets/google-fonts.json and the *matched*
// entry is what goes into the outbound URL — a name from a request body is never
// interpolated into it.
import { mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fontIdFor, getFont, isKnownFont, registerFont, UNICODE_RANGE } from "../src/fonts.js";
import { createFailureCache } from "./failureCache.js";
import { readCapped } from "./readCapped.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FONTS_DIR = resolve(ROOT, "assets", "fonts");
// Tests point VITRINE_FONT_CACHE at a temp dir; renders always read assets/fonts/cache.
const CACHE_DIR = process.env.VITRINE_FONT_CACHE ?? resolve(FONTS_DIR, "cache");
const CATALOG_PATH = resolve(ROOT, "assets", "google-fonts.json");

// The weights worth having: enough for a caption, a body and three grades of
// bold. Asking for a static family's missing weight 400s the whole request, so
// they are requested as a variable range first and narrowed on failure.
const WANTED = [300, 400, 500, 600, 700, 800, 900];

const DOWNLOAD_TIMEOUT_MS = 15000;
// A stale copy whose upgrade failed is not retried for this long: on a network
// that drops packets every attempt costs the full timeout.
const UPGRADE_BACKOFF_MS = 10 * 60 * 1000;
// A whole family is a handful of files; anything past this is not a font.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
// A CJK family's css2 across 7 weights is well under 1.5 MB; past 4 MB it is not Google's CSS.
const MAX_CSS_BYTES = 4 * 1024 * 1024;

// Memoized on the promise: `if (!catalog) catalog = await read()` is a
// check-then-act across an await, so every caller arriving before the first read
// resolves starts its own parse of the same file.
let catalog = null;
export function loadCatalog() {
  catalog ??= (async () => {
    const raw = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
    return new Map(raw.families.map((f) => [f.family.toLowerCase(), f]));
  })().catch((e) => {
    // Unlike the sticker caches, this one has no empty fallback — it throws, and
    // a cached rejection would make one bad read permanent. Drop it so the next
    // caller retries, exactly as the old per-call read did.
    catalog = null;
    throw e;
  });
  return catalog;
}

export async function catalogList() {
  return [...(await loadCatalog()).values()];
}

const slugOf = (family) => family.replace(/[^A-Za-z0-9]/g, "");

// Google serves a different (and much smaller) file set to a modern browser than
// to an unknown agent, and only the modern one is woff2.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// fetch is meant to reject when its signal fires, but the deadline is the
// caller's promise: a request that ignores it must not hold the caller past it.
function fetchUntil(url, signal, init = {}) {
  const aborted = new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  // Neither Google host redirects for these URLs, so a redirect is refused
  // rather than followed: it would let a hijacked response aim the server at
  // 127.0.0.1 or a metadata address.
  return Promise.race([fetch(url, { ...init, signal, redirect: "error" }), aborted]);
}

async function fetchCss(url, signal) {
  const res = await fetchUntil(url, signal, { headers: { "user-agent": UA } });
  if (!res.ok) return null;
  return (await readCapped(res, MAX_CSS_BYTES))?.toString("utf8") ?? null;
}

// Pull (weight, url) out of the @font-face blocks, keeping the Latin subset.
//
// Google splits a family across a dozen unicode-range subsets and lists Cyrillic
// FIRST — so "take the first block per weight" caches a file with no Latin
// glyphs in it, and every slide silently renders in the fallback face. The subset
// is chosen by what it covers rather than by the /* comment */ above it, since
// only the range is part of the CSS rather than a courtesy.
const LATIN_MARKER = "U+0000-00FF";

function parseFaces(css) {
  const byWeight = new Map();
  for (const block of css.split("@font-face")) {
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1]);
    const url = block.match(/src:[^;]*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1];
    if (!Number.isFinite(weight) || !url) continue;
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "";
    const latin = range.includes(LATIN_MARKER);
    const held = byWeight.get(weight);
    // A Latin block wins outright; otherwise keep the first thing seen, so a
    // response with no unicode-range at all still yields a file.
    if (!held || (latin && !held.latin)) byWeight.set(weight, { url, latin });
  }
  return new Map([...byWeight].map(([w, v]) => [w, v.url]));
}

// Every (url, range) per weight, in Google's order. A CJK family has no Latin
// subset worth keeping alone — its ideographs are spread over a hundred-odd
// slices — so all of them are cached and declared with their ranges.
export function parseSlices(css) {
  const byWeight = new Map();
  for (const block of css.split("@font-face")) {
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1]);
    const url = block.match(/src:[^;]*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1];
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (!Number.isFinite(weight) || !url || !range) continue;
    if (!byWeight.has(weight)) byWeight.set(weight, []);
    byWeight.get(weight).push({ url, range });
  }
  return byWeight;
}

// Run `fn` over `items`, a few at a time: a CJK family is ~120 files.
async function eachLimited(items, fn, limit = 8) {
  const queue = items.entries();
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (const [i, item] of queue) await fn(item, i);
    }),
  );
}

// A family that draws a non-Latin script is cached whole, slice by slice: the
// Latin-only file parseFaces keeps would draw a Russian headline in the fallback.
const isSliced = (entry) => Boolean(entry.scripts?.length);

// A copy cached Latin-only before its catalogue entry named a script.
export const isStale = (entry, meta) => isSliced(entry) && !meta.slices;

async function download(url, signal) {
  const res = await fetchUntil(url, signal);
  if (!res.ok) throw new Error(`font file ${res.status}`);
  const buf = await readCapped(res, MAX_FILE_BYTES);
  if (!buf) throw new Error("font file too large");
  // Cheap sanity check: a file that isn't woff2 would be cached, inlined, and
  // then fail to load in a render with no error anyone would see.
  if (buf.subarray(0, 4).toString("latin1") !== "wOF2") throw new Error("not a woff2 file");
  return buf;
}

// What a family looks like on disk. A sidecar rather than inference from
// filenames, because "one variable file covering 300 to 800" is not something a
// directory listing can say.
const metaPathFor = (slug) => join(CACHE_DIR, slug, "meta.json");

// A meta that is not a family of this folder reads as "not cached" — one bad
// folder must not throw out of registerCachedFonts and take every family with it,
// and ensureFamily refetches it. A folder with no meta yet (a download in
// progress) is skipped silently. Each folder warns once per process: GET
// /api/fonts and the CLI read the same metas over and over.
const warned = new Set();
const skip = (slug, why) => {
  if (!warned.has(slug)) console.warn(`fonts: skipping cache/${slug}: ${why}`);
  warned.add(slug);
  return null;
};

// Slices as cacheSliced writes them: a non-empty list of unicode-range strings.
const slicesValid = (slices) =>
  Array.isArray(slices) && slices.length > 0 && slices.every((r) => typeof r === "string" && UNICODE_RANGE.test(r));

// The files a meta promises, named as fontFile() does: one per weight, a single
// variable file, and a slice index last for a sliced family.
function filesOf(slug, { slices, weights, variable }) {
  const bases = variable ? [`${slug}-var`] : weights.map((w) => `${slug}-${w}`);
  return slices ? bases.flatMap((base) => slices.map((_, i) => `${base}.${i}.woff2`)) : bases.map((base) => `${base}.woff2`);
}

// A file counts as cached only if it opens, is not empty and starts with the
// woff2 signature — what download() checked when it wrote it. A meta alone
// proved nothing: a deleted file crashed the render with ENOENT and an empty or
// garbage one was inlined and silently drew the fallback face. Four header
// bytes, not a parse.
async function isWoff2(path) {
  let fh;
  try {
    fh = await open(path);
    const { bytesRead, buffer } = await fh.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && buffer.toString("latin1") === "wOF2";
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}

async function firstBadFile(slug, meta) {
  for (const file of filesOf(slug, meta)) if (!(await isWoff2(join(CACHE_DIR, slug, file)))) return file;
  return null;
}

// Slug -> the file that made readMeta call a family uncached, so ensureFamily can
// name it if the refetch has nowhere to go.
const damaged = new Map();

async function readMeta(slug) {
  let meta;
  try {
    meta = JSON.parse(await readFile(metaPathFor(slug), "utf8"));
  } catch (err) {
    return err.code === "ENOENT" || err.code === "ENOTDIR" ? null : skip(slug, "unreadable meta.json");
  }
  const ok =
    typeof meta?.family === "string" &&
    slugOf(meta.family) === slug &&
    Array.isArray(meta.weights) &&
    meta.weights.length &&
    meta.weights.every(Number.isFinite);
  if (!ok) return skip(slug, "invalid meta.json");
  if (meta.slices != null && !slicesValid(meta.slices)) return skip(slug, "invalid slices");
  const bad = await firstBadFile(slug, meta);
  if (bad) {
    damaged.set(slug, bad);
    return skip(slug, `${bad} is missing, empty or not a font`);
  }
  damaged.delete(slug);
  return meta;
}

// One in-flight fetch per family, so two cards asking at once download once.
const inflight = new Map();

// Families whose download just failed. POST /api/font is open to anyone and a
// failed attempt costs up to three requests and their timeouts, so without this
// one client retrying through an outage amplified it into Google. The error is
// kept and rethrown, so callers see the same message they would have.
const failures = createFailureCache();
export const forgetFontFailures = () => failures.clear();

// `timeout` bounds each request; `signal`, when given, bounds them all at once —
// the CLI's one deadline across every family it waits on.
export async function ensureFamily(requested, { timeout = DOWNLOAD_TIMEOUT_MS, signal } = {}) {
  const limit = () => signal ?? AbortSignal.timeout(timeout);
  // A string or nothing: String() of an object with a non-callable toString throws
  // a TypeError, which the route answered as a 502 "try again" for a bad request.
  const entry = typeof requested === "string" ? (await loadCatalog()).get(requested.toLowerCase()) : null;
  if (!entry) throw new Error("unknown family");
  const { family } = entry;
  const slug = slugOf(family);

  const have = await readMeta(slug);
  if (have && !isStale(entry, have)) return registerFont({ family, weights: have.weights, variable: have.variable, slices: have.slices });
  if (!have) {
    const bad = damaged.get(slug);
    if (!bad) return fetchFamily(entry, slug, limit);
    // The meta is there but a file it lists is not usable: refetch, and if that
    // cannot happen say which file is the problem rather than "could not reach".
    return fetchFamily(entry, slug, limit).then(
      (font) => (damaged.delete(slug), font),
      (err) => {
        throw new Error(`${family}: cached file ${bad} is missing, empty or not a font, and re-downloading it failed (${err.message})`);
      },
    );
  }

  // A stale Latin-only copy still draws Latin text, so an upgrade that fails
  // keeps it rather than failing the caller. The failure goes in its meta so
  // the next request, restart or CLI run does not pay the timeout again.
  const latin = () => registerFont({ family, weights: have.weights, variable: have.variable });
  if (Date.now() - (have.upgradeFailedAt ?? 0) < UPGRADE_BACKOFF_MS) return latin();
  return fetchFamily(entry, slug, limit).catch(async () => {
    await writeFile(metaPathFor(slug), JSON.stringify({ ...have, upgradeFailedAt: Date.now() })).catch(() => {});
    return latin();
  });
}

function fetchFamily(entry, slug, limit) {
  const { family } = entry;
  const failed = failures.get(family);
  if (failed) return Promise.reject(failed);
  if (inflight.has(family)) return inflight.get(family);
  const job = (async () => {
    const name = encodeURIComponent(family).replace(/%20/g, "+");
    // A variable family answers the range; a static one 400s it, and the plain
    // request then returns whatever weights it does have.
    const css =
      (await fetchCss(`https://fonts.googleapis.com/css2?family=${name}:wght@${WANTED.join(";")}&display=swap`, limit())) ??
      (await fetchCss(`https://fonts.googleapis.com/css2?family=${name}:wght@100..900&display=swap`, limit())) ??
      (await fetchCss(`https://fonts.googleapis.com/css2?family=${name}&display=swap`, limit()));
    if (!css) throw new Error("could not reach Google Fonts");
    if (isSliced(entry)) return cacheSliced(family, slug, css, limit);

    const faces = parseFaces(css);
    if (!faces.size) throw new Error("no woff2 in the Google Fonts response");

    await mkdir(join(CACHE_DIR, slug), { recursive: true });
    const weights = [...faces.keys()].sort((a, b) => a - b);
    // Every weight pointing at one URL means a variable family: cache the single
    // file and declare it across the range, rather than writing six identical
    // copies whose @font-face rules would each resolve to the default instance.
    const variable = new Set(faces.values()).size === 1 && faces.size > 1;

    if (variable) {
      await writeFile(join(CACHE_DIR, slug, `${slug}-var.woff2`), await download([...faces.values()][0], limit()));
    } else {
      for (const [weight, url] of faces) {
        await writeFile(join(CACHE_DIR, slug, `${slug}-${weight}.woff2`), await download(url, limit()));
      }
    }
    await writeFile(metaPathFor(slug), JSON.stringify({ family, weights, variable }));
    return registerFont({ family, weights, variable });
  })()
    .catch((err) => {
      failures.set(family, err);
      throw err;
    })
    .finally(() => inflight.delete(family));

  inflight.set(family, job);
  return job;
}

// Same variable test as above, over the whole slice list: every weight naming
// the same files is one variable family declared across the range. The file
// names follow fontFile() in src/fonts.js, slice index last.
async function cacheSliced(family, slug, css, limit) {
  const byWeight = parseSlices(css);
  if (!byWeight.size) throw new Error("no woff2 in the Google Fonts response");
  const weights = [...byWeight.keys()].sort((a, b) => a - b);
  const lists = [...byWeight.values()];
  const urls = (list) => list.map((s) => s.url).join(" ");
  const variable = lists.length > 1 && lists.every((l) => urls(l) === urls(lists[0]));
  const slices = lists[0].map((s) => s.range);
  const files = variable
    ? lists[0].map((s, i) => [`${slug}-var.${i}.woff2`, s.url])
    : [...byWeight].flatMap(([w, list]) => list.map((s, i) => [`${slug}-${w}.${i}.woff2`, s.url]));

  await mkdir(join(CACHE_DIR, slug), { recursive: true });
  await eachLimited(files, async ([file, url]) => writeFile(join(CACHE_DIR, slug, file), await download(url, limit())));
  // Written last, so a download cut short leaves no meta and the next ask retries.
  await writeFile(metaPathFor(slug), JSON.stringify({ family, weights, variable, slices }));
  const font = registerFont({ family, weights, variable, slices });
  // The Latin-only files a stale copy was drawn from are now unreferenced.
  const keep = new Set(files.map(([file]) => file));
  for (const file of await readdir(join(CACHE_DIR, slug))) {
    if (file.endsWith(".woff2") && !keep.has(file)) await rm(join(CACHE_DIR, slug, file), { force: true });
  }
  return font;
}

// What the client needs to rebuild the same font registry the server has.
//
// `variable` is not cosmetic: fontFile() picks "<slug>-var.woff2" for a variable
// family and "<slug>-<weight>.woff2" otherwise, so a payload that drops the flag
// makes the client ask for a file that was never written — and every render of a
// slide using that family fails, on both paths. One helper so the two routes
// cannot answer differently. `slices` is the same story for a CJK family.
export const fontPayload = ({ family, weights, variable, slices }) => ({ family, weights, variable, slices });

// Register everything already cached, so a render after a restart resolves the
// family without going back to the network. A stale Latin-only copy is
// registered as it is and upgraded to its slices in the background — boot and
// GET /api/fonts never wait on Google. `wait` (the CLI, with a short `timeout`)
// tries the upgrades in parallel under one deadline, aborting whatever is left
// and falling back to the Latin copy.
export async function registerCachedFonts({ wait = false, timeout } = {}) {
  const out = [];
  const signal = wait ? AbortSignal.timeout(timeout ?? DOWNLOAD_TIMEOUT_MS) : undefined;
  const catalog = await loadCatalog().catch(() => new Map());
  for (const slug of await readdir(CACHE_DIR).catch(() => [])) {
    const meta = await readMeta(slug);
    if (!meta) continue;
    const register = () =>
      registerFont({ family: meta.family, weights: meta.weights, variable: meta.variable, slices: meta.slices });
    const entry = catalog.get(meta.family.toLowerCase());
    if (!entry || !isStale(entry, meta)) {
      out.push(register());
      continue;
    }
    const upgrade = ensureFamily(meta.family, { timeout, signal }).catch(register);
    if (wait) {
      out.push(upgrade);
      continue;
    }
    // An upgrade that finished after `meta` was read has registered the slices
    // and deleted the Latin files; re-registering the old copy would point at them.
    const id = fontIdFor(meta.family);
    out.push(isKnownFont(id) && getFont(id).slices ? getFont(id) : register());
  }
  return Promise.all(out);
}
