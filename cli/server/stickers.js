// The sticker library's server half: the bundled manifest, and the on-demand
// packs cached to disk a file at a time.
//
// On-demand packs follow the font rule exactly (see server/fonts.js): rendering
// never touches the network, so a piece costs one download the first time anyone
// picks it and nothing thereafter — and the client render and the server render
// stay on byte-identical files, which a CDN link could not promise. Bundling
// them is not an option at this size: ~3.9k emoji and 9,072 Phosphor icons would
// be hundreds of megabytes in the image for art most decks never use.
//
// The id is matched against that pack's catalog and the *matched* entry is what
// builds the outbound URL and the path on disk — an id from a request body is
// never interpolated into either.
//
// Two callers cache a sticker, and they are not redundant. The GET route fetches
// on a miss so a layer whose file is gone (the cache is not a volume, so every
// deploy empties it) repaints and re-fills it. POST /api/sticker is the
// guarantee: it resolves only once the file is on disk, which is what the editor
// waits for before a layer points at one, so a server-side export or CLI render
// can never find it missing. Both go through ensureSticker, which dedupes per
// file and downloads under a gate.
import { mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMOJI_PACK,
  ICONS_PACK,
  applyTint,
  indexStickers,
  packSlotsFor,
  tintFromQuery,
} from "../src/stickers.js";
import { STICKERS_DIR } from "../src/template.js";
import { createFailureCache } from "./failureCache.js";
import { LimiterFullError, createLimiter } from "./limit.js";
import { readCapped } from "./readCapped.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
// One definition of where the library lives: src/template.js resolves sticker
// paths for the render, and this serves the same files over HTTP.
export { STICKERS_DIR };
const MANIFEST_PATH = resolve(STICKERS_DIR, "index.json");

const DOWNLOAD_TIMEOUT_MS = 15000;
// One emoji is a few KB of paths, one icon rather less; anything past this is
// not either.
const MAX_FILE_BYTES = 512 * 1024;

// Where the art comes from, and what has to ship beside it. The emoji SVGs in
// noto-emoji are Apache 2.0 — the OFL covers the font files only, which is a
// distinction worth keeping straight in the one place that fetches them.
//
// Pinned to a release tag rather than main: upstream moved svg/ to 2D/svg/ once
// already and every uncached emoji 404ed until the catalog caught up. A tag is a
// tree that cannot move under the catalog's paths; bump it together with
// assets/noto-emoji.json (scripts/download-emoji.mjs builds the paths).
const EMOJI_BASE = "https://raw.githubusercontent.com/googlefonts/noto-emoji/v2026-09-24-unicode18_0";
const EMOJI_NOTICE = `Noto Emoji
Source: https://github.com/googlefonts/noto-emoji (tag v2026-09-24-unicode18_0)

The emoji under 2D/svg/ are Copyright Google Inc., licensed under the Apache
License, Version 2.0 — https://www.apache.org/licenses/LICENSE-2.0
(The SIL Open Font License covers that repository's font files, not these.)

The flags under third_party/region-flags are in the public domain or otherwise
exempt from copyright.

Cached on demand by Vitrine. This directory is generated — do not edit.
`;

// Pinned to the commit main was at on 2026-10-26 (phosphor-icons/core
// 2b75f3ad12b420c9504ef05df8d2564a28f8500e), for the emoji base's reason: `main`
// is mutable, so a push upstream could change or move the art under the catalog
// — or put a hostile file where every uncached icon is fetched from. Bump it
// together with assets/phosphor.json.
const PHOSPHOR_BASE = "https://raw.githubusercontent.com/phosphor-icons/core/2b75f3ad12b420c9504ef05df8d2564a28f8500e";
const PHOSPHOR_NOTICE = `Phosphor Icons
Source: https://github.com/phosphor-icons/core

Copyright (c) 2023 Phosphor Icons, licensed under the MIT License —
https://opensource.org/licenses/MIT

Changed from the originals: fill="currentColor" is replaced with the pack's ink
slot colour, so a deck can recolour an icon the way it recolours every other
sticker. Nothing else is touched — the geometry is Phosphor's.

Cached on demand by Vitrine. This directory is generated — do not edit.
`;

