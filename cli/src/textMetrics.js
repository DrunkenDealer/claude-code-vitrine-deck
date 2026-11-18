// How tall a text layer actually renders, which is the one thing the layout
// model has never known. `layerBox` returns `h: null` for text (geometry.js) —
// the column is placed, and the browser decides where the words break inside it.
// Nothing downstream could ask whether a headline fits, so nothing did.
//
// This predicts the wrap the way src/slideHtml.js's `textLayerCss` produces it,
// so the two must be read together: `width: fit-content; max-width: 100%;
// overflow-wrap: anywhere`, unitless `line-height`, `letter-spacing` in em, and
// `text-transform` applied before anything is measured.
//
// Node-API-free like geometry.js/visual.js/layers.js — both hosts import it.
// Glyph widths come in through `measure`, because Node has no font engine and
// the browser's is a canvas; `estimateEm` stands in when there is neither.
//
// test/textParity.test.js checks the prediction against a real Chromium, which
// is the only honest way to know this file is right.
import { layerBox } from "./geometry.js";
import { captionText, fontSizePx } from "./layers.js";

// ---- glyph width fallback ---------------------------------------------------

// Advance per character, in em, by rough class. A single constant would be
// worse than nothing here — "WWW" and "iii" differ by about 4× — and this is
// within ~5% of the bundled families, which is well inside the tolerance the
// scorer applies on top (see layoutScore.js).
//
// Order matters: `I` is hairline before it is a capital.
const CLASSES = [
  [/[ijlI.,;:'!|]/, 0.28],
  [/[ftrs()[\]{}-]/, 0.4],
  [/ /, 0.26],
  [/[mwMW@%]/, 0.88],
  [/[A-Z0-9]/, 0.62],
];
const DEFAULT_ADVANCE = 0.53;

function advanceOf(ch) {
  for (const [re, em] of CLASSES) if (re.test(ch)) return em;
  return DEFAULT_ADVANCE;
}

// em for a run, ignoring letter-spacing — the same contract a real `measure` has.
export function estimateEm(str) {
  let em = 0;
  for (const ch of str) em += advanceOf(ch);
  return em;
}

// A measurer factory (the shape measuredRun hands its callback) that answers
// every face with the estimator. `check --fast` solves caption stacks on it so
// each canvas is graded on the column it would get, as a full check and render
// do, rather than on the phone's shared ratios. Stacks solved on it are guesses:
// grade with them, never persist them.
export const estimatingMeasurer = () => estimateEm;

// ---- text -------------------------------------------------------------------

// CSS `text-transform` is locale-tailored (ß→SS, Turkish dotted i) and these
// two are not; they agree on Latin, which is what an app-store caption is.
export function applyCase(text, textCase) {
  const s = text ?? "";
  if (textCase === "upper") return s.toUpperCase();
  if (textCase === "lower") return s.toLowerCase();
  return s;
}

// The advance of one run, in px.
//
// `* count`, not `* (count - 1)`: CSS adds letter-spacing to the
// advance of *every* character, the last one included. That trailing unit is
// why a centred, letter-spaced line sits half a spacing unit left of true
// centre, and dropping it is the classic off-by-one in this calculation.
//
// Except in cursive scripts: Chromium never letter-spaces Arabic, Syriac, N'Ko,
// Mongolian, Mandaic, Phags-pa or Hanifi Rohingya (css-text-3 §cursive-tracking).
// It decides per script run, and a space, digit or mark has no script of its
// own — it joins the run before it, or the one after when it leads.
const CURSIVE =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Mandaic}\p{Script=Phags_Pa}\p{Script=Hanifi_Rohingya}]/u;
const NEUTRAL = /[\p{Script=Common}\p{Script=Inherited}]/u;

// The unit is the grapheme cluster, not the UTF-16 code unit: niqqud, a
// Devanagari conjunct, a ZWJ family or a skin-toned emoji each take one spacing
// unit in Chromium. A cluster of nothing but default-ignorables (ZWSP, soft
// hyphen, bidi marks) takes none. A cluster's script is its base character's.
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}+$/u;

