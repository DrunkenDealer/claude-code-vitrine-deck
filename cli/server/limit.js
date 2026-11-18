// A concurrency gate: `limit(fn, key)` runs `fn` when a slot is free and queues
// it otherwise, resolving or rejecting with whatever `fn` does.
//
// Lifted out of server/index.js, where it capped Chromium contexts, because the
// sticker route needs the same thing for a different reason: browsing the emoji
// pack asks for ~60 uncached files at once, and each miss is a download from
// GitHub. Unbounded, that is 60 sockets to one host on a mouse click.
//
// It wraps one task and propagates rejection, which is what `ensureSticker` and
// `ensureFamily` need — web/src/api.js's pLimit maps an array and swallows
// errors into `{ ok: false }`, a different shape for a different job (and
// browser-only besides).
//
// **The queue is per key, served round-robin.** One FIFO was fine while every
// caller was the same visitor's browser, but a deck is rendered a cell at a
// time: a Safari user exporting thirty cells (WebKit can't rasterize locally, so
// it falls back to the server) would hold a single queue for the length of the
// whole export, and everyone else waited behind all thirty. Rotating between
// keys means a second visitor waits one render, not someone else's deck. Callers
// with nothing to separate — the font and sticker fetches — pass no key and
// share one queue, exactly as before.
//
// **`maxQueue` bounds the waiting line.** Past it a call is rejected at once with
// a LimiterFullError instead of joining: an unbounded queue is unbounded memory
// (every entry holds a request body) and an unbounded wait for whoever is last.
// `maxQueuePerKey` bounds one key's share of it, so one caller can't fill it.
//
// **A call can leave.** `limit(fn, key, { signal })` withdraws a call that is
// still queued when the signal aborts: it rejects with the signal's reason, and
// its place in the line, its key's share and its turn are gone at once. Without
// that, a client that hung up (the editor cancelling a re-render, a proxy cutting
// a long request) kept its six places until each abandoned cell had been rendered
// in turn, and its resubmit was told the server was busy. A call already running
// is left to `fn`, which has to watch the signal itself; the slot frees only when
// `fn` settles, so `n` and `perKey` never undercount what is really running.
export class LimiterFullError extends Error {
  constructor() {
    super("too many requests are waiting");
    this.name = "LimiterFullError";
  }
}

export function createLimiter(n, { perKey = Infinity, maxQueue = Infinity, maxQueuePerKey = Infinity } = {}) {
  let active = 0;
  let waiting = 0;
  const queues = new Map();
  const inFlight = new Map();
  // Whose turn it was last, by key rather than by index: a queue that drains
  // disappears from the map, and an index into the old key list would then skip
  // whoever moved into its place.
  let lastKey = null;

  const countOf = (key) => inFlight.get(key) ?? 0;

  function pick() {
    const keys = [...queues.keys()];
    if (!keys.length) return null;
    const start = lastKey === null ? 0 : keys.indexOf(lastKey) + 1;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[(start + i) % keys.length];
      // Everyone still waiting may already be at their own cap, in which case
      // there is nothing to start until something finishes.
      if (countOf(key) < perKey) return key;
    }
    return null;
  }

  function pump() {
    while (active < n) {
      const key = pick();
      if (key === null) return;
      const queue = queues.get(key);
      const run = queue.shift();
      waiting--;
      if (!queue.length) queues.delete(key);
      lastKey = key;
      active++;
      inFlight.set(key, countOf(key) + 1);
      run();
    }
  }

  return (fn, key = "", { signal } = {}) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      if (waiting >= maxQueue || (queues.get(key)?.length ?? 0) >= maxQueuePerKey) return reject(new LimiterFullError());
      const onAbort = () => {
        const queue = queues.get(key);
        const at = queue ? queue.indexOf(run) : -1;
        if (at === -1) return;
        queue.splice(at, 1);
        waiting--;
        if (!queue.length) queues.delete(key);
        reject(signal.reason);
      };
      const run = () => {
        signal?.removeEventListener("abort", onAbort);
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            const left = countOf(key) - 1;
            if (left > 0) inFlight.set(key, left);
            else inFlight.delete(key);
            pump();
          });
      };
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push(run);
      waiting++;
      signal?.addEventListener("abort", onAbort, { once: true });
      pump();
    });
}
