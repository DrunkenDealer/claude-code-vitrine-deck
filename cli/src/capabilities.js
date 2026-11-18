// Everything a slide is allowed to be, in one document.
//
// This exists because the alternative is a table copied into a prompt. The ASO
// skill's renderer reference hardcodes the device list today, and the day a
// device is added that table is wrong with nothing to notice — an agent picking
// from a stale menu writes a deck that fails at render time, or worse, quietly
// renders at the wrong size. So the menu is *served* rather than copied: every
// entry here is read off the module that owns it, and adding a theme or a device
// changes this output by construction.
//
// Read by `vitrine capabilities --json`. Free of node APIs except the sticker
// manifest, which is loaded through template.js's cached reader.
import { DEVICES } from "./devices.js";
import { FRAME_TINT_OPTIONS } from "./frames.js";
import { FONTS, DEFAULT_FONT_ID, DEFAULT_HEADLINE_WEIGHT, DEFAULT_SUBTITLE_WEIGHT } from "./fonts.js";
import { THEMES, DEFAULT_THEME_ID } from "./themes.js";
import {
  BACKGROUND_GROUPS,
  BACKGROUND_PRESETS,
  ROTATION_PRESETS,
  ROTATION_LIMITS,
  DEFAULT_DEVICE_TRANSFORM,
  MAX_SPAN,
} from "./visual.js";
import { LOCALES, DEFAULT_LOCALE, isSupportedLocale, needsFontCoverage } from "./locales.js";
import { DEFAULT_SAFE_AREA } from "./safeArea.js";
import { FAULTS, FAULT_HINT, FAULT_SEVERITY, FAULT_LABEL, WEIGHTS, APPLY_MARGIN } from "./layoutScore.js";
import { CONTRAST_HINT, CONTRAST_RULE, CONTRAST_UNVERIFIED, LOW_CONTRAST } from "./contrast.js";
import { THUMBNAIL } from "./thumbnail.js";
import {
  APP_STORE,
  APP_STORE_BANNERS,
  FEATURING,
  NO_FEATURE_GRAPHIC,
  PLAY,
  REQUIRED_SLOT,
  SLOT_COUNT,
  STORE_FAULT_HINT,
  STORE_FAULT_LABEL,
  STORE_FAULT_SEVERITY,
  STORE_FIT,
  compliantAlternative,
  storeFitFor,
  storesFor,
} from "./storeFit.js";
import { COPY_LANGUAGE, COPY_LANGUAGE_NOTE, STORE_COPY, copyRuleTable } from "./storeCopy.js";
import {
  DECK_DEFAULTS,
  DEFAULT_NAME_TEMPLATE,
  DEVICELESS_KINDS,
  FALLBACK_KIND,
  INHERITED_KEYS,
  KINDS,
  LOCALIZABLE_KEYS,
  NAME_TOKENS,
  SLIDE_FIELDS,
  orientationOf,
} from "./deck.js";
import { FEATURE_GRAPHIC_PRESETS, PRESETS } from "./layoutPresets.js";
import { COMPILED_LOOKS, DEFAULT_LOOK_ID, LOOK_FAMILIES } from "./looks.js";
import {
  IMAGE_FITS,
  IMAGE_ROLES,
  LAYER_ROLES,
  LAYER_TYPES,
  TEXT_ALIGNS,
  LENS_CONNECTORS,
  LENS_PRESETS,
  TEXT_CASES,
  makeDeviceLayer,
  makeImageLayer,
  makeLensLayer,
  makeTextLayer,
  HEADLINE_MAX,
  SUBTITLE_MAX,
  TEXT_MAX,
} from "./layers.js";
import { stickerKeyFromId } from "./stickers.js";
import { DECK_VERSION } from "../web/src/lib/deckMigration.js";
import { stickerLibrary, stickerPacks } from "./template.js";

