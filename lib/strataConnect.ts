// The browser half of "Connect Strata" (editor → Branding). A small popup signs the person in
// to Charisol, then hands their ID token to our server (/api/v1/strata/session), which
// verifies it and stores a Strata session. This file is the shared contract between the three
// pieces — the popup's start page (app/auth/strata/page.tsx), the Charisol callback
// (app/auth/charisol/callback/page.tsx) and the editor-side adapter
// (app/dashboard/apps/_components/strataAdapter.ts) — and has no dependencies, so each piece
// (and the tests) can use it as is.

/** sessionStorage key marking that the Charisol sign-in in THIS window is for connecting Strata,
 *  not for signing in to Plexo. Cognito's redirect_uri is fixed, so the callback page has no
 *  other way to know why it was opened. */
export const STRATA_CONNECT_KEY = "plexo_strata_connect";
/** How long a "connect Strata" marker stays valid — a sign-in takes seconds; this just stops a
 *  forgotten marker from turning a much later normal sign-in into a Strata connection. */
const MARKER_MAX_AGE_MS = 10 * 60 * 1000;

export const STRATA_CONNECTED_MESSAGE = "plexo-strata-connected";
export const STRATA_FAILED_MESSAGE = "plexo-strata-failed";
export type StrataPopupMessage = { type: typeof STRATA_CONNECTED_MESSAGE | typeof STRATA_FAILED_MESSAGE; message?: string };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function markStrataConnect(store: Store, now = Date.now()): void {
  store.setItem(STRATA_CONNECT_KEY, String(now));
}

export function clearStrataConnect(store: Store): void {
  store.removeItem(STRATA_CONNECT_KEY);
}

/** True (once) when this sign-in was started to connect Strata. Always clears the marker. */
export function takeStrataConnect(store: Store, now = Date.now()): boolean {
  const raw = store.getItem(STRATA_CONNECT_KEY);
  store.removeItem(STRATA_CONNECT_KEY);
  const startedAt = Number(raw);
  return !!raw && Number.isFinite(startedAt) && now - startedAt >= 0 && now - startedAt < MARKER_MAX_AGE_MS;
}

/** Only messages our own popup page sends, from our own origin. */
export function readStrataPopupMessage(event: { origin: string; data: unknown }, ownOrigin: string): StrataPopupMessage | null {
  if (event.origin !== ownOrigin) return null;
  const data = event.data as Partial<StrataPopupMessage> | null;
  if (!data || typeof data !== "object") return null;
  if (data.type !== STRATA_CONNECTED_MESSAGE && data.type !== STRATA_FAILED_MESSAGE) return null;
  return { type: data.type, message: typeof data.message === "string" ? data.message : undefined };
}

export const STRATA_POPUP_PATH = "/auth/strata";

/**
 * Runs inside the popup once Charisol has sent the person back: sends their ID token to the
 * server, tells the window that opened the popup how it went, and closes. Never signs them in
 * to Plexo. Returns false when there was no opener to tell (the popup was opened directly), so
 * the caller can send the person somewhere sensible instead.
 */
export async function finishStrataConnect(deps: {
  getIdToken: () => Promise<string | null>;
  fetchFn: typeof fetch;
  opener: { postMessage: (message: StrataPopupMessage, targetOrigin: string) => void } | null;
  origin: string;
  close: () => void;
}): Promise<boolean> {
  let message: StrataPopupMessage;
  try {
    const idToken = await deps.getIdToken();
    if (!idToken) {
      message = { type: STRATA_FAILED_MESSAGE, message: "The Charisol sign-in didn't finish. Please try connecting again." };
    } else {
      const res = await deps.fetchFn("/api/v1/strata/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      message = res.ok ? { type: STRATA_CONNECTED_MESSAGE } : { type: STRATA_FAILED_MESSAGE, message: body?.error ?? "Strata couldn't be connected. Please try again." };
    }
  } catch {
    message = { type: STRATA_FAILED_MESSAGE, message: "That sign-in link expired or was already used. Please try connecting again." };
  }
  if (!deps.opener) return false;
  deps.opener.postMessage(message, deps.origin);
  deps.close();
  return true;
}
