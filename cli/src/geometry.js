// Shared slide geometry, used by both the Node render (src/template.js) and the
// web preview (ScreenshotCard.js) so a layer's placement is computed in exactly
// one place. Node-API-free, like src/devices.js.
import { normalizeRotation } from "./visual.js";

// The project-level `deviceHeightRatio`, and what a portrait device layer
// inherits when nothing overrides it.
//
// It has to equal the Hero preset's portrait `hRatio`, and a test pins the two
// together. `defaultLayersForKind` deliberately leaves a portrait device's
// hRatio null so the inspector's project-level control keeps reaching it, which
// means a fresh slide takes *this* number and not the preset's — so when the
// two disagree, the preset is simply wrong about every new slide. They did
// disagree: the presets were re-tuned against the measured top charts (see
// test/storeShape.test.js) and this was left at 0.74, which stopped the device
// 6.8% of the canvas short of the bottom edge on every fresh slide while Hero
// claimed 0.79.
export const DEFAULT_DEVICE_HEIGHT_RATIO = 0.79;

// The text column's share of the canvas width. 0.88 leaves 6% of padding a side,
// which is what the fixed three-slot layout hard-coded before layers existed.
export const DEFAULT_TEXT_WRATIO = 0.88;

// deviceHeightRatio is intentionally omitted here — callers supply it (the
// template merges the device default in; the web fills the project default).
export const DEFAULT_LAYOUT = {
  headlineXRatio: 0,
  headlineYRatio: 0.04,
  subtitleXRatio: 0,
  subtitleYRatio: 0.11,
  deviceXRatio: 0,
  deviceYRatio: 0.24,
};

const r = Math.round;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A text column is measured from its *padding*, not from its width: the old
// three-slot layout placed text with `left: round(W*0.06) + x`, and rounding a
// width instead would land a pixel off on some canvases (1290px is one). Deriving
// the pad first and the width from it reproduces the old placement exactly on
// every device — see test/layerGeometry.test.js.
function textColumn(W, wRatio) {
  const pad = r(W * ((1 - wRatio) / 2));
  return { pad, w: W - 2 * pad };
}

// Pixel box for one layer in canvas space.
//
// `layer` is a resolved layer (no nulls left). `frame` is the frame meta when the
// layer is a device with useFrame; ignored otherwise.
//
// Semantics carried over from the pre-layer model, so a migrated deck doesn't
// move: `xRatio` is an offset from the centered position as a fraction of W, and
// `yRatio` is the top edge as a fraction of H.
export function layerBox(layer, { W, H, frame }) {
  const y = r(H * (layer.yRatio ?? 0));

  if (layer.type === "text") {
    const { pad, w } = textColumn(W, layer.wRatio ?? DEFAULT_TEXT_WRATIO);
    return { x: pad + r(W * (layer.xRatio ?? 0)), y, w, h: null };
  }

  if (layer.type === "image") {
    const w = r(W * (layer.wRatio ?? 0.25));
    // An explicit hRatio wins; without one the layer carries the aspect measured
    // when its file was picked, so both renderers lay it out identically without
    // probing the bitmap. Only the explicit case can disagree with the bitmap's
    // own proportions, which is the only case where object-fit has any effect.
    const h =
      layer.hRatio != null
        ? r(H * layer.hRatio)
        : layer.aspect
          ? r(w / layer.aspect)
          : null;
    return { x: r((W - w) / 2 + W * (layer.xRatio ?? 0)), y, w, h };
  }

  if (layer.type === "lens") {
    const w = r(W * (layer.wRatio ?? 0.8));
    return { x: r((W - w) / 2 + W * (layer.xRatio ?? 0)), y, w, h: r(H * (layer.hRatio ?? 0.15)) };
  }

  // device
  const useFrame = layer.useFrame !== false;
  const h = r(H * (layer.hRatio ?? DEFAULT_DEVICE_HEIGHT_RATIO));
  const aspect = useFrame && frame ? frame.frameWidth / frame.frameHeight : W / H;
  const w = r(h * aspect);
  return { x: r((W - w) / 2 + W * (layer.xRatio ?? 0)), y, w, h };
}

// A cutout radius is one number, or [tl, tr, br, bl] for a screen whose corners
// differ — the iPhone Duo's outer display is near-square along the hinge and
// fully rounded on the open side, and one radius either pokes the screenshot's
// corners out past the body or leaves a gap inside the bezel.
const scaleRadius = (r, s) => (Array.isArray(r) ? r.map((v) => v * s) : r * s);
export const radiusCss = (r) => [r].flat().map((v) => `${v}px`).join(" ");

// An image layer's corner radius in px: a fraction of its box's shorter side, so
// 0.5 is a circle on a square icon. A box with no height yet rounds on its width.
export const imageRadiusPx = (layer, box) =>
  Math.round(Math.min(box.w, box.h ?? box.w) * Math.min(Math.max(Number(layer.radius) || 0, 0), 0.5));

