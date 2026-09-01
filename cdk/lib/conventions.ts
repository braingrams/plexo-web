import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

// Every Lambda-backed construct in this app should pass `logGroup` built from this
// helper rather than let CDK create an unmanaged, unretained log group — unmanaged
// retention is the single easiest way a small serverless app blows past CloudWatch's
// free tier (see the migration roadmap's cost analysis). 30 days is enough for real
// debugging without the log group growing without bound.
export const DEFAULT_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

const isProd = (process.env.PLEXO_ENV || "development") === "production";

// `logRetention` on lambda.Function is deprecated (CDK flags it for removal in a future
// major version) in favor of passing an explicit `logGroup` — this is that log group,
// pre-wired with the retention above and a removal policy matching the rest of this
// migration's non-prod-is-disposable / prod-is-retained convention.
export function buildLogGroup(scope: Construct, id: string): logs.LogGroup {
  return new logs.LogGroup(scope, `${id}LogGroup`, {
    retention: DEFAULT_LOG_RETENTION,
    removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
  });
}
