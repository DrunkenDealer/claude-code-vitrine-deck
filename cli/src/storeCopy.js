// The sentences the stores refuse.
//
// A slide's words are metadata as far as both stores are concerned, and both
// reject on them: a price, a call to action, the other store's name, a URL. Play
// also refuses a ranking, an award badge, a rating or a press quote, which the
// App Store takes — so those rules only apply to a slide that ships on a Play
// row (each rule's `stores`). None of that is a design problem, so nothing in
// src/layoutScore.js or src/contrast.js can see it — and it is the one class of
// fault where a deck is perfect, renders beautifully and is refused at review.
//
// **Warnings, not failures, by default.** False positives are certain: "best of
// both worlds" is not a ranking claim, "free" in "hands-free" is not an offer,
// and a gate people switch off protects nothing — the same reasoning that shaped
// the contrast sampler. `--strict` is for CI, where a human is not reading the
// output anyway.
//
// **The patterns are English.** A German *die beste App* passes every one of them.
// That is a real limit and not a bug to file: matching claims across languages
// needs a model, not a regex, and a caller who believes this list is exhaustive
// is worse off than one who knows it isn't. Said out loud in the CLI output, in
// `capabilities`, and here.
//
// Sources, read 2026-09-09:
//   Google Play, Store listing and promotion policy —
//     https://support.google.com/googleplay/android-developer/answer/9898842
//   App Review Guidelines 2.3.7 / 2.3.10 / 2.3.14 —
//     https://developer.apple.com/app-store/review/guidelines/
//
// Re-read 2026-11-17. Apple's 2.3.x names prices (2.3.7: "should not include
// prices"; 2.3.14: "specific or discounted pricing information") and other
// platforms (2.3.10), but nothing on awards, rankings, ratings or press — and 10
// of 16 award-winning App Store sets put an Apple Design Award, App of the Year,
// Editors' Choice laurel, press quote or rating count on slide 1 or 2. Blocking
// those on an iPhone row refused copy that ships. Play names them outright
// ("App of the year", "#1", award icons, "Editor's choice"), and Strava and Calm
// swap those slides out on Play.
//
// Node-API-free like the rest of src/ that both hosts share.

import { INVISIBLE_SOURCE } from "../web/src/lib/invisibleChars.js";
import { slidesForDevice } from "./deck.js";
import { storesFor } from "./storeFit.js";
import { captionText } from "./layers.js";

export const STORE_COPY = "store-copy";

export const COPY_LANGUAGE = "en";
export const COPY_LANGUAGE_NOTE =
  "the patterns are English — a claim made in another language passes them silently, " +
  "so a translated deck still needs a native reader";

// Polish repairs layout, never words, so every copy hint ends on where to edit.
const COPY_HINT_NOTE = " — edit the layer's text, or its layersByLocale override for detail.locale; polish never changes copy";
// A Play-only claim is usually right where it is for the App Store, so the fix
// is a second slide for Play rather than deleting the claim.
const PLAY_SWAP = "keep it for the App Store; give the Play rows a Play-specific replacement slide (a separate deck for the Play rows) that says what the app does instead";

const STORES_FOR_ALL = ["appStore", "play"];

/**
 * What each rule is looking for, and why the store cares.
 *
 * `severity` is what the rule is worth *before* --strict: "block" is a sentence a
 * store names in its own policy, "warn" is one that is usually fine and
 * occasionally a rejection, which is exactly where a human has to look.
 *
 * `stores` is which stores the rule applies to; a slide that ships on no row of
 * those stores is not graded against it.
 */