// The screen opening inside a device mockup, in mockup-local coordinates.
// Deliberately unrounded: the values scale a frame's authored geometry, and
// rounding them here would shift the screenshot against the bezel it sits in.
export function cutoutBox(frame, mockupW, mockupH, useFrame) {
  if (!useFrame || !frame) {
    return { x: 0, y: 0, w: mockupW, h: mockupH, r: 0 };
  }
  const scale = mockupW / frame.frameWidth;
  const c = frame.cutout;
  return {
    x: c.x * scale,
    y: c.y * scale,
    w: c.width * scale,
    h: c.height * scale,
    r: scaleRadius(c.borderRadius, scale),
  };
}

// ---------------------------------------------------------------------------
// Lens
// ---------------------------------------------------------------------------

// A lens is a second window onto a device's screen. `cut` is that screen's
// opening (cutoutBox), `box` the lens's own layer box; `area` is what it
// magnifies, as fractions of the opening (see makeLensLayer).
//
// The lens draws a copy of the whole screen, scaled by `k` and slid so the
// area's centre lands on the lens's centre — the same element the device draws,
// at a different size, which is what keeps the two identical pixel for pixel.
// Sized directly rather than through a CSS scale(), so the browser lays the
// screenshot out at the size it is shown instead of upsampling a small raster.
export function lensView(area, box, cut) {
  const k = box.w / (area.w * cut.w);
  return {
    k,
    x: box.w / 2 - area.cx * cut.w * k,
    y: box.h / 2 - area.cy * cut.h * k,
    w: cut.w * k,
    h: cut.h * k,
  };
}

// Where the magnified area sits on the device's screen, in opening-local px —
// what the source outline draws. Its height follows the lens's proportions.
export function lensSource(area, box, cut) {
  const w = area.w * cut.w;
  const h = (w * box.h) / box.w;
  return { x: area.cx * cut.w - w / 2, y: area.cy * cut.h - h / 2, w, h };
}

// The area moved to `cx`/`cy` but kept whole on the screen — an area hanging
// off it magnifies nothing, and the lens reads as see-through.
export function lensAreaOnScreen(area, cx, cy, box, cut) {
  const src = lensSource(area, box, cut);
  const hx = Math.min(0.5, src.w / cut.w / 2);
  const hy = Math.min(0.5, src.h / cut.h / 2);
  return { ...area, cx: clamp(cx, hx, 1 - hx), cy: clamp(cy, hy, 1 - hy) };
}

// The inverse: a rect drawn on the opening (opening-local px) -> the area, plus
// the proportions a lens needs for the area to fill it.
export function lensAreaFromRect(rect, cut) {
  return {
    area: {
      cx: clamp((rect.x + rect.w / 2) / cut.w, 0, 1),
      cy: clamp((rect.y + rect.h / 2) / cut.h, 0, 1),
      w: clamp(rect.w / cut.w, 0.02, 1),
    },
    aspect: rect.w / rect.h,
  };
}

// The spot and the lens as they land on the canvas, each through its own
// layer's rotation: four points apiece, nw ne se sw, plus each one's corner
// radius in canvas px — the spot's is the lens's shrunk by the magnification,
// as its outline draws it. `devBox` is the device's layer box, `cut` its
// opening. Null when either won't project.
export function lensQuads(lens, box, dev, devBox, cut) {
  const src = lensSource(lens.area, box, cut);
  const cx = devBox.x + devBox.w / 2;
  const cy = devBox.y + devBox.h / 2;
  const source = [];
  for (const [, sx, sy] of CORNER_SIGNS) {
    const u = cut.x + src.x + ((sx + 1) / 2) * src.w - devBox.w / 2;
    const v = cut.y + src.y + ((sy + 1) / 2) * src.h - devBox.h / 2;
    const p = projectOffset(u, v, dev.rotation);
    if (!p) return null;
    source.push({ x: cx + p.x, y: cy + p.y });
  }
  const own = projectCorners(box, lens.rotation);
  const r = Math.round(Math.min(box.w, box.h) * clamp(lens.radius ?? 0, 0, 0.5));
  return own && { source, lens: own, radius: { source: (r * src.w) / box.w, lens: r } };
}

