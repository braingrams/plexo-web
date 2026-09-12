import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";

const isProd = (process.env.PLEXO_ENV || "development") === "production";
// Non-prod stacks (PR previews, dev) are torn down freely; production tables survive
// a stack deletion by default so a bad `cdk destroy` can't take real data with it.
const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

type TableSpec = {
  id: string;
  tableName: string;
  ttlAttribute?: string;
  pointInTimeRecovery?: boolean;
  stream?: boolean;
  secondGsi?: boolean;
};

// One table per bounded context (not one single-table for the whole app) — see the
// migration roadmap for why: a shared 20-GSI budget and one key schema across 61
// relational models is a maintainability trap for a team new to DynamoDB. Storage cost
// is identical either way since DynamoDB prices by GB, not by table count.
const TABLES: TableSpec[] = [
  // PITR on Core/Commerce/Content isn't just a nice-to-have here — it's a hard
  // requirement discovered by actually invoking the analytics-stack export Lambda
  // (cdk/lib/analytics-stack.ts), which failed with
  // PointInTimeRecoveryUnavailableException before this was added:
  // ExportTableToPointInTime requires PITR enabled on the source table. Also a real
  // backup benefit in its own right for genuine business data, not just export plumbing.
  // secondGsi: ApiKey's byHashedKey lookup — the app-code cutover's resolveUser (every
  // API-key-authenticated request across the public API surface) needs this indexed;
  // without it, that lookup would be a Scan across the whole table, exactly what
  // maildrip-server/CLAUDE.md's "Scan is a code smell — never use it" rule exists to
  // prevent, on a security-critical, called-on-every-request path.
  { id: "Core", tableName: "plexo-core", secondGsi: true, pointInTimeRecovery: true },
  { id: "Ledger", tableName: "plexo-ledger", pointInTimeRecovery: true, stream: true },
  // CommerceOrder needs a second real lookup beyond payment-reference (GSI1) — customer
  // order-tracking by orderNumber, a genuine access pattern proven out in
  // lib/db/commerceEntities.ts, not speculative. customerEmail search stays on the
  // Athena/export path from the roadmap (an occasional admin-support query, not a
  // latency-sensitive one) rather than spending a third GSI on it.
  { id: "Commerce", tableName: "plexo-commerce", secondGsi: true, pointInTimeRecovery: true },
  // Template needs two real lookups beyond its own id: org-wide dashboard listing
  // (GSI1) and parent/child page-tree traversal for multipage sites (GSI2) — both
  // genuine, not speculative.
  { id: "Content", tableName: "plexo-content", secondGsi: true, pointInTimeRecovery: true },
  { id: "Ops", tableName: "plexo-ops", ttlAttribute: "ttl" },
  { id: "Import", tableName: "plexo-import", ttlAttribute: "ttl" },
  // SOL (the AI agent chat feature) stores real user-authored content — conversation
  // transcripts, user-curated memory facts — the same retention bar as Core/Commerce/
  // Content above, not the TTL-only bar Ops/Import get for disposable data.
  { id: "Sol", tableName: "plexo-sol", pointInTimeRecovery: true },
];

export class DataStack extends cdk.Stack {
  public readonly tables: Record<string, dynamodb.Table> = {};

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Customer-managed key for plexo-ledger specifically — financial data (credit
    // ledger, seller payouts, webhook logs) warrants key rotation and account-scoped
    // access control beyond the AWS-owned default key the other five tables use.
    const stackID = process.env.STACK_ID || "pr-1-plexo";
    const nameFor = (base: string): string => (isProd ? base : `${base}-${stackID}`);

    const ledgerKey = new kms.Key(this, "LedgerEncryptionKey", {
      alias: nameFor("plexo-ledger"),
      enableKeyRotation: true,
      removalPolicy,
    });

    // Production keeps its already-deployed literal names ("plexo-core", etc.) —
    // changing TableName forces DynamoDB/CloudFormation to replace the table, which
    // would destroy live data. Every other environment (staging, PR previews) gets a
    // suffixed name so it can never collide with — or be confused for — production.
    for (const spec of TABLES) {
      const table = new dynamodb.Table(this, spec.id, {
        tableName: nameFor(spec.tableName),
        partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: spec.pointInTimeRecovery ? { pointInTimeRecoveryEnabled: true } : undefined,
        timeToLiveAttribute: spec.ttlAttribute,
        stream: spec.stream ? dynamodb.StreamViewType.NEW_AND_OLD_IMAGES : undefined,
        encryption: spec.tableName === "plexo-ledger" ? dynamodb.TableEncryption.CUSTOMER_MANAGED : undefined,
        encryptionKey: spec.tableName === "plexo-ledger" ? ledgerKey : undefined,
        removalPolicy,
      });

      // Starting secondary index for each table's first cross-cutting access pattern
      // (e.g. list-by-org, list-by-status). ElectroDB entities define what actually
      // lands in GSI1PK/GSI1SK; more GSIs get added per table as real access patterns
      // are implemented, tracked against the 20-per-table ceiling.
      table.addGlobalSecondaryIndex({
        indexName: "GSI1",
        partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      });

      if (spec.secondGsi) {
        table.addGlobalSecondaryIndex({
          indexName: "GSI2",
          partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
        });
      }

      this.tables[spec.id] = table;

      new cdk.CfnOutput(this, `${spec.id}TableName`, {
        value: table.tableName,
        exportName: `${id}-${spec.id}-TableName`,
      });
    }

    // Replaces Vercel Blob (lib/storage.ts) — user-uploaded template/blog/commerce assets.
    // Lives in the data stack, not a compute stack: uploaded files need to survive a
    // compute-stack teardown (PR preview cleanup, a staging redeploy) exactly like the
    // DynamoDB tables do, for the same reason. Two prefixes, one bucket: "public/" is
    // openly readable (site assets, blog images — meant to be served to any visitor of a
    // published site) via a scoped bucket policy; "private/" (digital-product downloads)
    // is never publicly readable, only reachable through a short-lived presigned GET URL
    // (lib/storage.ts's getSignedDownloadUrl) — same access model Vercel Blob's
    // access:"public"/"private" + issueSignedToken split provided.
    const userContentBucket = new s3.Bucket(this, "UserContentBucket", {
      bucketName: nameFor("plexo-user-content"),
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
      removalPolicy,
    });
    userContentBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "PublicReadForPublicPrefix",
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ["s3:GetObject"],
        resources: [userContentBucket.arnForObjects("public/*")],
      }),
    );

    // Matches compute-stack.ts's ssmEnv convention ("staging"/"production") — read by
    // lib/storage.ts at Lambda cold start alongside the other SSM-sourced config.
    new ssm.StringParameter(this, "UserContentBucketNameParam", {
      parameterName: `/plexo/${isProd ? "production" : "staging"}/USER_CONTENT_BUCKET_NAME`,
      stringValue: userContentBucket.bucketName,
    });

    new cdk.CfnOutput(this, "UserContentBucketName", { value: userContentBucket.bucketName });
  }
}