// Ranges normalizeLayer clamps to. The one hand-written table left, because
// the clamps are inline literals in layers.js rather than something to read
// off — everything else in this file is derived from the module that owns it.
//
// test/capabilities.test.js is what stops it drifting: it checks that this
// describes every field the make*Layer functions actually produce, and that
// nothing here describes a field they don't.
const LAYER_SCHEMA = {
  common: {
    id: "unique within the slide; keys the per-device override map",
    role: `${LAYER_ROLES.join(" | ")} | null (null = the user's own, inherits nothing). ${IMAGE_ROLES.join(" and ")} are image-only: a feature graphic's brand mark and key art, which its layout presets place`,
    type: LAYER_TYPES.join(" | "),
    xRatio: "-2..2 — offset from the *centred* position, as a fraction of canvas width",
    yRatio: "-2..2 — the layer's top edge, as a fraction of canvas height",
    rotation: "{ x, y, z, depth } — see rotation.limits",
    opacity: "0..1",
  },
  text: {
    wRatio: "0.02..2 — the column's share of canvas width",
    text: `string — at most ${HEADLINE_MAX} characters for a headline, ${SUBTITLE_MAX} for a subtitle, ${TEXT_MAX} otherwise; validate warns past that`,
    fontId: "a font id; anything outside fonts.bundled must be cached first",
    weight: "100..900, snapped to the family's real weights at render",
    sizeMul: "0.1..6 — multiplies the device's role font size",
    align: TEXT_ALIGNS.join(" | "),
    color: "CSS colour",
    lineHeight: "0.6..3",
    letterSpacing: "-0.3..1 (em)",
    textCase: TEXT_CASES.join(" | "),
    balance: "boolean — text-wrap: balance",
    shadow: "null | { x: -1..1, y: -1..1, blur: 0..1, color } — all in multiples of the font size",
    highlight: "null | { color, padX: 0..3, padY: 0..3, radius: 0..3 } — in em of the font size",
    accent:
      "null | CSS colour — draws the words wrapped in { } in `text` in this colour (\"Habits that {stick}\"). " +
      "The braces are never drawn or measured; without an accent they are literal text. " +
      "A stray brace is dropped, so a translation that loses its pair renders plain. " +
      "Checked for contrast against the same floor as `color`.",
    followGap:
      "subtitle only. null = yRatio is absolute. 0..0.5 = keep this layer's top " +
      "that fraction of canvas height below the headline's ink bottom. The editor " +
      "recomputes yRatio from it on every write that changes the headline's " +
      "measured box; a deck written by hand is responsible for its own yRatio and " +
      "should leave this null unless it is going through the editor.",
  },
  device: {
    hRatio: "0.05..2 — height as a fraction of canvas height; width follows the frame",
    useFrame: "boolean",
    frameTint: FRAME_TINT_OPTIONS.map((t) => t.id).join(" | "),
    stackId:
      "null = yRatio and hRatio are absolute. A preset id = this device's y and " +
      "height are solved from that preset's vertical stack, so the canvas height " +
      "left over by the caption above or below it becomes the device rather than " +
      "dead air. The editor re-solves on every write that changes a caption's " +
      "measured box, and clears it when a yRatio or hRatio is written by hand. A " +
      "deck written by hand should leave this null and set both ratios itself.",
    sourceKey: "null = the slide's own screenshot",
    shot: "{ zoom: 1..4, x: 0..1, y: 0..1 } — object-position inside the frame's cutout",
    shadow: "null (off) | { opacity: 0..1, blur: 0..0.5, y: -0.5..0.5 } — fractions of mockup height",
  },
  image: {
    wRatio: "0.01..2",
    hRatio: "null (keep the bitmap's proportions) | 0.01..2",
    sourceKey: "an upload key, or a sticker key — see stickers.keyFormat",
    aspect: "0.01..100 — the source's own width/height",
    fit: `${IMAGE_FITS.join(" | ")} — only meaningful with an explicit hRatio`,
    radius: "0..0.5 — corner radius as a fraction of the box's shorter side; 0.5 on a square is a circle. Rounds the box, so with fit contain and an explicit hRatio the letterboxed picture's own corners stay square",
    tint: "null | { <slot token>: '#rrggbb' } — only for a sticker whose pack declares slots",
  },
  lens: {
    wRatio: "0.02..2",
    hRatio: "0.01..2",
    target: "the id of the device layer it magnifies; a lens whose target is gone draws nothing",
    area: "{ cx: 0..1, cy: 0..1, w: 0.02..1 } — the magnified spot, in fractions of the target's screen opening; its height follows the lens box's proportions",
    radius: "0..0.5 — of the lens box's shorter side, so 0.5 is a pill",
    border: "null (off) | { width: 0..0.05 (of canvas width), color, opacity: 0..1 }",
    shadow: "null (off) | { opacity: 0..1, blur: 0..0.5, y: -0.5..0.5 }",
    markSource: "boolean — outline the magnified spot on the device",
    dim: "0..0.9 — darkens the rest of the target's screen",
    blur: "0..1 — blurs the rest of the target's screen",
    connector: LENS_CONNECTORS.join(" | "),
  },
};

