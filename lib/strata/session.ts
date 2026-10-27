import { StrataSession } from "@/lib/db/coreEntities";
import { decryptStrataToken, encryptStrataToken } from "@/lib/crypto";

// A person's Strata session: a Strata-issued JWT that lasts 24 hours. It's stored encrypted
// (lib/crypto.ts), read only on the server and never returned to the browser — the browser
// only ever learns whether it is connected, expired, and as whom. A token is treated as
// expired an hour early so a request never starts with one about to run out.

export const STRATA_SESSION_MAX_AGE_MS = 23 * 60 * 60 * 1000;

export type StrataConnection = {
  connected: boolean;
  /** Connected once, but the session ran out — one click to reconnect. */
  expired: boolean;
  user?: { email?: string; name?: string };
};

export async function saveStrataSession(userId: string, session: { token: string; email?: string; name?: string }): Promise<void> {
  await StrataSession.upsert({
    userId,
    ciphertext: encryptStrataToken(session.token),
    strataEmail: session.email,
    strataName: session.name,
    connectedAt: new Date().toISOString(),
  }).go();
}

export async function deleteStrataSession(userId: string): Promise<void> {
  await StrataSession.delete({ userId }).go();
}

/** The connection's state, with no secrets in it — safe to hand to the browser. */
export async function getStrataConnection(userId: string, now = Date.now()): Promise<StrataConnection> {
  const { data } = await StrataSession.get({ userId }).go();
  if (!data) return { connected: false, expired: false };
  const user = { email: data.strataEmail, name: data.strataName };
  const fresh = now - new Date(data.connectedAt).getTime() < STRATA_SESSION_MAX_AGE_MS;
  return fresh ? { connected: true, expired: false, user } : { connected: false, expired: true, user };
}

/** The token to call Strata with, or null when there's none, it's too old, or it can't be decrypted. */
export async function loadStrataToken(userId: string, now = Date.now()): Promise<string | null> {
  const { data } = await StrataSession.get({ userId }).go();
  if (!data) return null;
  if (now - new Date(data.connectedAt).getTime() >= STRATA_SESSION_MAX_AGE_MS) return null;
  try {
    return decryptStrataToken(data.ciphertext);
  } catch {
    // A rotated encryption key reads like an expired session: the person just reconnects.
    return null;
  }
}
