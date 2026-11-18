import { INVISIBLE_SOURCE } from "../web/src/lib/invisibleChars.js";

// A deck (and a server's reply) is untrusted text and the CLI echoes its values
// into messages. JSON.stringify escapes only what JSON requires (NUL..U+001F
// inside strings), not what a terminal acts on: it leaves DEL, the C1 controls
// (U+009B is CSI on some terminals), bidi overrides/isolates, the line/paragraph
// separators and invisible format characters raw, and server error bodies,
// invalid-JSON snippets and upload keys never pass through it at all. So ESC,
// BEL and the other C0 controls (all but \n and \t) are escaped here too.
// Invisible characters hide text from the reader; web/src/lib/invisibleChars.js
// owns the rule (every format character, the Default_Ignorable set, unassigned
// and private-use code points, U+FFFC, U+2800), shared with feedback topics and
// file names so the lists cannot drift (N495). It keeps what is visible in
// context: a ZWJ inside an emoji sequence, a variation selector after an emoji
// base, a ZWNJ between Persian or Indic letters. Cyrillic, CJK and emoji pass.
// Escaping to \uXXXX (UTF-16 units for the astral tag characters) inside a JSON
// string reads back as the same character, so the filter is safe on --json
// output too.
const UNSAFE = new RegExp(String.raw`[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]|${INVISIBLE_SOURCE}`, "gu");

const unit = (c, i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, "0")}`;

export const termSafe = (s) => s.replace(UNSAFE, (c) => Array.from({ length: c.length }, (_, i) => unit(c, i)).join(""));

export function guardStreams(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    const write = stream.write.bind(stream);
    // A Buffer or Uint8Array carries the same bytes a string would, so it is
    // decoded and escaped too (N479). No CLI path writes binary to these two
    // streams: images and ZIPs go to files, so nothing legitimate is altered.
    stream.write = (chunk, ...rest) =>
      write(typeof chunk === "string" ? termSafe(chunk) : chunk instanceof Uint8Array ? termSafe(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("utf8")) : chunk, ...rest);
  }
}