// The connector in canvas px — `stroke` to outline, `fill` (wedge only) to
// tint — or null when there is nothing to draw: no connector, or the quads
// overlap, which leaves no gap between them to span.
//
// A line runs centre to centre, clipped to both outlines. A wedge is the zoom
// callout's beam: a trapezoid from the spot's edge that faces the lens to the
// lens's edge that faces the spot, its two sides stroked. Facing edges rather
// than the hull of both, which wraps the spot and puts slivers beside it; and
// each edge ends on its rounded corners' 45° points, so the sides meet the
// outline — not a point past the curve, and not one spot on a pill's round end.
export function lensConnectorPath(style, quads) {
  if (!quads || (style !== "line" && style !== "wedge")) return null;
  const { source, lens } = quads;
  const a = centroid(source);
  const b = centroid(lens);
  if (inQuad(a, lens) || inQuad(b, source)) return null;
  if (style === "line") {
    const t0 = exitT(source, a, b);
    const t1 = 1 - exitT(lens, b, a);
    if (!(t1 > t0)) return null;
    const at = (t) => `${fx(a.x + (b.x - a.x) * t)} ${fx(a.y + (b.y - a.y) * t)}`;
    return { stroke: `M${at(t0)}L${at(t1)}`, fill: null };
  }
  const n = facingAxis(source, lens, a, b);
  if (!n) return null;
  const [s0, s1] = facingEdge(source, n, quads.radius?.source ?? 0);
  let [l0, l1] = facingEdge(lens, { x: -n.x, y: -n.y }, quads.radius?.lens ?? 0);
  // Pair the ends so the sides don't cross: crossed pairs are always longer.
  if (dist(s0, l0) + dist(s1, l1) > dist(s0, l1) + dist(s1, l0)) [l0, l1] = [l1, l0];
  const pt = (p) => `${fx(p.x)} ${fx(p.y)}`;
  return {
    fill: ring([s0, s1, l1, l0]),
    stroke: `M${pt(s0)}L${pt(l0)}M${pt(s1)}L${pt(l1)}`,
  };
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const unit = (v) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

// Outward unit normals of a convex quad's edges, i -> i+1.
const normals = (q, c) =>
  q.map((p, i) => {
    const e = q[(i + 1) % q.length];
    const m = { x: (p.x + e.x) / 2 - c.x, y: (p.y + e.y) / 2 - c.y };
    const nv = unit({ x: e.y - p.y, y: p.x - e.x });
    return nv.x * m.x + nv.y * m.y < 0 ? { x: -nv.x, y: -nv.y } : nv;
  });

// The direction from spot to lens the beam crosses: of both quads' edge
// normals, the one along which the widest gap separates them — the side of the
// spot the lens actually lies beyond, not just the way its centre points.
function facingAxis(source, lens, a, b) {
  const d = { x: b.x - a.x, y: b.y - a.y };
  let best = null;
  for (let n of [...normals(source, a), ...normals(lens, b)]) {
    if (n.x * d.x + n.y * d.y < 0) n = { x: -n.x, y: -n.y };
    const dot = (p) => p.x * n.x + p.y * n.y;
    const gap = Math.min(...lens.map(dot)) - Math.max(...source.map(dot));
    if (!best || gap > best.gap) best = { n, gap };
  }
  return best.gap > 0 ? best.n : null;
}

// The edge of `q` whose outward normal lies closest to `n`, its ends moved onto
// the 45° points of the corners rounded by `r` (never past its middle).
function facingEdge(q, n, r) {
  const ns = normals(q, centroid(q));
  let i = 0;
  ns.forEach((m, j) => {
    if (m.x * n.x + m.y * n.y > ns[i].x * n.x + ns[i].y * n.y) i = j;
  });
  const p = q[i];
  const e = q[(i + 1) % q.length];
  const k = r * (1 - Math.SQRT1_2);
  const t = Math.min(0.5, k / (dist(p, e) || 1));
  const m = ns[i];
  const at = (u) => ({ x: p.x + (e.x - p.x) * u - m.x * k, y: p.y + (e.y - p.y) * u - m.y * k });
  return [at(t), at(1 - t)];
}

const fx = (n) => Math.round(n * 100) / 100;
const ring = (pts) => `M${pts.map((p) => `${fx(p.x)} ${fx(p.y)}`).join("L")}Z`;
const centroid = (q) => ({ x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length });
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

// Inside a convex quad of either winding.
function inQuad(p, q) {
  const s = q.map((a, i) => cross(a, q[(i + 1) % q.length], p));
  return s.every((v) => v >= 0) || s.every((v) => v <= 0);
}

// The smallest t in (0, 1] at which a -> b leaves the convex polygon `q`.
function exitT(q, a, b) {
  let best = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  q.forEach((p, i) => {
    const n = q[(i + 1) % q.length];
    const ex = n.x - p.x;
    const ey = n.y - p.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) return;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
    const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
    if (t > 1e-9 && t < best && u >= 0 && u <= 1) best = t;
  });
  return best;
}

