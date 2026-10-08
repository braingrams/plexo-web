// What the person sees when an AI request doesn't come back with a usable answer — shared
// by every dashboard screen that calls /api/v1/ai/generate, so they all explain it the
// same way. The server's own error (already plain words) wins whenever there is one.

export const AI_UNREACHABLE = "We couldn't reach Plexo to run the AI. Check your connection and try again.";

export function aiErrorMessage(status: number, body: { error?: unknown } | null | undefined, fallback = "The AI couldn't finish this. Try again."): string {
  if (body && typeof body.error === "string" && body.error.trim()) return body.error;
  if (status === 504 || status === 502 || status === 503) {
    return "This took longer than we can wait for the AI. Try again — a shorter request, or the faster quality option, usually finishes in time.";
  }
  if (status === 402) return "You're out of AI credits — top up, or add your own API key in Settings.";
  return fallback;
}
