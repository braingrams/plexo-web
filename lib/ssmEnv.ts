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
  "AUTH_SECRET",
  // Bearer-token auth for internal/cron-style routes (app/api/internal/*) — verified
  // against the same value the CDK-managed EventBridge API Destination sends (see
  // cdk/lib/published-sites-stack.ts's own comment), not read from a request header the
  // way GOOGLE_CLIENT_ID etc. below are.
  "CRON_SECRET",
  // Server-side only — checked against every Charisol/Cognito ID token's signature by
  // server/authDynamo.ts's charisolVerifier. Not a NEXT_PUBLIC_ var (unlike the client ID
  // it pairs with, which the browser needs and is instead baked in at build time — see
  // deploy-production.yml/deploy-staging.yml's "Build the app" step) since only the server
  // ever needs it.
  "CHARISOL_USER_POOL_ID",
  "AI_KEY_ENCRYPTION_SECRET",
  "PAYSTACK_KEY_ENCRYPTION_SECRET",
  "COMMERCE_DIGITAL_ACCESS_ENCRYPTION_SECRET",
  // Missing from this list until now — encryptBankDetail/decryptBankDetail (lib/crypto.ts)
  // call requireEnv("BANK_DETAILS_ENCRYPTION_SECRET") unconditionally, so every withdrawal
  // request (marketplace and Commerce wallet) was throwing "not configured" in production,
  // not just failing to decrypt.
  "BANK_DETAILS_ENCRYPTION_SECRET",
  "MAILDRIP_KEY_ENCRYPTION_SECRET",
  "MAILDRIP_API_URL",
  "MAILDRIP_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  // Plexo's platform-hosted Commerce Stripe account (app/api/webhooks/stripe/commerce,
  // lib/commerce/stripeClient.ts) — a separate account/key concept from STRIPE_SECRET_KEY
  // above by design (keeps marketplace seller charges out of the platform billing ledger),
  // though the two CAN point at the same underlying Stripe account if that's how it's
  // configured in SSM; the code doesn't assume either way.
  "PLATFORM_COMMERCE_STRIPE_SECRET_KEY",
  // Not a secret by Stripe's own design (this is the key meant to be public/embeddable) —
  // still loaded via this same SSM mechanism rather than baked in at build time, because
  // lib/commerce/stripe.ts reads it SERVER-SIDE at runtime (handed back to the client per
  // request via an API response, not inlined into the JS bundle) — unlike
  // NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (Plexo's own platform billing key), which the
  // browser needs directly and is baked in at build time instead (see
  // deploy-production.yml/deploy-staging.yml's "Build the app" step).
  "PLATFORM_COMMERCE_STRIPE_PUBLISHABLE_KEY",
  "PLATFORM_COMMERCE_STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_ULTRA",
  "STRIPE_PRICE_TOPUP_SMALL",
  "STRIPE_PRICE_TOPUP_MEDIUM",
  "STRIPE_PRICE_TOPUP_LARGE",
  // A recurring per-slot add-on subscription, separate from the plan prices above — see
  // lib/lms/funnelSlots.ts and app/api/billing/checkout/route.ts's "funnel_addon_slot" kind.
  "STRIPE_PRICE_LMS_ADDON_SLOT",
  "SYSTEM_AI_KEY_ANTHROPIC_CLAUDE",
  "SYSTEM_AI_KEY_OPENAI",
  "SYSTEM_AI_KEY_GOOGLE_GEMINI",
  "PUSHER_APP_ID",
  "PUSHER_KEY",
  "PUSHER_SECRET",
  "PUSHER_CLUSTER",
  "BROWSERBASE_API_KEY",
  // Not a secret (a bucket name), but published to the same /plexo/<env>/* SSM path by
  // cdk/lib/data-stack.ts and read through this same loader rather than inventing a
  // second config-loading mechanism for one value.
  "USER_CONTENT_BUCKET_NAME",
  // Not secrets either — cdk/lib/published-sites-stack.ts's own IDs for THIS environment
  // (staging vs production each get their own distribution + connection group). Can't be
  // injected via compute-stack.ts's Lambda environment the way PLEXO_*_TABLE is: the
  // published-sites stack is deployed AFTER compute (it imports compute's Lambda ARNs
  // cross-stack), so its own IDs aren't known yet at compute's deploy time. Set manually
  // in SSM once published-sites-stack finishes deploying for each environment — see
  // lib/cloudfrontDomains.ts, the only reader.
  "PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID",
  "PLEXO_PUBLISHED_SITES_CONNECTION_GROUP_ID",
  // The connection group's own routing endpoint (e.g. "d111111abcdef8.cloudfront.net") —
  // stored directly rather than fetched via GetConnectionGroupCommand on every domains
  // page load; it's a stable value that doesn't change across published-sites-stack.ts
  // redeploys, same reasoning as every other value in this list.
  "PLEXO_PUBLISHED_SITES_ROUTING_ENDPOINT",
  // The connection group's own literal CloudFront hostname (e.g.
  // "d111111abcdef8.cloudfront.net") — kept separate from
  // PLEXO_PUBLISHED_SITES_ROUTING_ENDPOINT above, which may be a friendlier branded CNAME
  // (e.g. "cname.plexopages.com") pointing AT this value. A customer's DNS-pointing CNAME
  // can use either, but the "_cf-challenge" TXT record AWS requires for apex/root custom
  // domains (see lib/cloudfrontDomains.ts's own comment) is checked as a literal string
  // against the real connection group hostname, not resolved through any CNAME chain — the
  // friendly alias would never match.
  "PLEXO_PUBLISHED_SITES_ROUTING_ENDPOINT_RAW",
  // Checked first thing in middleware.ts against every request's x-origin-verify header —
  // see cdk/lib/compute-stack.ts's own comment on originVerifySecret for why the server
  // function's Lambda Function URL is public instead of OAC-protected.
  "PLEXO_ORIGIN_VERIFY_SECRET",
  // Signs/verifies the Funnel/LMS module's learner session cookie (lib/lms/session.ts) —
  // a stateless JWT, not a DB-backed session, so this secret alone is what lets a learner
  // stay signed in across visits.
  "LMS_SESSION_SECRET",
] as const;

// GetParameters caps at 10 names per call.
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}

export async function loadSecretsFromSsm(): Promise<void> {
  // Local dev short-circuits here — no AWS credentials required, no SSM call made.
  // PLEXO_ENV (not AUTH_SECRET) is the signal: it's set directly as a literal Lambda
  // environment variable by cdk/lib/compute-stack.ts for every real deployment, and never
  // set locally. Checking AUTH_SECRET instead was the original approach and is WRONG —
  // confirmed by direct testing that it silently broke this function in every deployed
  // environment: Next.js's `output: "standalone"` build (required by OpenNext) always
  // copies the repo's own root .env file into the deployed Lambda bundle, and Next.js's
  // generated server bootstrap loads it before this function ever runs. Since local .env
  // always has AUTH_SECRET set (for local dev), that made this short-circuit true on
  // every cold start in every real environment too, meaning this function — and every
  // secret it's responsible for (GOOGLE_CLIENT_ID/SECRET, STRIPE_*, MAILDRIP_*, PUSHER_*,
  // every encryption key, CRON_SECRET) — silently never ran at all; the app was actually
  // running on whatever happened to be in .env at each deploy's build time instead.
  if (!process.env.PLEXO_ENV) return;

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
