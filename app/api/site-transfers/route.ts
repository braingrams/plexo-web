import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { listIncomingTransfers, listOutgoingTransfers } from "@/lib/siteTransferDynamo";
import { Template } from "@/lib/db/contentEntities";
import { Organization, User } from "@/lib/db/coreEntities";

/** Every pending transfer touching the signed-in user — incoming (sent to their email)
 * and outgoing (sent from their active org) — for the /dashboard/transfers list. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgResolution = await ensureActiveOrganization(session.user.id);
  const activeOrgId = orgResolution.status === "resolved" ? orgResolution.organizationId : null;

  const [incoming, outgoing] = await Promise.all([
    listIncomingTransfers(session.user.email.toLowerCase()),
    activeOrgId ? listOutgoingTransfers(activeOrgId) : Promise.resolve([]),
  ]);

  const [incomingTemplates, incomingOrgs, incomingUsers] = await Promise.all([
    Promise.all(incoming.map((t) => Template.get({ id: t.templateId }).go())),
    Promise.all(incoming.map((t) => Organization.get({ id: t.fromOrganizationId }).go())),
    Promise.all(incoming.map((t) => User.get({ id: t.fromUserId }).go())),
  ]);
  const outgoingTemplates = await Promise.all(outgoing.map((t) => Template.get({ id: t.templateId }).go()));

  return NextResponse.json({
    incoming: incoming.map((t, i) => ({
      id: t.id,
      templateId: t.templateId,
      template: { id: t.templateId, name: incomingTemplates[i].data?.name ?? "Untitled site" },
      fromOrganization: { name: incomingOrgs[i].data?.name ?? "Unknown organization" },
      fromUser: { name: incomingUsers[i].data?.name ?? "Unknown", email: incomingUsers[i].data?.email ?? "" },
      status: t.status,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
    })),
    outgoing: outgoing.map((t, i) => ({
      id: t.id,
      templateId: t.templateId,
      template: { id: t.templateId, name: outgoingTemplates[i].data?.name ?? "Untitled site" },
      toEmail: t.toEmail,
      status: t.status,
      createdAt: t.createdAt,
    })),
  });
}
