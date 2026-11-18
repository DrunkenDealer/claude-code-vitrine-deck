// Node side of the slide render: resolves fonts, frames and images off disk into
// data URLs, then hands them to the shared builder in slideHtml.js. The browser
// does the same job with fetch in web/src/lib/clientRender.js.
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_FRAME_TINT, frameSvgUrl } from "./frames.js";
import {
  deviceLayerSources,
  fontFilesForLayers,
  frameTintOf,
  imageLayerSources,
  layersFromFlat,
  MAX_RENDER_DEVICE_LAYERS,
  MAX_RENDER_IMAGE_LAYERS,
  countDeviceLayers,
  MAX_RENDER_INLINE_BYTES,
  MAX_RENDER_LAYERS,
  normalizeLayers,
  RenderTooLargeError,
  usesFrame,
} from "./layers.js";
import { backgroundImageKey, normalizeBackground } from "./visual.js";
import { needsDeviceLayer } from "./deck.js";
import { buildSlideHtml } from "./slideHtml.js";
import { DEFAULT_LAYOUT } from "./geometry.js";
import { indexStickers, isStickerKey, packSlotsFor, stickerIdFromKey, stickerSvgUrl } from "./stickers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMES_DIR = resolve(__dirname, "..", "assets", "frames");
const FONTS_DIR = resolve(__dirname, "..", "assets", "fonts");
// Tests point VITRINE_STICKERS_DIR at a temp copy so the on-demand caches they
// empty and refill are their own, not the checkout's.
export const STICKERS_DIR = process.env.VITRINE_STICKERS_DIR ?? resolve(__dirname, "..", "assets", "stickers");
export const BACKGROUNDS_DIR = resolve(__dirname, "..", "assets", "backgrounds");

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export { DEFAULT_LAYOUT };

// Where the renderer answers for a file held in `assets`. `.invalid` never resolves.
export const ASSET_ORIGIN = "http://vitrine-asset.invalid";

