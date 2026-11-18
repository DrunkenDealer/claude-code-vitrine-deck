import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";
import { resolveDevice } from "./devices.js";
import { renderSlideHtml } from "./template.js";

// Temp file + rename, never a write through the path. A link already sitting at
// the output (a planted `01_x.png -> precious.txt`) was followed, so the target
// was overwritten with a PNG; the rename replaces the link itself and leaves what
// it pointed at alone. The tool's own earlier outputs are replaced as before (N350).
async function writeReplacing(path, data) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

const DEVICE_SCALE_FACTOR = Number(process.env.VITRINE_SCALE) || 2;

export const LAUNCH_OPTS = {
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    // Text has to rasterize the same way here as it does in the browser tab that
    // renders the same slide locally (web/src/lib/clientRender.js), because the
    // two are the same export and a deck can take either path.
    //
    // A page compositing into an opaque layer gets subpixel-antialiased text on
    // Linux — glyph edges carry RGB fringes. The local path draws its slide from
    // an <svg>, and text inside an image is always greyscale-antialiased, so the
    // same headline comes out with different pixels on the two paths. macOS
    // never had the split, which is why it took a Linux CI to surface it (see
    // test/renderParity.test.js). Fringes are wrong for the artefact anyway: a
    // store screenshot is resized and recomposited by the store, and subpixel
    // colour assumes a display layout the exported PNG cannot know.
    "--disable-lcd-text",
    // Same reason, for glyph shape rather than glyph colour: hinting snaps
    // outlines and advances to the pixel grid through fontconfig, which the
    // in-image rasterizer does not do. Unhinted is also what the editor measures
    // against — canvas measureText is unhinted, and that is what predicts a wrap
    // (src/textMetrics.js).
    "--font-render-hinting=none",
  ],
};

export async function withBrowser(fn) {
  const browser = await chromium.launch(LAUNCH_OPTS);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

// Every asset reaches the page as a data: URL — fonts, frames, stickers, layer
// images — and the one exception is the slide's own screenshot, served by the
// render host over loopback. Anything else a request body managed to smuggle
// into the markup (a background function, an <img>) is aborted here instead of
// fetched from the server's network, which would be a blind SSRF.
export function allowRequest(url, screenshotUrl) {
  if (/^(?:data|about|blob):/i.test(url)) return true;
  if (screenshotUrl == null) return false;
  // The browser reports a normalized URL (spaces, case of the host), so compare
  // like with like or a screenshot named "my shot.png" is aborted.
  try {
    return new URL(url).href === new URL(screenshotUrl).href;
  } catch {
    return false;
  }
}

// `assets`: Map url -> { body, contentType } — the files the markup refers to by
// short URL, answered from memory instead of fetched.
export const blockForeignRequests = (page, screenshotUrl, assets = null) =>
  page.route("**/*", (route) => {
    const url = route.request().url();
    const asset = assets?.get(url);
    if (asset) return route.fulfill(asset);
    return allowRequest(url, screenshotUrl) ? route.continue() : route.abort();
  });

// A render that has not finished by now is stuck (a page that never settles, a
// hung Chromium), and its limiter slot would be held for ever.
export const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS) || 120000;

export class RenderTimeoutError extends Error {
  constructor(ms = RENDER_TIMEOUT_MS) {
    super(`the slide took more than ${Math.round(ms / 1000)} s to render and was stopped — use fewer layers or smaller shadows`);
    this.name = "RenderTimeoutError";
  }
}

// A client error: the body named a file that isn't a picture. The message is
// sent to the caller as is, so it names no server path.
export class UnreadableImageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnreadableImageError";
  }
}

