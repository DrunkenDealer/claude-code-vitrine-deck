// The slide's HTML+CSS, built from already-resolved assets and a layer list.
// Node-API-free like geometry.js/frames.js/visual.js, so both hosts can import
// it: src/template.js resolves the assets off disk, web/src/lib/clientRender.js
// fetches them. One builder means the client render and the server render cannot
// drift.
//
// The renderer maps over `layers` in array order — back to front — rather than
// naming three sockets, so a new kind of element is data rather than a fourth
// code path. It never resolves defaults: whatever arrives here is already a
// complete layer (see normalizeLayers in layers.js).
import { FALLBACK_STACK, fontFamilyStack, UNICODE_RANGE } from "./fonts.js";
import { backdropBox, compileBackgroundStyle, rotationCss } from "./visual.js";
import {
  cssBackground,
  cssColor,
  cssEnum,
  cssFontStack,
  cssNumber,
  cssSafe,
  cssTransform,
} from "./css.js";
import { accentRuns, DEFAULT_SHOT, fontSizePx, lensTarget, TEXT_ALIGNS, TEXT_CASES } from "./layers.js";
import { cutoutBox, imageRadiusPx, layerBox, radiusCss, lensAside, lensConnectorPath, lensQuads, lensSource, lensView, shadowPx } from "./geometry.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Text is stored with real newlines and rendered as breaks, so a hand-placed
// line break survives the round trip through the deck.
const textToHtml = (s) => escapeHtml(s ?? "").replace(/\n/g, "<br/>");

// An accented run is a span that changes nothing but colour, so the shaping and
// the wrap are the plain text's (textParity holds this against Chromium).
const captionHtml = (layer, i) =>
  accentRuns(layer.text, layer.accent)
    .map((r) => (r.accent ? `<span class="${cls(i)}-a">${textToHtml(r.text)}</span>` : textToHtml(r.text)))
    .join("");

// Which way a shrink-wrapped text body hugs its column. The body is
// `width: fit-content` rather than full-width so a highlight pill wraps the
// glyphs instead of the whole column; fit-content resolves to the available
// width the moment the text wraps, so the wrap points are unchanged.
const marginInline = (align) =>
  align === "left" ? "0 auto" : align === "right" ? "auto 0" : "auto";

// Defence in depth for everything interpolated into `<style>`: the css.js guards
// already refuse `<`, but `</style` anywhere ends the stylesheet, so no value
// gets to carry one even if a guard is ever loosened. `\3c ` is CSS's own `<`.
const inStyle = (s) => String(s).replace(/</g, "\\3c ");

const px = (n) => `${n}px`;

// The enum spells the intent; CSS spells it its own way, and "none" is the
// absence of the declaration rather than a value. Exported because the live
// preview mirrors this rule and the two must not disagree about the mapping.
export const TEXT_TRANSFORM = { upper: "uppercase", lower: "lowercase" };

// ---------------------------------------------------------------------------
// per-layer CSS + markup
// ---------------------------------------------------------------------------

// Class names are positional, never derived from a layer id: an id is user-facing
// data and has no business reaching a selector.
const cls = (i) => `ly${i}`;