// The size of a new lens over a drawn `rect` (canvas px): `zoom` times the rect,
// held between 40% and 92% of the canvas on the wide side and 40% of its height
// on the tall one. A tall area earns more height, up to what `zoom` asks for,
// before that cap takes anything off: capping it at 40% first, then deriving the
// width from it, is what turned a tall pick into a lens smaller than the thing
// it magnified. Neither cap ever takes it below 1x.
export function lensSize(rect, W, H, zoom = 1.6) {
  const aspect = rect.w / rect.h;
  let w = clamp(rect.w * zoom, 0.4 * W, Math.max(0.92 * W, rect.w));
  let h = w / aspect;
  const maxH = Math.max(0.4 * H, Math.min(rect.h * zoom, Math.max(0.92 * H, rect.h)));
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w, h };
}

// Where a lens of w x h goes beside `spot` (its source's box on the canvas):
// centred on it, above or below — whichever side of it `bounds` leaves more
// room on — a gap away, and kept on the canvas. Apart rather than over the spot
// because that is what makes an inset read as a zoom and not as more screen,
// and it leaves a connector somewhere to run. Top-left, canvas px.
export function lensAside(spot, w, h, bounds, W, H) {
  const gap = 0.03 * H;
  const up = spot.y - bounds.y > bounds.y + bounds.h - (spot.y + spot.h);
  return {
    x: clamp(spot.x + spot.w / 2 - w / 2, 0, Math.max(0, W - w)),
    y: clamp(up ? spot.y - gap - h : spot.y + spot.h + gap, 0, Math.max(0, H - h)),
  };
}

// ---------------------------------------------------------------------------
// Rotated corners
// ---------------------------------------------------------------------------

// Where a layer's four corners actually land once its rotation is applied.
//
// The selection handles have to sit on these, not on the axis-aligned box around
// them: the box a rotated layer reports has its corners out in empty space, and
// dots drawn there float off the thing they resize.
//
// Doing the projection here rather than reading it back off the rendered dots is
// what makes it testable — and it avoids the trap in the DOM version, where dots
// living inside the rotated frame get projected *themselves*, so the near corner
// draws twice the size of the far one and the --ui-px counter-scaling that keeps
// chrome at a constant screen size is defeated.
//
// The maths is CSS's own, in the order rotationCss emits:
// `perspective(D) rotateX(a) rotateY(b) rotateZ(c)` about `center center`.
// A point at layer-local offset (u, v) from the centre, on the z = 0 plane, is
// rotated by Z then Y then X, and the perspective divide finishes it.
const CORNER_SIGNS = [
  ["nw", -1, -1],
  ["ne", 1, -1],
  ["se", 1, 1],
  ["sw", -1, 1],
];
export const CORNERS = CORNER_SIGNS.map(([c]) => c);

const RAD = Math.PI / 180;

export function projectOffset(u, v, rotation) {
  const { x: ax, y: ay, z: az, depth } = normalizeRotation(rotation);
  const a = ax * RAD;
  const b = ay * RAD;
  const c = az * RAD;
  const p1 = u * Math.cos(c) - v * Math.sin(c);
  const p2 = u * Math.sin(c) + v * Math.cos(c);
  const X = p1 * Math.cos(b);
  const Y = p2 * Math.cos(a) + p1 * Math.sin(b) * Math.sin(a);
  const Z = p2 * Math.sin(a) - p1 * Math.sin(b) * Math.cos(a);
  const w = 1 - Z / depth;
  // A corner at or behind the camera plane has no finite projection. It cannot
  // happen inside the shipped limits (x/y are capped at 30 degrees), but the
  // rotation can arrive off an unvalidated /api/render body, so it is guarded
  // rather than left to produce Infinity.
  if (!(w > 0.001)) return null;
  return { x: X / w, y: Y / w };
}

