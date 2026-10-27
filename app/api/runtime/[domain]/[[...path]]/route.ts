import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolveAppContext, type AppContext } from "@/lib/appRuntime/context";
import { ok, fail, errorResponse, readJson, requestMeta, throttle } from "@/lib/appRuntime/http";
import { runQuery, runRpc, type Caller } from "@/lib/appRuntime/data";
import { readSessionToken, sessionSetCookie, sessionClearCookie } from "@/lib/appAuth/cookies";
import * as auth from "@/lib/appAuth/service";
import { toPublicUser } from "@/lib/appAuth/store";
import { startGoogleSignIn, parseState, consumeOAuthState, finishGoogleSignIn, completeHandoff } from "@/lib/appAuth/oauth";
import * as storage from "@/lib/appStorage";
import { invokeFunction, serviceKeyMatches } from "@/lib/appFunctions/invoke";
import { resolveSecrets } from "@/lib/appFunctions/secrets";
import { runOwnerSql } from "@/lib/appData/migrations";
import { runDb } from "@/lib/appData/db";
import { AppRuntimeError } from "@/lib/db/appEntities";
import { PageView } from "@/lib/db/opsEntities";
import { recordPageViewRollup } from "@/lib/analyticsRollup";
import { parseUserAgent, extractGeoFromHeaders } from "@/server/analytics";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { emailShell, sendMaildripEmail } from "@/lib/mail/maildrip";
import { logEmailDelivery } from "@/lib/mail/logEmail";

// The backend of every app built on Plexo, answered on the app's own domain at
// /__plexo/api/* (middleware.ts rewrites it here; this path is unreachable directly).
// See docs/plexo-projects/ARCHITECTURE.md "Runtime API" for the full list.

type Params = { params: Promise<{ domain: string; path?: string[] }> };

async function context(request: NextRequest, params: Params["params"]): Promise<{ ctx: AppContext; path: string[] } | NextResponse> {
  const { domain, path = [] } = await params;
  const ctx = await resolveAppContext(decodeURIComponent(domain));
  if (!ctx) return fail(404, "This app doesn't exist or isn't published.", "app_not_found");
  // Same-origin only: a page on any other site can't use a visitor's session here.
  const origin = request.headers.get("origin");
  if (origin && origin !== ctx.origin && request.method !== "GET" && !request.headers.get("x-plexo-service-key")) {
    return fail(403, "Requests from other websites aren't allowed.", "cross_origin");
  }
  return { ctx, path };
}

async function caller(request: NextRequest, ctx: AppContext): Promise<Caller> {
  const key = request.headers.get("x-plexo-service-key");
  if (key) {
    const hash = ctx.env === "dev" ? ctx.settings.serviceKeyHashDev : ctx.settings.serviceKeyHashLive;
    if (!serviceKeyMatches(key, hash)) throw new auth.AuthError("That service key isn't valid for this app.", 401, "invalid_service_key");
    return { kind: "service" };
  }
  return { kind: "visitor", user: await auth.currentUser(ctx, readSessionToken(request, ctx.host)) };
}

function withSession(res: NextResponse, ctx: AppContext, token: string | null): NextResponse {
  res.headers.append("Set-Cookie", token ? sessionSetCookie(ctx.host, token) : sessionClearCookie(ctx.host));
  return res;
}

function redirect(url: string, ctx: AppContext, token?: string | null, error?: string): NextResponse {
  const target = new URL(url);
  if (error) target.searchParams.set("auth_error", error);
  const res = NextResponse.redirect(target.toString(), 303);
  res.headers.set("Cache-Control", "no-store");
  if (token !== undefined) withSession(res, ctx, token);
  return res;
}

// ------------------------------------------------------------------ auth

