/** Plain-words rules for the "Your money" screen, shared by the hub and the old wallet page. */

export type WithdrawalInput = { amount: string; bankName: string; accountNumber: string; accountHolderName: string };

/** The request to send, or one plain sentence saying what to fix. `balanceCents` stops asking for more than is there. */
export function checkWithdrawal(i: WithdrawalInput, balanceCents: number, currency: string): { amountCents: number; bankName: string; accountNumber: string; accountHolderName: string } | string {
  const amountCents = Math.round(Number(i.amount.replace(/,/g, "")) * 100);
  if (!i.amount.trim() || !Number.isFinite(amountCents) || amountCents <= 0) return "How much would you like to take out? Type an amount, like 5000.";
  if (amountCents > balanceCents) return `That's more than you have. You can take out up to ${(balanceCents / 100).toLocaleString("en")} ${currency}.`;
  if (!i.bankName.trim() || !i.accountNumber.trim() || !i.accountHolderName.trim()) return "Fill in your bank, your account number and the name on the account, so we know where to send it.";
  return { amountCents, bankName: i.bankName.trim(), accountNumber: i.accountNumber.trim(), accountHolderName: i.accountHolderName.trim() };
}

export const LEDGER_WORDS: Record<string, string> = {
  SALE_CREDIT: "A sale",
  WITHDRAWAL_DEBIT: "Money taken out",
  WITHDRAWAL_REVERSAL: "Money returned to you",
  DOMAIN_PURCHASE_DEBIT: "Web address bought",
  DOMAIN_REFUND_CREDIT: "Web address refunded",
  DOMAIN_RENEWAL_DEBIT: "Web address renewed",
};

export function withdrawalWords(status: string): { text: string; tone: "warning" | "success" | "danger" } {
  if (status === "PROCESSED") return { text: "Sent to your bank", tone: "success" };
  if (status === "REJECTED") return { text: "Not sent", tone: "danger" };
  return { text: "Being checked", tone: "warning" };
}

/** Which of the three states the screen is in, so each gets its own plain explanation. */
export function moneyState(i: { showWallet: boolean; commerceEnabled: boolean }): "off" | "own-keys" | "wallet" {
  if (i.showWallet) return "wallet";
  return i.commerceEnabled ? "own-keys" : "off";
}

type W = { amountCents: number; status: string; processedAt?: string | null; requestedAt: string };

/**
 * The three numbers an owner wants about their money: what they can take out now, what is waiting to be checked
 * (already set aside from the balance), and what has reached their bank. `takeAll` is the amount for "take it all".
 */
export function moneySummary(balanceCents: number, withdrawals: W[]) {
  const pending = withdrawals.filter((w) => w.status === "PENDING");
  const sent = withdrawals.filter((w) => w.status === "PROCESSED");
  const lastSent = sent.map((w) => w.processedAt ?? w.requestedAt).sort().at(-1) ?? null;
  return {
    availableCents: Math.max(0, balanceCents),
    pendingCents: pending.reduce((s, w) => s + w.amountCents, 0),
    pendingCount: pending.length,
    sentCents: sent.reduce((s, w) => s + w.amountCents, 0),
    lastSentAt: lastSent,
    takeAllCents: Math.max(0, balanceCents),
  };
}

/** One plain sentence about when a request will be dealt with. */
export function timingWords(status: string): string {
  if (status === "PROCESSED") return "It has been sent to your bank. Banks can take another day to show it.";
  if (status === "REJECTED") return "We couldn't send this one. The money is back in your balance.";
  return "A person at Plexo checks each request by hand, so it can take a few business days. You'll see it here when it's sent.";
}
