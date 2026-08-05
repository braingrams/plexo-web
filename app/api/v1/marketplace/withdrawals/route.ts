import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
import { encryptBankDetail } from "@/lib/crypto";
import { sendWithdrawalRequestNotificationEmail } from "@/lib/email";

/**
 * POST /api/v1/marketplace/withdrawals
 *
 * Requests a manual bank-transfer payout of the seller's marketplace balance. Reserves
 * (debits) the requested amount immediately, in the same transaction the request row is
 * created in, so a seller can't submit several requests that together exceed their
 * balance while all are still pending — a rejection later reverses this debit.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const request_ = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: resolved.userId },
        select: { sellerBalanceCents: true, email: true, name: true },
      });
      if (amountCents > user.sellerBalanceCents) {
        throw new Error("Requested amount exceeds your available balance.");
      }

      const nextBalance = user.sellerBalanceCents - amountCents;
      await tx.user.update({ where: { id: resolved.userId }, data: { sellerBalanceCents: nextBalance } });

      const withdrawal = await tx.withdrawalRequest.create({
        data: {
          userId: resolved.userId,
          amountCents,
          encryptedAccountNumber: encryptBankDetail(accountNumber),
          encryptedAccountHolderName: encryptBankDetail(accountHolderName),
          bankName,
        },
      });

      await tx.sellerLedgerEntry.create({
        data: {
          userId: resolved.userId,
          type: "WITHDRAWAL_DEBIT",
          netAmountCents: -amountCents,
          balanceAfterCents: nextBalance,
          withdrawalRequestId: withdrawal.id,
          description: `Withdrawal requested — ${bankName}`,
        },
      });

      return { withdrawal, userEmail: user.email, userName: user.name };
    });

    await sendWithdrawalRequestNotificationEmail({
      id: request_.withdrawal.id,
      userEmail: request_.userEmail,
      userName: request_.userName,
      amountCents: request_.withdrawal.amountCents,
      bankName: request_.withdrawal.bankName,
    }).catch((err) => console.error("Failed to send withdrawal admin notification email:", err));

    return NextResponse.json({ withdrawal: { id: request_.withdrawal.id, status: request_.withdrawal.status } }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to submit withdrawal request." },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const withdrawals = await prisma.withdrawalRequest.findMany({
    where: { userId: resolved.userId },
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
