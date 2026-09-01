import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { resolveCommerceWallet } from "@/lib/commerce/wallet";

/**
 * GET /api/v1/commerce/:templateId/wallet
 *
 * Balance + recent ledger for this site's platform-hosted (PLATFORM_PAYSTACK/PLATFORM_STRIPE)
 * proceeds. Resolves the pooled org wallet instead when Organization.commerceWalletPooled is
 * on — see resolveCommerceWallet. Read-only; wallets are only ever created by a real sale
 * (creditCommerceWallet) or lazily here on first read, never by this route directly mutating
 * balance.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId } = resolved.context;

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 25, 1), 100);
  const cursor = searchParams.get("cursor") || undefined;

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { commerceWalletPooled: true } });
  const existing = org?.commerceWalletPooled
    ? await prisma.commerceWallet.findFirst({ where: { organizationId, templateId: null } })
    : await prisma.commerceWallet.findUnique({ where: { templateId } });

  if (!existing) {
    return NextResponse.json({
      wallet: { balanceCents: 0, currency: "NGN", pooled: Boolean(org?.commerceWalletPooled) },
      ledger: [],
      nextCursor: null,
    });
  }

  const ledger = await prisma.commerceWalletLedgerEntry.findMany({
    where: { walletId: existing.id },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = ledger.length > limit;
  const page = hasMore ? ledger.slice(0, limit) : ledger;

  return NextResponse.json({
    wallet: { balanceCents: existing.balanceCents, currency: existing.currency, pooled: Boolean(org?.commerceWalletPooled) },
    ledger: page.map((entry) => ({
      id: entry.id,
      type: entry.type,
      grossAmountCents: entry.grossAmountCents,
      feeCents: entry.feeCents,
      netAmountCents: entry.netAmountCents,
      balanceAfterCents: entry.balanceAfterCents,
      description: entry.description,
      createdAt: entry.createdAt,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  });
}

/**
 * PATCH /api/v1/commerce/:templateId/wallet
 *
 * Toggles Organization.commerceWalletPooled — org-wide, not site-scoped, so this is
 * intentionally allowed from any one of the org's site dashboards (matches how the toggle is
 * surfaced in WalletClient.tsx).
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId } = resolved.context;

  const body = (await request.json().catch(() => ({}))) as { pooled?: boolean };
  if (typeof body.pooled !== "boolean") {
    return NextResponse.json({ error: "pooled must be a boolean." }, { status: 400 });
  }

  await prisma.organization.update({ where: { id: organizationId }, data: { commerceWalletPooled: body.pooled } });
  // Ensure the target wallet shape exists so the very next GET has something to read —
  // harmless no-op if it already does.
  await resolveCommerceWallet(templateId, organizationId).catch(() => undefined);

  return NextResponse.json({ pooled: body.pooled });
}
