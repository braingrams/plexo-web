import {
  CreateAliasCommand,
  CreateFunctionUrlConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  GetAliasCommand,
  GetFunctionUrlConfigCommand,
  PublishVersionCommand,
  PutProvisionedConcurrencyConfigCommand,
  ResourceNotFoundException,
  UpdateAliasCommand,
  type LambdaClient,
} from "@aws-sdk/client-lambda";
import { DeployedApp } from "@/lib/db/appEntities";
import { functionsLambda } from "@/lib/appFunctions/deploy";

// Always-on: one warm copy of an app's live server function. Lambda keeps warm copies of a published
// version behind an alias, so the app's live code is published as a version and the "warm" alias points at it.
// Only BuildFinalizeFn runs these (it's the role allowed to change plexo-ssr-* functions; see ssrControl.ts).

export const WARM_ALIAS = "warm";
const WARM_COPIES = 1;

async function liveFunction(templateId: string) {
  const { data: app } = await DeployedApp.get({ templateId }).go({ attributes: ["functionName", "hostingTier"] });
  if (!app?.functionName) throw new Error("This app has no live server function yet. Publish it first.");
  return { functionName: app.functionName, hostingTier: app.hostingTier ?? "LAMBDA" };
}

/** Points the warm alias at a new version of the function, creating the alias the first time. */
async function pointWarmAliasAt(lambda: LambdaClient, functionName: string, version: string): Promise<void> {
  try {
    await lambda.send(new GetAliasCommand({ FunctionName: functionName, Name: WARM_ALIAS }));
    await lambda.send(new UpdateAliasCommand({ FunctionName: functionName, Name: WARM_ALIAS, FunctionVersion: version }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
    await lambda.send(new CreateAliasCommand({ FunctionName: functionName, Name: WARM_ALIAS, FunctionVersion: version }));
  }
}

async function publishLiveVersion(lambda: LambdaClient, functionName: string): Promise<string> {
  const { Version } = await lambda.send(new PublishVersionCommand({ FunctionName: functionName, Description: "always-on" }));
  if (!Version) throw new Error("Lambda didn't return a version for the always-on copy.");
  return Version;
}

/** Turns always-on on: a warm copy of the live code, its own function URL, and the app served from it. */
export async function enableAlwaysOn(templateId: string): Promise<void> {
  await DeployedApp.patch({ templateId }).set({ alwaysOnStatus: "STARTING", alwaysOnError: "" }).go();
  const { functionName } = await liveFunction(templateId);
  const lambda = await functionsLambda();
  const version = await publishLiveVersion(lambda, functionName);
  await pointWarmAliasAt(lambda, functionName, version);
  await lambda.send(new PutProvisionedConcurrencyConfigCommand({ FunctionName: functionName, Qualifier: WARM_ALIAS, ProvisionedConcurrentExecutions: WARM_COPIES }));
  let url: string | undefined;
  try {
    url = (await lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: functionName, Qualifier: WARM_ALIAS }))).FunctionUrl;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
    url = (await lambda.send(new CreateFunctionUrlConfigCommand({ FunctionName: functionName, Qualifier: WARM_ALIAS, AuthType: "AWS_IAM", InvokeMode: "BUFFERED" }))).FunctionUrl;
  }
  if (!url) throw new Error("Lambda didn't return a URL for the always-on copy.");
  await DeployedApp.patch({ templateId }).set({ hostingTier: "PROVISIONED", alwaysOnFunctionUrl: url, alwaysOnStatus: "ON", alwaysOnError: "" }).go();
}

/** Turns always-on off: the warm copies are released and the app goes back to cold starts. */
export async function disableAlwaysOn(templateId: string, finalRequest: "NONE" | "REVOKED" = "NONE"): Promise<void> {
  const { functionName } = await liveFunction(templateId);
  const lambda = await functionsLambda();
  try {
    await lambda.send(new DeleteProvisionedConcurrencyConfigCommand({ FunctionName: functionName, Qualifier: WARM_ALIAS }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  // The request goes back to NONE, so the owner can ask again later.
  await DeployedApp.patch({ templateId }).set({ hostingTier: "LAMBDA", alwaysOnStatus: "OFF", alwaysOnError: "", alwaysOnRequest: finalRequest }).remove(["alwaysOnFunctionUrl"]).go();
}

/** After a publish, an always-on app's warm copy must run the new live code: publish it and move the alias. */
export async function repointWarmAlias(templateId: string): Promise<void> {
  const app = await liveFunction(templateId);
  if (app.hostingTier !== "PROVISIONED") return;
  const lambda = await functionsLambda();
  const version = await publishLiveVersion(lambda, app.functionName);
  await pointWarmAliasAt(lambda, app.functionName, version);
}
