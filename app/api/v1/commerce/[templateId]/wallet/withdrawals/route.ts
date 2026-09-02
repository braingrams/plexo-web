import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { TransactWriteCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

import { docClient } from "@/lib/db/client";
import { Organization, User } from "@/lib/db/coreEntities";
import { CommerceWallet, CommerceWalletLedgerEntry, CommerceWithdrawalRequest } from "@/lib/db/commerceEntities";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { resolveCommerceWallet } from "@/lib/commerce/walletDynamo";
import { encryptBankDetail } from "@/lib/crypto";
import { sendCommerceWithdrawalRequestNotificationEmail } from "@/lib/email";

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

  const wallet = await resolveCommerceWallet(templateId, organizationId);

  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
    const { data: current } = await CommerceWallet.get({ scopeId: wallet.scopeId }).go();
    if (!current) return NextResponse.json({ error: "Wallet not found." }, { status: 404 });
    const balanceCents = current.balanceCents ?? 0;
    if (amountCents > balanceCents) {
      return NextResponse.json({ error: "Requested amount exceeds the wallet's available balance." }, { status: 400 });
    }

    const nextBalance = balanceCents - amountCents;
    const withdrawalId = randomUUID();
    const ledgerEntryId = randomUUID();

    const updateWallet = CommerceWallet.patch({ scopeId: wallet.scopeId })
      .set({ balanceCents: nextBalance })
      .where((attr, op) => op.eq(attr.balanceCents, balanceCents)) // optimistic lock
      .params();

    const createWithdrawal = CommerceWithdrawalRequest.create({
      id: withdrawalId,
      walletId: wallet.id,
      organizationId,
      requestedByUserId: userId,
      amountCents,
      encryptedAccountNumber: encryptBankDetail(accountNumber),
      encryptedAccountHolderName: encryptBankDetail(accountHolderName),
      bankName,
    }).params();

    const createLedgerEntry = CommerceWalletLedgerEntry.create({
      id: ledgerEntryId,
      walletId: wallet.id,
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
            { Update: updateWallet as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Update"] },
            { Put: createWithdrawal as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Put"] },
            { Put: createLedgerEntry as unknown as NonNullable<TransactWriteCommandInput["TransactItems"]>[number]["Put"] },
          ],
        }),
      );

      const [{ data: organization }, { data: user }] = await Promise.all([
        Organization.get({ id: organizationId }).go(),
        User.get({ id: userId }).go(),
      ]);
      if (organization && user) {
        await sendCommerceWithdrawalRequestNotificationEmail({
          id: withdrawalId,
          organizationName: organization.name,
          userEmail: user.email,
          userName: user.name ?? "A seller",
          amountCents,
          bankName,
        }).catch((err) => console.error("Failed to send Commerce withdrawal admin notification email:", err));
      }

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

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId } = resolved.context;

  const { data: org } = await Organization.get({ id: organizationId }).go();
  const pooled = org?.commerceWalletPooled ?? false;
  const scopeId = pooled ? organizationId : templateId;
  const { data: wallet } = await CommerceWallet.get({ scopeId }).go();

  if (!wallet) {
    return NextResponse.json({ withdrawals: [] });
  }

  const { data: withdrawals } = await CommerceWithdrawalRequest.query.primary({ walletId: wallet.id }).go({ order: "desc" });

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
