import { NextRequest, NextResponse } from "next/server";
import { User } from "@/lib/db/coreEntities";
import { getCharisolVerifier } from "@/server/charisolVerifier";
import { isEmailVerifiedClaim } from "@/server/charisolAccount";
import { authorizeStrata, exchangeCharisolIdToken, readJson, strataApiUrl, strataFail } from "@/lib/strata/server";
import { deleteStrataSession, getStrataConnection, saveStrataSession } from "@/lib/strata/session";
import { resolveUser } from "@/lib/auth/resolveUser";

/**
 * The signed-in person's connection to Strata (the editor's Branding panel).
 *   GET    → { available, connected, expired, user? }   never includes the token
 *   POST   { idToken } → connects: verifies the Charisol ID token (same verifier as sign-in),
 *          requires its email to be the signed-in Plexo user's, trades it for a Strata session
 *          and stores that encrypted. → { available, connected, expired, user }
 *   DELETE → disconnects
 * When STRATA_API_URL isn't set, GET answers { available: false, connected: false } so the
 * editor can say so instead of failing.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!strataApiUrl()) return NextResponse.json({ available: false, connected: false, expired: false });
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Sign in to Plexo to continue.", kind: "unauthorized" }, { status: 401 });
  return NextResponse.json({ available: true, ...(await getStrataConnection(resolved.userId)) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const caller = await authorizeStrata(request, "session", 12);
  if (caller instanceof NextResponse) return caller;
  const body = await readJson(request);
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  if (!idToken) return NextResponse.json({ error: "The Charisol sign-in didn't finish. Please try connecting again.", kind: "invalid" }, { status: 400 });

  let claims: Record<string, unknown>;
  try {
    claims = (await getCharisolVerifier().verify(idToken)) as unknown as Record<string, unknown>;
  } catch {
    // Bad signature, wrong client, expired or malformed — nothing about why goes to the client.
    return NextResponse.json({ error: "That Charisol sign-in couldn't be verified. Please try connecting again.", kind: "invalid" }, { status: 401 });
  }

  const { data: user } = await User.get({ id: caller.userId }).go();
  const claimed = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!isEmailVerifiedClaim(claims.email_verified) || !claimed || claimed !== user?.email?.trim().toLowerCase()) {
    return NextResponse.json(
      { error: `That Charisol account${claimed ? ` (${claimed})` : ""} isn't the one you use for Plexo${user?.email ? ` (${user.email})` : ""}. Sign in to Charisol with the same email, then try again.`, kind: "forbidden" },
      { status: 403 },
    );
  }

  try {
    const session = await exchangeCharisolIdToken(strataApiUrl()!, idToken);
    await saveStrataSession(caller.userId, session);
    return NextResponse.json({ available: true, connected: true, expired: false, user: { email: session.email, name: session.name } });
  } catch (err) {
    return strataFail(err);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const caller = await authorizeStrata(request, "session", 30);
  if (caller instanceof NextResponse) return caller;
  try {
    await deleteStrataSession(caller.userId);
    return NextResponse.json({ available: true, connected: false, expired: false });
  } catch (err) {
    return strataFail(err);
  }
}
