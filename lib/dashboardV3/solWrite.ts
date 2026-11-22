/** Plain-words helpers for SOL's "write it for me" drawers. Pure. */

/** What a generation cost, from the balance before and after. null when either is unknown or nothing was spent. */
export function creditsSpent(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  const spent = Math.round(before - after);
  return spent > 0 ? spent : null;
}

/** "about 320 words" from the characters written so far (progress frames report characters). */
export function wordsSoFar(characters: number): string {
  const words = Math.max(0, Math.round(characters / 5 / 10) * 10);
  return words < 10 ? "just getting started" : `about ${words.toLocaleString("en-US")} words so far`;
}

export type CostCheck = { paidBy: "plexo" | "own-key" | "host"; enough: boolean; estimatedCredits: number | null; balance: number | null } | null;

/** The line above the prompt: what this will cost and what's left, or that it's free (their own key / included). */
export function costNote(check: CostCheck, balance: number | null): string {
  const n = (v: number) => v.toLocaleString("en-US");
  if (check?.paidBy === "own-key") return "This uses your own AI key, so it doesn't use any Plexo credits.";
  if (check?.paidBy === "host") return "This is included with your account.";
  const left = check?.balance ?? balance;
  const est = check?.estimatedCredits ?? null;
  if (est !== null && left !== null) return `About ${n(est)} credits. You have ${n(left)} left.`;
  if (est !== null) return `About ${n(est)} credits.`;
  if (left !== null) return `Uses AI credits. You have ${n(left)} left.`;
  return "Uses AI credits.";
}