export const COPY_RULES = [
  {
    id: "ranking-claim",
    severity: "block",
    pattern: /#\s?1\b|\bno\.?\s?1\b|\bbest\b|\btop[- ]rated\b|\bworld'?s\b|\b#1\b/i,
    stores: ["play"],
    why: "a ranking or superlative claim — Play's store-listing policy refuses them; the App Store does not",
    hint: `${PLAY_SWAP}${COPY_HINT_NOTE}`,
  },
  {
    id: "award-claim",
    severity: "block",
    pattern: /\baward|\bwinner\b|editor'?s choice|app of the year|featured by\b/i,
    stores: ["play"],
    why: "an award or store-programme claim — Play's store-listing policy refuses them; the App Store does not",
    hint: `${PLAY_SWAP}${COPY_HINT_NOTE}`,
  },
  {
    id: "rating-or-press",
    severity: "block",
    pattern: /\b[0-5](?:\.\d)?\s?(?:★|stars?\b)|\b\d[\d.,]*\s?[km]?\+?\s(?:ratings|reviews|downloads)\b|\bas seen (?:in|on)\b|\bfeatured (?:in|on)\b/i,
    stores: ["play"],
    why: "a rating, review count or press mention — store performance to Play's store-listing policy; the App Store does not refuse it",
    hint: `${PLAY_SWAP}${COPY_HINT_NOTE}`,
  },
  {
    id: "price-or-offer",
    severity: "block",
    pattern: /[$€£¥]\s?\d|\d+\s?%\s?off\b|\bsale\b|\bdiscount|\bcashback\b|\bhalf price\b/i,
    why: "a price, discount or offer — Play refuses them and App Review 2.3.7 / 2.3.14 do too",
    hint: `remove the price or offer — it belongs in the store's promotional text${COPY_HINT_NOTE}`,
  },
  {
    id: "call-to-action",
    severity: "block",
    pattern: /\b(download|install|get it|buy|subscribe|click|tap here)\s+(now|today|here)\b/i,
    why: "a call to action — the screenshot is not an ad unit",
    hint: `replace the call to action with the benefit${COPY_HINT_NOTE}`,
  },
  {
    id: "names-a-store",
    severity: "block",
    pattern: /app ?store|google ?play|play ?store/i,
    why: "names a store — neither store lets a listing advertise the other",
    hint: `remove the store's name${COPY_HINT_NOTE}`,
  },
  {
    id: "url-or-email",
    severity: "block",
    pattern: /https?:\/\/|www\.|\S+@\S+\.\w/i,
    why: "a URL or email address — both stores treat one in a screenshot as off-listing metadata",
    hint: `remove the URL or email address${COPY_HINT_NOTE}`,
  },
  {
    id: "promotional-word",
    severity: "warn",
    pattern: /\bfree\b|\btrial\b|\bnew\b|\bguarantee/i,
    why: "a promotional word — fine only if it is plainly true and is not an offer",
    hint: `keep it only if it is plainly true and not an offer${COPY_HINT_NOTE}`,
  },
  {
    id: "all-caps",
    severity: "warn",
    pattern: /\b[A-Z]{4,}\b/,
    why: "ALL CAPS — Play's policy asks listings to avoid it",
    hint: `write it in sentence or title case${COPY_HINT_NOTE}`,
  },
  {
    id: "emoji-pile-up",
    severity: "warn",
    pattern: /(\p{Extended_Pictographic}.*){3,}/u,
    why: "three or more emoji — Play's policy asks listings to avoid a pile-up",
    hint: `keep two emoji at most${COPY_HINT_NOTE}`,
  },
];

// Serialisable, because a RegExp is not. This is what `capabilities` serves, and
// it is the whole rule: source plus flags rebuilds the pattern exactly.
export const copyRuleTable = () =>
  COPY_RULES.map(({ id, severity, stores = STORES_FOR_ALL, why, hint, pattern }) => ({
    id,
    severity,
    stores,
    why,
    hint,
    pattern: pattern.source,
    flags: pattern.flags,
  }));

