import { PLAN, RETIRED_PLAN } from "@/lib/plan/plans";
import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { TRIAL_DAYS, storedPlan } from "@/lib/plan/entitlement";
import { TrialOffer } from "./trial-offer";

/**
 * Shown once, right after signing up: try Starter or Pro free for 14 days, no card. Anyone
 * who isn't eligible (already trialled, already paying) goes straight to the dashboard.
 */
export default async function WelcomePage(props: { searchParams: Promise<{ plan?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login?redirectTo=/welcome");

  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user || user.trialStartedAt || user.subscriptionId || user.stripeSubscriptionId || storedPlan(user) !== PLAN.FREE) redirect("/dashboard");

  const { plan } = await props.searchParams;
  // The plan they came in for (?plan= or the one picked at signup); ULTRA (before the rename) = Pro.
  const pending = user.pendingPlan ? storedPlan({ subscriptionPlan: user.pendingPlan, planVersion: user.planVersion }) : null;
  const asked = plan?.toUpperCase();
  const highlighted = asked === RETIRED_PLAN.ULTRA || asked === PLAN.PRO || (!asked && (pending === PLAN.PRO || pending === PLAN.ENTERPRISE)) ? PLAN.PRO : PLAN.STARTER;
  const firstName = (user.name ?? "").split(" ")[0] || null;

  return <TrialOffer firstName={firstName} highlighted={highlighted} trialDays={TRIAL_DAYS} />;
}
