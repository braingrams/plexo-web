import { NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { planUserSwitch } from "@/lib/dashboardVersions/actions";
import { buildState } from "@/lib/dashboardVersions/state";
import { loadRegistry } from "@/lib/dashboardVersions/store";

/** GET: which dashboard this person is on, what they may switch to, and any offer to show. */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) return NextResponse.json({ error: "We couldn't find your account." }, { status: 404 });
  const state = buildState(user, await loadRegistry());
  return NextResponse.json({ versionId: state.versionId, label: state.label, locked: state.locked, targets: state.targets, offer: state.offer });
}

/** POST { to }: switch the person's own dashboard, only when allowed. Records it in their history. Moves no data. */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { to?: unknown };
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user) return NextResponse.json({ error: "We couldn't find your account." }, { status: 404 });
  const plan = planUserSwitch(user, await loadRegistry(), body.to);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });
  await User.patch({ id: user.id }).set(plan.patch).go();
  return NextResponse.json({ success: true, versionId: plan.to });
}
