// Keeps a migration moving with no dashboard open. Each background invocation runs steps
// for under a minute (the server's limit), then hands the job to a fresh invocation — on
// AWS a self-call is just another request (the chain-avoidance in the older importers was
// for Vercel's loop protection). The stalled-job cron restarts any chain that breaks.

/** A runaway guard, far past what even a very large site needs (~1–2 steps per hop). */
export const MAX_BACKGROUND_HOPS = 2000;

/**
 * Starts the next background invocation. Waits until the request has certainly reached
 * the server (a cold start can take a few seconds — letting go sooner can mean it never
 * starts), but not for the invocation's own minute of work: it carries on after this
 * request lets go (a server function isn't cancelled by its caller disconnecting).
 */
export async function continueInBackground(templateId: string, jobId: string, hop = 0): Promise<void> {
  // This deployment's own address (a PR preview must hand off to itself, not to staging).
  const base = process.env.PLEXO_SELF_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${base}/api/internal/wp-migration/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
      body: JSON.stringify({ jobId, templateId, hop }),
      signal: AbortSignal.timeout(HANDOFF_WAIT_MS),
    });
    // Only a step finishing inside the wait gets here — or a refusal, which is worth knowing.
    if (!res.ok) console.error(`[wp-migration] background hand-off refused (${res.status}) for job ${jobId}, hop ${hop}`);
  } catch (err) {
    if ((err as Error)?.name !== "TimeoutError") console.error(`[wp-migration] background hand-off failed for job ${jobId}, hop ${hop}`, err);
    // TimeoutError is the normal case: the next invocation is under way. Anything else is
    // picked up by the stalled-job cron.
  }
}

/** Long enough for the request to land even on a cold start; short enough to leave room in the caller's minute. */
export const HANDOFF_WAIT_MS = 10_000;
