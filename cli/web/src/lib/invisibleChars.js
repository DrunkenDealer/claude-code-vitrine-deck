// Which characters draw nothing (or stand for hidden content), shared by the
// feedback topic (web/src/lib/feedback.js), the CLI's terminal filter
// (src/termSafe.js) and its file/batch names (src/fileName.js). Each kept its
// own hand list and they drifted: one round a name like "❤️ hero" was refused,
// the next a lone ZWJ printed raw (N486, N495, N496). One rule now.
//
// Hidden: every format character (\p{Cf}: bidi marks and overrides, zero-width,
// word joiner, invisible operators, tag characters, BOM, soft hyphen) plus the
// Unicode list of characters that render as nothing (Default_Ignorable: Khmer
// inherent vowels, Mongolian selectors, Hangul fillers, CGJ, variation
// selectors), unassigned and private-use code points, U+FFFC (object
// replacement) and the blank letters U+2800 (braille blank) and U+3164.
//
// Four things are visible in context and stay:
//  - a ZWJ that glues two pictographs into one emoji (👨‍👩‍👧, ❤️‍🔥), also after a
//    skin-tone modifier (Emoji_Modifier, not Extended_Pictographic: 👩🏽‍💻, N486);
//  - a variation selector directly after a pictograph, digit, # or *, or a Han
//    character, the things it modifies (❤️, 1️⃣);
//  - a ZWNJ/ZWJ between two letters or marks of a script that needs it (Persian
//    "می‌خواهم", Devanagari conjuncts). Latin, Cyrillic and Greek do not, so
//    "a‍b" is a hidden joiner like any other;
//  - the tag characters of an emoji tag sequence, the subdivision flags
//    (🏴󠁧󠁢󠁥󠁮󠁧󠁿 England, Scotland, Wales): U+1F3F4, 1-7 lowercase-letter/digit tags,
//    CANCEL TAG U+E007F (UTS #51). Tag characters anywhere else are the "ASCII
//    smuggling" vector (invisible text an LLM or a log still reads), so a run
//    after another base, an unterminated or over-long one, or one after a
//    complete sequence stays hidden (N506).
const NON_LATIN_LETTER = String.raw`(?![\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}])[\p{L}\p{M}]`;
const TAG = String.raw`[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]`;
// Position k of the run (k tags before it) fixes how many may follow, so the
// whole spec stays within 7 tags.
const FLAG_TAG = Array.from({ length: 7 }, (_, k) => String.raw`(?<=\u{1F3F4}${TAG}{${k}})${TAG}(?=${TAG}{0,${6 - k}}\u{E007F})`).join("|");
const KEPT = [
  String.raw`(?<=[\p{Extended_Pictographic}\p{Emoji_Modifier}]️?)‍(?=\p{Extended_Pictographic})`,
  String.raw`(?<=${NON_LATIN_LETTER})[‌‍](?=${NON_LATIN_LETTER})`,
  String.raw`(?<=[\p{Extended_Pictographic}\p{Script=Han}0-9#*])[︀-️\u{E0100}-\u{E01EF}]`,
  FLAG_TAG,
  String.raw`(?<=\u{1F3F4}${TAG}{1,7})\u{E007F}`,
].join("|");

// One character per match, so a caller can escape or strip hits in place.
export const INVISIBLE_SOURCE = String.raw`(?!${KEPT})[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cn}\p{Co}￼⠀ㅤ]`;

const ANY = new RegExp(INVISIBLE_SOURCE, "u");
export const hasInvisible = (s) => ANY.test(s);
