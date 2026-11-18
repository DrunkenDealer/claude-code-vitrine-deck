// A deck to start from, built the way the editor builds one.
//
// Without this an agent wrote its first deck from the capabilities schema by
// hand — and the commonest hand-written deck renders nothing: slides without
// `selected`, no `projectDevices`, a kind no device draws. Every slide here is
// the editor's own fresh slide (defaultLayersForKind, inheriting every styled
// field from the project defaults), so `apply`, `check` and `render` treat it
// exactly as they would one saved by the editor.
import { DECK_DEFAULTS, DEVICELESS_KINDS, KINDS, defaultLayersForKind } from "./deck.js";
import { DEVICES, RETIRED_DEVICE_IDS } from "./devices.js";
import { IMAGE_ROLES, makeImageLayer } from "./layers.js";
import { isLocaleId, isSupportedLocale } from "./locales.js";
import { DECK_VERSION } from "../web/src/lib/deckMigration.js";

export const SCREENSHOT_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

// The first row of the kind, which for a phone is the App Store slot every
// iPhone submission must fill (iphone-6.3) — the starter deck's own choice.
export const defaultDeviceFor = (kind) =>
  Object.entries(DEVICES).find(([, d]) => d.category === kind)?.[0] ?? null;

// An app icon reads as one at a launcher's corner radius; key art keeps its own edges.
const IMAGE_RADIUS = { icon: 0.22, art: 0 };

/**
 * `sources` is `[{ key, name }]` in slide order. `images` maps an image role
 * (`icon`, `art`) to `{ key, aspect }` and adds that layer to every slide; only
 * a feature graphic has layouts to place one. Throws naming whatever is not a
 * kind, device or locale this build knows.
 */
export function initDeck({ sources = [], kind = "phone", devices = null, locales = null, images = {} }) {
  if (!KINDS.includes(kind)) throw new Error(`unknown kind "${kind}" (kinds: ${KINDS.join(", ")})`);
  const roles = IMAGE_ROLES.filter((r) => images[r]);
  if (roles.length && kind !== "feature-graphic") {
    throw new Error(`an ${roles.join(" or ")} layer is placed by the feature graphic's layouts — use kind feature-graphic`);
  }
  const ids = devices?.length ? devices : [defaultDeviceFor(kind)];
  // Own-property lookups: `--device constructor` read Object.prototype's
  // function as a device and wrote a deck naming it (N507).
  const unknown = ids.filter((id) => !Object.hasOwn(DEVICES, id));
  if (unknown.length) {
    const retired = unknown.filter((id) => Object.hasOwn(RETIRED_DEVICE_IDS, id));
    const hint = retired.length ? ` (${retired.map((id) => `${id} is now ${RETIRED_DEVICE_IDS[id]}`).join(", ")})` : "";
    throw new Error(`unknown device ${unknown.join(", ")}${hint}`);
  }
  const langs = [...(locales?.length ? locales : DECK_DEFAULTS.locales)];
  const badLocales = langs.filter((l) => !isLocaleId(l));
  if (badLocales.length) throw new Error(`unknown locale ${badLocales.join(", ")}`);
  const rtl = langs.filter((l) => !isSupportedLocale(l));
  if (rtl.length) throw new Error(`locale ${rtl.join(", ")} is right-to-left, which Vitrine does not lay out`);
  if (!sources.length && !DEVICELESS_KINDS.has(kind)) {
    throw new Error(`a ${kind} slide shows a screenshot — pass a folder with at least one image`);
  }

  // A banner (page-header, search-result, feature-graphic) may hold no screenshot at all: one slide, copy on a ground.
  const slides = sources.length ? sources : [{ key: null, name: kind }];
  return {
    v: DECK_VERSION,
    projectDevices: [...ids],
    defaults: { locales: langs, baseLocale: langs[0] },
    screenshots: slides.map(({ key, name }, i) => ({
      id: `s-${i + 1}`,
      name,
      kind,
      sourceKey: key,
      groupId: null,
      order: i,
      selected: true,
      spanId: null,
      spanIndex: null,
      background: null,
      safeAreaTop: null,
      safeAreaBottom: null,
      safeAreaLeft: null,
      safeAreaRight: null,
      layers: [
        ...defaultLayersForKind(kind),
        ...roles.map((role) =>
          makeImageLayer({ id: role, role, sourceKey: images[role].key, aspect: images[role].aspect, radius: IMAGE_RADIUS[role] })),
      ],
    })),
  };
}
