// Values JSON can carry that throw the moment an engine coerces them (N517).
//
// `{"toString": 1}` parses to an object whose toString isn't callable, so every
// `Number(v)`, `String(v)` and `regex.test(v)` the normalisers run over a render
// body or a deck file throws "Cannot convert object to primitive value" — a 500
// from /api/render, a stack from the CLI. Patching each field would miss the next
// one, so both hosts refuse these once, up front, with the path that holds one.
// A NUL in a string is the same class: fs calls on a source key holding one throw
// ERR_INVALID_ARG_VALUE. Node-API-free like css.js.

// Own `toString` / `valueOf` keys are the only way a parsed object makes
// coercion throw (JSON has no symbols and no functions).
const POISON = ["toString", "valueOf"];

/** [[path, why], ...] for every value in `value` the engine cannot coerce.
 *  `nul: false` skips the NUL check: a pasted NUL in caption text doesn't crash the editor
 *  and /api/render refuses it at export, so a deck save must not be refused for it (N522). */
export function uncoercible(value, root = "body", { nul = true } = {}) {
  const found = [];
  // Iterative: a body nested thousands deep must not overflow the stack here.
  const todo = [[value, root]];
  while (todo.length) {
    const [v, path] = todo.pop();
    if (typeof v === "string") {
      if (nul && v.includes("\0")) found.push([path || "deck", "contains a NUL character"]);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => todo.push([item, `${path}[${i}]`]));
    } else if (v && typeof v === "object") {
      if (POISON.some((k) => Object.hasOwn(v, k))) found.push([path || "deck", "has a toString or valueOf key, which no field accepts"]);
      for (const [k, item] of Object.entries(v)) todo.push([item, path ? `${path}.${k}` : k]);
    }
  }
  return found.reverse();
}

/** A copy without those keys: what is left coerces to NaN or "[object Object]", which every normaliser already repairs. */
export const withoutPoison = (value) => JSON.parse(JSON.stringify(value, (k, v) => (POISON.includes(k) ? undefined : v)));
