import { CharisolLink } from "@/lib/db/coreEntities";
import { decryptStrataToken, encryptStrataToken } from "@/lib/crypto";

// One Charisol sign-in, many Charisol products. When someone signs in to Plexo through Charisol we keep their Charisol
// refresh token here, encrypted and server-side only, so connecting another Charisol product (Strata) can ask Charisol for a
// fresh ID token as them — no second login, even long after Charisol's own browser session (about an hour) has ended. A person who
// never signed in through Charisol simply has none, and the caller falls back to a sign-in window.

// Charisol's refresh tokens last 30 days; stop trusting ours a day early.
const MAX_AGE_MS = 29 * 24 * 60 * 60 * 1000;

export async function saveCharisolRefresh(userId: string, refreshToken: string): Promise<void> {
  await CharisolLink.upsert({ userId, ciphertext: encryptStrataToken(refreshToken), storedAt: new Date().toISOString() }).go();
}

export async function deleteCharisolRefresh(userId: string): Promise<void> {
  await CharisolLink.delete({ userId }).go();
}

/** A fresh Charisol ID token for this person, or null when there's no saved sign-in (or Charisol no longer honours it). */
export async function freshCharisolIdToken(userId: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const { data } = await CharisolLink.get({ userId }).go();
  if (!data || Date.now() - new Date(data.storedAt).getTime() > MAX_AGE_MS) return null;
  let refreshToken: string;
  try {
    refreshToken = decryptStrataToken(data.ciphertext);
  } catch {
    return null; // a rotated key reads like "no saved sign-in"
  }
  const domain = process.env.NEXT_PUBLIC_CHARISOL_DOMAIN || "auth.charisol.io";
  let res: Response;
  try {
    res = await fetchFn(`https://${domain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: process.env.NEXT_PUBLIC_CHARISOL_CLIENT_ID ?? "", refresh_token: refreshToken }),
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    // The person ended that sign-in elsewhere (or it expired): forget it so we stop asking.
    if (res.status === 400 || res.status === 401) await deleteCharisolRefresh(userId).catch(() => undefined);
    return null;
  }
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  return typeof body?.id_token === "string" ? body.id_token : null;
}
