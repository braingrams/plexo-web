import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { TRIAL_DAYS } from "@/lib/plan/entitlement";
import { TrialOffer } from "./trial-offer";

/**
 * Shown once, right after signing up: try Pro or Ultra free for 14 days, no card. Anyone
 * who isn't eligible (already trialled, already paying) goes straight to the dashboard.
 */
export default async function WelcomePage(props: { searchParams: Promise<{ plan?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login?redirectTo=/welcome");

  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user || user.trialStartedAt || user.stripeSubscriptionId || user.subscriptionPlan !== "FREE") redirect("/dashboard");

  const { plan } = await props.searchParams;
  const highlighted = plan?.toUpperCase() === "ULTRA" ? "ULTRA" : user.pendingPlan === "ULTRA" ? "ULTRA" : "PRO";
  const firstName = (user.name ?? "").split(" ")[0] || null;

  return <TrialOffer firstName={firstName} highlighted={highlighted} trialDays={TRIAL_DAYS} />;
}
