import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// Fake Lambda: every command is recorded with its input, and `send` answers from `responses`,
// keyed by the command's name. A response that is an Error is thrown.
const sent: Array<{ name: string; input: any }> = [];
let responses: Record<string, unknown | Error> = {};

vi.mock("@aws-sdk/client-lambda", () => {
  class ResourceNotFoundException extends Error {}
  const command = (name: string) => class { name = name; constructor(public input: any) {} };
  return {
    LambdaClient: class {
      async send(cmd: { name: string; input: any }) {
        sent.push({ name: cmd.name, input: cmd.input });
        const answer = responses[cmd.name];
        if (answer instanceof Error) throw answer;
        return answer ?? {};
      }
    },
    CreateFunctionCommand: command("CreateFunctionCommand"),
    UpdateFunctionCodeCommand: command("UpdateFunctionCodeCommand"),
    UpdateFunctionConfigurationCommand: command("UpdateFunctionConfigurationCommand"),
    GetFunctionConfigurationCommand: command("GetFunctionConfigurationCommand"),
    GetFunctionUrlConfigCommand: command("GetFunctionUrlConfigCommand"),
    CreateFunctionUrlConfigCommand: command("CreateFunctionUrlConfigCommand"),
    DeleteFunctionCommand: command("DeleteFunctionCommand"),
    GetFunctionCommand: command("GetFunctionCommand"),
    waitUntilFunctionUpdatedV2: vi.fn(async () => ({})),
    waitUntilFunctionActiveV2: vi.fn(async () => ({})),
    ResourceNotFoundException,
  };
});
vi.mock("@aws-sdk/client-scheduler", () => ({ SchedulerClient: class {}, CreateScheduleCommand: class {}, UpdateScheduleCommand: class {}, DeleteScheduleCommand: class {}, ResourceNotFoundException: class extends Error {} }));
vi.mock("@aws-sdk/client-sts", () => ({ STSClient: class {}, AssumeRoleCommand: class {} }));
vi.mock("@/lib/db/appEntities", () => ({
  AppFunction: {},
  AppSettings: { get: () => ({ go: async () => ({ data: null }) }), create: () => ({ go: async () => ({}) }), patch: () => ({ set: () => ({ go: async () => ({}) }) }) },
  DeployedApp: { patch: () => ({ set: () => ({ go: async () => ({}) }) }) },
}));
// Each server app gets its own role; the IAM calls are tested in ssrExecRole.test.ts.
vi.mock("@/lib/appFunctions/ssrExecRole", () => ({
  ensureSsrExecRole: async (templateId: string) => `arn:aws:iam::123456789012:role/plexo-ssr-exec-${templateId}`,
  ssrCachePrefix: (templateId: string) => `private/projects/${templateId}/ssr/cache`,
  ensureSsrTagTable: async (templateId: string) => `plexo-ssr-tags-${templateId}`,
}));
vi.mock("@/lib/appFunctions/ssrVariableStore", () => ({ listSsrVariables: async () => [] }));
vi.mock("@/lib/appFunctions/secrets", () => ({ listSecrets: async () => [] }));
vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: () => ({ go: async () => ({ data: { organizationId: "org-1" } }) }) }, PublishedDomain: {} }));
vi.mock("@/server/pagesDomain", () => ({ getPagesDomain: () => "pages.test" }));
vi.mock("@/lib/projects/previewHost", () => ({ previewUrl: () => "https://preview.test" }));

const bundleBody = Buffer.from("fake-zip-bytes");
const getObject = vi.fn(async (_key: string) => ({ body: bundleBody, contentType: "application/zip" }));
vi.mock("@/lib/projects/blobStore", () => ({ getObject: (key: string) => getObject(key), projectBucket: () => "plexo-user-content-test" }));

import { deploySsrFunction, applySsrVariables } from "@/lib/appFunctions/deploy";

const TEMPLATE = "tmpl-abc";
const FUNCTION = `plexo-ssr-${TEMPLATE}`;
const BUNDLE_SHA = createHash("sha256").update(bundleBody).digest("base64");

