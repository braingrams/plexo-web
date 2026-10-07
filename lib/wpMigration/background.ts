// Keeps a migration moving with no dashboard open. Each background invocation runs steps
// for under a minute (the server's limit), then hands the job to a fresh invocation — on
// AWS a self-call is just another request (the chain-avoidance in the older importers was
// for Vercel's loop protection). The stalled-job cron restarts any chain that breaks.

/** A runaway guard, far past what even a very large site needs (~1–2 steps per hop). */
export const MAX_BACKGROUND_HOPS = 2000;

/**
 * Starts the next background invocation. Waits only until it's under way: the invocation
 * carries on after this request lets go (a server function isn't cancelled by its caller
 * disconnecting).
 */
export async function continueInBackground(templateId: string, jobId: string, hop = 0): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await fetch(`${base}/api/internal/wp-migration/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
    body: JSON.stringify({ jobId, templateId, hop }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {
    // timing out here is the normal hand-off; a real failure is picked up by the cron
  });
}
