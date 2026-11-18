import { NextRequest, NextResponse } from "next/server";
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { fromNodeProviderChain, fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentity } from "@smithy/types";
import { getObject } from "@/lib/projects/blobStore";
import { checkDeployedAppDailyLimit } from "@/lib/pub/deployedAppRateLimit";
import { cacheControlFor } from "@/lib/pub/serveDeployedStatic";
import { capCacheControl } from "@/lib/pub/capCacheControl";

// Serves an SSR app (DeployedApp type SSR): static files come straight from S3, and everything
// else is proxied to the app's own Lambda Function URL, which is IAM-authenticated, so only this
// app (plexo-web's role) can call it. Static files never reach the function.

const REGION = process.env.AWS_REGION || "us-east-1";

export type DeployedSsrShape = {
  functionUrl?: string | null;
  /** The warm copy's URL. Used instead of functionUrl while hostingTier is PROVISIONED. */
  alwaysOnFunctionUrl?: string | null;
  /** The image optimizer, for apps that use next/image. Empty or missing means no image function. */
  imageFunctionUrl?: string | null;
  ssrSitePrefix?: string | null;
  hostingTier?: string | null;
};

// Request headers the app's code may see. Never host or accept-encoding: Node's fetch decodes
// compressed bodies but would keep the encoding header, so the app is asked for identity bytes.
const FORWARD = new Set(["accept", "accept-language", "content-type", "cookie", "referer", "user-agent"]);
// The client's address travels as x-plexo-client-ip, not x-forwarded-for. The function URL changes
// x-forwarded-for after the request is signed, so a signed x-forwarded-for makes the call fail with
// InvalidSignatureException (reproduced: 403 with x-forwarded-for, 200 with any other name).
// Hop-by-hop and length headers that don't survive re-wrapping the body.
const DROP_FROM_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"]);
// Only standard response headers are passed on. The app's own platform headers (x-nextjs-*, x-opennext,
// x-powered-by, vary, x-amzn-*) are left behind: the HTML response carrying them returned 502 through the web app.
const FORWARD_FROM_RESPONSE = new Set([
  "content-type",
  "content-language",
  "content-disposition",
  "location",
  "set-cookie",
  "cache-control",
  "etag",
  "last-modified",
  "x-robots-tag",
]);

let credentialsProvider: (() => Promise<AwsCredentialIdentity>) | null = null;
/** plexo-web's own credentials, or — when FUNCTIONS_ACCOUNT_ROLE_ARN is set (functions live in
 * another account) — the role in that account, the same way lib/appFunctions does it. */
function credentials(): () => Promise<AwsCredentialIdentity> {
  if (credentialsProvider) return credentialsProvider;
  const roleArn = process.env.FUNCTIONS_ACCOUNT_ROLE_ARN;
  credentialsProvider = roleArn
    ? fromTemporaryCredentials({ params: { RoleArn: roleArn, RoleSessionName: "plexo-ssr-invoke", DurationSeconds: 3600 }, clientConfig: { region: REGION } })
    : fromNodeProviderChain();
  return credentialsProvider;
}

/** Calls the SSR function's Function URL with a SigV4 signature (service "lambda"). */
export async function invokeSsrFunction(functionUrl: string, request: NextRequest, slugSegments: string[]): Promise<Response> {
  const url = new URL(functionUrl);
  const incoming = new URL(request.url);
  const path = "/" + slugSegments.map(encodeURIComponent).join("/");
  const query: Record<string, string> = {};
  incoming.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  const headers: Record<string, string> = { host: url.hostname };
  request.headers.forEach((value, key) => {
    if (FORWARD.has(key)) headers[key] = value;
  });
  const clientIp = request.headers.get("x-forwarded-for");
  if (clientIp) headers["x-plexo-client-ip"] = clientIp;
  const forwardedHost = request.headers.get("host");
  if (forwardedHost) headers["x-forwarded-host"] = forwardedHost;
  headers["x-forwarded-proto"] = "https";

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;

  const signer = new SignatureV4({ credentials: credentials(), region: REGION, service: "lambda", sha256: Sha256 });
  const unsigned = new HttpRequest({ method: request.method, protocol: "https:", hostname: url.hostname, path, query, headers, body });
  const signed = await signer.sign(unsigned);

  return fetch(`https://${url.hostname}${path}${incoming.search}`, {
    method: request.method,
    headers: signed.headers,
    body: body ? new Uint8Array(body) : undefined,
    redirect: "manual",
  });
}

