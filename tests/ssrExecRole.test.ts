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
vi.mock("@/lib/projects/blobStore", () => ({ projectBucket: () => "plexo-user-content-staging-plexo", projectPrefix: (t: string) => `private/projects/${t}` }));

import { ensureSsrExecRole, ssrExecRoleName, ssrCachePrefix } from "@/lib/appFunctions/ssrExecRole";

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
    expect(names()).toContain("AttachRolePolicyCommand");
  });

  it("reuses an existing role without changing it", async () => {
    await ensureSsrExecRole("t1");
    sent.length = 0;
    await ensureSsrExecRole("t1");
    expect(names()).toEqual(["GetRoleCommand"]);
  });

  it("refuses to create a role without a boundary", async () => {
    delete process.env.SSR_EXEC_BOUNDARY_ARN;
    await expect(ensureSsrExecRole("t2")).rejects.toThrow(/SSR_EXEC_BOUNDARY_ARN/);
    expect(names()).not.toContain("CreateRoleCommand");
  });
});