// Characters that are always a cluster of their own, never ignorable and never
// cursive: printable ASCII, Latin-1 (less the soft hyphen), Latin Extended,
// IPA, spacing modifiers, Greek, Cyrillic (less its combining marks), Latin
// Extended Additional and the common punctuation and currency signs. A string
// of only these counts one unit per code unit, so it skips the segmenter, which
// is most of the cost of laying out a tracked Latin deck.
// test/spacedChars.test.js checks every one of them against the full path.
export const SIMPLE =
  /^[\x20-\x7e\xa0-\xac\xae-˿Ͱ-҂Ҋ-ԯḀ-ỿ‐-‧‰-⁞₠-⃀]*$/;

export function spacedChars(str) {
  if (SIMPLE.test(str)) return str.length;
  return spacedClusters(str);
}

export function spacedClusters(str) {
  const clusters = [...GRAPHEMES.segment(str)]
    .map(({ segment }) => segment)
    .filter((c) => !IGNORABLE.test(c));
  if (!CURSIVE.test(str)) return clusters.length;
  let n = 0;
  let pending = 0;
  let cursive = null;
  for (const cluster of clusters) {
    const ch = String.fromCodePoint(cluster.codePointAt(0));
    if (NEUTRAL.test(ch)) {
      if (cursive === null) pending++;
      else if (!cursive) n++;
      continue;
    }
    cursive = CURSIVE.test(ch);
    if (!cursive) n += 1 + pending;
    pending = 0;
  }
  return n + pending;
}

// The grapheme count is only what Chromium does when the font forms each
// conjunct into one cluster. It spaces *shaped* clusters, and a face without a
// ligature for स्त shapes स्ते as two — macOS Devanagari MT does, and so does the
// Linux runner's Devanagari fallback, where a tracked Hindi line predicted one
// unit short. A measurer that can count the units in the real face
// (`measure.units`, canvas letterSpacing) is asked instead. Not for cursive text:
// a canvas letter-spaces Arabic runs the DOM leaves alone.
function spacingUnits(str, measure) {
  if (SIMPLE.test(str)) return str.length;
  if (CURSIVE.test(str)) return spacedClusters(str);
  return measure?.units?.(str) ?? spacedClusters(str);
}

// Shape runs. Before this, a whole candidate line went to one measure() call, and
// canvas measureText splits a word after an ideograph or kana and at spaces, then
// shapes each piece: in 持“Apple the piece “Apple keeps the “A kern. The page
// shapes a paragraph per script run instead, and a Common/Inherited character
// (quote, period, space, digit) joins the run before it, so “ sits in the Han run,
// A starts the Latin run and no kerning crosses the boundary. The canvas came out
// narrower than the page by the kern, the engine packed one glyph more than the
// page and counted a line fewer (a zh headline of 9 lines scored as 8, so the
// give-way stack put the subtitle under it). Han, Hiragana and Katakana stay
// separate runs: the fallback face for ％ and （ depends on which one precedes.
// The lead is the script the previous text ended in; Chromium itemizes the whole
// block, so it crosses line breaks and \n. All-Latin text takes the fast path
// with the same measure calls as before.
const SCRIPT_KEYS = ["Latin","Cyrillic","Greek","Han","Hiragana","Katakana","Hangul","Bopomofo","Thai","Lao","Khmer","Myanmar","Arabic","Hebrew","Devanagari","Bengali","Tamil","Georgian","Armenian","Ethiopic"]
  .map((k) => [k, new RegExp(`\\p{Script=${k}}`, "u")]);
