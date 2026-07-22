import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { headers } from "next/headers";
import { OverviewClient } from "./overview-client";

export default async function OverviewPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect("/auth/login");
  }

  // 1. Fetch user onboarding statuses
  const templatesCount = await prisma.template.count({
    where: { userId: session.user.id },
  });

  const domainsCount = await prisma.publishedDomain.count({
    where: { userId: session.user.id },
  });

  const apiKeysCount = await prisma.apiKey.count({
    where: { userId: session.user.id },
  });

  const viewsCount = await prisma.pageView.count({
    where: {
      template: { userId: session.user.id },
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, subscriptionPlan: true },
  });

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 1500, margin: "0 auto" }}>
      <OverviewClient
        userName={user.name}
        plan={user.subscriptionPlan}
        hasTemplates={templatesCount > 0}
        hasDomains={domainsCount > 0}
        hasApiKeys={apiKeysCount > 0}
        hasViews={viewsCount > 0}
        templatesCount={templatesCount}
        domainsCount={domainsCount}
        apiKeysCount={apiKeysCount}
      />
    </div>
  );
}
