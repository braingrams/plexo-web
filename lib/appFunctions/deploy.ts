import { createHash, randomBytes } from "node:crypto";
import {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  GetFunctionConfigurationCommand,
  GetFunctionUrlConfigCommand,
  CreateFunctionUrlConfigCommand,
  DeleteFunctionCommand,
  waitUntilFunctionUpdatedV2,
  waitUntilFunctionActiveV2,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda";
import { SchedulerClient, CreateScheduleCommand, UpdateScheduleCommand, DeleteScheduleCommand, ResourceNotFoundException as ScheduleNotFound } from "@aws-sdk/client-scheduler";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { AppFunction, AppSettings, DeployedApp, type AppEnv } from "@/lib/db/appEntities";
import { getObject } from "@/lib/projects/blobStore";
import { validateSsrEnvChange, type SsrEnvChange } from "@/lib/appFunctions/ssrEnv";
import { getPagesDomain } from "@/server/pagesDomain";
import { previewUrl } from "@/lib/projects/previewHost";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";

// Deploys an app's server functions (functions/<name>.ts, bundled by the build) as Lambdas.
//
// Each function's execution role has NO AWS permissions (FUNCTIONS_EXECUTION_ROLE_ARN —
// only CloudWatch logging). Everything a function does with its app goes through the app's
// own /__plexo/api with a per-environment service key. With FUNCTIONS_ACCOUNT_ROLE_ARN set,
// function Lambdas live in a separate AWS account entirely.

export type FunctionBundle = { key: string; schedule?: string; bytes: number };

const REGION = process.env.AWS_REGION || "us-east-1";

async function clients(): Promise<{ lambda: LambdaClient; scheduler: SchedulerClient }> {
  const roleArn = process.env.FUNCTIONS_ACCOUNT_ROLE_ARN;
  if (!roleArn) return { lambda: new LambdaClient({ region: REGION }), scheduler: new SchedulerClient({ region: REGION }) };
  const { Credentials } = await new STSClient({ region: REGION }).send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "plexo-functions-deploy" }));
  const credentials = { accessKeyId: Credentials!.AccessKeyId!, secretAccessKey: Credentials!.SecretAccessKey!, sessionToken: Credentials!.SessionToken! };
  return { lambda: new LambdaClient({ region: REGION, credentials }), scheduler: new SchedulerClient({ region: REGION, credentials }) };
}

export function functionLambdaName(templateId: string, env: AppEnv, name: string): string {
  // Lambda names max 64 chars: keep it readable but bounded.
  const id = templateId.replace(/-/g, "").slice(0, 20);
  const short = name.length > 24 ? `${name.slice(0, 17)}-${createHash("sha1").update(name).digest("hex").slice(0, 6)}` : name;
  return `plexo-fn-${id}-${env}-${short}`;
}

export function validCron(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  // EventBridge cron has 6 fields and needs "?" in day-of-month or day-of-week.
  const [min, hour, dom, mon, dow] = fields;
  const domQ = dow === "*" ? dom : "?";
  const dowQ = dow === "*" ? "?" : dow.replace(/\b0\b/, "7").replace(/\d/g, (d) => String(((Number(d) % 7) + 1)));
  return `cron(${min} ${hour} ${domQ} ${mon} ${dowQ} *)`;
}

/** The app's public API base for an environment — where its functions call back to. */
async function apiBase(templateId: string, env: AppEnv): Promise<string> {
  if (env === "dev") {
    const { data: t } = await Template.get({ id: templateId }).go({ attributes: ["previewHost"] });
    return `${previewUrl(t!.previewHost!)}/__plexo/api`;
  }
  const { data: domains } = await PublishedDomain.query.primary({ templateId }).go({ pages: "all" });
  const pick = domains.find((d) => d.type === "CUSTOM" && d.active !== false && d.dnsVerified) ?? domains.find((d) => d.active !== false);
  return `https://${pick?.domain ?? `${templateId}.${getPagesDomain()}`}/__plexo/api`;
}

/** The environment's service key: the one its deployed functions already hold (when it still
 * matches the stored hash), otherwise a fresh one. Its hash lives in AppSettings, its
 * plaintext only in that environment's function configurations. Reusing it means a deploy
 * never breaks calls in flight from functions that haven't been updated yet. */
async function serviceKeyFor(lambda: LambdaClient, templateId: string, organizationId: string, env: AppEnv, existingLambdaName?: string): Promise<string> {
  if (existingLambdaName) {
    const { data: settings } = await AppSettings.get({ templateId }).go();
    const stored = env === "dev" ? settings?.serviceKeyHashDev : settings?.serviceKeyHashLive;
    const current = await lambda
      .send(new GetFunctionConfigurationCommand({ FunctionName: existingLambdaName }))
      .then((c) => c.Environment?.Variables?.PLEXO_SERVICE_KEY, () => undefined);
    if (current && stored && createHash("sha256").update(current).digest("hex") === stored) return current;
  }
  return rotateServiceKey(templateId, organizationId, env);
}

