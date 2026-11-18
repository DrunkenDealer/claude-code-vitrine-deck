// Putting a deck into a running Vitrine, and getting back a link that opens it.
//
// This is what makes an agent-designed deck a *starting point* rather than a
// verdict. A folder of PNGs is finished work you cannot argue with; a project in
// the editor is something you can drag a headline on. So the CLI pushes rather
// than renders, and hands back a URL.
//
// What the link does depends on the browser that opens it, which is the whole
// design: signed in, the server adopts the pushed project into the account and
// it appears in the grid; signed out, every deck this session pushed is copied
// into the browser's own anonymous projects. Either way only after the link's
// confirm page is submitted. Neither case needs the CLI to hold an account
// credential, which is why there is no `vitrine login`.
//
// Everything here talks to the same public API the editor uses. Nothing is
// special-cased for the CLI except /api/claim, which exists because a session in
// a terminal cannot otherwise reach a browser.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { isStickerKey, stickerIdFromKey } from "./stickers.js";
import { isBackgroundImageKey } from "./visual.js";
import { isAppOwned, mapDeckSources, walkDeckSources } from "./deckSources.js";
import { readSession, saveSession, sessionFile } from "./session.js";

const SID = "vitrine_sid";

// What the server takes for one JSON write (server/writeLimit.js jsonWrites). A
// deck over it was refused at the very end, after the project and every upload
// existed, with only "request entity too large" to say why (N385).
export const JSON_BODY_LIMIT = 1024 * 1024;
const sizeText = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MiB` : `${Math.ceil(n / 1024)} KiB`);
// A deck a few KiB over the limit rounds to the limit's own text ("1.00 MiB …
// at most 1.00 MiB"); the pair then says exact bytes (N429).
const sizePair = (n, limit) => (sizeText(n) === sizeText(limit) ? [`${n} bytes`, `${limit} bytes`] : [sizeText(n), sizeText(limit)]);

// Before any call: the deck as the server will be sent it, give or take the
// remapped upload keys. Names the biggest slide, since that is what to trim.
function checkDeckSize(deck) {
  const size = Buffer.byteLength(JSON.stringify({ baseRev: 0, deck }));
  if (size <= JSON_BODY_LIMIT) return;
  const biggest = (deck.screenshots ?? [])
    .map((s, i) => ({ name: s?.name ?? `slide ${i + 1}`, bytes: Buffer.byteLength(JSON.stringify(s ?? null)) }))
    .sort((a, b) => b.bytes - a.bytes)[0];
  const [have, max] = sizePair(size, JSON_BODY_LIMIT);
  throw new Error(
    `the deck is ${have} as JSON and the server saves at most ${max} — nothing was pushed` +
    (biggest ? ` (largest slide: “${biggest.name}”, ${sizeText(biggest.bytes)}; shorten copy, drop translations or split the deck)` : ""),
  );
}

// Packs whose art is fetched on demand: a layer pointing into one renders as a
// hole until the file is on disk, and only POST /api/sticker guarantees that.
const ON_DEMAND_PACKS = new Set(["icons", "emoji"]);

/** Every source key a deck needs on the server, with the kind to upload it as. */
export function collectDeckSources(deck) {
  const found = new Map();
  walkDeckSources(deck, (key, kind) => {
    if (typeof key !== "string" || !key || isAppOwned(key) || found.has(key)) return;
    found.set(key, kind);
  });
  return found;
}

/**
 * The bundled `backgrounds/…` keys a deck names. They are never uploaded, so
 * collectDeckSources skips them — and with them the "file is missing" checks
 * built on it: a typo, a `../` path or a folder rendered a blank background and
 * pushed a dead key, exit 0. Callers resolve these against the install.
 */
export function collectBundledBackgrounds(deck) {
  const found = new Set();
  walkDeckSources(deck, (key) => {
    if (typeof key === "string" && isBackgroundImageKey(key)) found.add(key);
  });
  return [...found];
}

/**
 * The bundled `examples/…` keys a deck names. App-owned like backgrounds, so
 * collectDeckSources skips them and a typo, a `../` path or a folder pushed a
 * dead key (or, in render, surfaced only mid-run as "screenshot not found").
 */
export function collectBundledExamples(deck) {
  const found = new Set();
  walkDeckSources(deck, (key) => {
    if (typeof key === "string" && key.startsWith("examples/")) found.add(key);
  });
  return [...found];
}

// Fonts and stickers a deck reaches for that the server may not hold yet. Both
// are cache-on-demand and neither touches the network at render time, so a deck
// that arrives before its assets renders in Inter with holes where the art goes.
export function collectDeckAssets(deck) {
  const fonts = new Set();
  const stickers = new Set();
  const font = (id) => { if (typeof id === "string" && id.startsWith("gf:")) fonts.add(id.slice(3)); };

  // An override can swap a sticker as well as a font: a card that shows a
  // different icon on the iPad, or a flag per locale.
  const layer = (l) => {
    if (!l || typeof l !== "object") return;
    font(l.fontId);
    const id = isStickerKey(l.sourceKey) ? stickerIdFromKey(l.sourceKey) : null;
    if (id && ON_DEMAND_PACKS.has(id.split("/")[0])) stickers.add(id);
  };

  font(deck.defaults?.fontId);
  for (const s of deck.screenshots ?? []) {
    for (const l of s.layers ?? []) layer(l);
    for (const byLayer of [...Object.values(s.layersByLocale ?? {}), ...Object.values(s.layersByDevice ?? {})]) {
      for (const patch of Object.values(byLayer ?? {})) layer(patch);
    }
  }
  return { fonts: [...fonts], stickers: [...stickers] };
}

// A cookie jar of exactly one cookie, which is all the identity this API has.
function sessionFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")].filter(Boolean);
  for (const line of raw) {
    const m = /(?:^|;\s*)vitrine_sid=([^;]+)/.exec(line);
    if (m) return `${SID}=${m[1]}`;
  }
  return null;
}

// The server's 429s are all answered before any work is done — the write limit
// (server/writeLimit.js) runs ahead of every handler, and /api/claim checks its
// own limit before minting — so a 429 is safe to repeat for any request. A 503
// is not always the app's: a proxy can answer it for a request that did land,
// so it is repeated only where a second arrival does nothing new: reads, uploads
// (deduped by content hash), font and sticker caching, the deck save (a stale
// baseRev is a 409, never a second write) and a claim (at worst a spare link).
// Creating a project or cutting a version would make a second one.
// Past `giveUpMs` the refusal is a daily cap (server/quota.js), not a busy
// moment, and is said at once rather than retried into the same answer.
//
// `timeoutMs` bounds one request, not the push: a server that accepts the
// connection and never answers used to hold the CLI for undici's ~5 minutes and
// then be reported as "no Vitrine running". A wait for a 429 is not counted.
export const pushRetry = { tries: 6, baseMs: 1000, maxMs: 30_000, giveUpMs: 10 * 60_000, timeoutMs: 60_000 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A number is seconds (fractions allowed); only a non-numeric value is an
// HTTP-date. `1.5` and `-5` used to fall through to Date.parse, which read them
// as a year in the past and answered 0 — a burst of immediate retries (N300).
// Both kinds are floored at one second and capped at a day.
const RETRY_FLOOR_MS = 1000;
const RETRY_CAP_MS = 86_400_000;
export function retryAfterMs(res, attempt) {
  const raw = res.headers.get("retry-after")?.trim();
  const seconds = raw == null || raw === "" ? NaN : /^[+-]?(\d+\.?\d*|\.\d+)$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : pushRetry.baseMs * 2 ** (attempt - 1);
  return Math.min(RETRY_CAP_MS, Math.max(RETRY_FLOOR_MS, ms));
}

// The session cookie is a live credential, so it never goes out in clear text
// to a machine other than this one: http is accepted only for a loopback host
// (localhost, 127.0.0.0/8, ::1). A LAN or remote server must be served over https.
export function insecureServer(server) {
  const { protocol, hostname } = new URL(server);
  if (protocol !== "http:") return null;
  const host = hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
  return loopback ? null : `refusing to send the session cookie over plain http to ${hostname} — use an https:// server (http is only allowed for localhost)`;
}