function textLayerCss(layer, i, ctx) {
  const box = layerBox(layer, ctx);
  const xform = rotationCss(layer.rotation);
  const size = fontSizePx(layer.role, cssNumber(layer.sizeMul, { min: 0.1, max: 6, fallback: 1 }), ctx.device);
  const align = cssEnum(layer.align, TEXT_ALIGNS, "center");
  const transform = TEXT_TRANSFORM[cssEnum(layer.textCase, TEXT_CASES, "none")];

  const shadow = layer.shadow
    ? `text-shadow: ${px(Math.round(size * cssNumber(layer.shadow.x, { min: -1, max: 1, fallback: 0 })))} ${px(Math.round(size * cssNumber(layer.shadow.y, { min: -1, max: 1, fallback: 0 })))} ${px(Math.round(size * cssNumber(layer.shadow.blur, { min: 0, max: 1, fallback: 0 })))} ${cssColor(layer.shadow.color, "rgba(0,0,0,0.45)")};`
    : "";

  const hl = layer.highlight;
  const highlight = hl
    ? `background: ${cssColor(hl.color, "#000000")};
    padding: ${px(Math.round(size * cssNumber(hl.padY, { min: 0, max: 3, fallback: 0 })))} ${px(Math.round(size * cssNumber(hl.padX, { min: 0, max: 3, fallback: 0 })))};
    border-radius: ${px(Math.round(size * cssNumber(hl.radius, { min: 0, max: 3, fallback: 0 })))};
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;`
    : "";

  return `
  .${cls(i)} {
    position: absolute;
    top: ${px(box.y)};
    left: ${px(box.x)};
    width: ${px(box.w)};
    text-align: ${align};
    transform: ${cssTransform(xform.transform)};
    transform-origin: ${cssTransform(xform.origin, "center center")};
  }
  .${cls(i)} > * {
    font-family: ${cssFontStack(fontFamilyStack(layer.fontId), FALLBACK_STACK)};
    font-size: ${px(size)};
    font-weight: ${cssNumber(layer.weight, { min: 100, max: 900, fallback: 400 })};
    line-height: ${cssNumber(layer.lineHeight, { min: 0.6, max: 3, fallback: 1.2 })};
    letter-spacing: ${cssNumber(layer.letterSpacing, { min: -0.3, max: 1, fallback: 0 })}em;
    color: ${cssColor(layer.color, "#ffffff")};
    opacity: ${cssNumber(layer.opacity, { min: 0, max: 1, fallback: 1 })};
    ${transform ? `text-transform: ${transform};` : ""}
    width: fit-content;
    max-width: 100%;
    overflow-wrap: anywhere;
    ${layer.balance ? "text-wrap: balance;" : ""}
    margin-inline: ${marginInline(align)};
    ${shadow}
    ${highlight}
  }${layer.accent ? `
  .${cls(i)}-a { color: ${cssColor(layer.accent, "#ffffff")}; }` : ""}`;
}

function imageLayerCss(layer, i, ctx) {
  const box = layerBox(layer, ctx);
  const xform = rotationCss(layer.rotation);
  return `
  .${cls(i)} {
    position: absolute;
    left: ${px(box.x)};
    top: ${px(box.y)};
    width: ${px(box.w)};
    ${box.h == null ? "" : `height: ${px(box.h)};`}
    object-fit: ${cssEnum(layer.fit, ["contain", "cover"], "contain")};
    border-radius: ${px(imageRadiusPx(layer, box))};
    opacity: ${cssNumber(layer.opacity, { min: 0, max: 1, fallback: 1 })};
    transform: ${cssTransform(xform.transform)};
    transform-origin: ${cssTransform(xform.origin, "center center")};
  }`;
}

// How a device's screenshot fills its opening. A lens draws the same element at
// another size, so both take it from here.
function shotCss(selector, device, useFrame) {
  const shot = device.shot ?? DEFAULT_SHOT;
  const pos =
    `${cssNumber(shot.x, { min: 0, max: 1, fallback: 0.5 }) * 100}% ` +
    `${cssNumber(shot.y, { min: 0, max: 1, fallback: 0 }) * 100}%`;
  return `${selector} {
    width: 100%;
    height: 100%;
    object-fit: ${useFrame ? "cover" : "contain"};
    object-position: ${pos};
    transform: ${shot.zoom > 1 ? `scale(${cssNumber(shot.zoom, { min: 1, max: 4, fallback: 1 })})` : "none"};
    transform-origin: ${pos};
  }`;
}

