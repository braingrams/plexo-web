import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { isValidUuid } from "@/server/slug";
import { computeTransferWarnings, generateTransferToken, SITE_TRANSFER_EXPIRY_DAYS } from "@/server/siteTransfer";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildSiteTransferEmail } from "@/lib/mail/templates";
import { getOrganizationOwnerPlan, getOrgBrand } from "@/lib/subscription";

async function resolveSite(id: string, organizationId: string) {
  return prisma.template.findFirst({
    where: { id, organizationId, parentId: null },
    select: { id: true, name: true, organizationId: true },
  });
}

/** The current pending outgoing transfer for this site, if any. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const site = await resolveSite(id, resolved.organizationId);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const pending = await prisma.siteTransferRequest.findFirst({
    where: { templateId: id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });

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

  const senderUser = await prisma.user.findUnique({ where: { id: resolved.userId }, select: { email: true, name: true } });
  if (senderUser && toEmail === senderUser.email.toLowerCase()) {
    return NextResponse.json({ error: "You can't transfer a site to yourself." }, { status: 400 });
  }

  const existingPending = await prisma.siteTransferRequest.findFirst({ where: { templateId: id, status: "PENDING" } });
  if (existingPending) {
    return NextResponse.json({ error: `A transfer to ${existingPending.toEmail} is already pending for this site. Cancel it first.` }, { status: 409 });
  }

  const recipientUser = await prisma.user.findUnique({ where: { email: toEmail }, select: { id: true, subscriptionPlan: true } });
  let recipientOrgId: string | null = null;
  if (recipientUser) {
    const membership = await prisma.member.findFirst({ where: { userId: recipientUser.id }, orderBy: { createdAt: "asc" }, select: { organizationId: true } });
    recipientOrgId = membership?.organizationId ?? null;
  }
  const recipientPlan = recipientUser?.subscriptionPlan ?? "FREE";
  const warnings = await computeTransferWarnings(id, recipientPlan as "FREE" | "PRO" | "ULTRA", recipientOrgId);

  if (body.confirm !== true) {
    return NextResponse.json({ preview: true, recipientExists: !!recipientUser, warnings });
  }

  const token = generateTransferToken();
  const expiresAt = new Date(Date.now() + SITE_TRANSFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const created = await prisma.siteTransferRequest.create({
    data: {
      templateId: id,
      fromOrganizationId: resolved.organizationId,
      fromUserId: resolved.userId,
      toEmail,
      toUserId: recipientUser?.id ?? null,
      token,
      compatibilityWarnings: warnings as any,
      expiresAt,
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const brand = await getOrgBrand(resolved.organizationId);
  try {
    await sendMaildripEmail({
      to: toEmail,
      subject: `${senderUser?.name ?? "Someone"} wants to transfer "${site.name}" to you on Plexo`,
      html: buildSiteTransferEmail({
        senderName: senderUser?.name ?? "A Plexo user",
        siteName: site.name,
        acceptUrl: `${baseUrl}/dashboard/transfers/${created.id}?token=${token}`,
        warningCount: warnings.length,
        expiresInDays: SITE_TRANSFER_EXPIRY_DAYS,
        brand,
      }),
    });
  } catch (err) {
    // The request itself is real and can still be found/accepted via the dashboard even
    // if the notification email failed to send — don't roll back a genuine transfer offer
    // over a transient mail-provider error.
    console.error("Failed to send site transfer email:", err);
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

  const pending = await prisma.siteTransferRequest.findFirst({ where: { templateId: id, status: "PENDING" } });
  if (!pending) return NextResponse.json({ error: "No pending transfer to cancel." }, { status: 404 });

  await prisma.siteTransferRequest.update({ where: { id: pending.id }, data: { status: "CANCELLED", respondedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