async function handleAuth(request: NextRequest, ctx: AppContext, rest: string[]): Promise<NextResponse> {
  const meta = requestMeta(request);
  const route = rest.join("/");
  const method = request.method;

  if (method === "GET" && route === "session") {
    const user = await auth.currentUser(ctx, readSessionToken(request, ctx.host));
    return ok({ user: user ? toPublicUser(user) : null });
  }
  if (method === "GET" && route === "verify") {
    const q = request.nextUrl.searchParams;
    const result = await auth.verifyLink(ctx, q.get("type") ?? "", q.get("token") ?? "", meta);
    return redirect(result.redirectTo, ctx, result.signedIn?.sessionToken, result.error);
  }
  if (method === "GET" && route === "oauth/google") {
    try {
      return redirect(await startGoogleSignIn(ctx, request.nextUrl.searchParams.get("redirectTo")), ctx);
    } catch (err) {
      return redirect(auth.safeRedirect(ctx, request.nextUrl.searchParams.get("redirectTo")), ctx, undefined, err instanceof Error ? err.message : "Sign-in failed.");
    }
  }
  if (method === "GET" && route === "oauth/google/callback") {
    const q = request.nextUrl.searchParams;
    const state = parseState(q.get("state"));
    const st = state && state.templateId === ctx.templateId ? await consumeOAuthState(ctx, state.token) : null;
    if (!st) return redirect(auth.safeRedirect(ctx, "/"), ctx, undefined, "That sign-in attempt expired. Please try again.");
    try {
      const result = await finishGoogleSignIn(ctx, { code: q.get("code"), state: st, via: "app" }, meta);
      return redirect(result.redirectTo, ctx, result.signedIn?.sessionToken);
    } catch (err) {
      return redirect(auth.safeRedirect(ctx, st.redirectTo), ctx, undefined, err instanceof Error ? err.message : "Sign-in failed.");
    }
  }
  if (method === "GET" && route === "oauth/complete") {
    const result = await completeHandoff(ctx, request.nextUrl.searchParams.get("token") ?? "", meta);
    return redirect(result.redirectTo, ctx, result.signedIn?.sessionToken);
  }

  if (method !== "POST") return fail(405, "Method not allowed.");
  const body = await readJson(request, 64_000);
  switch (route) {
    case "signup": {
      const result = await auth.signUp(ctx, body, meta);
      if ("needsEmailConfirmation" in result) return ok({ user: null, needsEmailConfirmation: true });
      return withSession(ok({ user: result.user, needsEmailConfirmation: false }), ctx, result.sessionToken);
    }
    case "login": {
      const result = await auth.signInWithPassword(ctx, body, meta);
      return withSession(ok({ user: result.user }), ctx, result.sessionToken);
    }
    case "magic-link":
      await auth.sendMagicLink(ctx, body, meta);
      return ok({ sent: true });
    case "recover":
      await auth.sendPasswordReset(ctx, body, meta);
      return ok({ sent: true });
    case "reset": {
      const result = await auth.resetPassword(ctx, body, meta);
      return withSession(ok({ user: result.user }), ctx, result.sessionToken);
    }
    case "logout": {
      await auth.signOut(ctx, readSessionToken(request, ctx.host));
      return withSession(ok(null), ctx, null);
    }
    case "update": {
      const token = readSessionToken(request, ctx.host);
      const user = await auth.currentUser(ctx, token);
      if (!user || !token) return fail(401, "Sign in first.", "not_signed_in");
      return ok({ user: await auth.updateSignedInUser(ctx, { user, sessionToken: token }, body) });
    }
  }
  return fail(404, `Unknown sign-in action "${route}".`);
}

// ------------------------------------------------------------------ platform endpoints

async function recordRuntimeError(request: NextRequest, ctx: AppContext): Promise<NextResponse> {
  if (ctx.env !== "dev") return new NextResponse(null, { status: 204 });
  if (!throttle(`rterr:${ctx.templateId}`, 120)) return new NextResponse(null, { status: 204 });
  const body = await readJson(request, 20_000).catch(() => ({}) as Record<string, any>);
  const message = String(body.message ?? "").slice(0, 2000);
  if (!message) return new NextResponse(null, { status: 204 });
  await AppRuntimeError.create({
    templateId: ctx.templateId,
    id: randomUUID(),
    kind: String(body.kind ?? "error").slice(0, 40),
    message,
    stack: body.stack ? String(body.stack).slice(0, 6000) : undefined,
    url: body.url ? String(body.url).slice(0, 500) : undefined,
  }).go();
  return new NextResponse(null, { status: 204 });
}

async function recordPageView(request: NextRequest, ctx: AppContext): Promise<NextResponse> {
  if (ctx.env !== "live" || !throttle(`pv:${requestMeta(request).ipHash}:${ctx.templateId}`, 120)) return new NextResponse(null, { status: 204 });
  const userAgent = request.headers.get("user-agent");
  const { deviceType, browser, os } = parseUserAgent(userAgent);
  const { country, region, city } = extractGeoFromHeaders(request.headers);
  const createdAt = new Date();
  await Promise.allSettled([
    PageView.create({
      id: randomUUID(),
      templateId: ctx.templateId,
      domain: ctx.host,
      ipHash: requestMeta(request).ipHash,
      userAgent: userAgent ?? undefined,
      deviceType: deviceType ?? undefined,
      browser: browser ?? undefined,
      os: os ?? undefined,
      country: country ?? undefined,
      region: region ?? undefined,
      city: city ?? undefined,
    }).go(),
    recordPageViewRollup({ createdAt, templateId: ctx.templateId, deviceType, browser, os }),
  ]);
  return new NextResponse(null, { status: 204 });
}