// The keys of a layout fault's `detail` in check --json, per code (null when a
// fault carries none). big-gap names no layer: its layerId is null.
const STORE_DETAIL = {
  [STORE_FIT]: ["store", "width", "height", "reason", "alternative"],
  [SLOT_COUNT]: ["store", "count", "min", "max"],
  [FEATURING]: ["store", "count", "want", "reason"],
  [NO_FEATURE_GRAPHIC]: ["store", "reason"],
  [REQUIRED_SLOT]: ["store", "reason", "alternative"],
};

const LAYOUT_DETAIL = {
  [FAULTS.OFF_CANVAS]: ["fraction"],
  [FAULTS.SAFE_AREA]: ["vOver", "hOver"],
  [FAULTS.OVERLAP]: ["otherId", "fraction"],
  [FAULTS.TINY_TEXT]: ["fontSizePx", "floor"],
  [FAULTS.SMALL_TEXT]: ["fontSizePx", "thumbnailPx", "floor"],
  [FAULTS.TIGHT_MARGIN]: ["distance"],
  [FAULTS.BIG_GAP]: ["maxGap", "bottomGap"],
  [FAULTS.FG_DULL_GROUND]: ["color"],
};

const defaultsOf = (layer) => {
  const { id: _id, ...rest } = layer;
  return rest;
};

/**
 * The whole vocabulary. `packs`/`stickers` need the manifest off disk; pass
 * `{ stickers: false }` where that isn't wanted.
 */