function fileToDataUrl(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const b64 = readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${b64}`;
}

// The sticker manifest, read once. Cached rather than re-read per layer the way
// loadFrame is: a slide can carry several stickers and a deck renders every
// slide, where a frame is one file per render.
//
// Missing is not an error — a checkout with no library still renders every deck
// that doesn't use one, and a sticker whose entry is gone falls back to being
// served untinted rather than failing the slide.
let stickerIndex = null;
let stickerPackList = [];
export function stickerLibrary() {
  if (!stickerIndex) {
    try {
      const raw = JSON.parse(readFileSync(join(STICKERS_DIR, "index.json"), "utf8"));
      stickerIndex = indexStickers(raw);
      stickerPackList = raw.packs ?? [];
    } catch {
      stickerIndex = new Map();
    }
  }
  return stickerIndex;
}

// The manifest's pack list — what a pack declares, including the slots every
// file in an on-demand pack inherits. Served by `vitrine capabilities` so an
// agent picks a sticker from the library that is actually installed.
export function stickerPacks() {
  stickerLibrary();
  return stickerPackList;
}

// An on-demand sticker has no manifest entry of its own — there are 9,072
// Phosphor icons — so its pack answers for it.
export function stickerSlotsFor(sourceKey) {
  const id = stickerIdFromKey(sourceKey);
  if (!id) return null;
  return stickerLibrary().get(id)?.slots ?? packSlotsFor(id, stickerPackList);
}

// Where a sticker key lives on disk. Resolved here rather than through the
// caller's resolver because the library is the app's own, not an owner's: the
// CLI resolves every other key against the cwd, and `stickers/…` must not mean
// "a folder called stickers next to my config".
export function stickerPath(sourceKey) {
  const id = stickerIdFromKey(sourceKey);
  if (!id || id.includes("..")) return null;
  const path = resolve(STICKERS_DIR, `${id}.svg`);
  return path.startsWith(STICKERS_DIR + sep) ? path : null;
}

// A frame's geometry, cached. The scorer needs this and nothing else — it works
// out where the silhouette sits, not what it looks like — so it must not pay for
// generating a bezel it will throw away, once per cell of a whole deck.
const frameMetaCache = new Map();
export function frameMeta(name) {
  if (!frameMetaCache.has(name)) {
    frameMetaCache.set(name, JSON.parse(readFileSync(join(FRAMES_DIR, `${name}.json`), "utf8")));
  }
  return frameMetaCache.get(name);
}

// Frames are generated from their geometry JSON so one file covers every finish.
// A frame that names an `image` is a hand-authored raster instead — it ships as-is
// and the tint doesn't apply to it.
export function loadFrame(name, tintId = DEFAULT_FRAME_TINT) {
  const meta = frameMeta(name);
  const svgUrl = meta.image
    ? fileToDataUrl(join(FRAMES_DIR, meta.image))
    : frameSvgUrl(meta, tintId);
  return { meta, svgUrl };
}

// `layers` is the model; the flat options are the legacy shape the CLI and the
// batch config still speak, adapted here so there is one definition of what they
// meant. `resolveSource` maps a layer's sourceKey to an absolute path — the
// server passes its owner-aware resolver, the CLI resolves against the cwd.
export function renderSlideHtml({
  device,
  layers,
  screenshotPath,
  screenshotUrl,
  background,
  span = null,
  resolveSource = (key) => key,
  assets = null,
  ...flat
}) {
  // A layer list is taken as it is — a slide whose device was deleted has
  // none, and drawing one back would render what the editor doesn't show. Only
  // the flat pre-layers shape, which never listed a device, is given one.
  const rawLayers = layers ?? layersFromFlat(flat);
  if (Array.isArray(rawLayers) && rawLayers.length > MAX_RENDER_LAYERS) {
    throw new RenderTooLargeError(`a slide can render at most ${MAX_RENDER_LAYERS} layers`);
  }
  const list = normalizeLayers(rawLayers, {
    requireDevice: layers == null && needsDeviceLayer(device.category),
  });
  const bg = normalizeBackground(background);
  const bgKey = backgroundImageKey(bg, span);
  const wantsFrame = usesFrame(list);
  const frameData = wantsFrame ? loadFrame(device.frame, frameTintOf(list)) : null;
  const finishes = [...new Set(list.filter((l) => l.type === "device").map((l) => l.frameTint))];
  const frameUrls = wantsFrame && finishes.length > 1
    ? Object.fromEntries(finishes.map((tint) => [tint, loadFrame(device.frame, tint).svgUrl]))
    : null;
  // Always derived from the layers' font ids: a caller-supplied list would name
  // any file on disk and a family that lands raw in the stylesheet.
  const files = fontFilesForLayers(list);

  // A sticker is read as text and recoloured before it is encoded; everything
  // else is inlined as its own bytes. The browser gets the same string from the
  // /stickers route, so the two hosts cannot drift on what a tint means.
  //
  // Every byte that goes into the page is paid for out of one budget, so a body
  // cannot fan a file out into copies. With an `assets` map (the server and CLI
  // renderer) each distinct file is held once and the markup carries a short URL
  // the renderer answers from that map, so the layers sharing a file — device
  // layers with no source of their own all draw the slide's screenshot — cost its
  // bytes once. Without one the page carries a data URL per layer (the editor's
  // own preview path), and each use is spent. A file is sized before it is read,
  // so a refusal costs no memory.
  if (countDeviceLayers(list) > MAX_RENDER_DEVICE_LAYERS) {
    throw new RenderTooLargeError(`a slide can render at most ${MAX_RENDER_DEVICE_LAYERS} device layers`);
  }
  if (imageLayerSources(list).length > MAX_RENDER_IMAGE_LAYERS) {
    throw new RenderTooLargeError(`a slide can render at most ${MAX_RENDER_IMAGE_LAYERS} image layers`);
  }
  let spent = 0;
  const spend = (bytes) => {
    spent += bytes;
    if (spent > MAX_RENDER_INLINE_BYTES) throw new RenderTooLargeError("the images on this slide are too large to render");
  };
  const registered = new Map();
  const fileUrl = (path) => {
    const abs = resolve(path);
    const known = registered.get(abs);
    if (known && assets) return known;
    spend(statSync(abs).size);
    if (known) return known;
    let url;
    if (assets) {
      url = `${ASSET_ORIGIN}/${assets.size}`;
      assets.set(url, { body: readFileSync(abs), contentType: MIME[extname(abs).toLowerCase()] ?? "application/octet-stream" });
    } else {
      url = fileToDataUrl(abs);
    }
    registered.set(abs, url);
    return url;
  };
  const read = (sourceKey, tint) => {
    if (isStickerKey(sourceKey)) {
      const path = stickerPath(sourceKey);
      if (!path) return null;
      // A layer pointing at a sticker that isn't there draws nothing rather
      // than failing the slide — an uncached emoji on a fresh checkout.
      try {
        const text = readFileSync(path, "utf8");
        const url = stickerSvgUrl(text, stickerSlotsFor(sourceKey), tint);
        spend(url.length);
        return url;
      } catch (err) {
        if (err instanceof RenderTooLargeError) throw err;
        return null;
      }
    }
    const path = resolveSource(sourceKey);
    return path ? fileUrl(path) : null;
  };
  const inline = (sources) =>
    Object.fromEntries(
      sources.flatMap(({ id, sourceKey, tint }) => {
        const url = read(sourceKey, tint);
        return url == null ? [] : [[id, url]];
      }),
    );

  // The slide's screenshot is drawn by every device layer without a source of its
  // own, again by each lens, and again inside a lens's outline: without an asset
  // map each of those is a copy in the page, so each is spent.
  const shotUses = list.filter((l) => (l.type === "device" && !l.sourceKey) || l.type === "lens").length;
  const shotUrl = () => {
    const url = fileUrl(screenshotPath);
    if (!assets) for (let i = 1; i < shotUses * 2; i++) spend(statSync(resolve(screenshotPath)).size);
    return url;
  };

  const bgPath = bgKey ? resolveSource(bgKey) : null;
  if (bgPath) spend(statSync(resolve(bgPath)).size);

  return buildSlideHtml({
    device,
    layers: list,
    background: bg,
    backgroundUrl: bgPath ? fileToDataUrl(resolve(bgPath)) : null,
    span,
    frameMeta: frameData?.meta ?? null,
    frameUrl: frameData?.svgUrl ?? null,
    frameUrls,
    // A slide with no device layer has no screenshot to inline, and asking for
    // one would fail the render on a file nothing was going to read.
    screenshotUrl: screenshotUrl ?? (screenshotPath ? shotUrl() : null),
    imageUrls: inline(imageLayerSources(list)),
    deviceUrls: inline(deviceLayerSources(list)),
    fontFaces: files.map((f) => ({
      ...f,
      url: fileToDataUrl(join(FONTS_DIR, f.file)),
    })),
  });
}
