import { CreditTransactionType, Prisma } from "@prisma/client";

import { MAX_TOKENS } from "@/lib/ai/generate";
import type { AiActionMode, AiProvider, ConcreteTier, GenerateOutcome } from "@/lib/ai/types";
import { PLAN_MONTHLY_CREDITS } from "@/lib/subscription";
import { prisma } from "@/server/prisma";

import { computeCostUsd, creditsForUsd } from "./pricing";

const ALLOWANCE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreditBalance {
  allowanceBalance: number;
  topupBalance: number;
  total: number;
  allowanceResetAt: Date;
}

/**
 * Lazily grants the next monthly allowance once the current period has
 * elapsed — no rollover, the prior unused balance is simply replaced. There's
 * no cron: this runs at the top of every system-AI request and whenever the
 * Settings/Billing page loads, so the balance shown is always current.
 *
 * Uses a conditional `updateMany` (rather than read-then-write) so two
 * concurrent requests straddling the reset boundary can't both grant the
 * same period twice.
 */
export async function ensureCreditPeriod(userId: string): Promise<CreditBalance> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { subscriptionPlan: true, allowanceBalance: true, topupBalance: true, allowanceResetAt: true },
  });

  const now = new Date();
  if (now <= user.allowanceResetAt) {
    return {
      allowanceBalance: user.allowanceBalance,
      topupBalance: user.topupBalance,
      total: user.allowanceBalance + user.topupBalance,
      allowanceResetAt: user.allowanceResetAt,
    };
  }

  const grant = PLAN_MONTHLY_CREDITS[user.subscriptionPlan];
  const nextResetAt = new Date(now.getTime() + ALLOWANCE_PERIOD_MS);

  const { count } = await prisma.user.updateMany({
    where: { id: userId, allowanceResetAt: { lt: now } },
    data: { allowanceBalance: grant, allowanceResetAt: nextResetAt },
  });

  if (count > 0) {
    await prisma.creditLedgerEntry.create({
      data: {
        userId,
        type: CreditTransactionType.MONTHLY_GRANT,
        amount: grant,
        balanceAfter: grant + user.topupBalance,
        description: `Monthly ${user.subscriptionPlan} allowance`,
      },
    });
    return {
      allowanceBalance: grant,
      topupBalance: user.topupBalance,
      total: grant + user.topupBalance,
      allowanceResetAt: nextResetAt,
    };
  }

  // Lost the race to another concurrent request — read back what it wrote.
  const fresh = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { allowanceBalance: true, topupBalance: true, allowanceResetAt: true },
  });
  return {
    allowanceBalance: fresh.allowanceBalance,
    topupBalance: fresh.topupBalance,
    total: fresh.allowanceBalance + fresh.topupBalance,
    allowanceResetAt: fresh.allowanceResetAt,
  };
}

/**
 * Upper-bound credit cost for a request, computed *before* calling the
 * provider — real cost isn't known until the call completes, but our own
 * `MAX_TOKENS[mode]` ceiling is exact (it's the maxTokens we pass to the
 * provider), and input is estimated conservatively (~3 chars/token, biased
 * high) from the actual prompt+context payload. Used purely as a pre-flight
 * balance gate; `chargeUsage` bills the real, usually-lower amount after.
 */
export function estimateWorstCaseCost(
  provider: AiProvider,
  tier: ConcreteTier,
  mode: AiActionMode,
  approxInputChars: number,
): number {
  const conservativeInputTokens = Math.ceil(approxInputChars / 3);
  const maxOutputTokens = MAX_TOKENS[mode];
  const usd = computeCostUsd(provider, tier, {
    inputTokens: conservativeInputTokens,
    outputTokens: maxOutputTokens,
  });
  return creditsForUsd(usd);
}

/**
 * Deducts the real, usage-based cost of a completed system-AI request —
 * allowance bucket first, then top-up. Only called after a successful
 * provider call; never charge on failure.
 */
