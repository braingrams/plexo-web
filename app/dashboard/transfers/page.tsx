import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { SettingsShell } from "../_components/SettingsShell";
import { TransfersListClient } from "./TransfersListClient";

export default async function TransfersPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) redirect("/auth/login?redirectTo=/dashboard/transfers");

  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");
  const activeOrgId = orgResolution.organizationId;

  const [incoming, outgoing] = await Promise.all([
    prisma.siteTransferRequest.findMany({
      where: { toEmail: session.user.email.toLowerCase(), status: "PENDING" },
      include: { template: { select: { id: true, name: true } }, fromOrganization: { select: { name: true } }, fromUser: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    activeOrgId
      ? prisma.siteTransferRequest.findMany({
          where: { fromOrganizationId: activeOrgId, status: "PENDING" },
          include: { template: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <SettingsShell>
      <TransfersListClient
        incoming={incoming.map((t) => ({
          id: t.id,
          siteName: t.template.name,
          fromName: t.fromUser.name,
          fromOrgName: t.fromOrganization.name,
          createdAt: t.createdAt.toISOString(),
          expiresAt: t.expiresAt.toISOString(),
        }))}
        outgoing={outgoing.map((t) => ({ id: t.id, templateId: t.template.id, siteName: t.template.name, toEmail: t.toEmail, createdAt: t.createdAt.toISOString() }))}
      />
    </SettingsShell>
  );
}