const ONLY_LATIN = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u;
function scriptOf(ch) {
  if (NEUTRAL.test(ch)) return null;
  for (const [k, re] of SCRIPT_KEYS) if (re.test(ch)) return k;
  return "Other";
}
export function shapeRuns(str, lead = null) {
  if ((lead === null || lead === "Latin") && ONLY_LATIN.test(str)) return { runs: [str], tail: /\p{Script=Latin}/u.test(str) ? "Latin" : lead };
  const runs = [];
  let cur = "";
  let script = lead;
  for (const ch of str) {
    const sc = scriptOf(ch);
    if (sc !== null && script !== null && sc !== script && cur) {
      runs.push(cur);
      cur = "";
    }
    if (sc !== null) script = sc;
    cur += ch;
  }
  if (cur) runs.push(cur);
  return { runs, tail: script };
}
export function runWidthPx(str, { measure, fontSizePx: size, letterSpacing = 0, lead = null }) {
  let em;
  if (!measure) em = estimateEm(str);
  else { em = 0; for (const r of shapeRuns(str, lead).runs) em += measure(r); }
  return em * size + (letterSpacing && letterSpacing * size * spacingUnits(str, measure));
}

// The longest prefix of `word` that fits, at least one character. Mirrors
// `overflow-wrap: anywhere`, which breaks inside a word rather than letting it
// spill out of the column.
function breakAt(word, limitPx, opts) {
  let n = 1;
  while (n < word.length && runWidthPx(word.slice(0, n + 1), opts) <= limitPx) n++;
  return n;
}

// Where the browser may break inside a word. The slide is drawn by the DOM with
// `line-break: auto`, so the engine has to break where Chromium does or its
// line count drifts from what is painted: a CJK sentence has no spaces, so it
// was one "word" cut at the last code unit that fits, and a "，" could start a
// line that kinsoku pushes down together with the character before it. That
// counted a zh headline at 1.5 as 7 lines against the 8 drawn, and put it on its
// subtitle (N784).
//
// Chromium breaks with ICU's UAX #14 rules, so these are those rules: each
// character gets its line-break class (LINE_CLASS, the classes that occur in
// app copy; anything else is a letter, AL, or an ideograph, ID) and `mayBreak`
// applies the pair rules in the standard's order. A first version listed which
// characters may not start or end a line and was still short of the browser on
// ASCII quotes (never a break), curly quotes (a break only against a wide
// neighbour, LB19a), "/" and ％ before a Latin letter (LB24, LB25) and a hyphen
// inside CJK text: it counted a line fewer than was drawn (N784 again). The
// render emits no lang, which is what this was measured under (lang=zh differs
// only on 〜); test/textParity.test.js compares it with the Chromium in use. A
// word without a wide character is one unit, so Latin and every other script
// wrap as they always did.
const WIDE = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-￯\u{20000}-\u{3FFFF}]/u;
const HANGUL = /[ᄀ-ᇿ가-퟿]/u;
const EMOJI = /(?![©®])\p{Extended_Pictographic}|\p{Emoji_Presentation}|️/u;
const EMOJI_WIDE = /^(?![\u{1F1E6}-\u{1F1FF}])\p{Emoji_Presentation}/u;
// An emoji next to a letter is a break opportunity (N805): the page breaks
// between 🔥 and a letter on either side, so "привычки🔥бросьте" is two units
// and the engine, which kept it one, counted lines the page does not draw. Not
// every pictograph is class ID, though. Chromium's ICU keeps these as AL, glued
// to the letters like "™" (found by testing every Extended_Pictographic
// code point next to "a": test/textParity.test.js repeats the check on a sample).
// A flag is its own class, RI: a break is allowed on both sides of it, unlike
// ID against "$" or "%". A keycap or a VS16 on an ASCII base keeps the base's class.
const AL_PICTOGRAPH =
  /[©®™ℹ↔-↙↩-↪⌨⏏⏩-⏯⏸-⏺Ⓜ▪-▫▶◀◻-◾☄☎☑☠☢-☣☦☪☮-☯☸♀♂♈-♓♟-♠♣♥-♦♻♾⚒-⚗⚙⚛-⚜⚠-⚡⚧⚪-⚫⚰-⚱⛎⛩⛰✅✏✒✔✖✝✡✨✳-✴❄❇❌❎❓-❕❗➕-➗➡➰➿⤴-⤵⬅-⬇⬛-⬜⭐⭕\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{1f191}-\u{1f19a}\u{1f3b5}-\u{1f3b6}\u{1f3bc}\u{1f4a0}\u{1f4a2}\u{1f4a4}\u{1f4af}\u{1f4b1}-\u{1f4b2}\u{1f500}-\u{1f506}\u{1f517}-\u{1f524}\u{1f532}-\u{1f53d}\u{1f549}]/u;
