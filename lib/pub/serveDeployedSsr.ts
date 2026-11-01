import { NextRequest, NextResponse } from "next/server";
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { fromNodeProviderChain, fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentity } from "@smithy/types";
import { getObject } from "@/lib/projects/blobStore";
import { checkDeployedAppDailyLimit } from "@/lib/pub/deployedAppRateLimit";
import { cacheControlFor } from "@/lib/pub/serveDeployedStatic";

// Serves an SSR app (DeployedApp type SSR): static files come straight from S3, and everything
// else is proxied to the app's own Lambda Function URL, which is IAM-authenticated, so only this
// app (plexo-web's role) can call it. Static files never reach the function.

const REGION = process.env.AWS_REGION || "us-east-1";

export type DeployedSsrShape = {
  functionUrl?: string | null;
  ssrSitePrefix?: string | null;
  hostingTier?: string | null;
};

// Request headers the app's code may see. Never host or accept-encoding: Node's fetch decodes
// compressed bodies but would keep the encoding header, so the app is asked for identity bytes.
const FORWARD = new Set(["accept", "accept-language", "content-type", "cookie", "referer", "user-agent", "x-forwarded-for"]);
// Hop-by-hop and length headers that don't survive re-wrapping the body.
const DROP_FROM_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length"]);

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

export async function serveDeployedSsr(
  request: NextRequest,
  app: DeployedSsrShape,
  slugSegments: string[],
  options: { templateId: string; dailyRequestLimit?: number | null; onNotFound?: () => NextResponse },
): Promise<NextResponse> {
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

  if (!app.functionUrl) return notFound();

  // Everything else runs the app's code, so it's charged against the owner's daily cap.
  if (options.dailyRequestLimit !== undefined) {
    const allowed = await checkDeployedAppDailyLimit(options.templateId, options.dailyRequestLimit ?? null);
    if (!allowed) {
      return new NextResponse("Daily request limit reached. Upgrade your plan for more capacity.", {
        status: 429,
        headers: { "Retry-After": "86400", "Content-Type": "text/plain" },
      });
    }
  }

  const upstream = await invokeSsrFunction(app.functionUrl, request, slugSegments);
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_FROM_RESPONSE.has(key)) headers.append(key, value);
  });
  if (!headers.has("cache-control")) headers.set("Cache-Control", cacheControlFor(rawPath || "index.html", app.hostingTier));
  headers.set("X-Plexo-Hosting-Tier", app.hostingTier ?? "LAMBDA");
  // Decoded by fetch above, so the bytes are identity: send them as-is.
  return new NextResponse(new Uint8Array(await upstream.arrayBuffer()), { status: upstream.status, headers });
}
