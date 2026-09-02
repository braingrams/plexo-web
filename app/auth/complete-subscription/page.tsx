import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { CompleteSubscriptionClient } from "./complete-subscription-client";

export default async function CompleteSubscriptionPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  const { data: user } = await User.get({ id: session.user.id }).go();

  // databaseHooks (server/auth.ts) only ever writes PRO/ULTRA/null here, never FREE — this
  // narrows the type for the client component, which only expects the two paid plans.
  if (!user?.pendingPlan || user.pendingPlan === user.subscriptionPlan) {
    redirect("/dashboard");
  }

  return <CompleteSubscriptionClient plan={user.pendingPlan} />;
}