describe("deploySsrFunction", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://plexo.test";
    sent.length = 0;
    responses = {};
    process.env.FUNCTIONS_EXECUTION_ROLE_ARN = "arn:aws:iam::123456789012:role/plexo-fn-exec";
    delete process.env.FUNCTIONS_ACCOUNT_ROLE_ARN;
  });

  const names = () => sent.map((s) => s.name);
  const input = (name: string) => sent.find((s) => s.name === name)?.input;

  it("creates the function on x86_64 with the app's execution role and an IAM Function URL", async () => {
    const { ResourceNotFoundException } = await import("@aws-sdk/client-lambda");
    responses.GetFunctionConfigurationCommand = new (ResourceNotFoundException as any)({ message: "missing", $metadata: {} });
    responses.GetFunctionUrlConfigCommand = new (ResourceNotFoundException as any)({ message: "missing", $metadata: {} });
    responses.CreateFunctionUrlConfigCommand = { FunctionUrl: "https://abc.lambda-url.us-east-1.on.aws/" };

    const result = await deploySsrFunction({ templateId: TEMPLATE, buildId: "b1", bundleKey: "k" });

    expect(result).toEqual({ functionName: FUNCTION, functionUrl: "https://abc.lambda-url.us-east-1.on.aws/" });
    expect(names()).toContain("CreateFunctionCommand");
    expect(names()).not.toContain("UpdateFunctionCodeCommand");
    const create = input("CreateFunctionCommand");
    expect(create).toMatchObject({ FunctionName: FUNCTION, Runtime: "nodejs24.x", Handler: "index.handler", Architectures: ["x86_64"], Role: `arn:aws:iam::123456789012:role/plexo-ssr-exec-${TEMPLATE}` });
    expect(create.Code.ZipFile).toBe(bundleBody);
    expect(input("CreateFunctionUrlConfigCommand")).toMatchObject({ FunctionName: FUNCTION, AuthType: "AWS_IAM" });
  });

  it("updates the code only when the bundle's SHA-256 differs from the live function's", async () => {
    responses.GetFunctionConfigurationCommand = { CodeSha256: "some-other-hash" };
    responses.GetFunctionUrlConfigCommand = { FunctionUrl: "https://abc.lambda-url.us-east-1.on.aws/" };
    await deploySsrFunction({ templateId: TEMPLATE, buildId: "b2", bundleKey: "k" });
    expect(names()).toContain("UpdateFunctionCodeCommand");
    expect(names()).not.toContain("CreateFunctionCommand");
    expect(input("UpdateFunctionCodeCommand")).toMatchObject({ FunctionName: FUNCTION });
  });

  it("leaves the code alone when the bundle is unchanged, and reuses the existing URL", async () => {
    responses.GetFunctionConfigurationCommand = { CodeSha256: BUNDLE_SHA };
    responses.GetFunctionUrlConfigCommand = { FunctionUrl: "https://abc.lambda-url.us-east-1.on.aws/" };
    const result = await deploySsrFunction({ templateId: TEMPLATE, buildId: "b3", bundleKey: "k" });
    expect(names()).not.toContain("UpdateFunctionCodeCommand");
    expect(names()).not.toContain("CreateFunctionUrlConfigCommand");
    expect(result.functionUrl).toBe("https://abc.lambda-url.us-east-1.on.aws/");
  });
});

