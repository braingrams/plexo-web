import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { SolConversation } from "@/lib/db/solEntities";

/** Has this person already seen SOL's "Hi, I'm SOL" hello? Remembered on the account, so it follows them between devices. */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data: user } = await User.get({ id: session.user.id }).go({ attributes: ["id", "solIntroSeenAt"] });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (user.solIntroSeenAt) return NextResponse.json({ seen: true });
  // Someone who already talks to SOL has met it: no "first visit" hello, and we remember that so it is not asked again.
  const { data: chats } = await SolConversation.query.primary({ userId: user.id }).go({ limit: 1 }).catch(() => ({ data: [] as unknown[] }));
  if (chats.length > 0) {
    await User.patch({ id: user.id }).set({ solIntroSeenAt: new Date().toISOString() }).go();
    return NextResponse.json({ seen: true });
  }
  return NextResponse.json({ seen: false });
}

/** They closed the hello, tapped one of its ideas, or sent their first message: never show it again. Setting it twice changes nothing. */
export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { data: user } = await User.get({ id: session.user.id }).go({ attributes: ["id", "solIntroSeenAt"] });
  if (!user) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (!user.solIntroSeenAt) await User.patch({ id: user.id }).set({ solIntroSeenAt: new Date().toISOString() }).go();
  return NextResponse.json({ ok: true });
}
