// Device bezels. Every frame is generated from its geometry JSON plus a tint
// rather than kept as one file per device per finish, so a new finish is three
// hex values and not eleven more PNGs. Node-API-free like visual.js/geometry.js:
// the Node render inlines the result as a data URL and the web preview does the
// same, which is what keeps preview and output byte-identical.
//
// The shape is per-family, not generic. A slab with a pill cutout reads as "a
// phone" but not as *which* phone, and a store screenshot is exactly where that
// matters — so `style` in the sidecar picks a silhouette that carries the
// family's tells: the Dynamic Island and rail buttons on an iPhone, the centred
// punch-hole on a Pixel, the camera on the landscape edge of an iPad, the
// pedestal under a TV. Drawn here rather than sourced, because no frame set with
// a license we can ship covers iOS and Android across phone, tablet and TV at
// the resolution a 2868px-tall render needs.

// A tint is three colors: the gradient's outer stops (`edge`), its midpoint
// (`core`), and the rim hairline. On the dark finish the rim is *lighter* than the
// core and reads as a specular highlight; on the light finishes it has to be
// darker than the bezel instead, or the device edge dissolves into a light
// background — which is the whole reason the light finishes exist.
export const FRAME_TINTS = {
  black: { label: "Black", edge: "#2a2a2c", core: "#0e0e10", rim: "#3a3a3c" },
  silver: { label: "Silver", edge: "#f4f4f6", core: "#d4d4d8", rim: "#b9b9c0" },
  titanium: { label: "Titanium", edge: "#b8b0a6", core: "#8a8279", rim: "#a09890" },
};

export const DEFAULT_FRAME_TINT = "black";

// Own keys only: a deck saying "constructor" or "toString" read an
// Object.prototype member as a tint and rendered a different frame (N508).
export const isFrameTint = (id) => typeof id === "string" && Object.hasOwn(FRAME_TINTS, id);

export function frameTint(id) {
  return FRAME_TINTS[isFrameTint(id) ? id : DEFAULT_FRAME_TINT];
}

export const FRAME_TINT_OPTIONS = Object.entries(FRAME_TINTS).map(([id, t]) => ({
  id,
  ...t,
}));

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// Two decimals: a frame is authored at ~1400 units and drawn at up to 3000px, so
// this is well under a rendered pixel, and full floats triple the data URL.
const n = (v) => Math.round(v * 100) / 100;

const rrect = (x, y, w, h, r, attrs) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" ry="${n(r)}" ${attrs}/>`;

