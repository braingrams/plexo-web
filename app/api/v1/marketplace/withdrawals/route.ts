import { NextRequest, NextResponse } from "next/server";
import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { docClient } from "@/lib/db/client";
import { User } from "@/lib/db/coreEntities";
import { SellerLedgerEntry, WithdrawalRequest } from "@/lib/db/ledgerEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { encryptBankDetail } from "@/lib/crypto";
import { sendWithdrawalRequestNotificationEmail } from "@/lib/email";

const MAX_OPTIMISTIC_RETRIES = 5;

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string }; CancellationReasons?: Array<{ Code?: string }> };
  return (
    anyErr?.name === "ConditionalCheckFailedException" ||
    anyErr?.cause?.name === "ConditionalCheckFailedException" ||
    anyErr?.name === "TransactionCanceledException" ||
    Boolean(anyErr?.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed"))
  );
}

/**
 * POST /api/v1/marketplace/withdrawals
 *
 * Requests a manual bank-transfer payout of the seller's marketplace balance. Reserves
 * (debits) the requested amount immediately, in the same TransactWriteItems call the
 * request row is created in — same guarantee lib/db/ledgerOperations.ts's grantTopup/
 * debitCredits already established for the credit ledger, extended here to a 3-item
 * transaction (User debit + WithdrawalRequest create + SellerLedgerEntry create).
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

  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
    const { data: user } = await User.get({ id: resolved.userId }).go();
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    const sellerBalanceCents = user.sellerBalanceCents ?? 0;
    if (amountCents > sellerBalanceCents) {
      return NextResponse.json({ error: "Requested amount exceeds your available balance." }, { status: 400 });
    }

    const nextBalance = sellerBalanceCents - amountCents;
    const withdrawalId = crypto.randomUUID();
    const ledgerEntryId = crypto.randomUUID();

    const updateUser = User.patch({ id: resolved.userId })
      .set({ sellerBalanceCents: nextBalance })
      .where((attr, op) => op.eq(attr.sellerBalanceCents, sellerBalanceCents)) // optimistic lock
      .params();

    const createWithdrawal = WithdrawalRequest.create({
      id: withdrawalId,
      userId: resolved.userId,
      amountCents,
      encryptedAccountNumber: encryptBankDetail(accountNumber),
      encryptedAccountHolderName: encryptBankDetail(accountHolderName),
      bankName,
    }).params();

    const createLedgerEntry = SellerLedgerEntry.create({
      id: ledgerEntryId,
      userId: resolved.userId,
      type: "WITHDRAWAL_DEBIT",
      netAmountCents: -amountCents,
      balanceAfterCents: nextBalance,
      withdrawalRequestId: withdrawalId,
      description: `Withdrawal requested — ${bankName}`,
    }).params();

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            { Update: updateUser as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Update"] },
            { Put: createWithdrawal as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Put"] },
            { Put: createLedgerEntry as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Put"] },
          ],
        }),
      );

      await sendWithdrawalRequestNotificationEmail({
        id: withdrawalId,
        userEmail: user.email,
        userName: user.name ?? "A seller",
        amountCents,
        bankName,
      }).catch((err) => console.error("Failed to send withdrawal admin notification email:", err));

      return NextResponse.json({ withdrawal: { id: withdrawalId, status: "PENDING" } }, { status: 201 });
    } catch (err) {
      if (isConditionalCheckFailure(err) && attempt < MAX_OPTIMISTIC_RETRIES - 1) continue;
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Unable to submit withdrawal request." },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ error: "Too much concurrent balance contention — try again." }, { status: 409 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: withdrawals } = await WithdrawalRequest.query.primary({ userId: resolved.userId }).go({ order: "desc" });

  return NextResponse.json({
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amountCents: w.amountCents,
      bankName: w.bankName,
      status: w.status ?? "PENDING",
      rejectionReason: w.rejectionReason ?? null,
      requestedAt: w.requestedAt,
      processedAt: w.processedAt ?? null,
    })),
  });
}