async function rotateServiceKey(templateId: string, organizationId: string, env: AppEnv): Promise<string> {
  const key = `pxs_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const { data } = await AppSettings.get({ templateId }).go();
  if (!data) await AppSettings.create({ templateId, organizationId }).go().catch(() => undefined);
  await AppSettings.patch({ templateId }).set(env === "dev" ? { serviceKeyHashDev: hash } : { serviceKeyHashLive: hash }).go();
  return key;
}

export type DeployOutcome = { deployed: string[]; removed: string[]; failed: Array<{ name: string; message: string }> };

export async function deployFunctions(input: { templateId: string; organizationId: string; env: AppEnv; buildId: string; bundles: Record<string, FunctionBundle> }): Promise<DeployOutcome> {
  const outcome: DeployOutcome = { deployed: [], removed: [], failed: [] };
  const { data: existing } = await AppFunction.query.primary({ templateId: input.templateId }).begins({ env: input.env }).go({ pages: "all" });
  const names = Object.keys(input.bundles);
  if (!names.length && !existing.length) return outcome;

  const role = process.env.FUNCTIONS_EXECUTION_ROLE_ARN;
  if (!role) throw new Error("Server functions aren't available in this environment yet (FUNCTIONS_EXECUTION_ROLE_ARN isn't set).");
  const { lambda, scheduler } = await clients();
  const serviceKey = await serviceKeyFor(lambda, input.templateId, input.organizationId, input.env, existing.find((f) => f.status === "READY")?.lambdaName);
  const environment = { Variables: { PLEXO_API_URL: await apiBase(input.templateId, input.env), PLEXO_SERVICE_KEY: serviceKey, NODE_OPTIONS: "--enable-source-maps" } };

  for (const name of names) {
    const bundle = input.bundles[name];
    const lambdaName = functionLambdaName(input.templateId, input.env, name);
    try {
      const zip = await getObject(bundle.key);
      if (!zip) throw new Error("The function's bundle is missing — rebuild the app.");
      const codeSha256 = createHash("sha256").update(zip.body).digest("base64");
      const current = existing.find((f) => f.name === name);
      await AppFunction.put({ templateId: input.templateId, env: input.env, name, lambdaName, status: "DEPLOYING", buildId: input.buildId, schedule: bundle.schedule, scheduleName: current?.scheduleName }).go();

      let exists = true;
      try {
        await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: lambdaName }));
      } catch (err) {
        if (!(err instanceof ResourceNotFoundException)) throw err;
        exists = false;
      }
      if (!exists) {
        await lambda.send(
          new CreateFunctionCommand({
            FunctionName: lambdaName,
            Runtime: "nodejs24.x",
            Handler: "index.handler",
            Role: role,
            Code: { ZipFile: zip.body },
            MemorySize: 512,
            Timeout: 30,
            Environment: environment,
            Architectures: ["arm64"],
            Description: `Plexo app ${input.templateId} (${input.env}) — ${name}`,
            Tags: { plexoApp: input.templateId, plexoEnv: input.env },
          }),
        );
        await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 60 }, { FunctionName: lambdaName });
      } else {
        await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: lambdaName, Environment: environment }));
        await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 60 }, { FunctionName: lambdaName });
        if (current?.codeSha256 !== codeSha256) {
          await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: lambdaName, ZipFile: zip.body }));
          await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 60 }, { FunctionName: lambdaName });
        }
      }

      const scheduleName = await syncSchedule(scheduler, lambdaName, bundle.schedule, current?.scheduleName, name);
      await AppFunction.put({
        templateId: input.templateId,
        env: input.env,
        name,
        lambdaName,
        codeSha256,
        schedule: bundle.schedule,
        scheduleName: scheduleName ?? undefined,
        buildId: input.buildId,
        status: "READY",
        deployedAt: new Date().toISOString(),
      }).go();
      outcome.deployed.push(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await AppFunction.patch({ templateId: input.templateId, env: input.env, name }).set({ status: "FAILED", statusMessage: message.slice(0, 500) }).go().catch(() => undefined);
      outcome.failed.push({ name, message });
    }
  }

  // Functions whose file was deleted from the project.
  for (const gone of existing.filter((f) => !names.includes(f.name))) {
    try {
      if (gone.scheduleName) await scheduler.send(new DeleteScheduleCommand({ Name: gone.scheduleName })).catch(() => undefined);
      await lambda.send(new DeleteFunctionCommand({ FunctionName: gone.lambdaName })).catch((err) => {
        if (!(err instanceof ResourceNotFoundException)) throw err;
      });
      await AppFunction.delete({ templateId: input.templateId, env: input.env, name: gone.name }).go();
      outcome.removed.push(gone.name);
    } catch (err) {
      outcome.failed.push({ name: gone.name, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return outcome;
}

async function syncSchedule(scheduler: SchedulerClient, lambdaName: string, cron: string | undefined, currentName: string | undefined, fnName: string): Promise<string | null> {
  const name = lambdaName; // schedule names share the (≤64-char) function name
  if (!cron) {
    if (currentName) await scheduler.send(new DeleteScheduleCommand({ Name: currentName })).catch((err) => {
      if (!(err instanceof ScheduleNotFound)) throw err;
    });
    return null;
  }
  const expression = validCron(cron);
  if (!expression) throw new Error(`"${cron}" isn't a valid schedule. Use 5-field cron in UTC, like "0 9 * * *" (every day at 09:00).`);
  const roleArn = process.env.FUNCTIONS_SCHEDULER_ROLE_ARN;
  if (!roleArn) throw new Error("Scheduled functions aren't available in this environment yet (FUNCTIONS_SCHEDULER_ROLE_ARN isn't set).");
  const { lambda } = await clients();
  const fn = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: lambdaName }));
  const params = {
    Name: name,
    ScheduleExpression: expression,
    ScheduleExpressionTimezone: "UTC",
    FlexibleTimeWindow: { Mode: "OFF" as const },
    Target: { Arn: fn.FunctionArn!, RoleArn: roleArn, Input: JSON.stringify({ kind: "schedule", function: fnName }) },
    State: "ENABLED" as const,
  };
  try {
    await scheduler.send(new UpdateScheduleCommand(params));
  } catch (err) {
    if (!(err instanceof ScheduleNotFound)) throw err;
    await scheduler.send(new CreateScheduleCommand(params));
  }
  return name;
}

