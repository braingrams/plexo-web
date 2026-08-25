import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";

export type ResolvedCommerceAdmin = {
  userId: string;
  organizationId: string;
  role: string | null;
  templateId: string;
};

/**
 * Auth + ownership check shared by every /api/v1/commerce/[templateId]/* admin route:
 * resolves the caller (session or API key, same as every other admin route — see
 * resolveUser) and confirms templateId is a root Template (a "site") belonging to their
 * organization. Returns a ready-to-return NextResponse on any failure, or context to
 * proceed with.
 */
export async function resolveCommerceAdmin(
  request: NextRequest,
  templateId: string,
): Promise<{ error: NextResponse; context?: undefined } | { error?: undefined; context: ResolvedCommerceAdmin }> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const site = await prisma.template.findFirst({
    where: { id: templateId, organizationId: resolved.organizationId, parentId: null },
    select: { id: true },
  });
  if (!site) {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }

  return {
    context: {
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      role: resolved.role,
      templateId,
    },
  };
}

/** Masks a Paystack/MailDrip secret for display — same idea as ApiKey.maskedKey: never
 * return the real value once it's set, just enough to confirm something is configured. */
export function maskSecret(plain: string | null): string | null {
  if (!plain) return null;
  if (plain.length <= 8) return "••••••••";
  return `${plain.slice(0, 4)}${"•".repeat(8)}${plain.slice(-4)}`;
}
