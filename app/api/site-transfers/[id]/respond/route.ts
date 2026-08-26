import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";
import { isValidUuid } from "@/server/slug";
import { computeTransferWarnings, executeSiteTransfer } from "@/server/siteTransfer";
import { getOrganizationOwnerPlan, type SubscriptionPlan } from "@/lib/subscription";

/**
 * body: { action: "accept" | "decline", token?: string, acknowledgeWarnings?: boolean }
 * Accept recomputes warnings fresh against the recipient's REAL current plan/org — the
 * warnings shown when the sender initiated the transfer could be stale by now (plans and
 * page counts change). If there are any and acknowledgeWarnings isn't true, this returns
 * them (409) instead of transferring anything, so the UI can show them and let the
 * recipient explicitly confirm through — the "show it in detail, cleanly" the transfer
 * was asked for.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Transfer not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const action = body.action === "accept" || body.action === "decline" ? body.action : null;
  if (!action) return NextResponse.json({ error: "action must be \"accept\" or \"decline\"." }, { status: 400 });

  const transfer = await prisma.siteTransferRequest.findUnique({
    where: { id },
    include: { template: { select: { id: true, name: true } } },
  });
  if (!transfer) return NextResponse.json({ error: "Transfer not found." }, { status: 404 });

  if (transfer.toEmail !== session.user.email.toLowerCase()) {
    return NextResponse.json({ error: `This transfer was sent to ${transfer.toEmail} — log in with that email to respond to it.` }, { status: 403 });
  }

  if (transfer.status !== "PENDING") {
    return NextResponse.json({ error: `This transfer is already ${transfer.status.toLowerCase()}.` }, { status: 409 });
  }
  if (transfer.expiresAt < new Date()) {
    await prisma.siteTransferRequest.update({ where: { id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "This transfer offer has expired." }, { status: 410 });
  }

  if (action === "decline") {
    await prisma.siteTransferRequest.update({ where: { id }, data: { status: "DECLINED", respondedAt: new Date() } });
    return NextResponse.json({ ok: true, status: "DECLINED" });
  }

  // action === "accept"
  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    return NextResponse.json({ error: "Choose which of your organizations should receive this site first, then try again.", needsOrgChoice: true }, { status: 409 });
  }

  const recipientPlan = await getOrganizationOwnerPlan(orgResolution.organizationId);
  const warnings = await computeTransferWarnings(transfer.templateId, recipientPlan, orgResolution.organizationId);

  if (warnings.length > 0 && body.acknowledgeWarnings !== true) {
    return NextResponse.json({ requiresAcknowledgement: true, warnings }, { status: 409 });
  }

  await executeSiteTransfer({
    rootId: transfer.templateId,
    toOrganizationId: orgResolution.organizationId,
    toUserId: session.user.id,
  });

  await prisma.siteTransferRequest.update({
    where: { id },
    data: { status: "ACCEPTED", toUserId: session.user.id, respondedAt: new Date() },
  });

  return NextResponse.json({ ok: true, status: "ACCEPTED", templateId: transfer.templateId });
}