// The four corners of `box` in canvas coordinates, front-of-the-compass order
// (nw, ne, se, sw) so one list drives the maths, the cursor and the class name.
// Returns null if any corner is unprojectable, so a caller never draws three
// handles out of four.
export function projectCorners(box, rotation) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const hw = box.w / 2;
  const hh = box.h / 2;
  const out = [];
  for (const [corner, sx, sy] of CORNER_SIGNS) {
    const p = projectOffset(sx * hw, sy * hh, rotation);
    if (!p) return null;
    out.push({ corner, x: cx + p.x, y: cy + p.y });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Magnetic snapping
// ---------------------------------------------------------------------------

// Which of a box's three lines a candidate plays, and who names the pixel when
// two of them land on it. A lock only ever pairs like with like — left to left,
// centre to centre, right to right — so `role` is not decoration: it is what a
// candidate is *for*.
export const SNAP_WEIGHT = { canvas: 0, safe: 1, layer: 2 };
// Ties go to the centre, then to the more authoritative source. A layer sitting
// exactly on the canvas centre must report the centre, not whichever line
// happened to be built first.
const ROLE_RANK = { center: 0, start: 1, end: 2 };
// Canvas px within which two candidates of the same role are the same line. An
// odd-width layer centres on a half pixel; the canvas centres on a whole one,
// and one magnetic line down the middle is the whole point.
const SNAP_EPS = 1;

// How close a drag has to come before it locks, in *screen* px. Screen rather
// than a share of the axis, which is what this used to be: a share is a
// different number on each axis, so on a 1290x2796 canvas the vertical pull was
// 2.2x the horizontal one, and no amount of zooming in bought you finer
// placement. 6 sits between DRAG_THRESHOLD (4) and HIT_PAD (8) in
// useCanvasEditor, which is the same scale the rest of the gesture works at.
export const SNAP_SCREEN_PX = 6;
// Ceiling on the same value as a share of the canvas's short edge. Since the
// budget is SNAP_SCREEN_PX * short / cardWidth, the short edge cancels and this
// binds exactly on the two smallest card sizes — where 6 screen px is a large
// enough slice of the canvas that everything would feel magnetised.
export const SNAP_MAX_RATIO = 0.025;

// The lock distance in canvas px, for a card drawn at `scale`.
export function snapThreshold(scale, { W, H }) {
  return Math.min(SNAP_SCREEN_PX / (scale || 1), SNAP_MAX_RATIO * Math.min(W, H));
}

// The lines a drag can lock onto, in canvas px: the canvas's own edges and
// centre, the safe area's insets when it is switched on, and every other layer's
// edges and centre.
//
// Edges, not just centres. Centres alone can only answer "put these two on the
// same axis" — which is the easy case, since a slide is mostly centred anyway.
// Lining a badge up with the left edge of the headline above it is the thing
// people actually reach for, and it has no centre to snap to.
//
// The safe area contributes no centre: an inset is a boundary, and the middle of
// two insets is the canvas centre by another name.
// `seams` are the x of any edge this canvas shares with a panorama neighbour. A
// layer centred on one is split evenly between two slides, so each is a centre
// line with the canvas's own weight.
export function snapLines(boxes, { W, H, safeArea = null, seams = [] }) {
  const x = axis(0, W, safeArea && [safeArea.leftPx, W - safeArea.rightPx]);
  const y = axis(0, H, safeArea && [safeArea.topPx, H - safeArea.bottomPx]);
  for (const pos of seams) x.push({ pos, role: "center", weight: SNAP_WEIGHT.canvas });
  for (const b of boxes) {
    // A box that hasn't been measured yet would seed NaN candidates, and NaN
    // compares false against every threshold — so it would not lock, it would
    // quietly poison the dedupe ordering.
    if (Number.isFinite(b.x) && Number.isFinite(b.w)) push(x, b.x, b.w, SNAP_WEIGHT.layer);
    if (Number.isFinite(b.y) && Number.isFinite(b.h)) push(y, b.y, b.h, SNAP_WEIGHT.layer);
  }
  return { x: dedupe(x), y: dedupe(y) };
}

function axis(lo, hi, insets) {
  const out = [];
  push(out, lo, hi - lo, SNAP_WEIGHT.canvas);
  if (insets) {
    out.push({ pos: insets[0], role: "start", weight: SNAP_WEIGHT.safe });
    out.push({ pos: insets[1], role: "end", weight: SNAP_WEIGHT.safe });
  }
  return out;
}

function push(out, lo, size, weight) {
  out.push({ pos: lo, role: "start", weight });
  out.push({ pos: lo + size / 2, role: "center", weight });
  out.push({ pos: lo + size, role: "end", weight });
}

// Collapse candidates that are the same line. Keyed on the role as well as the
// position: a layer's right edge landing on the canvas centre is two different,
// both-meaningful targets, and merging them would silently delete one.
//
// The lower-weight entry names the survivor's position too, not just its weight
// — otherwise the canvas centre loses its own pixel to a layer edge half a pixel
// away, and "centred" stops being reproducible.
function dedupe(entries) {
  const out = [];
  for (const e of [...entries].sort((a, b) => a.pos - b.pos || a.weight - b.weight)) {
    const prev = out.find((k) => k.role === e.role && Math.abs(k.pos - e.pos) <= SNAP_EPS);
    if (!prev) {
      out.push({ ...e });
    } else if (e.weight < prev.weight) {
      prev.pos = e.pos;
      prev.weight = e.weight;
    }
  }
  return out.sort((a, b) => a.pos - b.pos);
}

// The best lock for one axis: the smallest shift that brings the dragged box's
// own line onto a candidate playing the same role. Returns the shift to apply
// and the line that caught it, or null for no lock.
//
// Like to like, always. Matching any of the three own lines against any
// candidate — which is what this used to do — makes a layer's right edge lock
// onto the canvas centre, so a mockup sitting far to the left draws the same
// line down the middle that a centred one does. It also breaks the property that
// makes a drag feel steady: with one own line per candidate, the lock is the
// nearest-point map over a fixed set, which is monotone in the travel, so a
// steady drag walks the guides in order and never returns to one it has left.
// Pairing an edge against the opposite edge would give each candidate two
// distances again, and the guide would flip back and forth between neighbours.
//
// Nearest wins rather than first, so a layer between two guides snaps to the one
// it is actually closer to instead of whichever happened to be built first.
export function snapAxis(lo, size, candidates, threshold) {
  const own = { start: lo, center: lo + size / 2, end: lo + size };
  let best = null;
  for (const c of candidates) {
    const delta = c.pos - own[c.role];
    // Negated so a NaN delta is rejected rather than accepted.
    if (!(Math.abs(delta) <= threshold)) continue;
    if (best && !beats(delta, c, best)) continue;
    best = { delta, line: c.pos, role: c.role, weight: c.weight };
  }
  return best;
}

// Nearest, then centre, then the more authoritative source. The epsilon is what
// makes the tie-break reachable at all: a layer that is already exactly aligned
// has a zero delta against all three of its lines, and a strict `<` would hand
// the lock to whichever was built first.
function beats(delta, c, best) {
  const d = Math.abs(delta) - Math.abs(best.delta);
  if (Math.abs(d) > 1e-6) return d < 0;
  if (c.role !== best.role) return ROLE_RANK[c.role] < ROLE_RANK[best.role];
  return c.weight < best.weight;
}

// A move shared by several layers, held to what every one of them can take, so
// the group arrives in the arrangement it left in. Clamping each member on its
// own squeezes the group flat against a wall instead. `ranges` is one
// `{ at, lo, hi }` per member in the same units as `delta`. A member already
// outside its own range may move back toward it but not further out, and never
// yanks the group in: zero is always allowed.
export function sharedDelta(delta, ranges) {
  let lo = -Infinity;
  let hi = Infinity;
  for (const r of ranges) {
    lo = Math.max(lo, r.lo - r.at);
    hi = Math.min(hi, r.hi - r.at);
  }
  return Math.max(Math.min(0, lo), Math.min(Math.max(0, hi), delta));
}

// ---------------------------------------------------------------------------
// Rotate gesture
// ---------------------------------------------------------------------------

// Degrees the shift key rounds a rotate to. 15 gives you the eighths of a turn
// people actually reach for, and lands on 45 and 90 exactly.
export const ROTATE_SNAP = 15;

// Into (-180, 180]. The model *clamps* z rather than wrapping it, so a sweep
// past the bound would pin at 180 while the pointer reads -179 — and the next
// grab would spring 358 degrees back the other way. Wrapping before the write
// is what keeps a full turn continuous.
export function wrapDeg(d) {
  const m = (((d + 180) % 360) + 360) % 360 - 180;
  return m === -180 ? 180 : m;
}

// The roll a rotate gesture is asking for: the angle the pointer has swept about
// the layer's centre since the press, added to the roll it started at.
//
// Measured as a delta rather than "wherever the pointer points" so the layer
// doesn't jump to meet the cursor on the first pixel of the drag — you keep hold
// of the grip you actually grabbed.
//
// The centre is the *untransformed* box centre, and that is exact rather than an
// approximation: CSS composes a transform as T(origin)·funcs·T(-origin), so the
// transform-origin — `center center`, per rotationCss — is the one point every
// rotation and the perspective divide leave exactly where it was.
export function rotateTo(startDeg, { cx, cy, startX, startY, x, y, snap = false }) {
  const swept = Math.atan2(y - cy, x - cx) - Math.atan2(startY - cy, startX - cx);
  const deg = startDeg + (swept * 180) / Math.PI;
  return wrapDeg(snap ? Math.round(deg / ROTATE_SNAP) * ROTATE_SNAP : deg);
}

// A pointer delta measured on screen, expressed in the layer's own axes.
//
// resizeBox works in the unrotated box's space — "east" means the box's right
// edge, not the screen's. Once the handles sit on the rotated corners those two
// stop agreeing, and dragging the corner of a rolled block stretches it along
// the screen diagonal instead of its own. Undoing the roll first is what makes
// the corner follow the pointer.
//
// Only z is undone. x and y are capped at 30 degrees (they lean the plane toward
// the camera, and the frames are flat art), so the foreshortening they add is a
// second-order error on a gesture the eye is correcting continuously anyway,
// while z now runs the full turn.
export function unrotateDelta(dx, dy, z) {
  const a = (z ?? 0) * RAD;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { dx: dx * cos + dy * sin, dy: -dx * sin + dy * cos };
}

// The resize cursor for a corner, from where that corner actually sits relative
// to the layer's centre. Naming it off the compass label instead — "nw is always
// nwse-resize" — is a lie the moment anything is rolled: at 90 degrees the
// north-west corner of the model is the north-east corner on screen.
export function cursorForPoint(point, centre) {
  const deg = (Math.atan2(point.y - centre.y, point.x - centre.x) * 180) / Math.PI;
  // Four cursors over eight 45-degree sectors, so opposite corners share one.
  const sector = ((Math.round(deg / 45) % 4) + 4) % 4;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][sector];
}

