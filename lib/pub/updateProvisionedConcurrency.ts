import { LambdaClient, PutProvisionedConcurrencyConfigCommand, DeleteProvisionedConcurrencyConfigCommand } from "@aws-sdk/client-lambda";
import { DeployedApp } from "@/lib/db/appEntities";

// The alias that all CloudFront traffic routes through (compute-stack.ts "ServerFnLiveAlias").
// PC is set on the alias, not on $LATEST, so only traffic arriving via this qualifier
// benefits from pre-warmed instances.
const ALIAS_NAME = "live";

async function countProvisionedApps(): Promise<number> {
  // Full scan with filter — acceptable because DeployedApp is one row per deployed site
  // (bounded by number of customers on PROVISIONED tier, not total request volume).
  // No GSI exists for hostingTier; a real-scale system would maintain an atomic counter,
  // but the scan is correct and cheap until PROVISIONED tier reaches hundreds of customers.
  const { data } = await DeployedApp.scan
    .where(({ hostingTier }, { eq }) => eq(hostingTier, "PROVISIONED"))
    .go({ pages: "all" });
  return data.length;
}

// Recalculates the target provisioned concurrency based on current PROVISIONED-tier app
// count and applies it to the "live" alias. Called from the PATCH /deploy endpoint
// whenever a customer changes their hosting tier.
//
// No-ops outside a real Lambda environment (no AWS_LAMBDA_FUNCTION_NAME / PLEXO_ACCOUNT_ID)
// so it's safe to call in local dev where those vars are absent.
export async function updateProvisionedConcurrency(): Promise<void> {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME || !process.env.PLEXO_ACCOUNT_ID) return;

  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  const count = await countProvisionedApps();
  const client = new LambdaClient({ region: process.env.AWS_REGION });

  if (count === 0) {
    // No PROVISIONED customers — remove PC so the function scales to zero normally.
    try {
      await client.send(
        new DeleteProvisionedConcurrencyConfigCommand({ FunctionName: functionName, Qualifier: ALIAS_NAME }),
      );
    } catch (err: unknown) {
      // ResourceNotFoundException = PC was never set. Fine — nothing to delete.
      if ((err as { name?: string }).name !== "ResourceNotFoundException") throw err;
    }
    return;
  }

  // 2 warm instances per PROVISIONED customer, floored at 5.
  // Each warm instance can serve one concurrent request; 2× headroom handles short bursts.
  const targetPc = Math.max(count * 2, 5);
  await client.send(
    new PutProvisionedConcurrencyConfigCommand({
      FunctionName: functionName,
      Qualifier: ALIAS_NAME,
      ProvisionedConcurrentExecutions: targetPc,
    }),
  );
}
