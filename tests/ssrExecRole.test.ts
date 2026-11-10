import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake IAM: GetRole answers from `roles`; a create of an existing role throws EntityAlreadyExists.
const sent: Array<{ name: string; input: any }> = [];
const roles = new Set<string>();
vi.mock("@aws-sdk/client-iam", () => {
  class NoSuchEntityException extends Error {}
  class EntityAlreadyExistsException extends Error {}
  const errors = { NoSuchEntityException, EntityAlreadyExistsException };
  const command = (name: string) => class { name = name; constructor(public input: any) {} };
  return {
    IAMClient: class {
      async send(cmd: { name: string; input: any }) {
        sent.push({ name: cmd.name, input: cmd.input });
        if (cmd.name === "GetRoleCommand") {
          if (!roles.has(cmd.input.RoleName)) throw new errors.NoSuchEntityException("no role");
          return { Role: { Arn: `arn:aws:iam::123456789012:role/${cmd.input.RoleName}` } };
        }
        if (cmd.name === "CreateRoleCommand") {
          if (roles.has(cmd.input.RoleName)) throw new errors.EntityAlreadyExistsException("exists");
          roles.add(cmd.input.RoleName);
        }
        return {};
      }
    },
    GetRoleCommand: command("GetRoleCommand"),
    CreateRoleCommand: command("CreateRoleCommand"),
    AttachRolePolicyCommand: command("AttachRolePolicyCommand"),
    PutRolePolicyCommand: command("PutRolePolicyCommand"),
    ...errors,
  };
});
const tables = new Map<string, any>();
vi.mock("@aws-sdk/client-dynamodb", () => {
  class ResourceNotFoundException extends Error {}
  const errors = { ResourceNotFoundException };
  const command = (name: string) => class { name = name; constructor(public input: any) {} };
  return {
    DynamoDBClient: class {
      async send(cmd: { name: string; input: any }) {
        if (cmd.name === "DescribeTableCommand") {
          const t = tables.get(cmd.input.TableName);
          if (!t) throw new errors.ResourceNotFoundException("no table");
          return { Table: { TableStatus: "ACTIVE" } };
        }
        if (cmd.name === "CreateTableCommand") {
          sent.push({ name: "CreateTableCommand", input: cmd.input });
          tables.set(cmd.input.TableName, cmd.input);
          return {};
        }
        return {};
      }
    },
    CreateTableCommand: command("CreateTableCommand"),
    DescribeTableCommand: command("DescribeTableCommand"),
    ...errors,
  };
});
vi.mock("@/lib/projects/blobStore", () => ({ projectBucket: () => "plexo-user-content-staging-plexo", projectPrefix: (t: string) => `private/projects/${t}` }));

import { ensureSsrExecRole, ensureSsrTagTable, ssrExecRoleName, ssrCachePrefix, ssrTagTableName } from "@/lib/appFunctions/ssrExecRole";

const BOUNDARY = "arn:aws:iam::123456789012:policy/boundary";
const names = () => sent.map((s) => s.name);

describe("ssrExecRoleName and ssrCachePrefix", () => {
  it("names a role within IAM's limit, and keeps it stable per app", () => {
    const name = ssrExecRoleName("ece8087e-1799-4865-98c7-c9345677c37c");
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toBe(ssrExecRoleName("ece8087e-1799-4865-98c7-c9345677c37c"));
    expect(name).not.toBe(ssrExecRoleName("another-app"));
  });
  it("puts the cache under the app's own prefix", () => {
    expect(ssrCachePrefix("t1")).toBe("private/projects/t1/ssr/cache");
  });
});

describe("ensureSsrExecRole", () => {
  beforeEach(() => {
    sent.length = 0;
    roles.clear();
    process.env.SSR_EXEC_BOUNDARY_ARN = BOUNDARY;
  });

  it("creates the app's role with the boundary, logging, and a cache-only policy the first time", async () => {
    const arn = await ensureSsrExecRole("t1");
    expect(arn).toContain("plexo-ssr-exec-");
    const create = sent.find((s) => s.name === "CreateRoleCommand")!.input;
    expect(create.PermissionsBoundary).toBe(BOUNDARY);
    expect(create.AssumeRolePolicyDocument).toContain("lambda.amazonaws.com");
    const put = sent.find((s) => s.name === "PutRolePolicyCommand")!.input;
    const doc = JSON.parse(put.PolicyDocument);
    expect(doc.Statement[0].Resource).toBe("arn:aws:s3:::plexo-user-content-staging-plexo/private/projects/t1/ssr/cache/*");
    expect(doc.Statement[1].Action).toEqual(["s3:ListBucket"]);
    expect(doc.Statement[1].Condition.StringLike["s3:prefix"]).toContain("private/projects/t1/ssr/cache/*");
    expect(doc.Statement[2].Resource[0]).toBe(`arn:aws:dynamodb:us-east-1:123456789012:table/${ssrTagTableName("t1")}`);
    expect(names()).toContain("AttachRolePolicyCommand");
  });

  it("reuses an existing role, and refreshes its policy so older roles get the new permissions", async () => {
    await ensureSsrExecRole("t1");
    sent.length = 0;
    await ensureSsrExecRole("t1");
    expect(names()).toEqual(["GetRoleCommand", "PutRolePolicyCommand"]);
  });

  it("creates the app's tag table with the keys OpenNext's tag cache uses", async () => {
    const name = await ensureSsrTagTable("t1");
    expect(name).toBe(ssrTagTableName("t1"));
    const create = sent.find((s) => s.name === "CreateTableCommand")!.input;
    expect(create.KeySchema).toEqual([{ AttributeName: "tag", KeyType: "HASH" }, { AttributeName: "path", KeyType: "RANGE" }]);
    expect(create.GlobalSecondaryIndexes[0].IndexName).toBe("revalidate");
    expect(create.GlobalSecondaryIndexes[0].KeySchema[0].AttributeName).toBe("path");
  });

  it("refuses to create a role without a boundary", async () => {
    delete process.env.SSR_EXEC_BOUNDARY_ARN;
    await expect(ensureSsrExecRole("t2")).rejects.toThrow(/SSR_EXEC_BOUNDARY_ARN/);
    expect(names()).not.toContain("CreateRoleCommand");
  });
});
