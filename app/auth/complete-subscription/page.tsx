import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { CompleteSubscriptionClient } from "./complete-subscription-client";

export default async function CompleteSubscriptionPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect("/auth/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { subscriptionPlan: true, pendingPlan: true },
  });

  // databaseHooks (server/auth.ts) only ever writes PRO/ULTRA/null here, never FREE — this
  // narrows the type for the client component, which only expects the two paid plans.
  if (!user?.pendingPlan || user.pendingPlan === user.subscriptionPlan || user.pendingPlan === "FREE") {
    redirect("/dashboard");
  }

  return <CompleteSubscriptionClient plan={user.pendingPlan} />;
}
