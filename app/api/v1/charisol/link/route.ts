import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { deleteCharisolRefresh, saveCharisolRefresh } from "@/lib/charisolLink";

// Keeps (POST) or forgets (DELETE) the signed-in person's Charisol sign-in on the server, so Strata can be connected as them
// without another login (lib/charisolLink.ts). The token is only ever stored, never returned. Whose token it is gets checked
// when it's used: the ID token it yields must carry this person's own email.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Sign in to Plexo to continue." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { refreshToken?: unknown } | null;
  const token = typeof body?.refreshToken === "string" ? body.refreshToken : "";
  if (!token || token.length > 4096) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  if (!process.env.STRATA_TOKEN_ENCRYPTION_SECRET) return NextResponse.json({ saved: false });
  try {
    await saveCharisolRefresh(resolved.userId, token);
    return NextResponse.json({ saved: true });
  } catch (err) {
    console.error("charisol link save failed:", err);
    return NextResponse.json({ saved: false });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ ok: true });
  await deleteCharisolRefresh(resolved.userId).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