// Every endpoint push calls answers a small JSON document; a server that streams
// forever used to be buffered by res.text() until the 60 s timeout (N468).
const RESPONSE_LIMIT = 8 * 1024 * 1024;

async function readCapped(res, path) {
  if (!res.body) return res.text();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > RESPONSE_LIMIT) {
      await res.body.cancel().catch(() => {});
      throw Object.assign(new Error(`the server's answer to ${path} is larger than ${RESPONSE_LIMIT / 1024 / 1024} MiB — refusing to read it; check --server`), { kind: "server", tooBig: true });
    }
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

// A 2xx whose JSON is not the shape the endpoint promises (a proxy, a mock, the
// wrong --server) used to reach a destructure or `.map` as a raw TypeError (N498).
const unexpected = (method, path, what) =>
  Object.assign(new Error(`the server answered ${method} ${path} unexpectedly (${what}) — is --server a Vitrine server?`), { kind: "server" });
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// The claim link's expiry, or null when the server's number can't be a deadline:
// NaN, a string, the past, or a year 3000 that would print as 1e25 minutes.
const CLAIM_MAX_MS = 24 * 60 * 60 * 1000;
const sane = (expiresAt) =>
  Number.isFinite(expiresAt) && expiresAt > Date.now() && expiresAt - Date.now() <= CLAIM_MAX_MS ? expiresAt : null;

