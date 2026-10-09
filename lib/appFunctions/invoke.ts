import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { createHash } from "node:crypto";
import { AppFunction, type AppEnv } from "@/lib/db/appEntities";
import { RestError } from "@/lib/appData/rest";
import type { AppContext } from "@/lib/appRuntime/context";
import type { AppUserRow } from "@/lib/appAuth/store";

// Calls an app's server function (plexo.functions.invoke("name")) and reads its logs.

const REGION = process.env.AWS_REGION || "us-east-1";
const MAX_BODY = 5 * 1024 * 1024;

let cached: { lambda: LambdaClient; logs: CloudWatchLogsClient; until: number } | null = null;
async function clients() {
  if (cached && cached.until > Date.now()) return cached;
  const roleArn = process.env.FUNCTIONS_ACCOUNT_ROLE_ARN;
  if (!roleArn) {
    cached = { lambda: new LambdaClient({ region: REGION }), logs: new CloudWatchLogsClient({ region: REGION }), until: Number.MAX_SAFE_INTEGER };
    return cached;
  }
  const { Credentials } = await new STSClient({ region: REGION }).send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "plexo-functions-invoke", DurationSeconds: 3600 }));
  const credentials = { accessKeyId: Credentials!.AccessKeyId!, secretAccessKey: Credentials!.SecretAccessKey!, sessionToken: Credentials!.SessionToken! };
  cached = { lambda: new LambdaClient({ region: REGION, credentials }), logs: new CloudWatchLogsClient({ region: REGION, credentials }), until: Date.now() + 50 * 60 * 1000 };
  return cached;
}

const fnCache = new Map<string, { lambdaName: string | null; at: number }>();
async function lambdaFor(templateId: string, env: AppEnv, name: string): Promise<string | null> {
  const key = `${templateId}:${env}:${name}`;
  const hit = fnCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.lambdaName;
  const { data } = await AppFunction.get({ templateId, env, name }).go();
  const lambdaName = data?.status === "READY" ? data.lambdaName : null;
  fnCache.set(key, { lambdaName, at: Date.now() });
  return lambdaName;
}

// Request headers a function may see. Never the visitor's cookies: a function gets the
// signed-in user as ctx.user instead of the raw session.
const FORWARD = new Set(["content-type", "accept", "accept-language", "user-agent", "x-request-id", "stripe-signature", "x-hub-signature-256", "x-signature", "authorization"]);

export async function invokeFunction(ctx: AppContext, name: string, request: Request, user: AppUserRow | null): Promise<Response> {
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(name)) throw new RestError(`"${name}" isn't a valid function name.`, 404);
  const lambdaName = await lambdaFor(ctx.templateId, ctx.env, name);
  if (!lambdaName) {
    throw new RestError(`There's no server function called "${name}".`, 404, `Create functions/${name}.ts with a default export, then ${ctx.env === "dev" ? "rebuild" : "publish"}.`);
  }
  const body = ["GET", "HEAD"].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
  if (body && body.length > MAX_BODY) throw new RestError("The request is too large for a function (5 MB at most).", 413);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    if (FORWARD.has(k)) headers[k] = v;
  });
  const url = new URL(request.url);
  const event = {
    kind: "http",
    method: request.method,
    url: `${ctx.origin}/__plexo/api/fn/${name}${url.search}`,
    headers,
    bodyBase64: body?.toString("base64"),
    user: user ? { id: user.id, email: user.email, role: user.role, metadata: user.metadata ?? {} } : null,
  };
  const { lambda } = await clients();
  const res = await lambda.send(new InvokeCommand({ FunctionName: lambdaName, Payload: Buffer.from(JSON.stringify(event)) }));
  if (res.FunctionError) {
    const detail = res.Payload ? Buffer.from(res.Payload).toString("utf8").slice(0, 500) : "";
    console.error(`Function ${lambdaName} failed: ${res.FunctionError} ${detail}`);
    const timedOut = /Task timed out/i.test(detail);
    return Response.json(
      { error: { message: timedOut ? `The "${name}" function took longer than 30 seconds.` : `The "${name}" function crashed.`, code: "function_error", hint: "Check its logs in Plexo → your app → Functions." } },
      { status: timedOut ? 504 : 502 },
    );
  }
  const out = JSON.parse(Buffer.from(res.Payload!).toString("utf8")) as { status: number; headers: Record<string, string>; bodyBase64: string };
  const outHeaders = new Headers();
  for (const [k, v] of Object.entries(out.headers ?? {})) {
    // A function can't set cookies on the app's domain (that's the app's session space).
    if (k.toLowerCase() !== "set-cookie") outHeaders.set(k, v);
  }
  outHeaders.set("Cache-Control", outHeaders.get("Cache-Control") ?? "no-store");
  return new Response(Buffer.from(out.bodyBase64 ?? "", "base64"), { status: out.status || 200, headers: outHeaders });
}

/** Runs a function on demand from the dashboard ("Run now" / testing a schedule). */
export async function runFunctionNow(templateId: string, env: AppEnv, name: string): Promise<{ status: number; body: string }> {
  const lambdaName = await lambdaFor(templateId, env, name);
  if (!lambdaName) throw new RestError(`There's no deployed function called "${name}".`, 404);
  const { lambda } = await clients();
  const res = await lambda.send(new InvokeCommand({ FunctionName: lambdaName, Payload: Buffer.from(JSON.stringify({ kind: "schedule", scheduledAt: new Date().toISOString() })) }));
  if (res.FunctionError) return { status: 500, body: Buffer.from(res.Payload ?? []).toString("utf8").slice(0, 2000) };
  const out = JSON.parse(Buffer.from(res.Payload!).toString("utf8"));
  return { status: out.status, body: Buffer.from(out.bodyBase64 ?? "", "base64").toString("utf8").slice(0, 10_000) };
}

export type LogLine = { at: string; message: string; requestId?: string };

export async function functionLogs(templateId: string, env: AppEnv, name: string, opts: { sinceMinutes?: number; filter?: string } = {}): Promise<LogLine[]> {
  const { data } = await AppFunction.get({ templateId, env, name }).go();
  if (!data) return [];
  const { logs } = await clients();
  const res = await logs.send(
    new FilterLogEventsCommand({
      logGroupName: `/aws/lambda/${data.lambdaName}`,
      startTime: Date.now() - (opts.sinceMinutes ?? 60) * 60_000,
      filterPattern: opts.filter ? `"${opts.filter.replace(/"/g, "")}"` : undefined,
      limit: 500,
    }),
  ).catch((err) => {
    if (err?.name === "ResourceNotFoundException") return { events: [] };
    throw err;
  });
  return (res.events ?? [])
    .filter((e) => !/^(START|END|REPORT|INIT_START) RequestId/.test(e.message ?? ""))
    .map((e) => {
      const m = (e.message ?? "").match(/^\S+\t([0-9a-f-]{36})\t(?:\w+\t)?([\s\S]*)$/);
      return { at: new Date(e.timestamp ?? 0).toISOString(), message: (m ? m[2] : e.message ?? "").trimEnd(), requestId: m?.[1] };
    });
}

export function serviceKeyMatches(provided: string | null, hash: string | undefined | null): boolean {
  if (!provided || !hash) return false;
  return createHash("sha256").update(provided).digest("hex") === hash;
}
