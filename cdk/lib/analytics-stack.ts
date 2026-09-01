import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as athena from "aws-cdk-lib/aws-athena";
import * as glue from "aws-cdk-lib/aws-glue";
import { DEFAULT_LOG_RETENTION } from "./conventions";

// The Athena/export escape hatch the migration roadmap designed for ad hoc admin
// queries — plexo-admin's dashboards (organizations, users, withdrawals, marketplace,
// analytics) are the real consumer, not a hypothetical. Deliberately NOT a live
// second database: a monthly DynamoDB point-in-time export to S3, queried with Athena
// on demand. No OpenSearch, no standing compute beyond one small monthly Lambda —
// verified in the original cost analysis to keep this in the ~$12-15/yr range.
const isProd = (process.env.PLEXO_ENV || "development") === "production";
const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
const stackID = process.env.STACK_ID || "pr-1-plexo";

// Tables plexo-admin's dashboards actually need to query ad hoc — not every table.
// plexo-ledger is deliberately excluded: financial data goes through its own audit
// path (PITR), not the general-purpose export bucket.
const EXPORTABLE_TABLES = ["core", "commerce", "content"] as const;

export class AnalyticsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, tableArns: Record<(typeof EXPORTABLE_TABLES)[number], string>, props?: cdk.StackProps) {
    super(scope, id, props);

    const exportBucket = new s3.Bucket(this, "ExportBucket", {
      bucketName: `plexo-analytics-exports-${stackID}`.toLowerCase(),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        // Exports are point-in-time snapshots superseded by the next month's — no need
        // to keep more than a year of history for ad hoc admin queries.
        { expiration: cdk.Duration.days(365) },
      ],
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    const exportRole = new iam.Role(this, "ExportLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
    });
    exportRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:ExportTableToPointInTime"],
        resources: Object.values(tableArns),
      }),
    );
    exportBucket.grantWrite(exportRole);

    const exportFn = new lambda.Function(this, "MonthlyExportFn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      role: exportRole,
      timeout: cdk.Duration.minutes(5),
      logRetention: DEFAULT_LOG_RETENTION,
      environment: {
        EXPORT_BUCKET: exportBucket.bucketName,
        TABLE_ARNS: JSON.stringify(tableArns),
      },
      // Inline: this is a small, self-contained trigger (kick off N export jobs, don't
      // wait for them — DynamoDB exports run asynchronously and can take minutes to
      // hours), not worth a full build pipeline of its own.
      code: lambda.Code.fromInline(`
        const { DynamoDBClient, ExportTableToPointInTimeCommand } = require("@aws-sdk/client-dynamodb");
        const client = new DynamoDBClient({});
        exports.handler = async () => {
          const tableArns = JSON.parse(process.env.TABLE_ARNS);
          const bucket = process.env.EXPORT_BUCKET;
          const results = [];
          for (const [name, arn] of Object.entries(tableArns)) {
            const res = await client.send(new ExportTableToPointInTimeCommand({
              TableArn: arn,
              S3Bucket: bucket,
              S3Prefix: name,
              ExportFormat: "DYNAMODB_JSON",
            }));
            results.push({ table: name, exportArn: res.ExportDescription?.ExportArn });
          }
          console.log(JSON.stringify(results));
          return results;
        };
      `),
    });

    new events.Rule(this, "MonthlyExportSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.days(30)),
      targets: [new targets.LambdaFunction(exportFn)],
    });

    const athenaResultsBucket = new s3.Bucket(this, "AthenaResultsBucket", {
      bucketName: `plexo-athena-results-${stackID}`.toLowerCase(),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }], // query results are disposable
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    new athena.CfnWorkGroup(this, "AdminQueryWorkgroup", {
      name: `plexo-admin-${stackID}`,
      workGroupConfiguration: {
        resultConfiguration: { outputLocation: `s3://${athenaResultsBucket.bucketName}/` },
        // Sanity ceiling, not a real limit at this data volume — the original cost
        // analysis put realistic Athena usage at $2-5/yr; this just guards against a
        // runaway unpartitioned query.
        bytesScannedCutoffPerQuery: 10 * 1024 * 1024 * 1024, // 10GB
      },
    });

    new glue.CfnDatabase(this, "AdminQueryDatabase", {
      catalogId: this.account,
      databaseInput: { name: `plexo_admin_${stackID.replace(/-/g, "_")}` },
    });

    new cdk.CfnOutput(this, "ExportBucketName", { value: exportBucket.bucketName });
    new cdk.CfnOutput(this, "AthenaResultsBucketName", { value: athenaResultsBucket.bucketName });
  }
}