export async function renderSlide(browser, opts) {
  const {
    input,
    device: deviceId,
    output,
    debugHtmlPath,
    frameOverride,
    format = "png",
    quality = 0.92,
    timeoutMs = RENDER_TIMEOUT_MS,
    // `layoutOverrides` is the legacy name for the ratio bag; layersFromFlat
    // reads it as `layout`.
    layoutOverrides,
    // Aborted when whoever asked has gone: the render stops at once instead of
    // running to its deadline for nobody.
    signal,
    ...rest
  } = opts;
  const baseDevice = resolveDevice(deviceId);
  const device = frameOverride
    ? { ...baseDevice, frame: frameOverride }
    : baseDevice;

  const assets = new Map();
  const html = renderSlideHtml({
    ...rest,
    assets,
    device,
    screenshotPath: input,
    layout: layoutOverrides,
  });

  if (debugHtmlPath) {
    await mkdir(dirname(debugHtmlPath), { recursive: true });
    await writeReplacing(debugHtmlPath, html);
  }

  signal?.throwIfAborted();
  const context = await browser.newContext({
    viewport: { width: device.canvasWidth, height: device.canvasHeight },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });
  // Closing the context fails whatever the render is waiting on, which is how
  // an overall deadline reaches a Playwright call that has no deadline of its own.
  // That is the only clock: Playwright's own per-call timeouts (30 s by default,
  // 60 s as once set here) would fire first whenever they are shorter than
  // `timeoutMs`, with a TimeoutError that is not ours — the server answered a
  // generic 500 after holding the renderer for that long. So they are off.
  context.setDefaultTimeout(0);
  const onAbort = () => context.close().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  // The checkpoint after anything the close cannot interrupt: a deadline or a
  // caller that left while it ran is an error, not a result.
  const stopIfLeft = () => {
    if (timedOut) throw new RenderTimeoutError(timeoutMs);
    signal?.throwIfAborted();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    context.close().catch(() => {});
  }, timeoutMs);
  try {
    const page = await context.newPage();
    await blockForeignRequests(page, rest.screenshotUrl, assets);
    await page.setContent(html, { waitUntil: "load" });
    // Failures come back as data and are thrown here: an Error thrown inside
    // the page reaches the CLI as a Playwright stack with a data URL in it.
    const broken = await page.evaluate(() => {
      /* global document */
      return Promise.all(
        Array.from(document.images).map((img) => {
          if (img.complete) return img.naturalWidth === 0 ? img.className : null;
          return new Promise((res) => {
            img.onload = () => res(null);
            img.onerror = () => res(img.className);
          });
        })
      ).then((all) => all.filter((c) => c != null));
    });
    if (broken.length) {
      const what = broken.some((c) => c.endsWith("-shot")) ? "the screenshot" : "an image layer";
      throw new UnreadableImageError(`${what} is not an image that can be read (PNG, JPEG or WebP)`);
    }
    await page.evaluate(() => document.fonts.ready);
    // page.screenshot's PNG encode was ~90% of a render (2.1 of 2.4 s on an
    // iPhone cell) and blocks the whole browser: no context close, crash or
    // other page gets through until it returns. So an abandoned render held the
    // renderer to the end and still wrote its PNG. optimizeForSpeed is the same
    // lossless pixels with a faster zlib (~4.5x shorter step). The scale is
    // explicit because this CDP session carries none of Playwright's
    // device-metrics emulation — 1 would come back at CSS size and the downscale
    // below would stop supersampling.
    const cdp = await context.newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: device.canvasWidth, height: device.canvasHeight, scale: DEVICE_SCALE_FACTOR },
      optimizeForSpeed: true,
    });
    stopIfLeft();
    const buffer = Buffer.from(data, "base64");

    // Always screenshot as PNG — a JPEG round trip before the downscale would
    // bake compression artefacts into the supersampled image — and encode the
    // requested format only at the end.
    const pipeline = sharp(buffer).resize(device.canvasWidth, device.canvasHeight, { fit: "fill" });
    const resized = await (format === "jpeg"
      ? pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: Math.round(quality * 100), mozjpeg: true })
      : pipeline.png({ compressionLevel: 9 })
    ).toBuffer();

    // Nothing is written or recorded for a caller that left during sharp.
    stopIfLeft();
    await mkdir(dirname(output), { recursive: true });
    await writeReplacing(output, resized);
    return output;
  } catch (err) {
    if (timedOut) throw new RenderTimeoutError(timeoutMs);
    if (signal?.aborted) throw signal.reason;
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    await context.close().catch(() => {});
  }
}