async function handleService(request: NextRequest, ctx: AppContext, who: Caller, rest: string[]): Promise<NextResponse> {
  if (who.kind !== "service") return fail(401, "This endpoint is only for the app's server functions.", "service_only");
  const route = rest.join("/");
  if (route === "secrets" && request.method === "GET") return ok(await resolveSecrets(ctx.templateId, ctx.env));
  if (route === "sql" && request.method === "POST") {
    const body = await readJson(request);
    if (typeof body.query !== "string" || !body.query.trim()) return fail(400, "Pass { query, params? }.");
    if (Array.isArray(body.params) && body.params.length) {
      // Parameterized queries run as a single statement through the owner login.
      const [result] = await runDb({ database: ctx.database, login: "owner", statements: [{ sql: body.query, params: body.params }], statementTimeoutMs: 30_000, maxRows: 5000 });
      return ok(result.rows, { count: result.rowCount });
    }
    const result = await runOwnerSql({ templateId: ctx.templateId, organizationId: ctx.organizationId, env: ctx.env, sql: body.query, maxRows: 5000 });
    return ok(result.rows, { count: result.rowCount });
  }
  if (route === "email" && request.method === "POST") {
    const body = await readJson(request, 300_000);
    const to = (Array.isArray(body.to) ? body.to : [body.to]).filter((t: unknown) => typeof t === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
    if (!to.length || to.length > 50) return fail(400, "Pass 1–50 valid email addresses in `to`.");
    if (typeof body.subject !== "string" || !body.subject.trim()) return fail(400, "Pass a `subject`.");
    if (!(await checkCommerceRateLimit(`appemail:${ctx.templateId}`, 500, 24 * 60 * 60_000))) {
      return fail(429, "This app has reached its email limit for today (500).", "email_limit");
    }
    const html = typeof body.html === "string" ? body.html : emailShell({ title: body.subject, brand: { name: ctx.appName }, bodyHtml: `<p style="font-size:15px;color:#334155;line-height:1.6;white-space:pre-wrap;">${String(body.text ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</p>` });
    for (const recipient of to) {
      try {
        await sendMaildripEmail({ to: recipient, subject: String(body.subject).slice(0, 200), html });
        logEmailDelivery({ kind: "maildrip", to: recipient, subject: body.subject, status: "sent", context: "app_function_email", organizationId: ctx.organizationId, templateId: ctx.templateId });
      } catch (err) {
        logEmailDelivery({ kind: "maildrip", to: recipient, subject: body.subject, status: "failed", errorMessage: err instanceof Error ? err.message : String(err), context: "app_function_email", organizationId: ctx.organizationId, templateId: ctx.templateId });
        return fail(502, "The email couldn't be sent.", "email_failed");
      }
    }
    return ok({ sent: to.length });
  }
  return fail(404, `Unknown service endpoint "${route}".`);
}

// ------------------------------------------------------------------ dispatch

async function handle(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const resolved = await context(request, params);
    if (resolved instanceof NextResponse) return resolved;
    const { ctx, path } = resolved;
    const [area, ...rest] = path;

    if (area === "auth") return await handleAuth(request, ctx, rest);
    if (area === "_runtime" && rest[0] === "errors" && request.method === "POST") return await recordRuntimeError(request, ctx);
    if (area === "_analytics" && rest[0] === "pageview" && request.method === "POST") return await recordPageView(request, ctx);
    if (area === "health") return ok({ app: ctx.appName, env: ctx.env });

    const who = await caller(request, ctx);
    const client = who.kind === "service" ? "service" : who.user?.id ?? requestMeta(request).ipHash;
    if (!throttle(`api:${ctx.templateId}:${client}`, ctx.settings.requestsPerMinute ?? 600)) {
      return fail(429, "Too many requests — slow down a little.", "rate_limited");
    }

    if (area === "_service") return await handleService(request, ctx, who, rest);

    if (area === "rest" && rest.length === 1 && request.method === "POST") {
      const result = await runQuery(ctx, who, decodeURIComponent(rest[0]), await readJson(request, 2_000_000));
      return ok(result.data, { count: result.count });
    }
    if (area === "rpc" && rest.length === 1 && request.method === "POST") {
      const result = await runRpc(ctx, who, decodeURIComponent(rest[0]), await readJson(request, 1_000_000));
      return ok(result.data);
    }
    if (area === "fn" && rest.length === 1) {
      const res = await invokeFunction(ctx, decodeURIComponent(rest[0]), request, who.kind === "visitor" ? who.user : null);
      return new NextResponse(res.body, { status: res.status, headers: res.headers });
    }
    if (area === "storage" && rest.length >= 2) {
      const bucket = decodeURIComponent(rest[0]);
      const op = rest[1];
      const storageCaller: storage.StorageCaller = who.kind === "service" ? { kind: "service" } : { kind: "visitor", user: who.user };
      if (op === "list" && request.method === "GET") return ok(await storage.listFiles(ctx, storageCaller, bucket, request.nextUrl.searchParams.get("prefix") ?? ""));
      if (request.method === "POST") {
        const body = await readJson(request, 64_000);
        if (op === "sign-upload") return ok(await storage.signUpload(ctx, storageCaller, bucket, body));
        if (op === "sign-download") return ok(await storage.signDownload(ctx, storageCaller, bucket, body));
        if (op === "remove") return ok(await storage.removeFiles(ctx, storageCaller, bucket, body));
      }
    }
    return fail(404, "Unknown endpoint.", "not_found");
  } catch (err) {
    return errorResponse(err);
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const maxDuration = 60;

export function OPTIONS(): NextResponse {
  // Same-origin API: no cross-origin access is granted.
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