/** Removes every function of an app (when the app is deleted). */
export async function deleteAllFunctions(templateId: string): Promise<void> {
  const { data } = await AppFunction.query.primary({ templateId }).go({ pages: "all" });
  if (!data.length) return;
  const { lambda, scheduler } = await clients();
  for (const f of data) {
    if (f.scheduleName) await scheduler.send(new DeleteScheduleCommand({ Name: f.scheduleName })).catch(() => undefined);
    await lambda.send(new DeleteFunctionCommand({ FunctionName: f.lambdaName })).catch(() => undefined);
    await AppFunction.delete({ templateId, env: f.env, name: f.name }).go();
  }
}

// ---------------------------------------------------------------- SSR apps

/** Lambda's direct-upload limit for a zipped function. Bigger bundles need S3 code deployment. */
export const SSR_MAX_DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024;

/** One server-rendered function per app (plexo-ssr-<templateId>), not per environment: SSR
 * apps deploy straight to live for now. */
import { ssrFunctionName, type SsrTarget } from "@/lib/appFunctions/ssrNames";
export { ssrFunctionName, type SsrTarget };

/** Creates or updates the app's SSR function, and makes sure it has an IAM-authenticated
 * Function URL. Only plexo-web may call that URL (lambda:InvokeFunctionUrl, see
 * cdk/lib/project-runtime.ts). */
export async function deploySsrFunction(input: { templateId: string; buildId: string; bundleKey: string; target?: SsrTarget }): Promise<{ functionName: string; functionUrl: string }> {
  const role = process.env.FUNCTIONS_EXECUTION_ROLE_ARN;
  if (!role) throw new Error("Server functions aren't available in this environment yet (FUNCTIONS_EXECUTION_ROLE_ARN isn't set).");
  const bundle = await getObject(input.bundleKey);
  if (!bundle) throw new Error("The server bundle is missing — rebuild the app.");
  if (bundle.body.byteLength > SSR_MAX_DIRECT_UPLOAD_BYTES) {
    throw new Error(`The server bundle is ${(bundle.body.byteLength / 1024 / 1024).toFixed(1)}MB, over Lambda's 50MB direct-upload limit.`);
  }
  const codeSha256 = createHash("sha256").update(bundle.body).digest("base64");
  const { lambda } = await clients();
  const functionName = ssrFunctionName(input.templateId, input.target ?? "live");

  let current: { CodeSha256?: string } | null = null;
  try {
    current = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  if (!current) {
    await lambda.send(
      new CreateFunctionCommand({
        FunctionName: functionName,
        Runtime: "nodejs24.x",
        Handler: "index.handler",
        Role: role,
        Code: { ZipFile: bundle.body },
        MemorySize: 1024,
        Timeout: 30,
        // x86_64 to match the build machine: the server bundle is built there, native addons included.
        Architectures: ["x86_64"],
        Environment: { Variables: { NODE_ENV: "production" } },
        Description: `Plexo SSR app ${input.templateId} — build ${input.buildId}`,
        Tags: { plexoApp: input.templateId, plexoKind: "ssr" },
      }),
    );
    await waitUntilFunctionActiveV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: functionName });
  } else if (current.CodeSha256 !== codeSha256) {
    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: bundle.body }));
    await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: functionName });
  }

  let functionUrl: string | undefined;
  try {
    functionUrl = (await lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: functionName }))).FunctionUrl;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
    functionUrl = (await lambda.send(new CreateFunctionUrlConfigCommand({ FunctionName: functionName, AuthType: "AWS_IAM", InvokeMode: "BUFFERED" }))).FunctionUrl;
  }
  if (!functionUrl) throw new Error("Lambda didn't return a Function URL for the SSR app.");
  return { functionName, functionUrl };
}