// The weight whose files carry no suffix: assets/regular/trophy.svg, against
// assets/duotone/trophy-duotone.svg. It is what lets a sticker id stay readable.
const BARE_WEIGHT = "regular";

// The packs whose art is fetched rather than bundled. Each one says where its
// catalog is, how an entry becomes a search result, and how an id inside the
// pack resolves to a file — which is the only place a pack's shape is known.
const ON_DEMAND = {
  [EMOJI_PACK]: {
    catalog: resolve(ROOT, "assets", "noto-emoji.json"),
    load: (raw) => ({ entries: raw.emoji ?? [], key: (e) => e.cp }),
    item: (e) => ({ id: e.cp, name: e.name, keywords: e.keywords ?? [] }),
    base: EMOJI_BASE,
    notice: EMOJI_NOTICE,
    unknown: "unknown emoji",
    resolve(id, { byKey }) {
      const entry = byKey.get(id);
      // Flags are not in 2D/svg/ — they live under third_party/region-flags
      // and the catalog carries the path, so the fetcher never has to guess
      // which bucket an emoji came from.
      return entry ? { id: entry.cp, name: entry.name, path: entry.path } : null;
    },
  },
  [ICONS_PACK]: {
    catalog: resolve(ROOT, "assets", "phosphor.json"),
    load: (raw) => ({ entries: raw.icons ?? [], key: (e) => e.name, weights: raw.weights ?? [] }),
    item: (e) => ({ id: e.name, name: e.label, keywords: e.keywords ?? [] }),
    base: PHOSPHOR_BASE,
    notice: PHOSPHOR_NOTICE,
    unknown: "unknown icon",
    // Phosphor ships every icon in six weights, so the weight is part of the id
    // rather than a seventh pack — six more tabs in a 320px panel is not a
    // control anyone can use. The suffix is matched against the catalog's own
    // weight list, and the path is rebuilt from what matched.
    resolve(id, { byKey, weights }) {
      const weight = weights.find((w) => w !== BARE_WEIGHT && id.endsWith(`-${w}`)) ?? BARE_WEIGHT;
      const entry = byKey.get(weight === BARE_WEIGHT ? id : id.slice(0, -(weight.length + 1)));
      if (!entry) return null;
      const file = weight === BARE_WEIGHT ? entry.name : `${entry.name}-${weight}`;
      return { id: file, name: `${entry.label} ${weight}`, path: `assets/${weight}/${file}.svg` };
    },
    // Phosphor draws in currentColor, which an <img> resolves to black and
    // applyTint cannot see at all. Substituting the pack's own ink sentinel on
    // the way to disk is what makes all 9,072 recolourable through exactly the
    // same path as an authored sticker — and taking the hex from the manifest
    // rather than a constant here is what keeps the two from drifting.
    transform: (text, slots) => text.replaceAll("currentColor", slots?.[0]?.default ?? "#111827"),
  },
};

// What counts as a sticker: a document whose root element is <svg>, after at
// most a BOM, an XML prolog, comments and a doctype. A substring check took any
// page that merely mentions "<svg" — a captive portal, a CDN error page with an
// inline logo — cached it for good and served it as image/svg+xml.
//
// Walked with indexOf over a bounded head rather than matched with a regex: the
// regex had two adjacent `(?:<!--…-->\s*)*` groups, and an upstream body of
// thirty `<!---->` followed by `<html>` (~210 bytes) backtracked exponentially —
// minutes of frozen event loop from one response. Each step here consumes input,
// so the cost is linear in the head, and a prolog longer than the head is not a
// sticker anyone drew.
const HEAD_BYTES = 4096;
function isSvg(text) {
  if (typeof text !== "string") return false;
  const head = text.slice(0, HEAD_BYTES);
  let i = head.charCodeAt(0) === 0xfeff ? 1 : 0;
  let xmlDecl = true;
  for (;;) {
    while (i < head.length && /\s/.test(head[i])) i++;
    let end;
    if (xmlDecl && head.startsWith("<?xml", i)) end = head.indexOf("?>", i) + 2;
    else if (head.startsWith("<!--", i)) end = head.indexOf("-->", i + 4) + 3;
    else if (head.slice(i, i + 9).toUpperCase() === "<!DOCTYPE") end = head.indexOf(">", i) + 1;
    else return /^<svg[\s>]/i.test(head.slice(i, i + 5));
    // indexOf missed: the construct never closes inside the head.
    if (end < 3) return false;
    // The prolog is only allowed once and first, as before.
    xmlDecl = false;
    i = end;
  }
}

