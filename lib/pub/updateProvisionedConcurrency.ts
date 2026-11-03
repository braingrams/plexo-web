import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DeployedApp } from "@/lib/db/appEntities";

// The warm-copy count is set by the separate PcScalerFn (compute-stack.ts), which is the only
// function allowed to change it. This module only decides the number and asks that function to
// apply it. The alias it targets is "live" (the qualifier all CloudFront traffic uses).

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
  const scaler = process.env.PC_SCALER_FUNCTION_NAME;
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME || !scaler) return;

  const count = await countProvisionedApps();
  // No PROVISIONED customers: 0 removes warm copies. Otherwise exactly one warm copy for the
  // whole platform. Deliberately small: one copy serves one request at a time, so bursts can
  // still cold-start. Raise this when real traffic shows it's needed.
  const desired = count === 0 ? 0 : 1;

  const client = new LambdaClient({ region: process.env.AWS_REGION });
  const res = await client.send(
    new InvokeCommand({ FunctionName: scaler, Payload: JSON.stringify({ provisionedConcurrency: desired }) }),
  );
  const body = JSON.parse(Buffer.from(res.Payload ?? new Uint8Array()).toString("utf8") || "{}");
  if (res.FunctionError || !body.ok) {
    throw new Error(`Setting provisioned concurrency failed: ${body.error ?? res.FunctionError ?? "unknown error"}`);
  }
}
