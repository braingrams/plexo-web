import { NextRequest, NextResponse } from "next/server";

import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { resolveCommerceWallet } from "@/lib/commerce/walletDynamo";
import { Organization } from "@/lib/db/coreEntities";
import { CommerceWallet, CommerceWalletLedgerEntry } from "@/lib/db/commerceEntities";

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
  const cursor = searchParams.get("cursor") || null;

  const { data: org } = await Organization.get({ id: organizationId }).go();
  const pooled = org?.commerceWalletPooled ?? false;
  const scopeId = pooled ? organizationId : templateId;
  const { data: existing } = await CommerceWallet.get({ scopeId }).go();

  if (!existing) {
    return NextResponse.json({
      wallet: { balanceCents: 0, currency: "NGN", pooled },
      ledger: [],
      nextCursor: null,
    });
  }

  const { data: ledger, cursor: nextCursor } = await CommerceWalletLedgerEntry.query
    .primary({ walletId: existing.id })
    .go({ limit, cursor, order: "desc" });

  return NextResponse.json({
    wallet: { balanceCents: existing.balanceCents ?? 0, currency: existing.currency ?? "NGN", pooled },
    ledger: ledger.map((entry) => ({
      id: entry.id,
      type: entry.type,
      grossAmountCents: entry.grossAmountCents ?? null,
      feeCents: entry.feeCents ?? null,
      netAmountCents: entry.netAmountCents,
      balanceAfterCents: entry.balanceAfterCents,
      description: entry.description ?? null,
      createdAt: entry.createdAt,
    })),
    nextCursor: nextCursor ?? null,
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

  await Organization.patch({ id: organizationId }).set({ commerceWalletPooled: body.pooled }).go();
  // Ensure the target wallet shape exists so the very next GET has something to read —
  // harmless no-op if it already does.
  await resolveCommerceWallet(templateId, organizationId).catch(() => undefined);

  return NextResponse.json({ pooled: body.pooled });
}