/** Deploys a finished SSR build. A preview build goes to the preview function and is recorded as
 * the preview; it's only served to the public after publishSsrPreview promotes it. */
export async function deploySsrApp(input: { templateId: string; buildId: string; bundleKey: string; sitePrefix: string; target: SsrTarget }): Promise<DeployOutcome> {
  const { functionName, functionUrl } = await deploySsrFunction({ ...input, target: input.target });
  if (input.target === "preview") {
    await DeployedApp.patch({ templateId: input.templateId })
      .set({ previewFunctionName: functionName, previewFunctionUrl: functionUrl, previewBuildId: input.buildId, previewSitePrefix: input.sitePrefix, previewBundleKey: input.bundleKey })
      .go();
  } else {
    await DeployedApp.patch({ templateId: input.templateId })
      .set({ type: "SSR", functionName, functionUrl, buildId: input.buildId, ssrSitePrefix: input.sitePrefix })
      .go();
  }
  return { deployed: [functionName], removed: [], failed: [] };
}

/** Publishes the app's latest SSR preview: the live function runs the same bundle, and the live
 * fields point at the preview's build and files. Returns the live function's name and URL. */
export async function publishSsrPreview(templateId: string): Promise<{ functionName: string; functionUrl: string } | { error: string }> {
  const { data: app } = await DeployedApp.get({ templateId }).go();
  if (!app?.previewBundleKey || !app.previewBuildId || !app.previewSitePrefix) {
    return { error: "There's no SSR preview to publish. Upload the server build first." };
  }
  const live = await deploySsrFunction({ templateId, buildId: app.previewBuildId, bundleKey: app.previewBundleKey, target: "live" });
  await DeployedApp.patch({ templateId })
    .set({ type: "SSR", functionName: live.functionName, functionUrl: live.functionUrl, buildId: app.previewBuildId, ssrSitePrefix: app.previewSitePrefix })
    .go();
  return live;
}

/** Variable names on an SSR app's live function (values are never returned). */
export async function ssrEnvNames(templateId: string, target: SsrTarget = "live"): Promise<string[] | { error: string }> {
  const { lambda } = await clients();
  try {
    const current = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: ssrFunctionName(templateId, target) }));
    return Object.keys(current.Environment?.Variables ?? {}).sort();
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return { error: "This app has no server function yet. Deploy its server build first." };
    throw err;
  }
}

/** Applies a change to an SSR app's live function environment (UpdateFunctionConfiguration).
 * The values go to Lambda and nowhere else: the caller gets the variable names back. */
export async function updateSsrEnvironment(templateId: string, change: SsrEnvChange, target: SsrTarget = "live"): Promise<{ names: string[] } | { error: string }> {
  const { lambda } = await clients();
  const functionName = ssrFunctionName(templateId, target);
  let current;
  try {
    current = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return { error: "This app has no server function yet. Deploy its server build first." };
    throw err;
  }
  const variables: Record<string, string> = { ...(current.Environment?.Variables ?? {}) };
  const problem = validateSsrEnvChange(change, variables);
  if (problem) return { error: problem };
  for (const key of change.unset) delete variables[key];
  Object.assign(variables, change.set);

  await lambda.send(new UpdateFunctionConfigurationCommand({ FunctionName: functionName, Environment: { Variables: variables } }));
  await waitUntilFunctionUpdatedV2({ client: lambda, maxWaitTime: 120 }, { FunctionName: functionName });
  return { names: Object.keys(variables).sort() };
}