// `kind` on a thrown error ("network" or "server") is what the CLI maps to exit 3.
class Client {
  constructor(server, cookie = null, onCookie = async () => {}, { onWait = () => {}, sleep = wait } = {}) {
    const insecure = insecureServer(server);
    if (insecure) throw new Error(insecure);
    // An origin, whatever spelling it came in: `//` before a path 404s.
    this.server = new URL(server).origin;
    // A remembered session, if there is one. The server renews it on the first
    // call, so a cookie that is no longer backed by a directory costs an upload
    // and nothing more.
    this.cookie = cookie;
    this.onCookie = onCookie;
    this.onWait = onWait;
    this.sleep = sleep;
  }

  unreachable(err, method, path) {
    if (err?.name === "TimeoutError") {
      const s = Math.round(pushRetry.timeoutMs / 1000);
      return Object.assign(new Error(
        `no answer from ${this.server} in ${s} s (${method} ${path}) — the server is up but not responding; check it, or pass --server`,
        { cause: err },
      ), { kind: "network" });
    }
    if (err instanceof TypeError && err.message === "fetch failed") {
      const code = err.cause?.code ?? err.cause?.errors?.[0]?.code;
      if (code === "ECONNREFUSED") {
        return Object.assign(new Error(`nothing is listening at ${this.server} — start one with \`npm run dev\`, or pass --server`, { cause: err }), { kind: "network" });
      }
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return Object.assign(new Error(`can't resolve ${new URL(this.server).hostname} — check --server`, { cause: err }), { kind: "network" });
      }
      return Object.assign(new Error(`couldn't reach ${this.server} (${code ?? err.cause?.message ?? err.message}) during ${method} ${path}`, { cause: err }), { kind: "network" });
    }
    return Object.assign(err, { kind: "network" });
  }

  // `tolerate` names the statuses a caller expects to handle itself — a project
  // that is no longer there is a normal answer when the id came from a file
  // written days ago, not an error worth a stack trace.
  async call(path, { method = "GET", json, body, headers = {}, tolerate = [], idempotent = method === "GET" } = {}) {
    for (let attempt = 1; ; attempt++) {
      // Fresh per attempt, and covering the body: a server can send headers and
      // then stall.
      const signal = AbortSignal.timeout(pushRetry.timeoutMs);
      let res;
      let text;
      try {
        res = await fetch(`${this.server}${path}`, {
          method,
          redirect: "manual",
          signal,
          headers: {
            ...(this.cookie ? { cookie: this.cookie } : {}),
            ...(json ? { "content-type": "application/json" } : {}),
            ...headers,
          },
          body: json ? JSON.stringify(json) : body,
        });
        const next = sessionFrom(res);
        if (next && next !== this.cookie) {
          // A cookie the file already held wins over a concurrent first push's.
          this.cookie = (await this.onCookie(next)) ?? next;
        }
        text = await readCapped(res, path);
      } catch (err) {
        throw err.tooBig ? err : this.unreachable(err, method, path);
      }
      const busy = res.status === 429 || (res.status === 503 && idempotent);
      const asked = busy ? retryAfterMs(res, attempt) : 0;
      if (busy && attempt < pushRetry.tries && asked <= pushRetry.giveUpMs) {
        const ms = Math.min(pushRetry.maxMs, asked);
        this.onWait({ status: res.status, seconds: Math.ceil(ms / 1000) });
        await this.sleep(ms);
        continue;
      }
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON — the message below carries the text */ }
      if (!res.ok) {
        if (tolerate.includes(res.status)) return null;
        // A refused write says how big it was and what the server takes, not the
        // framework's "request entity too large".
        const tooLarge = res.status === 413 && json && /entity too large/i.test(parsed?.error ?? "");
        const [have, max] = tooLarge ? sizePair(Buffer.byteLength(JSON.stringify(json)), JSON_BODY_LIMIT) : [];
        const reason = tooLarge
          ? `the server refused ${have} as one save — its limit is ${max}`
          : typeof parsed?.error === "string" ? parsed.error : text.slice(0, 200);
        throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${reason}`), { kind: "server", status: res.status });
      }
      // Every endpoint push calls answers JSON. A 2xx that is not (an empty body,
      // a proxy's HTML page, the wrong --server) used to reach `.id` or a
      // destructure as null and surface as a raw TypeError.
      if (parsed == null) {
        throw Object.assign(
          new Error(`the server answered ${method} ${path} with ${res.status} but no JSON body — is --server a Vitrine server?`),
          { kind: "server" },
        );
      }
      return parsed;
    }
  }
}

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/**
 * Create the project, upload into it, save, link.
 *
 * `resolveSource` maps the deck's keys to files on this machine — the same
 * resolver `vitrine render` uses, so a deck that renders locally is a deck that
 * pushes.
 */
export async function pushDeck(deck, { server, name, resolveSource, onStep = () => {}, sleep } = {}) {
  // Every file resolved before the server hears anything: a missing one found
  // half way through the uploads leaves those uploads orphaned on the server.
  checkDeckSize(deck);
  const lostBackground = collectBundledBackgrounds(deck).find((key) => !resolveSource(key));
  if (lostBackground) throw new Error(`bundled background not found: ${lostBackground}`);
  const lostExample = collectBundledExamples(deck).find((key) => !resolveSource(key));
  if (lostExample) throw new Error(`bundled example not found: ${lostExample}`);
  const sources = [...collectDeckSources(deck)].map(([key, kind]) => {
    const path = resolveSource(key);
    if (!path) throw new Error(`not on this machine: ${key}`);
    return { key, kind, path };
  });

  const remembered = await readSession(server);
  if (remembered.problem) onStep("session", { warning: "unread", file: sessionFile(), reason: remembered.problem });
  // The first failed save, if any: said once, and the push says "not-saved".
  let notSaved = null;
  let minted = false;
  const keep = async (entry) => {
    const r = await saveSession(server, entry);
    if (!r.saved && !notSaved) {
      notSaved = r;
      onStep("session", { warning: "unsaved", file: sessionFile(), reason: r.reason });
    }
    return r;
  };
  // Kept the moment the server issues it, not after the push: /api/session
  // re-signs a remembered bare id, and the bare form stops being accepted soon
  // after — so a push that fails past this point (a refused font, a Ctrl-C)
  // would otherwise leave behind a cookie that makes the next push a new owner.
  const client = new Client(
    server,
    remembered.cookie,
    async (cookie) => {
      // Only the first cookie of a push that had none can lose to another's.
      const ifNone = !remembered.cookie && !minted;
      minted = true;
      const r = await keep({ cookie, ifNone });
      return r.saved ? r.cookie : null;
    },
    { onWait: (info) => onStep("wait", info), sleep },
  );

  const session = await client.call("/api/session");
  if (!isObject(session)) throw unexpected("GET", "/api/session", "not a JSON object");
  if (!client.cookie) throw Object.assign(new Error("the server handed out no session cookie"), { kind: "server" });

  // Before the uploads: fonts and stickers are the calls the server can refuse
  // for what the deck names (an unknown family, a sticker id that isn't one),
  // and a refusal after the uploads leaves them behind for nothing. Before the
  // deck too — a font or sticker that arrives late renders as a fallback.
  const { fonts, stickers } = collectDeckAssets(deck);
  for (const family of fonts) {
    onStep("font", { family });
    await client.call("/api/font", { method: "POST", json: { family }, idempotent: true });
  }
  for (const id of stickers) {
    onStep("sticker", { id });
    await client.call("/api/sticker", { method: "POST", json: { id }, idempotent: true });
  }

  // A session pushes into one project, whatever the deck is called: the first
  // push creates it, every later one is the same project a revision on. Pushing
  // is how a deck gets iterated on — half a dozen attempts to find the one that
  // reads right — and a project per attempt (or per name an agent tried) buries
  // the comparison in a grid of near-identical cards, then 409s at the plan's
  // twelfth. A new name renames the project rather than starting another.
  //
  // The id is only a hint: it was written to a file on an earlier run, and the
  // project behind it can have been deleted in the editor since, or swept with
  // the session that held it. A 404 here means "make a new one", not "fail".
  // A file an older version wrote can hold several; the last one written wins.
  const [knownName, known] = Object.entries(remembered.projects).at(-1) ?? [];
  const existing = known
    ? await client.call(`/api/projects/${known}/deck`, { tolerate: [404] })
    : null;
  const projectId = existing
    ? known
    : await createProject(client, name);
  // A project an earlier push made and never saved into holds the server's
  // starter deck (or nothing), not a deck of ours: this push is its first.
  const unsaved = Boolean(existing) && remembered.pending === known;
  // Remembered the moment it exists, not after the save: a save that fails (a
  // 413, a 500, a reset) left no pointer, so every retry made another project
  // until the plan's twelfth 409'd, each also spending the daily new-project
  // quota. A retry now finds this one and takes the reuse path above; if it has
  // gone by then, the 404 there falls back to creating one.
  if (!existing) await keep({ cookie: client.cookie, name, projectId, pending: projectId });
  const renamed = Boolean(existing) && knownName !== name;
  if (renamed) await client.call(`/api/projects/${projectId}`, { method: "PATCH", json: { name }, idempotent: true });
  onStep("project", { projectId, reused: Boolean(existing), renamed, unsaved });

  // One file per request. The batch endpoint takes several, but it sanitizes and
  // de-duplicates names on the way in (`Home.png` becomes `Home-1.png` where one
  // already exists) — so a batched response cannot be matched back to what went
  // in, and a mismatched key silently points a slide at another slide's picture.
  const remap = new Map();
  for (const [i, { key, kind, path }] of sources.entries()) {
    onStep("upload", { key, index: i + 1, total: sources.length });

    const file = basename(path);
    const ext = file.split(".").pop().toLowerCase();
    const form = new FormData();
    // `pid` before the file: the server reads multipart fields in order, and the
    // upload lands in this project's own images, never a pool shared with the
    // owner's other projects. An older server ignores the field.
    form.append("pid", projectId);
    form.append("kind", kind);
    form.append("files", new Blob([await readFile(path)], { type: MIME[ext] ?? "image/png" }), file);

    const answer = await client.call("/api/upload", { method: "POST", body: form, idempotent: true });
    if (!isObject(answer) || !Array.isArray(answer.uploaded)) throw unexpected("POST", "/api/upload", "no `uploaded` list");
    const { uploaded, skipped } = answer;
    if (!uploaded.length) {
      const why = skipped?.[0]?.error;
      throw Object.assign(new Error(`upload rejected: ${key}${typeof why === "string" && why ? ` (${why})` : ""}`), { kind: "server" });
    }
    if (!isObject(uploaded[0]) || typeof uploaded[0].sourceKey !== "string") throw unexpected("POST", "/api/upload", "no sourceKey");
    remap.set(key, uploaded[0].sourceKey);
  }

  // Keep what is about to be overwritten. The editor's own checkpoint only fires
  // after a 30-minute quiet spell (`shouldCheckpoint`), which is exactly wrong
  // for a run of pushes minutes apart — without this, iterating destroys every
  // attempt but the last.
  //
  // Cut as automatic, not named. `named` is the top bucket a prune protects
  // (`server/versions.js` selectKept), and it is reserved for versions a person
  // asked for by name — fifty unattended push snapshots taking that lane would
  // evict the saves and exports someone chose to keep. Automatic is the honest
  // kind for something no one asked for, and it still survives long enough to
  // walk a session's iterations back.
  if (existing?.deck && !unsaved) {
    await client.call(`/api/projects/${projectId}/versions`, {
      method: "POST",
      json: { kind: "auto", label: `before push ${new Date().toLocaleString()}` },
      tolerate: [409],
    });
  }

  // The rev the project is actually at. Posting 0 against a project that has
  // been written before is a conflict, which is what the counter is for — and a
  // new project is not always unwritten: an owner's first opens on the starter
  // deck (server/starter.js), so its rev is read rather than assumed.
  const current = existing ?? (await client.call(`/api/projects/${projectId}/deck`));
  // The editor turns every source it has not seen into a new slide on open, and
  // a project's sources are the examples plus the uploads made into it. A pushed
  // deck is the whole deck, so all of them count as seen.
  const onServer = (await client.call(`/api/sources?pid=${projectId}`))?.sources;
  if (!Array.isArray(onServer)) throw unexpected("GET", "/api/sources", "no `sources` list");
  const mapped = mapDeckSources(deck, (k) => remap.get(k));
  const remapped = {
    ...mapped,
    knownSourceKeys: [...new Set([...(mapped.knownSourceKeys ?? []), ...onServer.map((s) => s?.sourceKey).filter((k) => typeof k === "string")])],
  };
  const saved = await client.call(`/api/projects/${projectId}/deck`, {
    method: "POST",
    json: { baseRev: current?.rev ?? 0, deck: remapped },
    tolerate: [409],
    idempotent: true,
  });
  // A 409 is not always someone else: a save that landed behind a proxy's 503 is
  // retried at the rev it has just moved past. The server stores the deck as
  // sent, so if what is there now is ours, the save is done.
  if (!saved) {
    const now = await client.call(`/api/projects/${projectId}/deck`);
    // A 409's body is the deck that won, which is no message to print.
    if (JSON.stringify(now?.deck) !== JSON.stringify(remapped)) {
      throw Object.assign(new Error("the project was saved from elsewhere while pushing — push again"), { kind: "server", status: 409 });
    }
  }
  onStep("deck", { projectId, slides: remapped.screenshots?.length ?? 0 });

  // Again now the deck is in: this also moves the pointer for a rename.
  await keep({ cookie: client.cookie, name, projectId, pending: null });

  // Whether this push is the owner the last one was: the cookie's id after the
  // server has had its say, against the remembered one. The signature part is
  // ignored — a bare id re-signed by the server is the same owner.
  const sidOf = (c) => c?.slice(SID.length + 1).split(".")[0] ?? null;
  const state = notSaved
    ? "not-saved"
    : remembered.cookie && sidOf(remembered.cookie) === sidOf(client.cookie) ? "resumed" : "new";
  const result = {
    projectId,
    reused: Boolean(existing),
    session: state,
    url: `${client.server}/p/${projectId}`,
    replaced: Boolean(existing?.deck) && !unsaved,
  };

  // A signed-in pusher needs no handover — the browser is already that account.
  if (session.owner?.kind === "user") {
    return { ...result, claimed: false, expiresAt: null };
  }

  const claim = await client.call("/api/claim", { method: "POST", json: { pid: projectId }, idempotent: true });
  const link = isObject(claim) && (typeof claim.url === "string" ? claim.url : typeof claim.path === "string" ? `${client.server}${claim.path}` : null);
  if (!link) throw unexpected("POST", "/api/claim", "no link");
  return { ...result, url: link, claimed: true, expiresAt: sane(claim.expiresAt) };
}

async function createProject(client, name) {
  const made = await client.call("/api/projects", { method: "POST", json: { name } });
  if (typeof made?.id !== "string" || !/^[\w-]{1,64}$/.test(made.id)) throw unexpected("POST", "/api/projects", "no project id");
  return made.id;
}