// A corner-handle drag, in canvas pixels: the box the gesture started from plus
// the pointer delta, giving the box it should become.
//
// `corner` is a compass pair ("nw"|"ne"|"se"|"sw") naming the handle being
// pulled — the opposite corner is what stays put on screen, which is the whole
// contract of a resize handle. `tie` keeps the two axes proportional (a layer
// whose height isn't its own to set, or shift held).
//
// `dx`/`dy` are the pointer's travel on screen and `z` is the layer's roll. The
// roll pivots about the box centre, and the centre moves with w and h, so on a
// rolled layer pinning the unrotated corner is not enough: the pivot shifts and
// carries the "pinned" corner with it. The box is moved back by the rotated
// part of that shift.
//
// Pure and here rather than in the card because it is the fiddliest arithmetic in
// the editor and the only part of a drag that has a right answer worth asserting.
export function resizeBox(box, { corner, dx: screenDx, dy: screenDy, z = 0, tie = false, min = 1 }) {
  const { dx, dy } = unrotateDelta(screenDx, screenDy, z);
  const sx = corner.includes("e") ? 1 : -1;
  const sy = corner.includes("s") ? 1 : -1;
  let w = Math.max(min, box.w + sx * dx);
  let h = Math.max(min, box.h + sy * dy);
  if (tie) {
    // A tied corner can only travel its own diagonal, so the scale it is being
    // asked for is the pointer's projection onto that ray — each axis counts for
    // as much as it is long, and pulling the corner by the diagonal doubles the
    // box. Taking whichever axis had moved further instead was discontinuous:
    // the factor swapped between w/box.w and h/box.h the moment a drag crossed
    // the diagonal, and on a wide, short block (a one-line headline is one) those
    // two are an order of magnitude apart — a few pixels of vertical wobble
    // tripled the type, which is what made a fast resize jump.
    const s = 1 + (sx * dx * box.w + sy * dy * box.h) / (box.w * box.w + box.h * box.h);
    // The floor holds the long side, not both: on a block far wider than it is
    // tall, flooring the short one would stop it shrinking at all.
    const floor = min / Math.max(box.w, box.h);
    w = box.w * Math.max(floor, s);
    h = box.h * Math.max(floor, s);
  }
  // The centre's travel in the layer's own axes, minus what the roll turns it
  // into on screen, is the pivot's drift. Exactly zero unrolled.
  const a = (z ?? 0) * RAD;
  const mx = (sx * (w - box.w)) / 2;
  const my = (sy * (h - box.h)) / 2;
  const driftX = (Math.cos(a) - 1) * mx - Math.sin(a) * my;
  const driftY = Math.sin(a) * mx + (Math.cos(a) - 1) * my;
  return {
    x: (sx > 0 ? box.x : box.x + box.w - w) + driftX,
    y: (sy > 0 ? box.y : box.y + box.h - h) + driftY,
    w,
    h,
  };
}

