import { NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { planOfferAnswer } from "@/lib/dashboardVersions/actions";
import { loadRegistry } from "@/lib/dashboardVersions/store";

/** POST { versionId, action: "later" | "never" }: remember "Maybe later" (ask again after N days) or "Don't ask again". */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { versionId?: unknown; action?: unknown };
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) return NextResponse.json({ error: "We couldn't find your account." }, { status: 404 });
  const plan = planOfferAnswer(user, await loadRegistry(), body.versionId, body.action);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  await User.patch({ id: user.id }).set({ dashboardOffers: plan.offers }).go();
  return NextResponse.json({ success: true });
}
