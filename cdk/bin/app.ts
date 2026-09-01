#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DataStack } from "../lib/data-stack";
import { ComputeStack } from "../lib/compute-stack";
import { AnalyticsStack } from "../lib/analytics-stack";

const app = new cdk.App();
cdk.Tags.of(app).add("appName", "plexo-web");
cdk.Tags.of(app).add("businessName", "plexo");

const stackID = process.env.STACK_ID || "pr-1-plexo";
// "data" deploys the persistent DynamoDB tables (production, staging — never per-PR).
// "compute" deploys the app-hosting layer (production, staging, and per-PR previews).
// "analytics" deploys the export/Athena admin-query path (production, staging only —
// no PR preview needs its own export pipeline).
const stackKind = process.env.STACK_KIND || "data";

const env = {
  account: process.env.AWS_ACCOUNT_ID,
  region: process.env.AWS_REGION,
};

if (stackKind === "data") {
  new DataStack(app, `${stackID}-data-stack`, { env });
} else if (stackKind === "compute") {
  new ComputeStack(app, `${stackID}-compute-stack`, { env });
} else if (stackKind === "analytics") {
  const isProd = (process.env.PLEXO_ENV || "development") === "production";
  const nameFor = (base: string): string => (isProd ? base : `${base}-${stackID}`);
  const arnFor = (base: string): string =>
    `arn:aws:dynamodb:${env.region}:${env.account}:table/${nameFor(base)}`;

  new AnalyticsStack(
    app,
    `${stackID}-analytics-stack`,
    {
      core: arnFor("plexo-core"),
      commerce: arnFor("plexo-commerce"),
      content: arnFor("plexo-content"),
    },
    { env },
  );
} else {
  throw new Error(`Unknown STACK_KIND "${stackKind}" — expected "data", "compute", or "analytics"`);
}