// A corner-handle drag on a *text* layer. Text is the one layer with no height
// of its own — the glyphs decide it — so its two axes write different things:
// the width is the column the text wraps in, the height is the type size that
// filled it. Pulling sideways therefore reflows the block at the size it is
// (all the way out to the full canvas), and pulling down scales the type.
//
// `tie` (shift) drives both from one factor instead, scaling the block whole:
// the column widens with the type, so the wrap points hold exactly.
//
// `origin` is the block's measured box when the gesture started, plus the
// layer's own sizeMul; `next` is the box resizeBox produced. `z` is the layer's
// roll.
//
// `heightOf({ sizeMul, wRatio })` predicts the block's height at the new size
// and column. resizeBox's `next.h` is only what the pointer asked for: a column
// that rewraps gains or loses whole lines, and the corner opposite the handle —
// which sits at the block's real height, and on a rolled block pivots about its
// real centre — would move by the difference. Without it `next.h` stands in.
export function textResize(origin, next, { W, H, tie = false, corner = "se", z = 0, heightOf }) {
  // Capped at the full canvas — a column wider than that has nowhere to go, and
  // is a width the inspector's slider could not show you either.
  const wRatio = clamp(next.w / W, 0.1, 1);
  const colW = W * wRatio;
  const k = tie ? next.w / origin.w : next.h / origin.h;
  let sizeMul = clamp(origin.sizeMul * k, 0.1, 6);
  // Growing from a north handle, the block's top is the edge under the pointer,
  // so the block may not come out taller than the pointer asked for: scaled by
  // the height alone, a column that does not widen with it rewraps, and a 15px
  // pull put a whole extra line under the pinned bottom — which a stacked
  // caption can only spill downward. The largest size whose block still fits
  // the dragged height instead; height grows with the type, so it is bisected.
  if (corner.includes("n") && !tie && heightOf && sizeMul > origin.sizeMul) {
    const fits = (s) => heightOf({ sizeMul: s, wRatio }) <= next.h + 0.5;
    if (!fits(sizeMul)) {
      let lo = origin.sizeMul;
      let hi = sizeMul;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      sizeMul = lo;
    }
  }
  const h = heightOf?.({ sizeMul, wRatio }) ?? next.h;
  // The opposite corner where it was on screen, and the box of the new size
  // whose same corner lands there. A west handle anchors the right edge, which
  // the width floor can leave apart from next.x once the column stops shrinking.
  const sx = corner.includes("e") ? 1 : -1;
  const sy = corner.includes("s") ? 1 : -1;
  const a = (z ?? 0) * RAD;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const turn = (ox, oy) => ({ x: ox * cos - oy * sin, y: ox * sin + oy * cos });
  const was = turn((-sx * origin.w) / 2, (-sy * origin.h) / 2);
  const now = turn((-sx * colW) / 2, (-sy * h) / 2);
  const cx = origin.x + origin.w / 2 + was.x - now.x;
  const cy = origin.y + origin.h / 2 + was.y - now.y;
  // The pinned edge holds while the column still fits beside it; past that the
  // block grows the other way instead of hanging off the canvas, so pulling a
  // corner all the way out lands it edge to edge rather than shouldered off the
  // side. (A block can still be *moved* off-canvas — that's a drag, not this.)
  const left = clamp(cx - colW / 2, 0, Math.max(0, W - colW));
  return {
    sizeMul,
    wRatio,
    xRatio: (left - (W - colW) / 2) / W,
    yRatio: clamp((cy - h / 2) / H, -0.5, 1.5),
  };
}

