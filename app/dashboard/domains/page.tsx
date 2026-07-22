import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { DashboardShell } from "../dashboard-shell";
import { DomainsClient } from "./domains-client";
import { headers } from "next/headers";

export default async function DomainsPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session?.user) {
    redirect("/auth/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      subscriptionPlan: true,
      customDomainLimit: true,
    },
  });

  if (!user) {
    redirect("/auth/login");
  }

  // Fetch user's published domains
  const publishedDomains = await prisma.publishedDomain.findMany({
    where: { userId: session.user.id },
    include: {
      template: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch user's landing pages to link/re-link
  const landingPages = await prisma.template.findMany({
    where: {
      userId: session.user.id,
      kind: "LANDING_PAGE",
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  // Format domains for client
  const domains = publishedDomains.map((d) => ({
    id: d.id,
    domain: d.domain,
    type: d.type as "SUBDOMAIN" | "CUSTOM",
    templateId: d.templateId,
    templateName: d.template.name,
    createdAt: d.createdAt.toISOString(),
  }));

  return (
    <div style={{ padding: "2rem", maxWidth: 1500, margin: "0 auto" }}>
      <DomainsClient
        initialDomains={domains}
        landingPages={landingPages}
        plan={user.subscriptionPlan}
        customLimit={user.customDomainLimit}
      />
    </div>
  );
}
