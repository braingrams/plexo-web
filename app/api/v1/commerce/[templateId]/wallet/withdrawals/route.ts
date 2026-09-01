import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { resolveCommerceWallet } from "@/lib/commerce/wallet";
import { encryptBankDetail } from "@/lib/crypto";
import { sendCommerceWithdrawalRequestNotificationEmail } from "@/lib/email";

/**
 * POST /api/v1/commerce/:templateId/wallet/withdrawals
 *
 * Requests a manual bank-transfer payout of the Commerce wallet balance — mirrors
 * app/api/v1/marketplace/withdrawals/route.ts's reserve-on-request transaction exactly,
 * just against CommerceWallet/CommerceWithdrawalRequest instead of
 * User.sellerBalanceCents/WithdrawalRequest. Approve/reject happens in plexo-admin.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, userId } = resolved.context;

  const body = (await request.json().catch(() => ({}))) as {
    amountCents?: number;
    accountNumber?: string;
    accountHolderName?: string;
    bankName?: string;
  };

  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "amountCents must be a positive integer." }, { status: 400 });
  }

  const accountNumber = body.accountNumber?.trim();
  const accountHolderName = body.accountHolderName?.trim();
  const bankName = body.bankName?.trim();
  if (!accountNumber || !accountHolderName || !bankName) {
    return NextResponse.json({ error: "Account number, account holder name, and bank name are required." }, { status: 400 });
  }

  try {
    const wallet = await resolveCommerceWallet(templateId, organizationId);

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.commerceWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      if (amountCents > current.balanceCents) {
        throw new Error("Requested amount exceeds the wallet's available balance.");
      }

      const nextBalance = current.balanceCents - amountCents;
      await tx.commerceWallet.update({ where: { id: wallet.id }, data: { balanceCents: nextBalance } });

      const withdrawal = await tx.commerceWithdrawalRequest.create({
        data: {
          walletId: wallet.id,
          organizationId,
          requestedByUserId: userId,
          amountCents,
          encryptedAccountNumber: encryptBankDetail(accountNumber),
          encryptedAccountHolderName: encryptBankDetail(accountHolderName),
          bankName,
        },
      });

      await tx.commerceWalletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          type: "WITHDRAWAL_DEBIT",
          netAmountCents: -amountCents,
          balanceAfterCents: nextBalance,
          withdrawalRequestId: withdrawal.id,
          description: `Withdrawal requested — ${bankName}`,
        },
      });

      return withdrawal;
    });

    const [organization, user] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    ]);

    if (organization && user) {
      await sendCommerceWithdrawalRequestNotificationEmail({
        id: result.id,
        organizationName: organization.name,
        userEmail: user.email,
        userName: user.name,
        amountCents: result.amountCents,
        bankName: result.bankName,
      }).catch((err) => console.error("Failed to send Commerce withdrawal admin notification email:", err));
    }

    return NextResponse.json({ withdrawal: { id: result.id, status: result.status } }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to submit withdrawal request." },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId } = resolved.context;

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { commerceWalletPooled: true } });
  const wallet = org?.commerceWalletPooled
    ? await prisma.commerceWallet.findFirst({ where: { organizationId, templateId: null } })
    : await prisma.commerceWallet.findUnique({ where: { templateId } });

  if (!wallet) {
    return NextResponse.json({ withdrawals: [] });
  }

  const withdrawals = await prisma.commerceWithdrawalRequest.findMany({
    where: { walletId: wallet.id },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      amountCents: true,
      bankName: true,
      status: true,
      rejectionReason: true,
      requestedAt: true,
      processedAt: true,
    },
  });

  return NextResponse.json({ withdrawals });
}
