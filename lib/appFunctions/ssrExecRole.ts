import { createHash } from "node:crypto";
import {
  IAMClient,
  GetRoleCommand,
  CreateRoleCommand,
  AttachRolePolicyCommand,
  PutRolePolicyCommand,
  NoSuchEntityException,
  EntityAlreadyExistsException,
} from "@aws-sdk/client-iam";
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, ResourceNotFoundException } from "@aws-sdk/client-dynamodb";
import { projectBucket, projectPrefix } from "@/lib/projects/blobStore";

// Each server app runs under its own role, so a customer's code can reach only its own page cache.
// The shared role used before could reach every app's cache. Roles are created by BuildFinalizeFn
// (the only role that may), and each one is capped by a permissions boundary (cdk/lib/project-runtime.ts)
// that allows logging and the cache prefixes only.

const REGION = process.env.AWS_REGION || "us-east-1";
const BASIC_LOGGING = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

let iam: IAMClient | null = null;
function client(): IAMClient {
  iam ??= new IAMClient({ region: REGION });
  return iam;
}
let dynamo: DynamoDBClient | null = null;
function dynamoClient(): DynamoDBClient {
  dynamo ??= new DynamoDBClient({ region: REGION });
  return dynamo;
}

/** The app's table for OpenNext's cache tags: one table per app, so an app's role reaches only its own. */
export function ssrTagTableName(templateId: string): string {
  return `plexo-ssr-tags-${createHash("sha256").update(templateId).digest("hex").slice(0, 24)}`;
}

/** Roles are account-wide, so the name is derived from the app's id (hashed to fit IAM's 64-character limit). */
export function ssrExecRoleName(templateId: string): string {
  return `plexo-ssr-exec-${createHash("sha256").update(templateId).digest("hex").slice(0, 24)}`;
}

/** Where an app's page cache lives in the project bucket. The app's role may read and write only here. */
export function ssrCachePrefix(templateId: string): string {
  return `${projectPrefix(templateId)}/ssr/cache`;
}

/** The app's role ARN, creating the role (and its cache policy) the first time. */
export async function ensureSsrExecRole(templateId: string): Promise<string> {
  const name = ssrExecRoleName(templateId);
  const existing = await readRole(name);
  if (existing) {
    await putCachePolicy(templateId, name, existing);
    return existing;
  }

  const boundary = process.env.SSR_EXEC_BOUNDARY_ARN;
  if (!boundary) throw new Error("Server apps can't get their own role yet (SSR_EXEC_BOUNDARY_ARN isn't set).");
  try {
    await client().send(
      new CreateRoleCommand({
        RoleName: name,
        AssumeRolePolicyDocument: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
        }),
        PermissionsBoundary: boundary,
        Description: `Runs the server app ${templateId}. Logging, and its own page cache only.`,
        Tags: [{ Key: "plexoApp", Value: templateId }],
      }),
    );
  } catch (err) {
    // Another deploy of the same app may have created it a moment earlier.
    if (!(err instanceof EntityAlreadyExistsException)) throw err;
  }
  await client().send(new AttachRolePolicyCommand({ RoleName: name, PolicyArn: BASIC_LOGGING }));
  const arn = await readRole(name);
  if (!arn) throw new Error("The server app's role was created but can't be read back.");
  await putCachePolicy(templateId, name, arn);
  return arn;
}

/** Makes sure the app's table for cache tags exists, and returns its name. */
export async function ensureSsrTagTable(templateId: string): Promise<string> {
  const name = ssrTagTableName(templateId);
  try {
    await dynamoClient().send(new DescribeTableCommand({ TableName: name }));
    return name;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  await dynamoClient().send(
    new CreateTableCommand({
      TableName: name,
      // The keys OpenNext's DynamoDB tag cache uses: items by tag, and a "revalidate" index by path.
      AttributeDefinitions: [
        { AttributeName: "tag", AttributeType: "S" },
        { AttributeName: "path", AttributeType: "S" },
        { AttributeName: "revalidatedAt", AttributeType: "N" },
      ],
      KeySchema: [
        { AttributeName: "tag", KeyType: "HASH" },
        { AttributeName: "path", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "revalidate",
          KeySchema: [
            { AttributeName: "path", KeyType: "HASH" },
            { AttributeName: "revalidatedAt", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
      Tags: [{ Key: "plexoApp", Value: templateId }],
    }),
  ).catch((err) => {
    if (err?.name !== "ResourceInUseException") throw err;
  });
  // A new table takes a moment to become usable.
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await dynamoClient().send(new DescribeTableCommand({ TableName: name }));
    if (res.Table?.TableStatus === "ACTIVE") return name;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("The server app's cache table didn't become ready in time. Publish again in a moment.");
}

/** The app's role may read and write its own cache prefix (and list it), and its own tag table, and nothing else. */
async function putCachePolicy(templateId: string, roleName: string, roleArn: string): Promise<void> {
  const account = roleArn.split(":")[4];
  const bucket = projectBucket();
  const table = ssrTagTableName(templateId);
  await client().send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: "page-cache",
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
            Resource: `arn:aws:s3:::${bucket}/${ssrCachePrefix(templateId)}/*`,
          },
          {
            Effect: "Allow",
            Action: ["s3:ListBucket"],
            Resource: `arn:aws:s3:::${bucket}`,
            Condition: { StringLike: { "s3:prefix": [ssrCachePrefix(templateId), `${ssrCachePrefix(templateId)}/*`] } },
          },
          {
            Effect: "Allow",
            Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
            Resource: [`arn:aws:dynamodb:${REGION}:${account}:table/${table}`, `arn:aws:dynamodb:${REGION}:${account}:table/${table}/index/*`],
          },
        ],
      }),
    }),
  );
}

async function readRole(name: string): Promise<string | null> {
  try {
    const res = await client().send(new GetRoleCommand({ RoleName: name }));
    return res.Role?.Arn ?? null;
  } catch (err) {
    if (err instanceof NoSuchEntityException) return null;
    throw err;
  }
}
