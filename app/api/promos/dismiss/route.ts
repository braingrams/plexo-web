import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { readDismissed, withDismissed } from "@/lib/promos/promos";

/** "Hide this message" on the dashboard promo strip: remembered on the account for that version. */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { id?: unknown; version?: unknown } | null;
  if (!body || typeof body.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(body.id) || typeof body.version !== "number" || !Number.isFinite(body.version)) {
    return NextResponse.json({ error: "That message couldn't be hidden." }, { status: 400 });
  }
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  await User.patch({ id: user.id })
    .set({ dismissedPromos: withDismissed(readDismissed(user.dismissedPromos), body.id, body.version) })
    .go();
  return NextResponse.json({ ok: true });
}
