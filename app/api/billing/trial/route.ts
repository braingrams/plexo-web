import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { PlanLifecycleError, startTrial } from "@/lib/plan/lifecycle";
import { TRIAL_DAYS, TRIAL_PLANS, canStartTrial, type TrialPlan } from "@/lib/plan/entitlement";

/** GET — whether this account can still start its one free trial (powers every "Try free" button). */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ available: false, trialDays: TRIAL_DAYS });
  const { data: user } = await User.get({ id: session.user.id }).go();
  return NextResponse.json({ available: !!user && canStartTrial(user), trialDays: TRIAL_DAYS }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/billing/trial
 *   { plan: "PRO" | "ULTRA" } — start the account's one 14-day trial (no card).
 *   { dismiss: true }         — "Continue on Free": don't offer it again after signup.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { plan?: unknown; dismiss?: unknown };

  if (body.dismiss === true) {
    await User.patch({ id: session.user.id }).set({ trialOfferSeenAt: new Date().toISOString() }).remove(["pendingPlan"]).go();
    return NextResponse.json({ success: true });
  }

  if (!TRIAL_PLANS.includes(body.plan as TrialPlan)) {
    return NextResponse.json({ error: "Choose Pro or Ultra to try." }, { status: 400 });
  }
  try {
    const { endsAt } = await startTrial(session.user.id, body.plan as TrialPlan);
    return NextResponse.json({ success: true, plan: body.plan, endsAt });
  } catch (err) {
    if (err instanceof PlanLifecycleError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
