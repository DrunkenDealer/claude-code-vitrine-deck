import { INVISIBLE_SOURCE } from "../web/src/lib/invisibleChars.js";

// Leaves room under the usual 255-byte filesystem limit for uniqueName's "-N".
const MAX_NAME_BYTES = 200;

const bytes = (s) => new TextEncoder().encode(s).length;

function truncateBytes(s, max) {
  let out = "";
  for (const ch of s) {
    if (bytes(out + ch) > max) break;
    out += ch;
  }
  return out;
}

// Characters that draw nothing or reorder what is drawn, so a name carrying them
// reads as another name in a listing (N496): controls, lone surrogates,
// noncharacters (APFS refuses U+FFFE and friends: EILSEQ) and the invisible
// characters web/src/lib/invisibleChars.js defines (bidi marks and overrides,
// zero-width, fillers, tags, ...), which keep the joiners and variation
// selectors that make an emoji or Persian word what it is (👨‍👩‍👧, ❤️). A batch
// config refuses a name with one; render and upload file names drop them.
const HIDDEN_SOURCE = String.raw`[\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}]|${INVISIBLE_SOURCE}`;
export const HIDDEN_NAME_CHARS = new RegExp(HIDDEN_SOURCE, "u");
const STRIP_HIDDEN = new RegExp(HIDDEN_SOURCE, "gu");

// Text made fit to sit in one path segment, in NFC. Letters and digits in any
// script survive; what goes is anything that could leave the directory or
// misbehave in a path: separators and Windows-reserved characters (each becomes
// `sub`), and the hidden characters above (an RLO can make "gnp.exe" read as
// "exe.png").
export const cleanNameText = (name, sub = "_") =>
  String(name)
    .normalize("NFC")
    .replace(STRIP_HIDDEN, "")
    .replace(/[<>:"/\\|?*]/g, sub)
    .replace(/\s+/gu, " ");

// An uploaded file's name as stored on disk: cleanNameText, less leading dots.
export function safeFileName(name) {
  const s = cleanNameText(name);
  const dot = s.lastIndexOf(".");
  const hasExt = dot >= 0 && /^\.[\p{L}\p{N}]{1,10}$/u.test(s.slice(dot));
  const ext = hasExt ? s.slice(dot) : "";
  const base = truncateBytes(
    (hasExt ? s.slice(0, dot) : s).replace(/^[.\s]+/, ""),
    MAX_NAME_BYTES - bytes(ext),
  ).replace(/[.\s]+$/, "");
  return (base || "image") + ext;
}

// One URL path segment. Stricter than encodeURIComponent, which leaves
// ' ( ) unescaped — and an editor preview drops the URL into an unquoted CSS url().
export const encodePathSegment = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