// A device layer's box and screen opening, which a lens needs as much as the
// device does.
function deviceScreen(layer, ctx) {
  const box = layerBox(layer, ctx);
  const useFrame = layer.useFrame !== false && Boolean(ctx.frame);
  return { box, useFrame, cut: cutoutBox(ctx.frame, box.w, box.h, useFrame) };
}

// Half the lens's own stroke, so the callout reads as the stronger of the two;
// a lens with no border still gets a visible outline.
export const markStroke = (border, W) => Math.max(2, Math.round((border || W * 0.006) / 2));

// The rim's colour at its own opacity. color-mix rather than rgba() because the
// colour may be any CSS colour, not only hex.
export function lensEdgeColor(border) {
  const c = cssColor(border?.color, "#ffffff");
  const a = cssNumber(border?.opacity, { min: 0, max: 1, fallback: 1 });
  return a < 1 ? `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)` : c;
}

function lensLayerCss(layer, i, ctx) {
  const dev = lensTarget(layer, ctx.layers);
  if (!dev) return "";
  const box = layerBox(layer, ctx);
  const { cut, useFrame } = deviceScreen(dev, ctx);
  const view = lensView(layer.area, box, cut);
  const xform = rotationCss(layer.rotation);
  const short = Math.min(box.w, box.h);
  const radius = Math.round(short * cssNumber(layer.radius, { min: 0, max: 0.5, fallback: 0 }));
  const border = layer.border
    ? Math.round(ctx.W * cssNumber(layer.border.width, { min: 0, max: 0.05, fallback: 0 }))
    : 0;
  const borderColor = cssColor(layer.border?.color, "#ffffff");
  const edge = lensEdgeColor(layer.border);
  const sh = shadowPx(layer.shadow, box.w);
  // The outline on the device is drawn at the device's scale, so its corners
  // are the lens's own corners shrunk by the magnification.
  const src = lensSource(layer.area, box, cut);
  const stroke = markStroke(border, ctx.W);
  const dim = cssNumber(layer.dim, { min: 0, max: 0.9, fallback: 0 });
  // Dimming is the mark's own shadow, spread past every edge of the opening,
  // which clips it — so the spot stays lit in whatever shape the mark has.
  const mark = hasMark(layer)
    ? `
  .${cls(i)}-mark {
    position: absolute;
    left: ${px(src.x)};
    top: ${px(src.y)};
    width: ${px(src.w)};
    height: ${px(src.h)};
    ${layer.markSource ? `border: ${px(stroke)} solid ${edge};` : ""}
    border-radius: ${px(radius / view.k)};
    ${dim ? `box-shadow: 0 0 0 ${px(Math.ceil(cut.w + cut.h))} rgba(0,0,0,${dim});` : ""}
    ${layer.blur > 0 ? "overflow: hidden;" : ""}
    z-index: 1;
  }${layer.blur > 0 ? `
  ${shotCss(`.${cls(i)}-sharp`, dev, useFrame)}
  .${cls(i)}-sharp {
    position: absolute;
    left: ${px(-src.x - (layer.markSource ? stroke : 0))};
    top: ${px(-src.y - (layer.markSource ? stroke : 0))};
    width: ${px(cut.w)};
    height: ${px(cut.h)};
  }` : ""}`
    : "";

  return `
  .${cls(i)} {
    position: absolute;
    left: ${px(box.x)};
    top: ${px(box.y)};
    width: ${px(box.w)};
    height: ${px(box.h)};
    border-radius: ${px(radius)};
    overflow: hidden;
    opacity: ${cssNumber(layer.opacity, { min: 0, max: 1, fallback: 1 })};
    transform: ${cssTransform(xform.transform)};
    transform-origin: ${cssTransform(xform.origin, "center center")};
    ${sh ? `box-shadow: 0 ${px(sh.y)} ${px(sh.blur)} rgba(0,0,0,${cssNumber(sh.opacity, { min: 0, max: 1, fallback: 0.35 })});` : ""}
  }
  .${cls(i)}-view {
    position: absolute;
    left: ${px(view.x)};
    top: ${px(view.y)};
    width: ${px(view.w)};
    height: ${px(view.h)};
  }
  ${shotCss(`.${cls(i)}-shot`, dev, useFrame)}
  ${border ? `.${cls(i)}::after {
    content: "";
    position: absolute;
    inset: 0;
    border: ${px(border)} solid ${edge};
    border-radius: inherit;
  }` : ""}${mark}
  .${cls(i)}-link {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
    opacity: ${cssNumber(layer.opacity, { min: 0, max: 1, fallback: 1 })};
  }
  .${cls(i)}-link path { fill: none; stroke: ${edge}; stroke-width: ${px(stroke)}; stroke-linecap: round; }
  .${cls(i)}-link .${cls(i)}-beam { fill: ${borderColor}; fill-opacity: ${WEDGE_TINT}; stroke: none; }`;
}

