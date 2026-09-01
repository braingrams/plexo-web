import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

// Populates process.env from SSM at Lambda cold start (see instrumentation.ts) — the
// replacement for the approach originally tried in cdk/lib/compute-stack.ts (baking each
// secret into the Lambda's Environment.Variables via a CloudFormation ssm-secure dynamic
// reference). That approach failed a REAL `cdk deploy` with:
//   "SSM Secure reference is not supported in: AWS::Lambda::Function/.../Environment/Variables"
// — a hard CloudFormation restriction, not a permissions issue, confirmed by actually
// deploying rather than trusting `cdk synth`. This is the same lazy-load-at-cold-start
// pattern maildrip-server/utils/dotenv.js uses for exactly this reason, just triggered by
// Next.js's instrumentation hook instead of an explicit await at the top of a handler —
// register() is guaranteed by Next.js to run once per server instance and complete before
// any request is served, so every existing eager `process.env.X` read in this app (the
// thing maildrip's approach has to painstakingly audit call-by-call for) stays safe without
// auditing every one of the 200+ files that read these vars.
const APP_SECRET_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "BETTER_AUTH_SECRET",
  "AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AI_KEY_ENCRYPTION_SECRET",
  "PAYSTACK_KEY_ENCRYPTION_SECRET",
  "COMMERCE_DIGITAL_ACCESS_ENCRYPTION_SECRET",
  "MAILDRIP_KEY_ENCRYPTION_SECRET",
  "MAILDRIP_API_URL",
  "MAILDRIP_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_ULTRA",
  "STRIPE_PRICE_TOPUP_SMALL",
  "STRIPE_PRICE_TOPUP_MEDIUM",
  "STRIPE_PRICE_TOPUP_LARGE",
  "SYSTEM_AI_KEY_ANTHROPIC_CLAUDE",
  "SYSTEM_AI_KEY_OPENAI",
  "SYSTEM_AI_KEY_GOOGLE_GEMINI",
  "PUSHER_APP_ID",
  "PUSHER_KEY",
  "PUSHER_SECRET",
  "PUSHER_CLUSTER",
  "BROWSERBASE_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_WEBHOOK_PUBLIC_KEY",
] as const;

// GetParameters caps at 10 names per call.
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}

export async function loadSecretsFromSsm(): Promise<void> {
  // Local dev (and any environment that already has these via .env/dotenv) short-circuits
  // here — no AWS credentials required, no SSM call made. DATABASE_URL is required in
  // every real environment, so its presence is a reliable "already configured" signal.
  if (process.env.DATABASE_URL) return;

  const ssmEnv = process.env.PLEXO_ENV === "production" ? "production" : "staging";
  const client = new SSMClient({});

  for (const names of chunk(APP_SECRET_KEYS, 10)) {
    const command = new GetParametersCommand({
      Names: names.map((key) => `/plexo/${ssmEnv}/${key}`),
      WithDecryption: true,
    });
    const result = await client.send(command);
    for (const param of result.Parameters ?? []) {
      const key = param.Name?.split("/").pop();
      if (key && param.Value !== undefined) process.env[key] = param.Value;
    }
    if (result.InvalidParameters?.length) {
      console.warn(`[ssmEnv] Missing SSM parameters (left unset): ${result.InvalidParameters.join(", ")}`);
    }
  }
}
