// A short, bounded memory of things that just failed, so a client hammering a
// broken upstream (a missing sticker, a Google Fonts outage) costs one outbound
// request per window instead of one per hit. In-memory on purpose: a restart
// forgives everything, and the window is short enough that nothing needs to
// outlive it. Insertion-ordered, so the oldest entry is the one evicted at the cap.
export const FAILURE_TTL_MS = 5 * 60 * 1000;

export function createFailureCache({ ttlMs = FAILURE_TTL_MS, max = 500 } = {}) {
  const held = new Map();
  return {
    get(key) {
      const hit = held.get(key);
      if (!hit) return undefined;
      if (hit.until <= Date.now()) {
        held.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      held.delete(key);
      if (held.size >= max) held.delete(held.keys().next().value);
      held.set(key, { value, until: Date.now() + ttlMs });
    },
    clear: () => held.clear(),
    get size() {
      return held.size;
    },
  };
}