const PICTOGRAPH = /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/u;
// "!" and "/" keep a Latin letter after them and not a Cyrillic one or a symbol:
// "ф😀!ф" breaks after the "!" in Chromium, "a😀!a" does not.
const LATIN = /\p{Script=Latin}/u;
const REGIONAL =/[\u{1F1E6}-\u{1F1FF}]/u;
const LINE_CLASS = new Map();
for (const [cls, chars] of Object.entries({
  OP: "（「『【《〈〔〖〘〚｛［｟〝｢([{¿¡‚„",
  CL: "，。、．）」』】》〉〕〗〙〛｝］｠｡､｣〞〟﹒﹐﹑",
  CP: ")]}",
  EX: "!?！？‼⁇⁈⁉❣",
  IS: ",.:;",
  SY: "/|",
  HY: "-",
  BA: "–‐　¦",
  NS: "ゝゞヽヾ・･々〻〜～゛゜゠：；",
  IN: "‥…․︙",
  QU: "\"'«»‹›“”‘’‛‟",
  PR: "$£¥€₩＄￡￥￦+±−№¤\\",
  PO: "%‰‱°′″℃℉¢％￠﹪",
  GL: "\u00A0\u202F\u2007\u2011",
  WJ: "\u2060\uFEFF",
  ZW: "\u200B",
  B2: "—",
})) for (const ch of chars) LINE_CLASS.set(ch, cls);
const OPENING_QUOTES = new Set([..."“‘«‹‛‟"]);
const CLOSING_QUOTES = new Set([..."”’»›"]);

const lineClass = (g) => {
  const cp = String.fromCodePoint(g.codePointAt(0));
  const known = LINE_CLASS.get(cp);
  if (known) return known;
  if (REGIONAL.test(cp)) return "RI";
  if (PICTOGRAPH.test(cp)) return AL_PICTOGRAPH.test(cp) ? "AL" : "ID";
  if (HANGUL.test(cp)) return "H";
  if (WIDE.test(cp)) return "ID";
  return /\p{Nd}/u.test(cp) ? "NU" : "AL";
};

// UAX #14, rules LB7 to LB31 in order, for the break before item i. `ea` marks
// the East Asian wide and fullwidth items that LB19a asks about.
function mayBreak(cls, ea, segs, i) {
  const a = cls[i - 1];
  const b = cls[i];
  const pa = segs[i - 1][0];
  const pb = segs[i][0];
  if (b === "ZW" || b === "WJ" || a === "WJ") return false;
  if (a === "ZW") return true;
  if (a === "GL" || (b === "GL" && a !== "BA" && a !== "HY")) return false;
  if (b === "CL" || b === "CP" || b === "EX" || b === "IS" || b === "SY") return false;
  if (a === "OP") return false;
  if (a === "QU" && OPENING_QUOTES.has(pa) && b === "OP") return false;
  if ((a === "CL" || a === "CP") && b === "NS") return false;
  if (a === "B2" && b === "B2") return false;
  if (b === "QU" && (!OPENING_QUOTES.has(pb) || !ea[i - 1] || !ea[i + 1])) return false;
  if (a === "QU" && (!CLOSING_QUOTES.has(pa) || !ea[i] || !ea[i - 2])) return false;
  if (b === "BA" || b === "HY" || b === "NS") return false;
  if (b === "IN") return false;
  if ((a === "AL" && b === "NU") || (a === "NU" && b === "AL")) return false;
  if ((a === "PR" && b === "ID") || (a === "ID" && b === "PO")) return false;
  if (((a === "PR" || a === "PO") && b === "AL") || (a === "AL" && (b === "PR" || b === "PO"))) return false;
  if (!ea[i - 1] && (a === "CL" || a === "CP" || a === "NU") && (b === "PO" || b === "PR")) return false;
  if ((a === "PO" || a === "PR") && b === "NU") return false;
  if ((a === "IS" || a === "NU" || a === "SY") && b === "NU") return false;
  if (a === "HY" && b === "NU" && cls[i - 2] !== "AL" && cls[i - 2] !== "NU") return false;
  if (!ea[i - 1] && a === "EX" && pa !== "?" && b === "NU") return false;
  if ((a === "H" && b === "PO") || (a === "PR" && b === "H")) return false;
  const narrow = !ea[i - 1] && !ea[i];
  if (narrow && (a === "PR" || a === "PO") && (b === "PR" || b === "PO")) return false;
  if ((narrow || (a === "IS" && PICTOGRAPH.test(pb[0]))) && (a === "SY" || a === "IS" || a === "EX") && pa !== "?" && b === "AL" && (a === "IS" || LATIN.test(pb[0]))) return false;
  if (narrow && (a === "SY" || a === "PR") && b === "OP") return false;
  if (narrow && (a === "SY" || a === "IS" || a === "EX" || a === "HY" || a === "BA") && pa !== "?" && (b === "PR" || b === "PO")) return false;
  if (a === "AL" && b === "AL") return false;
  if ((a === "AL" || a === "NU") && b === "OP" && !ea[i]) return false;
  if (a === "CP" && !ea[i - 1] && (b === "AL" || b === "NU")) return false;
  return true;
}