export function capabilities({ stickers = true } = {}) {
  const library = stickers ? stickerLibrary() : new Map();
  const packs = stickers ? stickerPacks() : [];

  return {
    version: 1,

    devices: Object.entries(DEVICES).map(([id, d]) => {
      const device = { id, ...d };
      const fit = storeFitFor(device);
      return {
        id,
        label: d.label,
        width: d.canvasWidth,
        height: d.canvasHeight,
        kind: d.category,
        platform: d.platform ?? null,
        frame: d.frame,
        headlineFontSize: d.headlineFontSize,
        subtitleFontSize: d.subtitleFontSize,
        // The store's art safe area, { x, y, w, h } in canvas px: outside it the
        // banner is cropped on some device. check grades text against it always.
        ...(d.artSafe ? { artSafe: d.artSafe } : {}),
        // Whether the store this row is an asset for will take its canvas.
        // Computed from the rule rather than listed, so a row added tomorrow
        // gets an answer without anyone remembering to write one — which is the
        // whole argument this document exists for. `uploadable: null` is "not
        // verified", never "refused"; see stores.appStore.
        store: Object.fromEntries(
          storesFor(device).map((store) => [
            store,
            {
              ...fit[store],
              alternative:
                fit[store].uploadable === false ? compliantAlternative(device, store) : null,
            },
          ]),
        ),
      };
    }),

    // A slide is one kind, and a kind is one canvas shape — which is why
    // landscape is its own kind and not a flag. A device draws the slides of its
    // own kind, falling back to `fallback` when it has none of them.
    kinds: KINDS.map((kind) => ({
      id: kind,
      orientation: orientationOf(kind),
      fallback: FALLBACK_KIND[kind] ?? null,
      // A banner (the Play feature graphic, the App Store header and search
      // result) is not a picture of an app running: it may hold a device mockup
      // and most do not, so its slides need neither a device layer nor a
      // screenshot behind one.
      deviceLayer: DEVICELESS_KINDS.has(kind) ? "optional" : "required",
      screenshot: DEVICELESS_KINDS.has(kind) ? "optional" : "required",
    })),

    themes: THEMES.map(({ preview: _preview, ...t }) => t),
    defaultThemeId: DEFAULT_THEME_ID,

    // Position, alignment and size only — never colour or font, so applying one
    // never disturbs the deck's look. Addresses layers by role, so anything the
    // user added stays where it was put.
    layoutPresets: PRESETS,
    // The Play feature graphic's own layouts, applied like any preset
    // (`apply --layout <id>`). They place the slide's `icon` and `art` image
    // layers (see layer.common.role) as well as its caption; a device preset on a
    // feature graphic lands on its text-only caption.
    featureGraphicPresets: FEATURE_GRAPHIC_PRESETS,

    // What the editor offers instead of themes: a ground, a layout preset and a
    // type style in one. The type style (tracking, case, size, shadow,
    // highlight) is layer-owned and cannot reach a slide through `defaults`, so
    // a look is applied with `vitrine apply --look <id>`, not by copying fields.
    looks: {
      families: LOOK_FAMILIES,
      defaultId: DEFAULT_LOOK_ID,
      entries: COMPILED_LOOKS.map((l) => ({
        id: l.id,
        family: l.family,
        label: l.label,
        layoutPreset: l.layout.id,
        font: l.font,
        ground: l.ground,
        headline: l.headline,
        subtitle: l.subtitle,
        device: l.device,
        defaults: l.defaults,
      })),
      applyWith: "vitrine apply --deck <path> --look <id>",
    },

    backgrounds: {
      // The spec shapes a background may take. Stored as a spec rather than
      // compiled CSS so the editor can reopen what a slide is using.
      types: {
        solid: "{ color }",
        linear: "{ angle: 0..360, stops: [[color, 0..100], …] }",
        radial: "{ x: -50..150, y: -50..150, r: 1..200, stops: [[color, pct], …] }",
        mesh: "{ base, blobs: [{ c, x: -50..150, y: -50..150, r: 1..200 }] }",
        image: "{ sourceKey, fit: cover|contain, scale: 1..4, x: 0..100, y: 0..100, blur: 0..100, dim: 0..1 }",
      },
      presets: BACKGROUND_PRESETS,
      // Every preset carries the text colour that provably reads on it, and the
      // editor writes that colour onto the deck when one is picked. An agent
      // choosing a background should do the same rather than leaving the deck's
      // ink on a background it was never measured against.
      inkNote:
        "each preset's `ink` is the text colour graded against it at the hero anchors — " +
        "apply it with the background unless the deck's own colour already clears WCAG AA",
      groups: BACKGROUND_GROUPS,
      // The bundled photo pack: ordinary `image` specs pointing into
      // assets/backgrounds/ rather than a sixth type, so every crop/blur/dim
      // control works on one exactly as on an upload.
      photos: {
        keyFormat: "backgrounds/<id>.webp",
        catalog: "assets/backgrounds/index.json — id, label, group, ink, credit",
        rebuildWith: "npm run backgrounds",
      },
    },

    fonts: {
      bundled: FONTS.map(({ id, label, family, weights }) => ({ id, label, family, weights })),
      // Any other Google family is reachable as `gf:<Family Name>`, but the file
      // has to be on disk before a render: nothing touches the network at render
      // time, so an uncached family silently falls back to the system stack.
      dynamicIdFormat: "gf:<Google family name>",
      warmWith: "vitrine font <family>",
      searchWith: "vitrine search fonts <query> --json",
      defaultId: DEFAULT_FONT_ID,
      defaultHeadlineWeight: DEFAULT_HEADLINE_WEIGHT,
      defaultSubtitleWeight: DEFAULT_SUBTITLE_WEIGHT,
    },

    frameTints: FRAME_TINT_OPTIONS,

    rotation: {
      presets: ROTATION_PRESETS,
      limits: ROTATION_LIMITS,
      default: DEFAULT_DEVICE_TRANSFORM,
    },

    locales: LOCALES.map((l) => ({
      ...l,
      supported: isSupportedLocale(l.id),
      // None of the bundled families draw anything outside Latin, so a locale
      // flagged here renders in a fallback stack that differs between the
      // browser preview and the render container unless a covering family is set.
      needsFontCoverage: needsFontCoverage(l.id),
    })),
    defaultLocale: DEFAULT_LOCALE,

    stickers: {
      keyFormat: `${stickerKeyFromId("<pack>/<id>")} — an ordinary image layer's sourceKey`,
      packs: packs.map((p) => ({
        ...p,
        onDemand: Boolean(p.onDemand),
        bundledCount: [...library.values()].filter((s) => s.pack === p.id).length,
      })),
      // Only the authored pack is enumerable — icons is 1,512 glyphs across six
      // weights and emoji is ~3.9k, both searched through their catalogs.
      objects: [...library.values()]
        .filter((s) => s.pack === "objects")
        .map(({ id, name, aspect, tags }) => ({ id, name, aspect, tags })),
      searchWith: "vitrine search icons|emoji|stickers <query> --json",
      catalogs: {
        icons: "assets/phosphor.json — the weight rides in the id (icons/trophy-duotone)",
        emoji: "assets/noto-emoji.json — ids are codepoints (emoji/1f680)",
      },
    },

    safeArea: {
      defaults: DEFAULT_SAFE_AREA,
      note: "absolute canvas px, authored against iPhone 6.9\" and scaled per device",
      // A guide only: it never moves a layer, so render output is the same
      // whatever the insets. Off unless the deck asks for it.
      optIn: "off by default; set defaults.safeAreaEnabled: true to draw the band as a guide and have `vitrine check` score it — rendering never moves text into it",
    },

    layers: {
      schema: LAYER_SCHEMA,
      defaults: {
        text: defaultsOf(makeTextLayer({ role: "headline" })),
        device: defaultsOf(makeDeviceLayer({})),
        image: defaultsOf(makeImageLayer({ sourceKey: "" })),
        lens: defaultsOf(makeLensLayer({})),
      },
      // One-click lens styles, as the editor offers them. Style only — position,
      // target and area stay put; a preset's border keeps the lens's own colour.
      lensPresets: LENS_PRESETS,
      rules: [
        `back to front; at most one layer per role; a device layer is always present, except on ${[...DEVICELESS_KINDS].join(", ")}, where it is optional`,
        "a role-carrying layer leaves an inherited field null so the project default reaches it",
        "a layer with role null carries its own values — presets never move it, themes never restyle it",
      ],
      inherits: INHERITED_KEYS,
    },

    deck: {
      version: DECK_VERSION,
      defaults: DECK_DEFAULTS,
      localizableKeys: [...LOCALIZABLE_KEYS],
      slideFields: SLIDE_FIELDS,
      // Every key a slide carries, as the editor writes it. `selected` is the
      // one a hand-written deck forgets: check, render and push skip a slide
      // without it, and the editor shows it unticked.
      slideShape: {
        id: "unique within the deck",
        name: "the export file name's {slide} token",
        kind: KINDS.join(" | "),
        sourceKey: "the screenshot every device draws, unless shotByDevice names another; null only on a deviceless kind",
        order: "export order within the kind, ascending",
        selected: "boolean — only selected slides are checked, rendered and pushed as exports",
        groupId: "null | id — links slides across kinds that show the same store screenshot",
        spanId: "null | id — see panorama",
        spanIndex: "null | 0.. — see panorama",
        ...Object.fromEntries(SLIDE_FIELDS.map((k) => [k, "null = the project default; see defaults"])),
        layers: "[layer…] back to front — see layers",
        layersByDevice: "see overrideMaps",
        layersByLocale: "see overrideMaps",
        byDevice: "see overrideMaps",
        shotByDevice: "see overrideMaps",
      },
      // Neighbouring slides of one kind sharing one background, painted that
      // many canvases wide; what crosses a seam carries on onto the neighbour.
      panorama: {
        maxSpan: MAX_SPAN,
        fields: ["spanId", "spanIndex"],
        rule:
          "a panorama is the unbroken run of selected slides of one kind, in order, that share a spanId " +
          "and whose spanIndex counts up by one (0, 1, 2). A run longer than maxSpan splits into " +
          "consecutive panoramas; a run of one is an ordinary slide. An image background in a panorama " +
          "under backgrounds/ uses its backgrounds/wide/ twin.",
      },
      overrideMaps: {
        layersByDevice: "{ [deviceId]: { [layerId]: partial layer } }",
        layersByLocale: "{ [locale]: { [layerId]: partial layer, from } } — localizableKeys only",
        byDevice: "{ [deviceId]: partial slide } — slideFields only",
        shotByDevice: "{ [deviceId]: sourceKey } — the screenshot that device shows instead of the slide's own",
      },
    },

    export: {
      nameTokens: NAME_TOKENS,
      defaultTemplate: DEFAULT_NAME_TEMPLATE,
      note: "a deck in more than one language is foldered under {locale} whether or not the template says so",
    },

    // What the stores do to the file, as opposed to what a designer does to the
    // slide. Every number here is the store's own; the only one that is ours is
    // in `thumbnail` below, and it says so.
    stores: {
      play: {
        label: "Google Play",
        screenshot: PLAY.screenshot,
        featureGraphic: { ...PLAY.featureGraphic, device: "play-feature-graphic", kind: "feature-graphic", required: true },
        featuring: PLAY.featuring,
        source: PLAY.source,
        screenshotSource: PLAY.screenshotSource,
      },
      appStore: {
        label: "App Store",
        slots: APP_STORE.slots,
        slotsPer: "device class, per localization",
        source: APP_STORE.source,
        // Apple publishes a list of accepted sizes rather than a rule, so an
        // unlisted canvas is reported as unverified rather than refused — a copy
        // of a list goes stale in a way a rule does not.
        note: "no aspect-ratio cap; a canvas is accepted because App Store Connect lists it. devices[].store.appStore.uploadable is null, not false, for a size not on the list this build carries.",
        // Optional banners, one slide each, graded against devices[].artSafe.
        pageHeader: { ...APP_STORE_BANNERS["page-header"], device: "app-store-header", kind: "page-header", required: false },
        searchResult: { ...APP_STORE_BANNERS["search-result"], device: "app-store-search", kind: "search-result", required: false },
        bannerSource: APP_STORE_BANNERS.source,
      },
      // When the documents above were last read end to end. A rule read later
      // than the sweep carries its own date — see play.screenshotSource.
      verifiedOn: "2026-09-09",
    },

    // **Not a store rule.** A measured store search result, and the floors type
    // has to clear there. Tunable, unlike everything in `stores`.
    thumbnail: THUMBNAIL,

    faults: {
      layout: Object.values(FAULTS).map((code) => ({
        code,
        label: FAULT_LABEL[code] ?? null,
        weight: WEIGHTS[code] ?? null,
        severity: FAULT_SEVERITY[code] ?? "block",
        hint: FAULT_HINT[code] ?? null,
        detail: LAYOUT_DETAIL[code] ?? null,
      })),
      contrast: [
        {
          code: LOW_CONTRAST,
          label: "text too close to its background",
          rule: CONTRAST_RULE,
          severity: "block",
          hint: CONTRAST_HINT[LOW_CONTRAST],
          detail: ["ratio", "color", "against", "opacity", "floor", "thumbnailPx", "weight"],
        },
        {
          code: CONTRAST_UNVERIFIED,
          label: "contrast not measurable on this background",
          severity: "warn",
          hint: CONTRAST_HINT[CONTRAST_UNVERIFIED],
          detail: ["reason", "color"],
        },
      ],
      // Device-level, not per-cell: a canvas is refused once, and a slot count
      // is a property of the row rather than of any image in it.
      store: Object.entries(STORE_FAULT_LABEL).map(([code, label]) => ({
        code,
        label,
        severity: STORE_FAULT_SEVERITY[code],
        hint: STORE_FAULT_HINT[code],
        detail: STORE_DETAIL[code],
        ...(code === STORE_FIT ? { warnWhen: "the store's rule cannot verify this canvas (devices[].store.<store>.uploadable null)" } : {}),
      })),
      // Deck-level, and warnings unless `check --strict`. English only.
      copy: {
        code: STORE_COPY,
        language: COPY_LANGUAGE,
        note: COPY_LANGUAGE_NOTE,
        storesNote:
          "rules[].stores is where a rule applies: a slide is graded only for the stores its device rows ship to " +
          "(storesFor). Rankings, awards, ratings and press are Play-only — App Review allows them; prices and offers block on both",
        strictFlag: "vitrine check --strict makes every warning blocking",
        rules: copyRuleTable(),
      },
      applyMargin: APPLY_MARGIN,
      note: "a penalty, not a score: 0 is clean and larger is worse. A slide can be tasteless and score 0.",
      // The faults with no weight, and why. All are real and none is something
      // the geometric repair can pay off, so pricing them would only teach the
      // search to reach for a fix it must not make.
      unweighted: {
        [FAULTS.NO_FRAME]: "an Infinity, not a term — the slide cannot be scored at all",
        [FAULTS.SMALL_TEXT]: "polish only shrinks, so it can never repair this; the clamp prevents it instead",
        [FAULTS.NO_DEVICE]: "a warning from check, not a term — a slide of type alone can be deliberate",
        [FAULTS.ORPHAN]: "a warning from check, not a term — only the copy can fix it, and polish never edits copy",
        [FAULTS.FG_DEVICE]: "a warning from check, not a term — polish never deletes a layer",
        [FAULTS.FG_NO_TEXT]: "a warning from check, not a term — only the copy can fix it",
        [FAULTS.FG_DULL_GROUND]: "a warning from check, not a term — a colour is not something a geometric repair may touch",
      },
    },
  };
}