// What the rules are matched against. The patterns spell an apostrophe `'`, and
// NFKC folds none of the lookalikes ("Editor\u2019s Choice" with a curly, a
// modifier-letter or a backtick apostrophe walked through), so they are mapped
// here first — and before NFKC, which turns U+00B4 into a space plus a combining
// acute. Fullwidth and compatibility forms are NFKC's job.
//
// Anything that changes how a word is spelled without changing how it reads also
// walked a claim through: an invisible or blank character inside it (CGJ, Hangul
// filler, braille blank, a variation selector: "be\u034fst"), or a combining mark
// on a letter. Invisible characters are dropped first (the shared rule in
// web/src/lib/invisibleChars.js), then the text is decomposed (NFKD, so a mark
// that composed into "\u00e9" is a base letter plus a mark again) and every
// combining mark dropped \u2014 from this matching copy only, never from the stored text, where
// Hindi and Arabic keep theirs. True homoglyphs (Cyrillic "\u0435") are a different
// script, not a form, and are not caught.
//
// A superscript or subscript character is a footnote marker, not part of the
// word it follows: NFKD folds "best¹" to "best1" and "bestⁱ" to "besti", which
// glues a character on and lets the rules' \b miss it ("best¹ app", "world’s²",
// "Free¹"). A space in its place was not enough either: "top¹-rated" and
// "app² of the year" became "top -rated" and "app  of", which the rules' single
// space or hyphen no longer matches (N528). So a marker is dropped, and becomes
// a space only between two letters ("best¹app", "H₂O"); "m²" just loses it.
// Modifier letters (ʰ, ᵃ, ⁿ) count; ª and º, real ordinals in Spanish, do not.
const SCRIPT_CHAR = "[\u00b2\u00b3\u00b9\u2070-\u209f\u02b0-\u02b8\u02e0-\u02e4\u1d2c-\u1d6a\u1d9b-\u1dbf]";
const SCRIPT_BETWEEN = new RegExp(`(?<=\\p{L})${SCRIPT_CHAR}+(?=\\p{L})`, "gu");
const SCRIPT_CHARS = new RegExp(`${SCRIPT_CHAR}+`, "gu");
const INVISIBLE = new RegExp(INVISIBLE_SOURCE, "gu");
export const matchable = (text) =>
  String(text)
    .replace(INVISIBLE, "")
    .replace(SCRIPT_BETWEEN, " ")
    .replace(SCRIPT_CHARS, "")
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");

/**
 * Every string a deck would print, with where it came from.
 *
 * Base text *and* every `layersByLocale` override, because a translation is new
 * copy that nobody has graded — and because the locale map is where a claim gets
 * introduced after the base language was reviewed.
 *
 * Only slides a deck would actually ship: `selected` is what check, render and
 * push all walk, so grading an unselected one would report a claim on an image
 * that does not exist.
 */
export function copyStrings(deck) {
  const out = [];
  const base = deck.defaults?.baseLocale ?? null;
  for (const slide of deck.screenshots ?? []) {
    if (!slide.selected) continue;
    for (const layer of slide.layers ?? []) {
      if (layer.type !== "text") continue;
      // The words as shown: accent braces would split "{best} app" from the rule
      // that names it.
      const shown = (text) => captionText({ text, accent: layer.accent });
      if (layer.text) {
        out.push({ slideId: slide.id, slide: slide.name, layerId: layer.id, locale: base, text: shown(layer.text) });
      }
      for (const [locale, patch] of Object.entries(slide.layersByLocale ?? {})) {
        const text = patch?.[layer.id]?.text;
        if (text) out.push({ slideId: slide.id, slide: slide.name, layerId: layer.id, locale, text: shown(text) });
      }
    }
  }
  return out;
}

/**
 * Copy faults for a whole deck, shaped like every other fault list so a report
 * can merge them. Deck-level rather than per-cell: the words do not change per
 * device, and printing the same claim once per device row is how a warning
 * becomes wallpaper.
 *
 * `devices` decides which stores each slide ships to, and so which rules apply
 * to it: a slide only on iPhone rows may carry an award, the same slide on an
 * Android or feature-graphic row may not. Without devices every rule applies.
 */
export function copyFaults(deck, devices = null) {
  const shipsTo = new Map();
  for (const device of devices ?? []) {
    for (const { screenshot } of slidesForDevice(deck.screenshots ?? [], device)) {
      const stores = shipsTo.get(screenshot.id) ?? new Set();
      for (const store of storesFor(device)) stores.add(store);
      shipsTo.set(screenshot.id, stores);
    }
  }
  const faults = [];
  for (const where of copyStrings(deck)) {
    const plain = matchable(where.text);
    const slideStores = devices ? (shipsTo.get(where.slideId) ?? new Set()) : new Set(STORES_FOR_ALL);
    for (const rule of COPY_RULES) {
      const stores = (rule.stores ?? STORES_FOR_ALL).filter((s) => slideStores.has(s));
      if (!stores.length) continue;
      const match = rule.pattern.exec(plain);
      if (!match) continue;
      faults.push({
        code: STORE_COPY,
        severity: rule.severity,
        rule: rule.id,
        slideId: where.slideId,
        slide: where.slide,
        layerId: where.layerId,
        locale: where.locale,
        hint: rule.hint,
        detail: { why: rule.why, match: match[0], text: where.text, stores },
      });
    }
  }
  return faults;
}
