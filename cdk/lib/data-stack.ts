import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";

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
  { id: "Core", tableName: "plexo-core" },
  { id: "Ledger", tableName: "plexo-ledger", pointInTimeRecovery: true, stream: true },
  // CommerceOrder needs a second real lookup beyond payment-reference (GSI1) — customer
  // order-tracking by orderNumber, a genuine access pattern proven out in
  // lib/db/commerceEntities.ts, not speculative. customerEmail search stays on the
  // Athena/export path from the roadmap (an occasional admin-support query, not a
  // latency-sensitive one) rather than spending a third GSI on it.
  { id: "Commerce", tableName: "plexo-commerce", secondGsi: true },
  { id: "Content", tableName: "plexo-content" },
  { id: "Ops", tableName: "plexo-ops", ttlAttribute: "ttl" },
  { id: "Import", tableName: "plexo-import", ttlAttribute: "ttl" },
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
  }
}
