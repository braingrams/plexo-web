import { prisma } from "@/server/prisma";

// Vercel's loop protection can reject a function calling itself with a 508 once it looks
// like a runaway self-referential chain — observed on this exact self-continuation
// pattern after a handful of hops. Spacing hops out is an attempt to look less like a
// tight loop to whatever heuristic is doing that detection; it's unverified whether this
// actually avoids the 508 (if the detector counts hops rather than elapsed time, this
// delay won't help) — kept small so it doesn't risk the function's own execution budget.
const CHAIN_DELAY_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fires the next batch of an already-started import job as a fire-and-forget HTTP
 * self-call — meant to be invoked from inside next/server's after(), after the response
 * for the current batch has already gone out. Any failure to continue (missing
 * CRON_SECRET, network error, non-2xx response) used to be silently swallowed on the
 * assumption the once-a-day stalled-job cron would eventually notice; instead it's now
 * recorded on the job's error log, so a broken chain shows up as a visible error (plus a
 * stale heartbeat in the UI) rather than just looking frozen with no explanation.
 */
export async function continueImportChain(jobId: string): Promise<void> {
  await sleep(CHAIN_DELAY_MS);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    await recordChainError(jobId, "Couldn't continue the import automatically: CRON_SECRET isn't configured. Click Retry now to continue.");
    return;
  }
  try {
    const res = await fetch(`${base}/api/internal/blog-import/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
      body: JSON.stringify({ jobId }),
    });
    if (!res.ok) {
      await recordChainError(jobId, `Couldn't continue the import automatically (self-trigger returned ${res.status}). It won't resume until the next automatic check-in — click Retry now to continue immediately.`);
    }
  } catch (err) {
    await recordChainError(
      jobId,
      `Couldn't continue the import automatically: ${err instanceof Error ? err.message : String(err)}. It won't resume until the next automatic check-in — click Retry now to continue immediately.`,
    );
  }
}

async function recordChainError(jobId: string, message: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId }, select: { errors: true } });
  if (!job) return;
  const errors = Array.isArray(job.errors) ? (job.errors as string[]) : [];
  errors.push(message);
  await prisma.importJob.update({ where: { id: jobId }, data: { errors } });
}
