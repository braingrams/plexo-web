import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { User } from "@/lib/db/coreEntities";

// A Google sign-in that just created the account is "new". The server decides, from the marker
// Charisol sign-in sets on account creation. The marker is read once and cleared, and it only
// counts for a few minutes, so an old marker can't make a later sign-in look new.
const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

/** GET /api/auth/signup-event → { isNew, userId } for the signed-in account. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: user } = await User.get({ id: resolved.userId }).go({ attributes: ["id", "signupEventPendingAt"] });
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!user.signupEventPendingAt) return NextResponse.json({ isNew: false, userId: user.id });
  await User.patch({ id: user.id }).remove(["signupEventPendingAt"]).go();
  const age = Date.now() - Date.parse(user.signupEventPendingAt);
  return NextResponse.json({ isNew: age >= 0 && age < NEW_ACCOUNT_WINDOW_MS, userId: user.id });
}
