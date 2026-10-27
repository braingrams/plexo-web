import { SolMessage } from "@/lib/db/solEntities";

/** Sums the usage of every SolMessage persisted in this conversation at or after `sinceIso` —
 * used to recover "how much was actually consumed" when InsufficientCreditsError aborts a
 * turn mid-loop. solAgent.ts's continueLoop persists each assistant message (with its real
 * `usage`) BEFORE the next iteration's budgetGuard check can throw, but the thrown error
 * itself carries no usage payload — so the persisted rows are the only source of truth for
 * what to actually charge for. */
export async function sumUsageSince(conversationId: string, sinceIso: string): Promise<{ inputTokens: number; outputTokens: number }> {
  // Every message of the turn, however long: an app-building turn saves 80+ (one AI message
  // and one tool-results message per round) — reading only the latest 20 under-charged it.
  const { data: messages } = await SolMessage.query.primary({ conversationId }).gte({ createdAt: sinceIso }).go({ pages: "all" });
  let inputTokens = 0;
  let outputTokens = 0;
  for (const message of messages) {
    if (message.createdAt < sinceIso) continue;
    if (message.role === "assistant" && message.usage) {
      inputTokens += message.usage.inputTokens ?? 0;
      outputTokens += message.usage.outputTokens ?? 0;
    }
  }
  return { inputTokens, outputTokens };
}