/** Copies an upstream (function) response back to the visitor. */
function relay(upstream: Response, app: DeployedSsrShape, rawPath: string, brand?: { templateId: string; method: string }): Promise<NextResponse> | NextResponse {
  // TEMPORARY (debug/upstream-status): the server app's status, to find the 502 on plexo-next.
  console.log("[pub-debug] upstream", upstream.status, upstream.headers.get("content-type"), upstream.headers.get("x-amzn-errortype") ?? "", upstream.headers.get("x-plexo-hosting-tier") ?? "");
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (FORWARD_FROM_RESPONSE.has(key)) headers.append(key, value);
  });
  const appCacheControl = headers.get("cache-control");
  if (appCacheControl) headers.set("Cache-Control", capCacheControl(appCacheControl));
  else headers.set("Cache-Control", cacheControlFor(rawPath || "index.html", app.hostingTier));
  headers.set("X-Plexo-Hosting-Tier", app.hostingTier ?? "LAMBDA");
  // Decoded by fetch above, so the bytes are identity: send them as-is.
  return upstream.arrayBuffer().then(async (body) => {
    let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(body);
    // The site's brand link goes into full HTML pages (never other responses; fails open). See lib/brand/ssrInject.ts.
    // Only for HTML, and fail open: any trouble (even loading the brand code) serves the app's bytes untouched.
    if (brand?.templateId && process.env.BRAND_SERVER_INJECT?.trim().toLowerCase() !== "off" && /^\s*text\/html/i.test(headers.get("content-type") ?? "")) {
      try {
        const { applyBrandToAppResponse } = await import("@/lib/brand/ssrInject");
        bytes = (await applyBrandToAppResponse(bytes, brand.templateId, { status: upstream.status, contentType: headers.get("content-type"), method: brand.method })) as Uint8Array<ArrayBuffer>;
      } catch (err) {
        console.warn("[site-brand] serving the app without the brand", err);
      }
    }
    return new NextResponse(bytes, { status: upstream.status, headers });
  });
}

/** The app's built assets are addressed under /__plexo/assets/ (the build sets the app's assetPrefix to it).
 * The app's own paths are what's left after that prefix. */
function appPath(slugSegments: string[]): string[] {
  return slugSegments[0] === "__plexo" && slugSegments[1] === "assets" ? slugSegments.slice(2) : slugSegments;
}

export async function serveDeployedSsr(
  request: NextRequest,
  app: DeployedSsrShape,
  incomingSegments: string[],
  options: { templateId: string; dailyRequestLimit?: number | null; onNotFound?: () => NextResponse },
): Promise<NextResponse> {
  const slugSegments = appPath(incomingSegments);
  const notFound = options.onNotFound ?? (() => new NextResponse(null, { status: 404 }));
  const rawPath = slugSegments.join("/");

  // Static file (an asset with an extension that isn't an HTML page): served from S3, not counted
  // against the Lambda cap, and never invoking the function.
  const hasAssetExtension = /\.[a-z0-9]{1,10}$/i.test(rawPath) && !/\.html?$/i.test(rawPath);
  if (hasAssetExtension && app.ssrSitePrefix && request.method === "GET") {
    const file = await getObject(`${app.ssrSitePrefix}/${rawPath}`);
    if (file) {
      const headers = new Headers({
        "Content-Type": file.contentType || "application/octet-stream",
        "Cache-Control": cacheControlFor(rawPath, app.hostingTier),
        "X-Content-Type-Options": "nosniff",
      });
      if (file.etag) headers.set("ETag", file.etag);
      return new NextResponse(new Uint8Array(file.body), { headers });
    }
  }

  const targetUrl = app.hostingTier === "PROVISIONED" && app.alwaysOnFunctionUrl ? app.alwaysOnFunctionUrl : app.functionUrl;
  if (!targetUrl) return notFound();

  // Everything else runs the app's code (or its image optimizer), so it's charged against the
  // owner's daily cap. Image requests count too, so a busy image page can't bypass the cap.
  if (options.dailyRequestLimit !== undefined) {
    const allowed = await checkDeployedAppDailyLimit(options.templateId, options.dailyRequestLimit ?? null);
    if (!allowed) {
      return new NextResponse("Daily request limit reached. Upgrade your plan for more capacity.", {
        status: 429,
        headers: { "Retry-After": "86400", "Content-Type": "text/plain" },
      });
    }
  }

  // next/image: the optimizer is GET-only, so anything else is refused without invoking it.
  if (slugSegments[0] === "_next" && slugSegments[1] === "image") {
    if (!app.imageFunctionUrl) return notFound();
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new NextResponse(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    return relay(await invokeSsrFunction(app.imageFunctionUrl, request, slugSegments), app, rawPath);
  }

  return relay(await invokeSsrFunction(targetUrl, request, slugSegments), app, rawPath, { templateId: options.templateId, method: request.method });
}