// Thai and Myanmar have no spaces between words, and the browser breaks them
// at dictionary words (ICU). Lao and Khmer are left out: Node's ICU splits Lao
// differently from Chromium's and Khmer more coarsely, so they keep breaking
// at spaces. The engine broke only at spaces, so a
// Thai sentence was one "word" cut at the last code unit that fits (inside a
// cluster, even): it came out short of the browser's lines in 125 of 1824
// headline and 40 of 912 subtitle cases of the sweep, text on text (N785).
// `Intl.Segmenter` word granularity returns the same words as Chromium's line
// breaker on every text measured, with a boundary kept only between two
// characters of these scripts so Latin and digits stay glued to their own run.
// The dictionary is the host's ICU data, not ours: a Node or browser with other
// data splits some words differently and so counts a different number of lines.
// The expected splits are pinned in test/textMetrics.test.js and compared with
// Chromium in test/textParity.test.js, so a new ICU fails loudly. This is its
// own commit so it can be reverted alone.
const DICTIONARY = /[\p{Script=Thai}\p{Script=Myanmar}]/u;
const WORDS = new Intl.Segmenter("th", { granularity: "word" });

function dictionaryUnits(word) {
  const out = [];
  for (const { segment } of WORDS.segment(word)) {
    const prev = out.at(-1);
    if (prev !== undefined && DICTIONARY.test(prev.at(-1)) && DICTIONARY.test(segment[0])) out.push(segment);
    else if (prev === undefined) out.push(segment);
    else out[out.length - 1] += segment;
  }
  return out;
}

export function breakUnits(word) {
  if (!WIDE.test(word) && !EMOJI.test(word)) return DICTIONARY.test(word) ? dictionaryUnits(word) : [word];
  const segs = [...GRAPHEMES.segment(word)].map(({ segment }) => segment);
  const cls = segs.map(lineClass);
  const ea = segs.map((g) => WIDE.test(String.fromCodePoint(g.codePointAt(0))) || EMOJI_WIDE.test(g));
  const out = [];
  let cur = segs[0];
  for (let i = 1; i < segs.length; i++) {
    if (mayBreak(cls, ea, segs, i)) {
      out.push(cur);
      cur = "";
    }
    cur += segs[i];
  }
  out.push(cur);
  return out;
}

// Whitespace the browser breaks at: `\s` less what it never breaks at. U+3000
// stays on the text before it and hangs past the line end, so it stays inside
// its word and is not measured at the end of a line. NBSP, figure space,
// narrow NBSP and the BOM are no-break: French sets "100 km" and "chaque
// semaine !" on them, and splitting there let the engine break a line the
// browser keeps whole, one line short of what is drawn (N786). Measured on
// Chromium 148 against every `\s` character.
const BREAKING_SPACE = /[^\S\u3000\u00a0\u2007\u202f\ufeff]+/;
const HANGING = /\u3000+$/;

