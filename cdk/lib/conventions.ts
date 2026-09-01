import * as logs from "aws-cdk-lib/aws-logs";

// Every Lambda-backed construct in this app should pass `logGroup` built from this
// helper rather than let CDK create an unmanaged, unretained log group — unmanaged
// retention is the single easiest way a small serverless app blows past CloudWatch's
// free tier (see the migration roadmap's cost analysis). 30 days is enough for real
// debugging without the log group growing without bound.
export const DEFAULT_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
