#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DataStack } from "../lib/data-stack";
import { ComputeStack } from "../lib/compute-stack";

const app = new cdk.App();
cdk.Tags.of(app).add("appName", "plexo-web");
cdk.Tags.of(app).add("businessName", "plexo");

const stackID = process.env.STACK_ID || "pr-1-plexo";
// "data" deploys the persistent DynamoDB tables (production, staging — never per-PR).
// "compute" deploys the app-hosting layer (production, staging, and per-PR previews).
// Kept as separate stacks/kinds deliberately: a PR workflow only ever needs to
// target `compute`, so there's no code path by which it could reach the data stack.
const stackKind = process.env.STACK_KIND || "data";

const env = {
  account: process.env.AWS_ACCOUNT_ID,
  region: process.env.AWS_REGION,
};

if (stackKind === "data") {
  new DataStack(app, `${stackID}-data-stack`, { env });
} else if (stackKind === "compute") {
  new ComputeStack(app, `${stackID}-compute-stack`, { env });
} else {
  throw new Error(`Unknown STACK_KIND "${stackKind}" — expected "data" or "compute"`);
}