/**
 * Greedy line-breaking, matching what the browser does inside the column.
 *
 * `columnPx` is the **content** box — a highlight's horizontal padding has
 * already been taken off it by the caller, because `box-sizing: border-box`
 * plus `max-width: 100%` means the padding eats the wrapping width rather than
 * growing the box. See textInkBox.
 *
 * `balance` is deliberately not a parameter: `text-wrap: balance` redistributes
 * words across the *same* number of lines, so it cannot change the height. It
 * moves `widestPx` slightly, which the scorer's tolerance absorbs.
 */
export function wrapLines(text, {
  measure,
  columnPx,
  fontSizePx: size,
  lineHeight = 1.2,
  letterSpacing = 0,
  textCase = "none",
} = {}) {
  const opts = { measure, fontSizePx: size, letterSpacing, lead: null };
  const limit = Math.max(1, columnPx);
  const lines = [];
  const leads = [];
  const push = (l) => { lines.push(l); leads.push(opts.lead); opts.lead = shapeRuns(l, opts.lead).tail; };

  // Split on real newlines first: the deck stores them and slideHtml renders
  // them as <br/>, so a hand-placed break starts a line unconditionally.
  for (const para of applyCase(text, textCase).split("\n")) {
    const words = para.split(BREAKING_SPACE).filter(Boolean);
    if (words.length === 0) {
      push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      // Only a word's first unit follows a space; the rest join with nothing.
      let sep = line ? " " : "";
      for (let unit of breakUnits(word)) {
        const joined = line + sep + unit;
        sep = "";
        if (runWidthPx(joined.replace(HANGING, ""), opts) <= limit) {
          line = joined;
          continue;
        }
        if (line) push(line);
        // The unit now sits alone on a fresh line; break it while it still
        // doesn't fit. Always consumes at least one character, so this ends.
        while (runWidthPx(unit, opts) > limit && unit.length > 1) {
          const n = breakAt(unit, limit, opts);
          push(unit.slice(0, n));
          unit = unit.slice(n);
        }
        line = unit;
      }
    }
    push(line);
  }

  // An empty block has no line box at all, so it is zero tall — but an empty
  // paragraph *between* two others does produce one, which is why this looks at
  // the whole result rather than filtering empties out of the loop above.
  if (lines.length === 1 && lines[0] === "") {
    return { lines: [], lineCount: 0, heightPx: 0, widestPx: 0, maxContentPx: 0, estimated: !measure };
  }

  let widestPx = 0;
  lines.forEach((l, i) => { widestPx = Math.max(widestPx, runWidthPx(l.replace(HANGING, ""), { ...opts, lead: leads[i] })); });

  // What the block would be if it never wrapped — CSS's max-content. Paragraphs
  // still break, because a newline is a break whatever the width.
  let maxContentPx = 0;
  opts.lead = null;
  for (const para of applyCase(text, textCase).split("\n")) {
    const one = para.split(BREAKING_SPACE).filter(Boolean).join(" ");
    maxContentPx = Math.max(maxContentPx, runWidthPx(one, opts));
    opts.lead = shapeRuns(one, opts.lead).tail;
  }

  return {
    lines,
    lineCount: lines.length,
    // Every line box is exactly `line-height` for single-font inline content —
    // half-leading sits inside it, at the top and the bottom.
    heightPx: lines.length * lineHeight * size,
    widestPx,
    maxContentPx,
    estimated: !measure,
  };
}

const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

// Which way a shrink-wrapped body sits in its column — the same mapping
// slideHtml.js spells as `margin-inline`.
function inkLeft(colX, colW, w, align) {
  if (align === "left") return colX;
  if (align === "right") return colX + colW - w;
  return colX + (colW - w) / 2;
}

