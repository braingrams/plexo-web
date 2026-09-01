// Runs once per server instance, guaranteed to complete before any request is served
// (Next.js's own contract for this file — verified against Next.js's instrumentation
// docs and confirmed empirically: register() must resolve before the server starts
// handling traffic). This is what makes lib/ssmEnv.ts's process.env backfill safe for
// every existing eager `process.env.X` read elsewhere in the app, in Lambda deployments
// where the CDK compute stack can't inject these via the Environment.Variables block
// (SSM SecureString dynamic references aren't supported there — see ssmEnv.ts's header).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadSecretsFromSsm } = await import("@/lib/ssmEnv");
  await loadSecretsFromSsm();
}