// How strongly a wedge tints what it crosses: enough to read as a beam, faint
// enough that the slide behind it still shows through.
export const WEDGE_TINT = 0.12;

const hasMark = (lens) => lens.markSource || lens.dim > 0 || lens.blur > 0;

// How far "blur the rest" softens a device's screen, in canvas px: the most any
// lens on it asks for. The spots stay sharp because each lens's mark carries an
// unblurred copy of the screen, lined up with the one underneath.
export const blurPx = (lens, W) => Math.round(cssNumber(lens.blur, { min: 0, max: 1, fallback: 0 }) * W * 0.015);
export const screenBlurPx = (device, layers, W) =>
  Math.max(0, ...layers.filter((l) => l.type === "lens" && l.target === device.id).map((l) => blurPx(l, W)));

// The connector for a lens, in canvas px ({ stroke, fill }), or null. Shared with the editor so
// both draw the same path.
export function lensLink(lens, layers, ctx) {
  const dev = lensTarget(lens, layers);
  if (!dev) return null;
  const { box: devBox, cut } = deviceScreen(dev, ctx);
  return lensConnectorPath(lens.connector, lensQuads(lens, layerBox(lens, ctx), dev, devBox, cut));
}

// Where to move a lens whose connector it hides by covering its own spot, as a
// position patch, or null when the connector already shows. Picking Line or
// Wedge is asking to see one, so the lens steps aside rather than the choice
// silently doing nothing.
export function lensClearing(lens, layers, ctx) {
  const dev = lensTarget(lens, layers);
  if (!dev || lens.connector === "none" || lensLink(lens, layers, ctx)) return null;
  const { box: devBox, cut } = deviceScreen(dev, ctx);
  const box = layerBox(lens, ctx);
  const quads = lensQuads(lens, box, dev, devBox, cut);
  if (!quads) return null;
  const xs = quads.source.map((p) => p.x);
  const ys = quads.source.map((p) => p.y);
  const spot = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const p = lensAside(spot, box.w, box.h, devBox, ctx.W, ctx.H);
  return { xRatio: (p.x + box.w / 2 - ctx.W / 2) / ctx.W, yRatio: p.y / ctx.H };
}