/**
 * The box the eye sees, in canvas px — not the column, which is 88% of the
 * canvas wide and mostly empty.
 *
 * That distinction is the whole point. The snapping code learned it the hard
 * way (see `snapBoxOf` in ScreenshotCard.js): guides derived from the column
 * pointed at nothing, because the visible text sits centred inside it. Anything
 * that scores overlap against the column reports every centred headline as
 * covering every centred device, on every slide.
 *
 * `frame: null` is safe — layerBox's text branch never reads it.
 */
export function textInkBox(layer, { W, H, device, measurer }) {
  // A factory, not a function: every text layer carries its own family and
  // weight, and one shared measurer would size a Fraunces subtitle with Inter's
  // advances. Null is a supported answer — wrapLines falls back to the estimator.
  // Asked at the size it will be drawn: an optical-size fallback face (Cyrillic
  // under a Latin-only subset) has em advances that depend on the px size, so a
  // table taken at another size wraps differently from the browser (N782).
  const size = fontSizePx(layer.role, clampNum(layer.sizeMul, 0.1, 6, 1), device);
  const measure = measurer ? measurer({ fontId: layer.fontId, weight: layer.weight, sizePx: size }) : null;
  const col = layerBox(layer, { W, H, frame: null });

  // A highlight pill pads the *border* box, and the global reset is
  // `box-sizing: border-box` with `max-width: 100%` — so the padding comes out
  // of the wrapping width instead of widening the block. At the default 0.35em
  // that is a column ~70% as wide, which is a line or two of difference on a
  // headline. Height, by contrast, gains the padding once and not per line:
  // the body is a block h1/p, so `box-decoration-break: clone` never fires.
  const hl = layer.highlight;
  const padX = hl ? Math.round(size * clampNum(hl.padX, 0, 3, 0)) : 0;
  const padY = hl ? Math.round(size * clampNum(hl.padY, 0, 3, 0)) : 0;

  // Accent braces are markup, never drawn, so they are never measured either.
  const wrapped = wrapLines(captionText(layer), {
    measure,
    columnPx: Math.max(1, col.w - 2 * padX),
    fontSizePx: size,
    lineHeight: clampNum(layer.lineHeight, 0.6, 3, 1.2),
    letterSpacing: clampNum(layer.letterSpacing, -0.3, 1, 0),
    textCase: layer.textCase,
  });

  // The element box, which is `width: fit-content` capped by `max-width: 100%`
  // — i.e. `min(max-content, available)`. It does **not** shrink back to the
  // longest line once the text wraps: a wrapped block is exactly as wide as its
  // column, ragged right edge and all. (Verified against Chromium in
  // test/textParity.test.js, which is where this was originally got wrong.)
  const elementPx = wrapped.lineCount
    ? Math.min(col.w, wrapped.maxContentPx + 2 * padX)
    : 0;

  // What is actually painted, which is the box a layout fault is about. Bare
  // glyphs are `widestPx` wide however wide their element is; a highlight fills
  // its element, so the pill *is* the element box.
  const w = hl ? elementPx : wrapped.widestPx;

  return {
    x: inkLeft(col.x, col.w, w, layer.align),
    y: col.y,
    w,
    h: wrapped.heightPx + 2 * padY,
    elementPx,
    colX: col.x,
    colW: col.w,
    fontSizePx: size,
    lineCount: wrapped.lineCount,
    lines: wrapped.lines,
    widestPx: wrapped.widestPx,
    estimated: wrapped.estimated,
  };
}

// The element the card paints for a caption (`width: fit-content`, `max-width:
// 100%`, `margin-inline` by align): the box a drag snaps by, predicted so it can
// be had for a language the card isn't showing (N184). textParity pins its width
// and height to Chromium's. Empty text has no element, so the column stands in.
export function textSnapBox(layer, opts) {
  const b = textInkBox(layer, opts);
  return b.lineCount
    ? { x: inkLeft(b.colX, b.colW, b.elementPx, layer.align), y: b.y, w: b.elementPx, h: b.h }
    : { x: b.colX, y: b.y, w: b.colW, h: b.fontSizePx };
}