// Upstream failures are remembered for a few minutes (server/failureCache.js):
// the sticker route is open to anyone, and a miss used to go back to GitHub on
// every request. The error itself is what is kept, so its `missing` flag — the
// upstream answered 404 — survives into the status the route picks.
const failures = createFailureCache();
export const forgetStickerFailures = () => failures.clear();

export const isOnDemand = (pack) => Object.hasOwn(ON_DEMAND, pack);

const packDir = (pack) => resolve(STICKERS_DIR, pack);

// The /stickers route. Not express.static, because a sticker is recoloured on
// the way out from the slot colours in the query — the server does that rather
// than the browser because the live canvas preview paints an <img>
// synchronously and cannot await the file's text.
//
// Exported as a handler rather than written inline in server/index.js so the
// render-parity test can mount the same one: a harness that served these files
// untinted would fail the very drift it exists to catch.
//
// `missLimit(client)` is a token bucket (server/rate.js) charged only when the
// file is not cached: a cached sticker stays as fast as a static file, while a
// client minting uncached ids to fill the download queue is refused with 429.
export function serveSticker(resolveKey, { clientOf = () => "", missLimit } = {}) {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let rel;
    try {
      rel = decodeURIComponent(req.path).replace(/^\/+/, "");
    } catch {
      return next();
    }
    if (!rel.endsWith(".svg")) return next();
    // The same resolver the render paths use, so a traversal is rejected once.
    const path = resolveKey(`stickers/${rel}`);
    // Past this point the request *was* addressed to this route, so a miss is a
    // 404 rather than a next(). Every other asset route in server/index.js falls
    // through to the SPA instead, which means a deleted upload answers 200 with
    // index.html; here that is not survivable. These URLs are <img> sources, and
    // clientRender's toDataUrl only checks res.ok — so an export would inline
    // 5KB of HTML as the picture rather than skip the layer, which is exactly
    // what inlineSources promises not to do.
    if (!path) return res.sendStatus(404);

    const id = rel.slice(0, -4);
    let text = await readFile(path, "utf8").catch(() => null);
    if (!isSvg(text)) {
      // Not on disk (or empty/garbage, which is the same thing). For an
      // on-demand pack that means "not cached yet" rather than "not a sticker".
      // Anything the catalog doesn't name 404s.
      //
      // Picker tiles come through here too, so visitors never talk to the
      // upstream host: a page of tiles is up to ~60 first-time downloads, queued
      // behind downloadLimit and cached for everyone after.
      const client = clientOf(req);
      const taken = missLimit?.(client);
      if (taken && !taken.ok) {
        res.set("Retry-After", String(Math.ceil(taken.retryAfterMs / 1000)));
        return res.sendStatus(429);
      }
      try {
        await ensureSticker(id, client);
        text = await readFile(path, "utf8");
      } catch (err) {
        if (err instanceof LimiterFullError) {
          res.set("Retry-After", "10");
          return res.sendStatus(503);
        }
        // A sticker the catalog doesn't name, or that upstream says it does not
        // have, is 404. Anything else is us failing to fetch a real one — a 404
        // there reads as "gone" and the editor drops the layer's picture.
        return res.sendStatus(err.missing || err.message?.startsWith("unknown ") ? 404 : 502);
      }
    }

    const slots = await slotsForId(id);
    res.type("image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=3600");
    // Opened directly, an SVG is a document: a script in one would run with our
    // origin. As an <img> this header is ignored, so rendering is unaffected.
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(applyTint(text, slots, tintFromQuery(req.query, slots)));
  };
}