const dot = (cx, cy, r, attrs) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${attrs}/>`;

// `meta` is the frame's JSON sidecar: { frameWidth, frameHeight, outerRadius,
// style, cutout: { x, y, width, height, borderRadius } }.
function geom(meta) {
  const { frameWidth: W, frameHeight: H, outerRadius: R, cutout: c } = meta;
  // How far a rail button stands proud of the slab. The body is inset by the
  // same amount so the silhouette — and the drop shadow that traces it — stays
  // inside the viewBox the device layer is sized from, which is why every
  // sidecar carries this much margin around its bezel: without it the inset
  // would come out of the bezel instead and every device would read thinner.
  // Off the cutout, not the frame box, so adding that margin can't move it.
  const depth = Math.max(3, Math.round(Math.min(c.width, c.height) * 0.0075));
  return { W, H, R, c, landscape: W > H, depth };
}

const inset = (g, d, h = g.H) => ({
  x: d,
  y: d,
  w: g.W - d * 2,
  h: h - d * 2,
  r: Math.max(0, g.R - d),
});

// ---------------------------------------------------------------------------
// Rail buttons
// ---------------------------------------------------------------------------

// Everything on a frame — buttons, cameras, the island — is authored in portrait
// terms: which side of the slab it sits on, and its extent along that side as
// fractions of it. A landscape sidecar is the same slab given a quarter-turn, so
// the sides move and half of them end up running the other way.
//
// Which quarter-turn depends on the family, because the two turns disagree about
// where the front camera ends up and each family has only one right answer. A
// phone's camera is on its portrait top edge, and turning left puts a landscape
// iPhone's island on the viewer's left, which is the way people hold one. A
// tablet's camera is on the edge that is the long one in landscape, so it sits on
// a portrait *side* — and only turning right leaves a portrait tablet with its
// buttons at the top rather than under it.
const TURNED = {
  ccw: { left: "bottom", right: "top", top: "left", bottom: "right" },
  cw: { left: "top", right: "bottom", top: "right", bottom: "left" },
};

const edgeFor = (g, turn, side) => (g.landscape ? TURNED[turn][side] : side);

function nub(g, edge, a, b, fill) {
  const d = g.depth;
  const r = d * 0.8;
  if (edge === "left") return rrect(0, a, d * 2, b - a, r, `fill="${fill}"`);
  if (edge === "right") return rrect(g.W - d * 2, a, d * 2, b - a, r, `fill="${fill}"`);
  if (edge === "top") return rrect(a, 0, b - a, d * 2, r, `fill="${fill}"`);
  return rrect(a, g.H - d * 2, b - a, d * 2, r, `fill="${fill}"`);
}

function railButtons(g, turn, specs, fill) {
  return specs
    .map(({ side, from, to }) => {
      // Left and right rails run the length of the slab; top and bottom span its
      // width. A turn reverses exactly one of those two groups, and which group
      // it is flips with the direction.
      const alongLong = side === "left" || side === "right";
      const [long, short] = g.landscape ? [g.W, g.H] : [g.H, g.W];
      const len = alongLong ? long : short;
      let [a, b] = [len * from, len * to];
      if (g.landscape && (turn === "cw") === alongLong) [a, b] = [len - b, len - a];
      return nub(g, edgeFor(g, turn, side), a, b, fill);
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Screen furniture — drawn over the screenshot, so it is outside the cutout mask
// ---------------------------------------------------------------------------

// A box sitting just inside the screen's portrait top edge, centred across it —
// where a phone keeps its front camera, whichever way the frame is turned.
function atScreenEdge(g, turn, gap, across, deep) {
  const { c } = g;
  const edge = edgeFor(g, turn, "top");
  const upright = edge === "top" || edge === "bottom";
  const [w, h] = upright ? [across, deep] : [deep, across];
  return {
    x: edge === "left" ? c.x + gap : edge === "right" ? c.x + c.width - gap - w : c.x + (c.width - w) / 2,
    y: edge === "top" ? c.y + gap : edge === "bottom" ? c.y + c.height - gap - h : c.y + (c.height - h) / 2,
    w,
    h,
  };
}

// The Dynamic Island: 3.45:1, a third of the screen's width, floating just below
// its top edge. Proportions off an iPhone 16 Pro, so it lands where a viewer
// expects it at any frame size.
function island(g, turn) {
  const across = (g.landscape ? g.c.height : g.c.width) * 0.31;
  const deep = across / 3.45;
  const b = atScreenEdge(g, turn, deep * 0.3, across, deep);
  return rrect(b.x, b.y, b.w, b.h, deep / 2, 'fill="#000"');
}

// A centred punch-hole camera — the Pixel's one unmistakable front-face tell.
function punchHole(g, turn) {
  const d = (g.landscape ? g.c.height : g.c.width) * 0.062;
  const b = atScreenEdge(g, turn, d, d, d);
  return dot(b.x + d / 2, b.y + d / 2, d / 2, 'fill="#000"');
}

// The midpoint of one edge's bezel strip, and how deep that strip is.
function bezelMid(g, edge) {
  const { c, depth: d } = g;
  const mid = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  if (edge === "left") return { ...mid, x: (d + c.x) / 2, band: c.x - d };
  if (edge === "right") return { ...mid, x: (c.x + c.width + g.W - d) / 2, band: g.W - d - c.x - c.width };
  if (edge === "top") return { ...mid, y: (d + c.y) / 2, band: c.y - d };
  return { ...mid, y: (c.y + c.height + g.H - d) / 2, band: g.H - d - c.y - c.height };
}

// A tablet's camera sits on the bezel, not in the screen, and since 2024 it sits
// on the edge that is the *long* one in landscape — a portrait side, which is
// the whole reason tablets turn the other way.
const bezelCamera = (side) => (g, turn, t) => {
  const { x, y, band } = bezelMid(g, edgeFor(g, turn, side));
  return dot(x, y, band * 0.3, `fill="#08080a" stroke="${t.rim}" stroke-width="${n(band * 0.08)}"`);
};

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

// Button runs as fractions of the side they sit on, measured off the real
// hardware: an iPhone carries the Action button above the volume pair on the
// left and the Side and Camera Control buttons on the right, where a Pixel
// carries power above the volume rocker on the right alone.
const IPHONE_RAILS = [
  { side: "left", from: 0.165, to: 0.196 },
  { side: "left", from: 0.22, to: 0.288 },
  { side: "left", from: 0.307, to: 0.374 },
  { side: "right", from: 0.245, to: 0.38 },
  { side: "right", from: 0.46, to: 0.53 },
];
const PIXEL_RAILS = [
  { side: "right", from: 0.19, to: 0.258 },
  { side: "right", from: 0.282, to: 0.4 },
];
// A tablet's power button shares the camera's edge at the far end of it, and the
// volume pair sits on the short edge beside it — so in portrait both land near
// the top, power on the camera's own rail and the pair across the top edge.
const IPAD_RAILS = [
  { side: "left", from: 0.07, to: 0.13 },
  { side: "top", from: 0.065, to: 0.135 },
  { side: "top", from: 0.155, to: 0.225 },
];
const TABLET_RAILS = [
  { side: "left", from: 0.075, to: 0.145 },
  { side: "top", from: 0.07, to: 0.2 },
];

const slab = (turn, rails, furniture) => (g, t) => ({
  body: inset(g, g.depth),
  under: railButtons(g, turn, rails, t.edge),
  over: furniture ? furniture(g, turn, t) : "",
});

// A TV is a panel on a pedestal. The panel's height is the cutout plus a bezel
// as deep as the one above it; whatever height the sidecar declares beyond that
// is the neck and foot, which is the only reason tv-black is taller than 16:9.
function tv(g, t) {
  const panelH = g.c.y * 2 + g.c.height;
  const neckW = g.W * 0.085;
  const neckH = (g.H - panelH) * 0.62;
  const footH = g.H - panelH - neckH;
  const footW = g.W * 0.34;
  return {
    body: { x: 0, y: 0, w: g.W, h: panelH, r: g.R },
    under:
      rrect((g.W - neckW) / 2, panelH - g.R, neckW, neckH + g.R, g.R * 0.4, `fill="${t.core}"`) +
      rrect((g.W - footW) / 2, g.H - footH, footW, footH, footH * 0.45, 'fill="url(#bezel)"'),
    over: "",
  };
}

const STYLES = {
  iphone: slab("ccw", IPHONE_RAILS, island),
  pixel: slab("ccw", PIXEL_RAILS, punchHole),
  ipad: slab("cw", IPAD_RAILS, bezelCamera("left")),
  "android-tablet": slab("cw", TABLET_RAILS, bezelCamera("left")),
  tv,
  // No style, no furniture: the original generic slab, filling its whole box.
  plain: (g) => ({ body: inset(g, 0), under: "", over: "" }),
};

// ---------------------------------------------------------------------------

export function frameSvg(meta, tintId) {
  const g = geom(meta);
  const { W, H, c } = g;
  const t = frameTint(tintId);
  const { body: b, under, over } = (STYLES[meta.style] ?? STYLES.plain)(g, t);

  // Both hairlines scale with the frame so they hold their weight from a
  // thumbnail to a full render. `glass` is the dark gap between rail and
  // display: only its outer half survives the cutout mask, which is exactly the
  // shadow a real screen sits in and the single cheapest cue that this is glass
  // and not a hole in a rectangle.
  const sw = Math.max(2, Math.min(W, H) * 0.0022);
  const gw = Math.max(1.5, Math.min(W, H) * 0.004);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <mask id="cutout">
      <rect width="${W}" height="${H}" fill="white"/>
      ${rrect(c.x, c.y, c.width, c.height, c.borderRadius, 'fill="black"')}
    </mask>
    <linearGradient id="bezel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.edge}"/>
      <stop offset="0.5" stop-color="${t.core}"/>
      <stop offset="1" stop-color="${t.edge}"/>
    </linearGradient>
  </defs>
  <g mask="url(#cutout)">
    ${under}
    ${rrect(b.x, b.y, b.w, b.h, b.r, 'fill="url(#bezel)"')}
    ${rrect(c.x - gw, c.y - gw, c.width + gw * 2, c.height + gw * 2, c.borderRadius + gw, `fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="${n(gw * 2)}"`)}
    ${rrect(b.x + sw / 2, b.y + sw / 2, b.w - sw, b.h - sw, Math.max(0, b.r - sw / 2), `fill="none" stroke="${t.rim}" stroke-width="${n(sw)}"`)}
  </g>
  ${over}
</svg>`;
}

// Percent-encoded rather than base64: btoa is browser-only and Buffer is
// node-only, and this module has to run on both sides.
export function frameSvgUrl(meta, tintId) {
  return `data:image/svg+xml,${encodeURIComponent(frameSvg(meta, tintId))}`;
}