// The device's drop shadow, as ratios of the mockup height so it stays
// proportional across canvases. The defaults reproduce the values that were
// literals in slideHtml.js before shadows were configurable.
export const DEFAULT_DEVICE_SHADOW = { opacity: 0.35, blur: 0.04, y: 0.02 };

export function shadowPx(shadow, mockupH) {
  if (!shadow) return null;
  return {
    y: r(mockupH * (shadow.y ?? DEFAULT_DEVICE_SHADOW.y)),
    blur: r(mockupH * (shadow.blur ?? DEFAULT_DEVICE_SHADOW.blur)),
    opacity: shadow.opacity ?? DEFAULT_DEVICE_SHADOW.opacity,
  };
}

// ---------------------------------------------------------------------------
// Legacy three-slot geometry. Kept only so test/layerGeometry.test.js can assert
// that layerBox reproduces it; nothing else calls it. Delete once that test has
// been green through a release.
// ---------------------------------------------------------------------------
export function slideGeometry({ W, H, layout, frame, useFrame }) {
  const mockupH = r(H * layout.deviceHeightRatio);
  const aspect = useFrame ? frame.frameWidth / frame.frameHeight : W / H;
  const mockupW = r(mockupH * aspect);
  const mockupX = r((W - mockupW) / 2 + W * (layout.deviceXRatio ?? 0));
  const mockupY = r(H * (layout.deviceYRatio ?? 0));

  const cutScale = useFrame ? mockupW / frame.frameWidth : 1;
  const cutX = useFrame ? frame.cutout.x * cutScale : 0;
  const cutY = useFrame ? frame.cutout.y * cutScale : 0;
  const cutW = useFrame ? frame.cutout.width * cutScale : mockupW;
  const cutH = useFrame ? frame.cutout.height * cutScale : mockupH;
  const cutR = useFrame ? scaleRadius(frame.cutout.borderRadius, cutScale) : 0;

  const textSidePad = r(W * 0.06);
  const headlineX = r(W * (layout.headlineXRatio ?? 0));
  const headlineY = r(H * (layout.headlineYRatio ?? 0.04));
  const subtitleX = r(W * (layout.subtitleXRatio ?? 0));
  const subtitleY = r(H * (layout.subtitleYRatio ?? 0.11));

  const shadowY = r(mockupH * 0.02);
  const shadowBlur = r(mockupH * 0.04);

  return {
    mockupX, mockupY, mockupW, mockupH,
    cutX, cutY, cutW, cutH, cutR,
    textSidePad, headlineX, headlineY, subtitleX, subtitleY,
    shadowY, shadowBlur,
  };
}