function deviceLayerCss(layer, i, ctx) {
  const { box, useFrame, cut } = deviceScreen(layer, ctx);
  const xform = rotationCss(layer.rotation);
  const sh = shadowPx(layer.shadow, box.h);
  const blur = screenBlurPx(layer, ctx.layers, ctx.W);

  return `
  .${cls(i)} {
    position: absolute;
    left: ${px(box.x)};
    top: ${px(box.y)};
    width: ${px(box.w)};
    height: ${px(box.h)};
    opacity: ${cssNumber(layer.opacity, { min: 0, max: 1, fallback: 1 })};
    transform: ${cssTransform(xform.transform)};
    transform-origin: ${cssTransform(xform.origin, "center center")};
  }
  .${cls(i)}-shadow {
    position: absolute;
    inset: 0;
    ${sh ? `filter: drop-shadow(0 ${px(sh.y)} ${px(sh.blur)} rgba(0,0,0,${cssNumber(sh.opacity, { min: 0, max: 1, fallback: 0.35 })}));` : ""}
  }
  /* The opening clips; the screenshot inside it is what zooms and pans. Before
     the fit was adjustable this was one element with object-position: top, which
     is exactly what the default shot values reproduce. */
  .${cls(i)}-screen {
    position: absolute;
    left: ${px(cut.x)};
    top: ${px(cut.y)};
    width: ${px(cut.w)};
    height: ${px(cut.h)};
    border-radius: ${radiusCss(cut.r)};
    overflow: hidden;
    z-index: 1;
    ${blur ? "background: #000;" : ""}
  }
  ${shotCss(`.${cls(i)}-shot`, layer, useFrame)}${blur ? `
  .${cls(i)}-shot { filter: blur(${px(blur)}); }` : ""}
  ${useFrame ? `.${cls(i)}-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
  }` : ""}`;
}

function layerCss(layer, i, ctx) {
  if (layer.type === "text") return textLayerCss(layer, i, ctx);
  if (layer.type === "image") return imageLayerCss(layer, i, ctx);
  if (layer.type === "lens") return lensLayerCss(layer, i, ctx);
  return deviceLayerCss(layer, i, ctx);
}

// Own keys only: a layer id like "constructor" or "toString" would otherwise read
// Object.prototype and hand a function to the template as a URL.
const own = (map, key) => (map && Object.hasOwn(map, key) ? map[key] : undefined);

const shotUrl = (device, ctx) => own(ctx.deviceUrls, device.id) ?? ctx.screenshotUrl;