// What a sticker declares to recolour. The manifest names the 76 authored pieces
// one by one; an on-demand pack carries its slots on the pack, because every
// file in it took the same treatment on the way to disk.
export async function slotsForId(id) {
  const manifest = await loadManifest();
  return indexStickers(manifest).get(id)?.slots ?? packSlotsFor(id, manifest.packs);
}

// Memoized on the *promise*, not on the parsed value. `if (!x) x = await read()`
// is a check-then-act across an await: every caller that arrives before the
// first read resolves sees the empty cache and starts its own, so browsing the
// emoji pack had ~60 handlers each parsing the 717KB catalog. Caching the
// promise means the second caller awaits the first one's work.
//
// The inner function swallows its own failure, so the cached promise always
// resolves and one unreadable file can never be retried into a rejection loop.
let manifest = null;
export function loadManifest() {
  manifest ??= (async () => {
    try {
      const raw = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
      return { packs: raw.packs ?? [], stickers: raw.stickers ?? [] };
    } catch {
      // A checkout with no library is not a broken server — the picker comes up
      // empty and every other surface is untouched.
      return { packs: [], stickers: [] };
    }
  })();
  return manifest;
}

export async function stickerIndex() {
  return indexStickers(await loadManifest());
}

// The promise, for loadManifest's reason — and more so here, because these are
// the big files (717KB of emoji, 223KB of icons) and a pack asks for its own in
// a burst the moment someone opens it.
const catalogs = new Map();
function loadCatalog(pack) {
  if (!catalogs.has(pack)) {
    catalogs.set(pack, (async () => {
      const spec = ON_DEMAND[pack];
      try {
        const { entries, key, ...rest } = spec.load(JSON.parse(await readFile(spec.catalog, "utf8")));
        return { byKey: new Map(entries.map((e) => [key(e), e])), entries, ...rest };
      } catch {
        return { byKey: new Map(), entries: [], weights: [] };
      }
    })());
  }
  return catalogs.get(pack);
}

// Everything in one on-demand pack that *could* be fetched — what the picker
// searches over, in the one shape the picker knows.
export async function stickerCatalog(pack) {
  if (!isOnDemand(pack)) return null;
  const { entries, weights } = await loadCatalog(pack);
  return { items: entries.map(ON_DEMAND[pack].item), weights: weights ?? [] };
}

