"use client";

/**
 * A small in-memory (module-singleton, same-tab) gate that lets the SOL entrance overlay
 * (see SolEntranceOverlay.tsx) hold its "wipe away and reveal" step until the destination
 * view's real data — currently just the Recents conversation list (ThreadSidebar) — has
 * actually finished loading, instead of always revealing after a fixed animation duration
 * regardless of whether the page underneath is still showing "Loading…". Deliberately not
 * sessionStorage-based like the launch-origin/handled markers in SolEntranceOverlay.tsx:
 * this needs live callbacks within the same page session, not a value that has to survive
 * a real navigation/reload.
 *
 * (The greeting's name used to be a second tracked task here too — it was fetched
 * client-side from `/api/v1/profile`, which does a full fan-out over every template + a
 * per-template domain-count query just to compute unrelated credit/domain-limit data. That
 * made it slow enough to blow past this gate's own safety timeout, so the name would
 * sometimes still pop in late even with the wait in place. Fixed at the source instead:
 * Greeting now receives the name as a prop straight from the page's own server-side
 * session (see SolChatView/the sol page.tsx files) — no fetch, no wait, no task to track.)
 *
 * `MANDATORY_KEYS` exists specifically to avoid a vacuous-true race: "sidebar" only gets
 * registered once ThreadSidebar's component function actually runs, which doesn't happen
 * until the destination route's client tree mounts — for however long that takes
 * (auth/org/DynamoDB reads on the server, network latency), pendingKeys is genuinely empty
 * but NOT because anything is ready. "content" (registered+resolved by SolChatView itself,
 * the actual page-level component) closes a second, related gap: ThreadSidebar lives in the
 * SOL *layout*, which can mount — and its own fetch resolve — before the *page* has mounted
 * at all, so requiring both keys to have been seen means the layout's chrome AND the page's
 * content both have to exist before the gate can ever consider itself ready, regardless of
 * which one happens to finish first.
 */

type Key = "sidebar" | "content";

const MANDATORY_KEYS: Key[] = ["sidebar", "content"];

let generation = 0;
let pendingKeys = new Set<Key>();
let seenKeys = new Set<Key>();
let waiters: Array<() => void> = [];

/** Called by SolEntranceOverlay itself, once, at the very start of each entrance —
 * resets the gate for a fresh wait cycle so leftover resolved state from a PREVIOUS visit
 * to SOL (ThreadSidebar/SolChatView/Greeting don't remount between conversations, only on
 * a genuinely fresh arrival) doesn't make the next arrival look falsely "already ready". */
export function armSolReadinessGate(): void {
  generation += 1;
  pendingKeys = new Set();
  seenKeys = new Set();
  waiters = [];
}

function isReady(): boolean {
  return MANDATORY_KEYS.every((k) => seenKeys.has(k)) && pendingKeys.size === 0;
}

function checkReady(): void {
  if (!isReady()) return;
  const toNotify = waiters;
  waiters = [];
  toNotify.forEach((fn) => fn());
}

/** Called by a data-owning component (ThreadSidebar, Greeting, SolChatView) as soon as it
 * mounts and knows it has something to fetch (or, for SolChatView's "content", as soon as
 * it mounts at all) — before that work resolves. */
export function registerSolReadinessTask(key: Key): void {
  pendingKeys.add(key);
  seenKeys.add(key);
}

/** Called by that same component once its work settles — success or failure, since a
 * failed fetch shouldn't hang the reveal forever either. */
export function resolveSolReadinessTask(key: Key): void {
  pendingKeys.delete(key);
  checkReady();
}

/** Resolves once every currently-registered task has settled AND every mandatory key has
 * been seen at least once, or after `maxWaitMs` — whichever comes first. The timeout is a
 * safety net for a genuinely broken fetch or a component that never mounts, not the
 * expected path. */
export function waitForSolReadiness(maxWaitMs: number): Promise<void> {
  const gen = generation;
  if (isReady()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters = waiters.filter((fn) => fn !== onReady);
      resolve();
    }, maxWaitMs);
    const onReady = () => {
      if (gen !== generation) return;
      clearTimeout(timer);
      resolve();
    };
    waiters.push(onReady);
  });
}
