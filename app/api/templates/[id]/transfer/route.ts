import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { isValidUuid } from "@/server/slugDynamo";
import { computeTransferWarnings, generateTransferToken, SITE_TRANSFER_EXPIRY_DAYS, listOutgoingTransfers } from "@/lib/siteTransferDynamo";
import { SiteTransferRequest } from "@/lib/db/importEntities";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildSiteTransferEmail } from "@/lib/mail/templates";
import { getOrgBrandDynamo } from "@/server/orgDynamo";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import { Template } from "@/lib/db/contentEntities";
import { User, Member } from "@/lib/db/coreEntities";

async function resolveSite(id: string, organizationId: string) {
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== organizationId || site.parentId) return null;
  return site;
}

/** The current pending outgoing transfer for this site, if any. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const site = await resolveSite(id, resolved.organizationId);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const outgoing = await listOutgoingTransfers(resolved.organizationId);
  const pending = outgoing.filter((t) => t.templateId === id).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0] ?? null;

  return NextResponse.json({ pending });
}

/**
 * body: { toEmail: string, confirm?: boolean }
 * Without confirm:true, this is a dry run — computes and returns the same warnings the
 * recipient will see, without creating or sending anything, so the sender can review
 * before committing. Only a real "owner" can initiate — this changes who owns the site,
 * not just its content.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (resolved.role !== null && resolved.role !== "owner") {
    return NextResponse.json({ error: "Only the organization owner can transfer a site." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const site = await resolveSite(id, resolved.organizationId);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const toEmail = typeof body.toEmail === "string" ? body.toEmail.trim().toLowerCase() : "";
  if (!toEmail || !toEmail.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const { data: senderUser } = await User.get({ id: resolved.userId }).go();
  if (senderUser && toEmail === senderUser.email.toLowerCase()) {
    return NextResponse.json({ error: "You can't transfer a site to yourself." }, { status: 400 });
  }

  const existingPending = (await listOutgoingTransfers(resolved.organizationId)).find((t) => t.templateId === id);
  if (existingPending) {
    return NextResponse.json({ error: `A transfer to ${existingPending.toEmail} is already pending for this site. Cancel it first.` }, { status: 409 });
  }

  const { data: recipientMatches } = await User.query.byEmail({ email: toEmail }).go();
  const recipientUser = recipientMatches[0] ?? null;
  let recipientOrgId: string | null = null;
  if (recipientUser) {
    const { data: memberships } = await Member.query.byUser({ userId: recipientUser.id }).go();
    const earliest = memberships.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0];
    recipientOrgId = earliest?.organizationId ?? null;
  }
  const recipientPlan = (recipientUser?.subscriptionPlan as "FREE" | "PRO" | "ULTRA" | undefined) ?? "FREE";
  const warnings = await computeTransferWarnings(id, recipientPlan, recipientOrgId);

  if (body.confirm !== true) {
    return NextResponse.json({ preview: true, recipientExists: !!recipientUser, warnings });
  }

  const token = generateTransferToken();
  const transferId = randomUUID();
  const expiresAt = new Date(Date.now() + SITE_TRANSFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await SiteTransferRequest.create({
    id: transferId,
    templateId: id,
    fromOrganizationId: resolved.organizationId,
    fromUserId: resolved.userId,
    toEmail,
    toUserId: recipientUser?.id,
    token,
    compatibilityWarnings: warnings,
    expiresAt,
  }).go();
  const { data: created } = await SiteTransferRequest.get({ templateId: id, id: transferId }).go();
  if (!created) throw new Error(`SiteTransferRequest ${transferId} vanished immediately after being created`);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const brand = await getOrgBrandDynamo(resolved.organizationId);
  const transferSubject = `${senderUser?.name ?? "Someone"} wants to transfer "${site.name}" to you on Plexo`;
  try {
    await sendMaildripEmail({
      to: toEmail,
      subject: transferSubject,
      html: buildSiteTransferEmail({
        senderName: senderUser?.name ?? "A Plexo user",
        siteName: site.name,
        acceptUrl: `${baseUrl}/dashboard/transfers/${created.id}?token=${token}`,
        warningCount: warnings.length,
        expiresInDays: SITE_TRANSFER_EXPIRY_DAYS,
        brand,
      }),
    });
    logEmailDelivery({
      kind: "maildrip", to: toEmail, subject: transferSubject, status: "sent",
      context: "site_transfer", organizationId: resolved.organizationId, templateId: id,
    });
  } catch (err) {
    // The request itself is real and can still be found/accepted via the dashboard even
    // if the notification email failed to send — don't roll back a genuine transfer offer
    // over a transient mail-provider error.
    console.error("Failed to send site transfer email:", err);
    logEmailDelivery({
      kind: "maildrip", to: toEmail, subject: transferSubject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "site_transfer", organizationId: resolved.organizationId, templateId: id,
    });
  }

  return NextResponse.json({ request: created, warnings }, { status: 201 });
}

/** Sender cancels their own pending outgoing transfer. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const site = await resolveSite(id, resolved.organizationId);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const pending = (await listOutgoingTransfers(resolved.organizationId)).find((t) => t.templateId === id);
  if (!pending) return NextResponse.json({ error: "No pending transfer to cancel." }, { status: 404 });

  await SiteTransferRequest.patch({ templateId: pending.templateId, id: pending.id }).set({ status: "CANCELLED", respondedAt: new Date().toISOString() }).go();
  return NextResponse.json({ ok: true });
}
