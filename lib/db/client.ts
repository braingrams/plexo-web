import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// DynamoDBDocument (not the separate DynamoDBDocumentClient wrapper) — this is the type
// @auth/dynamodb-adapter specifically requires (see server/authDynamo.ts), and it works
// equally well for ElectroDB and the raw TransactWriteCommand calls in
// lib/db/ledgerOperations.ts, so one shared client instance covers all three.
const ddb = new DynamoDB({ region: process.env.AWS_REGION || "us-east-1" });

export const docClient = DynamoDBDocument.from(ddb, {
  marshallOptions: { removeUndefinedValues: true },
});

// Table names come from the environment rather than being recomputed here from the CDK
// naming convention (base name, or `${base}-${stackID}` for non-prod) — that convention
// lives in exactly one place, cdk/lib/data-stack.ts, and gets wired into every deployed
// Lambda's real environment at deploy time (cdk/lib/compute-stack.ts's `tableEnv`, spread
// into ServerFn's `environment` block) — staging, production, and every PR preview alike,
// unconditionally. So these seven vars are ALWAYS set in a real deployed environment; the
// only place they can be missing is a local `next dev` that hasn't configured them.
//
// This used to silently fall back to the bare PRODUCTION table names
// ("plexo-core", not "plexo-core-staging-plexo") when unset — meaning a developer running
// `next dev` locally with real AWS credentials active (e.g. an SSO profile used for other
// work) and no PLEXO_*_TABLE vars set would connect straight to production DynamoDB,
// silently, with zero warning. Failing loudly instead: better a clear error explaining
// exactly what to set than a local dev server quietly reading/writing real customer data.
// Guarded on NEXT_PHASE so this can never break `next build`/`open-next build` — Next.js
// sets that env var only during the build step (never in `next dev` or the deployed
// Lambda's real runtime), and these vars genuinely aren't needed then: they're read from
// process.env at request time inside the Lambda, never inlined at build time the way a
// NEXT_PUBLIC_* var would be.
const REQUIRED_TABLE_ENV_VARS = [
  "PLEXO_CORE_TABLE",
  "PLEXO_LEDGER_TABLE",
  "PLEXO_COMMERCE_TABLE",
  "PLEXO_CONTENT_TABLE",
  "PLEXO_OPS_TABLE",
  "PLEXO_IMPORT_TABLE",
  "PLEXO_SOL_TABLE",
] as const;

if (process.env.NEXT_PHASE !== "phase-production-build") {
  const missing = REQUIRED_TABLE_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required DynamoDB table env var(s): ${missing.join(", ")}. A real deployed ` +
        `Lambda always has these injected (cdk/lib/compute-stack.ts's tableEnv) — this only ` +
        `happens in local dev. Set them in .env.local, pointed at staging's real tables ` +
        `(e.g. PLEXO_CORE_TABLE=plexo-core-staging-plexo) — see the README's local setup ` +
        `section. Never point local dev at the bare production table names.`,
    );
  }
}

export const TABLES = {
  core: process.env.PLEXO_CORE_TABLE!,
  ledger: process.env.PLEXO_LEDGER_TABLE!,
  commerce: process.env.PLEXO_COMMERCE_TABLE!,
  content: process.env.PLEXO_CONTENT_TABLE!,
  ops: process.env.PLEXO_OPS_TABLE!,
  import: process.env.PLEXO_IMPORT_TABLE!,
  sol: process.env.PLEXO_SOL_TABLE!,
} as const;