describe("the Next.js image function", () => {
  const input = (name: string) => sent.find((s) => s.name === name)?.input;
  beforeEach(() => {
    sent.length = 0;
    responses = {};
    process.env.FUNCTIONS_EXECUTION_ROLE_ARN = "arn:aws:iam::123456789012:role/plexo-fn-exec";
    process.env.SSR_IMAGE_ROLE_ARN = "arn:aws:iam::123456789012:role/plexo-ssr-image";
    process.env.AWS_REGION = "us-east-1";
  });

  it("deploys as arm64 with the image role, its sizing, and the site's file location", async () => {
    const { ResourceNotFoundException } = await import("@aws-sdk/client-lambda");
    responses.GetFunctionConfigurationCommand = new (ResourceNotFoundException as any)({ message: "missing", $metadata: {} });
    responses.GetFunctionUrlConfigCommand = new (ResourceNotFoundException as any)({ message: "missing", $metadata: {} });
    responses.CreateFunctionUrlConfigCommand = { FunctionUrl: "https://img.lambda-url.us-east-1.on.aws/" };
    const result = await deploySsrFunction({ templateId: TEMPLATE, buildId: "b9", bundleKey: "k", part: "image", sitePrefix: "private/projects/tmpl-abc/builds/b9/site" });
    expect(result).toEqual({ functionName: `plexo-ssr-${TEMPLATE}-img`, functionUrl: "https://img.lambda-url.us-east-1.on.aws/" });
    const create = input("CreateFunctionCommand");
    expect(create).toMatchObject({ Architectures: ["arm64"], Role: "arn:aws:iam::123456789012:role/plexo-ssr-image", MemorySize: 1536, Timeout: 25 });
    expect(create.Environment.Variables.BUCKET_KEY_PREFIX).toBe("private/projects/tmpl-abc/builds/b9/site");
    expect(input("CreateFunctionUrlConfigCommand")).toMatchObject({ AuthType: "AWS_IAM" });
  });

  it("refuses the image function without a site location", async () => {
    await expect(deploySsrFunction({ templateId: TEMPLATE, buildId: "b9", bundleKey: "k", part: "image" })).rejects.toThrow(/site/);
  });

  it("keeps the server function on x86 with the logging-only role", async () => {
    const { ResourceNotFoundException } = await import("@aws-sdk/client-lambda");
    responses.GetFunctionConfigurationCommand = new (ResourceNotFoundException as any)({ message: "missing", $metadata: {} });
    responses.GetFunctionUrlConfigCommand = { FunctionUrl: "https://abc.lambda-url.us-east-1.on.aws/" };
    await deploySsrFunction({ templateId: TEMPLATE, buildId: "b9", bundleKey: "k" });
    expect(input("CreateFunctionCommand")).toMatchObject({ Architectures: ["x86_64"], Role: `arn:aws:iam::123456789012:role/plexo-ssr-exec-${TEMPLATE}` });
  });
});

describe("PLEXO_BUILD_ID (secrets reach the server on a rebuild)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://plexo.test";
    sent.length = 0;
    responses = {};
    process.env.FUNCTIONS_EXECUTION_ROLE_ARN = "arn:aws:iam::123456789012:role/plexo-fn-exec";
  });

  const input = (name: string) => sent.find((s) => s.name === name)?.input;

  it("sets the server's environment to the build being deployed", async () => {
    const { ResourceNotFoundException } = await import("@aws-sdk/client-lambda");
    responses.GetFunctionConfigurationCommand = new (ResourceNotFoundException as any)({ message: "missing", $metadata: {} });
    responses.GetFunctionUrlConfigCommand = new (ResourceNotFoundException as any)({ message: "missing", $metadata: {} });
    responses.CreateFunctionUrlConfigCommand = { FunctionUrl: "https://abc.lambda-url.us-east-1.on.aws/" };
    await deploySsrFunction({ templateId: TEMPLATE, buildId: "build-42", bundleKey: "k" });
    expect(input("CreateFunctionCommand").Environment.Variables.PLEXO_BUILD_ID).toBe("build-42");
  });

  it("keeps the function's current build id when variables are applied without a build", async () => {
    responses.GetFunctionConfigurationCommand = { Environment: { Variables: { PLEXO_BUILD_ID: "build-7" } } };
    await applySsrVariables(TEMPLATE, "live");
    expect(input("UpdateFunctionConfigurationCommand").Environment.Variables.PLEXO_BUILD_ID).toBe("build-7");
  });
});
