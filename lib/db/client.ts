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
// lives in exactly one place, cdk/lib/data-stack.ts, and gets wired into each Lambda's
// environment at deploy time (see cdk/lib/compute-stack.ts's TODO for Phase 6). The
// production literal names are used as the fallback since that's what's actually live
// today, ahead of the compute stack existing to inject these properly.
export const TABLES = {
  core: process.env.PLEXO_CORE_TABLE || "plexo-core",
  ledger: process.env.PLEXO_LEDGER_TABLE || "plexo-ledger",
  commerce: process.env.PLEXO_COMMERCE_TABLE || "plexo-commerce",
  content: process.env.PLEXO_CONTENT_TABLE || "plexo-content",
  ops: process.env.PLEXO_OPS_TABLE || "plexo-ops",
  import: process.env.PLEXO_IMPORT_TABLE || "plexo-import",
} as const;