async function headIsSvg(path) {
  let fh;
  try {
    fh = await open(path);
    const { bytesRead, buffer } = await fh.read(Buffer.alloc(1024), 0, 1024, 0);
    return isSvg(buffer.toString("utf8", 0, bytesRead));
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}

// Which on-demand stickers are already on disk, as sticker ids — the client
// registers these at boot so a restored deck paints without a round trip each.
export async function cachedStickers() {
  const packs = await Promise.all(
    Object.keys(ON_DEMAND).map(async (pack) => {
      try {
        const files = (await readdir(packDir(pack))).filter((f) => f.endsWith(".svg"));
        // The same test a download passes, on the head of each file: an empty or
        // garbage one listed here is registered as cached and never repaired.
        const sound = await Promise.all(files.map((f) => headIsSvg(resolve(packDir(pack), f))));
        return files.filter((_, i) => sound[i]).map((f) => `${pack}/${f.slice(0, -4)}`);
      } catch {
        return [];
      }
    }),
  );
  return packs.flat();
}

// A NOTICE is a constant, so writing it per download rewrote a byte-identical
// file thousands of times a session. Once the directory has it, it has it.
const noticed = new Set();
async function writeAttribution(pack) {
  if (noticed.has(pack)) return;
  noticed.add(pack);
  await writeFile(resolve(packDir(pack), "NOTICE.txt"), ON_DEMAND[pack].notice).catch(() => {});
}

// One in-flight download per file, so the ~60 tiles a pack renders don't each
// open their own socket for the same one. Copied from ensureFamily in
// server/fonts.js, including the detail that makes it correct: nothing awaits
// between the cache-miss check and the `inflight` check, so the pair is atomic.
const inflight = new Map();
// And a ceiling across *different* files, so opening a pack queues instead of
// hitting one host 60 ways at once.
//
// Queued per client, round-robin, and bounded. One shared FIFO let a single
// anonymous client ask for a thousand distinct uncached ids and make every other
// visitor's first sticker wait behind all of them (48 s and growing). Keyed by
// client, a second visitor waits one download rather than someone else's
// backlog; the caps are a page of tiles (~60) with headroom per client, and a
// ceiling overall so the queue is not unbounded memory. Past either, ensureSticker
// throws LimiterFullError and the route answers 503 + Retry-After.
const downloadLimit = createLimiter(4, { maxQueue: 300, maxQueuePerKey: 80 });

// Resolves with the sticker id once the file is on disk. Throws "unknown …" for
// anything its pack's catalog does not name, which the route turns into a 400 —
// the same split ensureFamily uses.
async function lookup(rawId) {
  // A string or nothing, as in ensureFamily: String() of {"toString":1} throws.
  const raw = typeof rawId === "string" ? rawId : "";
  const slash = raw.indexOf("/");
  const pack = slash < 0 ? "" : raw.slice(0, slash);
  if (!isOnDemand(pack)) throw new Error("unknown sticker");

  const spec = ON_DEMAND[pack];
  const hit = spec.resolve(raw.slice(slash + 1), await loadCatalog(pack));
  if (!hit) throw new Error(spec.unknown);
  return { pack, spec, hit };
}

// Whether a catalog names this on-demand id, without fetching it.
export const knowsSticker = (id) => lookup(id).then(() => true, () => false);

// `missLimit` is the per-client miss bucket GET /stickers charges. POST /api/sticker
// skipped it, so 300 distinct uncached ids went upstream in 15 s; here it is
// charged only once the file is known to be missing and no download is running.
export async function ensureSticker(rawId, client = "", missLimit) {
  const { pack, spec, hit } = await lookup(rawId);
  const sticker = `${pack}/${hit.id}`;
  const target = resolve(packDir(pack), `${hit.id}.svg`);
  // A file only counts if it is what a download writes: an SVG document. An
  // empty or garbage file used to count as cached forever — the route served it
  // as the picture and a render drew nothing.
  const held = await readFile(target, "utf8").catch(() => null);
  if (isSvg(held)) return sticker;

  const failed = failures.get(sticker);
  if (failed) throw failed;
  if (inflight.has(sticker)) return inflight.get(sticker);
  const taken = missLimit?.(client);
  if (taken && !taken.ok) throw Object.assign(new Error("too many new stickers"), { retryAfterMs: taken.retryAfterMs });
  const job = downloadLimit(async () => {
    const res = await fetch(`${spec.base}/${hit.path}`, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      // The pinned host answers 200 or 404 for these paths. A redirect is not
      // something to follow: a hijacked upstream could bounce the server to
      // http://127.0.0.1/… or a cloud metadata address and cache what answers.
      redirect: "error",
    });
    if (!res.ok) throw Object.assign(new Error(`could not fetch ${hit.name}`), { missing: res.status === 404 });
    const body = (await readCapped(res, MAX_FILE_BYTES))?.toString("utf8");
    if (!isSvg(body)) throw new Error(`${hit.name} is not an SVG`);
    const text = spec.transform ? spec.transform(body, await slotsForId(sticker)) : body;

    // Write then rename: the route reads this file back the moment ensureSticker
    // resolves, and a plain writeFile lets a concurrent reader see a prefix.
    // Rename within the same directory is atomic.
    await mkdir(packDir(pack), { recursive: true });
    const tmp = `${target}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, text);
    await rename(tmp, target);
    await writeAttribution(pack);
    return sticker;
  }, client)
    .catch((err) => {
      // A full queue says nothing about this sticker: remembering it would keep
      // refusing a good id for the whole failure window.
      if (err instanceof LimiterFullError) throw err;
      const out =
        held == null
          ? err
          : Object.assign(new Error(`${sticker}: the cached file is empty or not an SVG, and re-downloading it failed (${err.message})`), {
              missing: err.missing,
            });
      failures.set(sticker, out);
      throw out;
    })
    .finally(() => inflight.delete(sticker));

  inflight.set(sticker, job);
  return job;
}
