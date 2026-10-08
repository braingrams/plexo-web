/**
 * What the person sees when the AI provider fails — what happened and what to do, never
 * the SDK's own wording (the full error goes to the server log). Every provider SDK here
 * puts the HTTP status on `status`.
 */
export function friendlyProviderError(err: unknown): string {
  const e = err as { status?: number; name?: string; message?: string } | null;
  const status = typeof e?.status === "number" ? e.status : null;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  if (status === 401 || status === 403) return "The AI provider rejected this account's API key. Check the key in Settings → AI, then try again.";
  if (status === 429) return "The AI provider is rate-limiting this account right now. Wait a minute, then try again.";
  if (status === 529 || /overloaded/i.test(text)) return "The AI service is very busy right now. Try again in a minute.";
  if (status !== null && status >= 500) return "The AI service had a problem on its side. Try again in a minute.";
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network/i.test(text)) return "The AI service didn't respond in time. Try again.";
  if (status === 400 && /credit|billing|balance/i.test(text)) return "The AI provider account for this key is out of credit. Top it up, or use a different key in Settings → AI.";
  return "The AI service couldn't complete this request. Try again — and if it keeps happening, try a shorter description.";
}