export async function chargeUsage(
  userId: string,
  params: { provider: AiProvider; tier: ConcreteTier; mode: AiActionMode; usage: GenerateOutcome["usage"] },
): Promise<{ creditsCharged: number; allowanceBalance: number; topupBalance: number }> {
  const usd = computeCostUsd(params.provider, params.tier, params.usage);
  const credits = creditsForUsd(usd);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { allowanceBalance: true, topupBalance: true },
    });

    const fromAllowance = Math.min(user.allowanceBalance, credits);
    const fromTopup = credits - fromAllowance;
    const nextAllowance = user.allowanceBalance - fromAllowance;
    // Can go negative only if actual usage exceeded the pre-flight worst-case
    // estimate (shouldn't normally happen) — left unclamped so the deficit is
    // visible and naturally paid down by the next grant/top-up.
    const nextTopup = user.topupBalance - fromTopup;

    await tx.user.update({
      where: { id: userId },
      data: { allowanceBalance: nextAllowance, topupBalance: nextTopup },
    });

    await tx.creditLedgerEntry.create({
      data: {
        userId,
        type: CreditTransactionType.AI_USAGE,
        amount: -credits,
        balanceAfter: nextAllowance + nextTopup,
        description: `${params.mode} (${params.provider}/${params.tier})`,
        metadata: {
          provider: params.provider,
          tier: params.tier,
          mode: params.mode,
          inputTokens: params.usage?.inputTokens ?? null,
          outputTokens: params.usage?.outputTokens ?? null,
          costUsd: usd,
        } satisfies Prisma.InputJsonValue,
      },
    });

    return { creditsCharged: credits, allowanceBalance: nextAllowance, topupBalance: nextTopup };
  });
}

/**
 * Deducts a fixed credit amount not derived from token usage — e.g. a flat per-image
 * generation cost. Same allowance-first-then-topup transaction shape as `chargeUsage`,
 * just without the usage/pricing math since there's no token count to price here.
 */
export async function chargeFlatCredits(
  userId: string,
  credits: number,
  description: string,
): Promise<{ allowanceBalance: number; topupBalance: number }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { allowanceBalance: true, topupBalance: true },
    });

    const fromAllowance = Math.min(user.allowanceBalance, credits);
    const fromTopup = credits - fromAllowance;
    const nextAllowance = user.allowanceBalance - fromAllowance;
    const nextTopup = user.topupBalance - fromTopup;

    await tx.user.update({
      where: { id: userId },
      data: { allowanceBalance: nextAllowance, topupBalance: nextTopup },
    });

    await tx.creditLedgerEntry.create({
      data: {
        userId,
        type: CreditTransactionType.AI_USAGE,
        amount: -credits,
        balanceAfter: nextAllowance + nextTopup,
        description,
      },
    });

    return { allowanceBalance: nextAllowance, topupBalance: nextTopup };
  });
}

/**
 * Credits a completed Stripe top-up purchase. Idempotent: the `StripeEvent`
 * insert is a standalone claim performed *before* the transaction that
 * applies the balance change — a Postgres unique-violation aborts the whole
 * transaction it happens in, so idempotency can't be a try/catch inside the
 * same transaction as the mutation it's guarding.
 */
export async function grantTopup(
  userId: string,
  credits: number,
  stripeEventId: string,
  description: string,
): Promise<void> {
  try {
    await prisma.stripeEvent.create({ data: { id: stripeEventId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return; // already processed this Stripe event
    }
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { topupBalance: { increment: credits } },
      select: { allowanceBalance: true, topupBalance: true },
    });

    await tx.creditLedgerEntry.create({
      data: {
        userId,
        type: CreditTransactionType.TOPUP_PURCHASE,
        amount: credits,
        balanceAfter: user.allowanceBalance + user.topupBalance,
        description,
        stripeEventId,
      },
    });
  });
}
