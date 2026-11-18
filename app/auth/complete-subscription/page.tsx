import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { CompleteSubscriptionClient } from "./complete-subscription-client";
import { TRIAL_DAYS, storedPlan } from "@/lib/plan/entitlement";

export default async function CompleteSubscriptionPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  const { data: user } = await User.get({ id: session.user.id }).go();

  // The plan picked at signup (never FREE), read in today's terms — a value saved before the
  // 2026 plan rename (PRO/ULTRA) means Starter/Pro.
  const pending = user?.pendingPlan ? storedPlan({ subscriptionPlan: user.pendingPlan, planVersion: user.planVersion }) : "FREE";
  if (!user || pending === "FREE" || pending === storedPlan(user)) {
    redirect("/dashboard");
  }

  const hasSubscription = !!(user.subscriptionId || user.stripeSubscriptionId);
  return <CompleteSubscriptionClient plan={pending} canTrial={!user.trialStartedAt && !hasSubscription && pending !== "ENTERPRISE"} trialDays={TRIAL_DAYS} />;
}
