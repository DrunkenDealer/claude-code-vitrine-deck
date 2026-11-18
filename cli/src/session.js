// What the CLI remembers between pushes.
//
// Without this, every `vitrine push` was a new person. The client held its
// cookie in an instance field, so each run started at `/api/session` with no
// cookie, the server minted a fresh anonymous owner, and the same screenshots
// went up again under a new id. Iterating on a deck — which is the whole point
// of pushing rather than rendering — cost one owner directory and one full
// re-upload per attempt, and left the user holding N unrelated links to N
// one-project grids instead of a set they could compare.
//
// So two things are kept, per server:
//
//   **The session cookie**, which makes every push the same owner. The server
//   dedupes uploads by content hash within an owner, so the second push of a
//   deck sends the images and gets back the copies it already has.
//
//   **The one project this session pushes into.** One per session, not one per
//   deck name: a push is how an agent iterates on *the* deck, and a name it
//   varies between runs used to mint a project each time — a grid of
//   near-duplicates, then a 409 at the plan's twelfth. Pushing under a new name
//   renames that project instead. Kept as a one-entry `{ name: id }` map so a
//   file an older version wrote still reads.
//
// The file holds a live credential, so it is written 0600 into the user's config
// directory and never into the repo. Everything here degrades to "no memory"
// rather than failing: a read-only home, a machine with no HOME, a file another
// version wrote — all of them mean this push behaves like the old ones did.
// But the degradation is said out loud: a read reports `problem`, a save returns
// `{ saved, reason }`, and the CLI warns on stderr. Silently minting a new owner
// and project on every run looked exactly like a working push.
import { randomBytes, randomUUID } from "node:crypto";
import { rmSync, rmdirSync, unlinkSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

// Every input the path is built from must be absolute as given. An empty HOME or
// a relative XDG_CONFIG_HOME / VITRINE_SESSION_FILE resolved against the cwd, so
// a push dropped a live cookie into whatever directory (often a repo) it was run
// from (N304). Checked on the raw values: `resolve(homedir(), ".config")` is
// absolute whatever homedir() was, which hid an empty or relative HOME.
const FILE = () => {
  const refuse = (variable, value) => {
    throw new Error(`${variable} must be an absolute path (got "${value}") — the session file is not written under the current directory`);
  };
  const { VITRINE_SESSION_FILE: file, XDG_CONFIG_HOME: xdg } = process.env;
  if (file) return isAbsolute(file) ? file : refuse("VITRINE_SESSION_FILE", file);
  if (xdg) return isAbsolute(xdg) ? resolve(xdg, "vitrine", "sessions.json") : refuse("XDG_CONFIG_HOME", xdg);
  const home = homedir();
  return isAbsolute(home) ? resolve(home, ".config", "vitrine", "sessions.json") : refuse("HOME", home);
};

// The key is the origin the cookie belongs to. `push --server` can name a local
// dev server and a deployed one in the same day, and a session from one is
// meaningless to the other.
// Spellings of one origin (LOCALHOST, a default port, a trailing `//`) share a
// key: they used to be a new owner each. Anything that isn't a URL keeps the old
// trailing-slash strip, so a hand-written key still reads.
export const serverKey = (server) => {
  const text = String(server ?? "");
  try {
    const { origin } = new URL(text);
    if (origin !== "null") return origin;
  } catch { /* not a URL */ }
  return text.replace(/\/+$/, "");
};

// Signed (`<id>.<sig>`) since the bare id stopped being proof of anything; the
// bare form is still read so a file from before migrates on the next push.
const SID_RE = /^vitrine_sid=[0-9a-f]{32}(?:\.[\w-]{43})?$/;
const PROJECT_RE = /^p_[0-9a-f]{24}$/;

// Read back only what we would have written. A hand-edited file, a truncated
// write, or a shape from a future version must not put a malformed cookie on a
// request or point a push at a project id that was never one.
function clean(raw) {
  const out = {};
  for (const [key, entry] of Object.entries(raw?.servers ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const projects = {};
    // Defined, not assigned: `projects["__proto__"] = pid` sets the prototype
    // and drops the entry, so a push named `__proto__` never found its project
    // and made a new one every run (N357).
    for (const [name, pid] of Object.entries(entry.projects ?? {})) {
      if (PROJECT_RE.test(pid)) Object.defineProperty(projects, name, { value: pid, enumerable: true, writable: true, configurable: true });
    }
    Object.defineProperty(out, key, {
      value: {
        cookie: SID_RE.test(entry.cookie) ? entry.cookie : null,
        projects,
        // The project whose deck no push has saved yet, if it is one of `projects`.
        ...(Object.values(projects).includes(entry.pending) && { pending: entry.pending }),
      },
      enumerable: true, writable: true, configurable: true,
    });
  }
  return out;
}

// What the file holds, and why not if it can't be read. A missing file is the
// normal first run and no problem; anything else (a directory, no permission, a
// truncated write) is treated as empty — the next write replaces it — but named.
// `malformed` keeps which servers' cookies were dropped by `clean`.
async function readState() {
  let raw;
  try {
    raw = await readFile(FILE(), "utf8");
  } catch (err) {
    return { servers: {}, malformed: new Set(), ...(err.code === "ENOENT" ? {} : { problem: err.code ?? err.message }) };
  }
  if (!raw) return { servers: {}, malformed: new Set() };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { servers: {}, malformed: new Set(), problem: "not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { servers: {}, malformed: new Set(), problem: "not valid JSON" };
  }
  const malformed = new Set(
    Object.entries(parsed.servers ?? {})
      .filter(([, e]) => e && typeof e === "object" && e.cookie != null && !SID_RE.test(e.cookie))
      .map(([key]) => key),
  );
  return { servers: clean(parsed), malformed };
}

export async function readSessions() {
  return (await readState()).servers;
}

/**
 * The remembered session for one server: `{ cookie, projects }`, both possibly
 * empty — plus `problem` (why the file or this server's cookie was dropped) only
 * when there is one.
 */
export async function readSession(server) {
  const key = serverKey(server);
  const { servers, malformed, problem } = await readState();
  const why = problem ?? (malformed.has(key) ? "malformed cookie" : null);
  return { ...(servers[key] ?? { cookie: null, projects: {} }), ...(why ? { problem: why } : {}) };
}

// Every change is a read-modify-write of the whole file, because a push touches
// one server's entry and must not drop another's. Two pushes to different
// servers run at once, and since the cookie is saved before the push can fail,
// they collide often enough to lose a session. So the cycle runs under a lock
// file, and the new contents land by rename so a reader never sees half of them.
const LOCK_STALE_MS = 10_000;

const sleep = () => new Promise((r) => setTimeout(r, 5 + Math.random() * 20));
// Either way: a lock dated in the future (a clock set back, a skewed network
// volume) would otherwise never age, and every push would wait on it forever.
const isStale = (s) => Math.abs(Date.now() - s.mtimeMs) > LOCK_STALE_MS;
const quietly = (p) => p.then(() => true, () => false);

// A push killed mid-save leaves its lock behind; nothing holds one for long, so
// a waiter clears one gone stale. Two waiters that both judged it stale must not
// both remove it — the second would remove the fresh lock a third had just taken
// — and no check-then-remove, under a steal lock or not, rules that out: the
// steal lock gets left stale in turn. So the removal itself names what it judged.
//
// The lock is a directory holding one file named by its holder's unique token,
// dated when taken. It is taken by renaming a ready-made directory into place,
// which fails while a holder's file is in it. Clearing a stale holder unlinks
// that holder's own file, which can never remove anyone else's, and then the
// directory, which only goes once empty. However many waiters clear at once,
// none of them can remove a lock taken since. A plain-file lock is one an older
// version left; a lock directory can't be unlinked, so removing it is safe too.
//
// Age alone made a SIGKILLed holder's fresh lock something every save waited
// 10 s on in silence. The token now names its holder's {pid, host}, so a holder
// that no longer exists on this host is visible at once; age stays the rule for
// anything the pid can't settle (no pid, another host's, a pid since reused).
async function holderGone(file) {
  let who;
  try {
    who = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return false;
  }
  if (!Number.isInteger(who?.pid) || who.host !== hostname()) return false;
  try {
    process.kill(who.pid, 0);
    return false;
  } catch (err) {
    return err.code !== "EPERM";
  }
}

async function clearStale(lock) {
  const s = await lstat(lock).catch(() => null);
  if (!s) return;
  if (!s.isDirectory()) {
    if (isStale(s)) await quietly(unlink(lock));
    return;
  }
  for (const holder of await readdir(lock).catch(() => [])) {
    const held = await stat(resolve(lock, holder)).catch(() => null);
    if (held && (isStale(held) || (await holderGone(resolve(lock, holder))))) await quietly(unlink(resolve(lock, holder)));
  }
  // Empty only once released or cleared, and a killed release can leave it so.
  await quietly(rmdir(lock));
}

// A lock directory is as old as its holder's file, or its own date when empty.
async function isStaleLock(file) {
  const s = await lstat(file).catch(() => null);
  if (!s?.isDirectory()) return !!s && isStale(s);
  const [holder] = await readdir(file).catch(() => []);
  const held = holder ? await stat(resolve(file, holder)).catch(() => null) : s;
  return !!held && (isStale(held) || (!!holder && (await holderGone(resolve(file, holder)))));
}

// Renaming onto a lock that has a holder fails with one of these, depending on
// the platform; onto an empty one it replaces it, as it should.
const HELD = new Set(["EEXIST", "ENOTEMPTY", "ENOTDIR", "EPERM"]);
// A waiter paused past the stale age (SIGSTOP, a sleeping laptop) has its
// ready-made lock swept as a killed waiter's, so a missing one means make it
// again and keep waiting. The rename can even land a lock the sweep had emptied,
// which holds nothing, so it is ours only once our token file is in it — and
// dating that file then also keeps it from looking stale after the pause.
const tryLock = (mine, lock, token) =>
  rename(mine, lock).then(
    () => quietly(utimes(resolve(lock, token), new Date(), new Date())),
    (err) => (HELD.has(err.code) || err.code === "ENOENT" ? false : Promise.reject(err)),
  );

// SIGINT, SIGTERM and SIGHUP run no cleanup, so a push stopped inside a save
// left its lock for the next one to wait out. While a lock is held or awaited
// (milliseconds per push) a handler releases it, then lets the signal kill the
// process as it would have: the exit status is the caller's to see.
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const releases = new Set();
function onSignal(signal) {
  for (const release of releases) {
    try {
      release();
    } catch { /* best effort: the process is dying */ }
  }
  releases.clear();
  for (const s of SIGNALS) process.off(s, onSignal);
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}
function track(release) {
  releases.add(release);
  if (releases.size === 1) for (const s of SIGNALS) process.on(s, onSignal);
}
function untrack(release) {
  releases.delete(release);
  if (!releases.size) for (const s of SIGNALS) process.off(s, onSignal);
}

// Whose lock a waiter is waiting on, for the one line it says after a second.
async function holderPid(lock) {
  const [holder] = await readdir(lock).catch(() => []);
  if (!holder) return null;
  try {
    return JSON.parse(await readFile(resolve(lock, holder), "utf8")).pid ?? null;
  } catch {
    return null;
  }
}

const NOTICE_AFTER_MS = 1_000;

// Exported for the signal test.
export async function withLock(path, fn) {
  const lock = `${path}.lock`;
  const token = randomUUID();
  const mine = `${lock}.${token}`;
  const ready = async () => {
    await mkdir(mine, { recursive: true });
    await writeFile(resolve(mine, token), JSON.stringify({ pid: process.pid, host: hostname() }));
  };
  // Our own ready-made dir, and our own token in the lock once it is taken —
  // never the lock dir wholesale, which may hold a successor's token after a
  // stale clear. Whichever of the two we are in, the other is already gone.
  const release = () => {
    rmSync(mine, { recursive: true, force: true });
    try {
      unlinkSync(resolve(lock, token));
      rmdirSync(lock);
    } catch { /* not ours, already gone, or not empty */ }
  };
  track(release);
  const since = Date.now();
  let told = false;
  try {
    await ready();
    while (!(await tryLock(mine, lock, token))) {
      if (!told && Date.now() - since >= NOTICE_AFTER_MS) {
        told = true;
        const pid = await holderPid(lock);
        process.stderr.write(`waiting for the session lock ${lock}${pid ? ` (held by pid ${pid})` : ""}\n`);
      }
      await clearStale(lock);
      await sleep();
      // Dated afresh at every attempt, so a long wait doesn't take a lock that
      // already looks stale.
      await utimes(resolve(mine, token), new Date(), new Date()).catch((err) =>
        err.code === "ENOENT" ? ready() : Promise.reject(err),
      );
    }
  } catch (err) {
    await rm(mine, { recursive: true, force: true });
    untrack(release);
    throw err;
  }
  try {
    return await fn();
  } finally {
    await quietly(unlink(resolve(lock, token)));
    await quietly(rmdir(lock));
    untrack(release);
  }
}

async function update(change) {
  let saved;
  try {
    const path = FILE();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await withLock(path, async () => {
      // Only the lock holder writes a temp file, so any other one here is from a
      // save that was killed before its rename — and it holds a live cookie.
      const leftover = new RegExp(`^${RegExp.escape(basename(path))}\\.\\d+(?:\\.[0-9a-f]{12})?\\.tmp$`);
      // A lock a waiter killed before taking it had ready, and the steal lock an
      // older version cleared stale locks under. A live waiter keeps its own
      // fresh, so only stale ones go.
      const stray = new RegExp(`^${RegExp.escape(basename(path))}\\.lock\\.(?:[0-9a-f-]{36}|steal)$`);
      for (const f of await readdir(dirname(path))) {
        const file = resolve(dirname(path), f);
        if (leftover.test(f) || (stray.test(f) && (await isStaleLock(file)))) await rm(file, { recursive: true, force: true });
      }
      const servers = change(await readSessions());
      saved = servers;
      // "wx" and a random suffix: a predictable name opened with "w" follows a
      // symlink planted there after the sweep above and writes the cookie into
      // its target (N494, as N471 for deck files).
      const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      // A failed write or rename must not leave the temp file behind: it holds
      // a live cookie, and nothing sweeps it until the next successful save.
      try {
        await writeFile(tmp, JSON.stringify({ v: 1, servers }, null, 2), { mode: 0o600, flag: "wx" });
        await rename(tmp, path);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    });
    return { saved: true, servers: saved };
  } catch (err) {
    // No home, a read-only volume, a sandboxed CI runner. The push works; it
    // just won't be remembered — and the caller says so.
    return { saved: false, reason: err.code ?? err.message };
  }
}

// `ifNone`: a first cookie, minted by a push that found none. Two first pushes
// at once each mint an owner and the last writer used to win, leaving the other
// pushing into an owner nothing remembered (N302). Under the lock the first one
// in stays, and the result's `cookie` is the one every push should carry on
// with; the loser's owner is provisional (no first write yet), so costs nothing.
//
// `pending` is the project a push created and has not yet saved a deck into: a
// failed first push leaves one behind, and the retry would otherwise read the
// starter deck in it as a deck of ours to replace (N384). A project id sets it,
// null clears it, left out keeps it.
export async function saveSession(server, { cookie, name, projectId, pending, ifNone = false }) {
  const key = serverKey(server);
  if (!key) return { saved: false, reason: "no server" };
  const r = await update((all) => {
    // Own property only: `all["__proto__"]` is Object.prototype, which has no
    // projects (N428).
    const prev = Object.hasOwn(all, key) ? all[key] : { cookie: null, projects: {} };
    const next = {
      cookie: SID_RE.test(cookie) && !(ifNone && prev.cookie) ? cookie : prev.cookie,
      projects: name && PROJECT_RE.test(projectId) ? { [name]: projectId } : prev.projects,
    };
    const open = pending === undefined ? prev.pending : pending;
    if (Object.values(next.projects).includes(open)) next.pending = open;
    return { ...all, [key]: next };
  });
  return r.saved ? { saved: true, cookie: r.servers[key]?.cookie ?? null } : r;
}

/** Forget one server's session, or all of them. */
export async function clearSession(server = null) {
  return update((all) => {
    if (server) delete all[serverKey(server)];
    return server ? all : {};
  });
}

// Said in warnings and by `vitrine session`, which must not throw over a bad config dir.
export const sessionFile = () => {
  try {
    return FILE();
  } catch (err) {
    return `(no session file: ${err.message})`;
  }
};