function layerHtml(layer, i, ctx) {
  if (layer.type === "text") {
    const tag = layer.role === "headline" ? "h1" : "p";
    return `<div class="${cls(i)}"><${tag}>${captionHtml(layer, i)}</${tag}></div>`;
  }
  if (layer.type === "image") {
    const url = own(ctx.imageUrls, layer.id);
    if (!url) return "";
    return `<img class="${cls(i)}" src="${escapeHtml(url)}" alt=""/>`;
  }
  if (layer.type === "lens") {
    const dev = lensTarget(layer, ctx.layers);
    if (!dev) return "";
    const d = lensLink(layer, ctx.layers, ctx);
    const beam = d?.fill ? `<path class="${cls(i)}-beam" d="${d.fill}"/>` : "";
    const link = d ? `<svg xmlns="http://www.w3.org/2000/svg" class="${cls(i)}-link" width="${ctx.W}" height="${ctx.H}" viewBox="0 0 ${ctx.W} ${ctx.H}">${beam}<path d="${d.stroke}"/></svg>` : "";
    return `${link}<div class="${cls(i)}"><div class="${cls(i)}-view"><img class="${cls(i)}-shot" src="${escapeHtml(shotUrl(dev, ctx))}" alt=""/></div></div>`;
  }
  const useFrame = layer.useFrame !== false && Boolean(ctx.frame);
  const bezel = own(ctx.frameUrls, layer.frameTint) ?? ctx.frameUrl;
  // The outlines of the lenses magnifying this device, inside its opening so
  // they clip, tilt and fade with it. Classed by the lens, which owns their CSS.
  const marks = ctx.layers
    .map((l, j) => {
      if (l.type !== "lens" || !hasMark(l) || l.target !== layer.id) return "";
      const sharp = l.blur > 0 ? `<img class="${cls(j)}-sharp" src="${escapeHtml(shotUrl(layer, ctx))}" alt=""/>` : "";
      return `<div class="${cls(j)}-mark">${sharp}</div>`;
    })
    .join("");
  return `<div class="${cls(i)}">
      <div class="${cls(i)}-shadow">
        <div class="${cls(i)}-screen"><img class="${cls(i)}-shot" src="${escapeHtml(shotUrl(layer, ctx))}" alt=""/>${marks}</div>
        ${useFrame ? `<img class="${cls(i)}-frame" src="${escapeHtml(bezel)}" alt=""/>` : ""}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------

// `layers`:    a normalized layer list, back to front.
// `fontFaces`: [{ family, weight, url }] — url is the woff2 as a data: URL.
// `frameMeta`: the frame's geometry JSON, or null when no layer uses a frame.
// `frameUrl`:  the bezel image as a data: URL (generated SVG, or a raster frame).
// `frameUrls`: { [frameTint]: dataUrl } when the slide's devices don't all share
//               one finish — a device borrowed from a panorama neighbour keeps
//               its own. `frameUrl` answers for any finish not in it.
// `background`: a background spec (see visual.js), or a CSS string from a deck
//               saved before specs existed.
// `backgroundUrl`: the background photo as a data: URL, for an image spec.
// `screenshotUrl`: the slide's own screenshot — a data: URL for the client path,
//                  an http URL for the server path (Chromium can fetch it there).
// `imageUrls`: { [layerId]: dataUrl } for image layers.
// `deviceUrls`: { [layerId]: url } for a device layer pointing somewhere other
//               than the slide's own screenshot.
// `span`:      { index, count } when the background is a panorama this slide
//               shows one window of (see visual.js), else null.
export function buildSlideHtml({
  device,
  layers,
  background,
  backgroundUrl,
  screenshotUrl,
  frameMeta,
  frameUrl,
  fontFaces,
  imageUrls,
  deviceUrls,
  frameUrls = null,
  span = null,
}) {
  const { canvasWidth: W, canvasHeight: H } = device;
  const bg = compileBackgroundStyle(background, { imageUrl: backgroundUrl });
  const backdrop = backdropBox(span, W);
  const ctx = { W, H, device, layers, frame: frameMeta, frameUrl, frameUrls, screenshotUrl, imageUrls, deviceUrls };

  const fontFaces_ = (fontFaces ?? [])
    .map(
      ({ family, weight, range, unicodeRange, url }) =>
        `@font-face { font-family: "${cssSafe(family, "").replace(/"/g, "")}"; font-style: normal; font-weight: ${cssSafe(range, "") || cssNumber(weight, { min: 1, max: 1000, fallback: 400 })}; font-display: block; src: url(${url}) format("woff2");${UNICODE_RANGE.test(unicodeRange ?? "") ? ` unicode-range: ${unicodeRange};` : ""} }`
    )
    .join("\n  ");

  const css = layers.map((l, i) => layerCss(l, i, ctx)).join("\n");
  const body = layers.map((l, i) => layerHtml(l, i, ctx)).join("\n    ");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  ${inStyle(fontFaces_)}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    font-family: ${FALLBACK_STACK};
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  .canvas {
    position: relative;
    width: ${W}px;
    height: ${H}px;
    overflow: hidden;
  }
  /* Its own element rather than a background on .canvas: a photo background is
     blurred with a filter, and a filter fades an element at its own edges — so
     this one is scaled past the canvas and clipped by it. A panorama widens it
     past the canvas the same way, to every slide it runs across. */
  .bg {
    position: absolute;
    top: 0;
    bottom: 0;
    left: ${px(backdrop.x)};
    width: ${px(backdrop.w)};
    background: ${inStyle(cssBackground(bg.background, "#000000"))};
    background-size: ${cssEnum(bg.size, ["auto", "cover", "contain"], "auto")};
    background-position: ${inStyle(cssSafe(bg.position, "0 0"))};
    background-repeat: no-repeat;
    filter: ${cssTransform(bg.filter, "none")};
    transform: ${cssTransform(bg.transform, "none")};
  }
${inStyle(css)}
</style>
</head>
<body>
  <div class="canvas">
    <div class="bg"></div>
    ${body}
  </div>
</body>
</html>`;
}
