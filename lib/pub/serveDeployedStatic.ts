import { NextRequest, NextResponse } from "next/server";
import type { RedirectRule } from "@/lib/db/appEntities";
import { deployedAppFileUrl } from "@/lib/storage";
import { checkDeployedAppDailyLimit } from "@/lib/pub/deployedAppRateLimit";

// Hashed asset detection: Vite ("main-BszCFdh3.js"), Webpack ("main.abc12345.chunk.js"),
// CRA ("runtime-main.a1b2c3d4.js"), Next.js export ("page-Abc12345.js") — all share the
// shape of a separator followed by 8+ alphanumeric characters immediately before the
// final extension. False-positive risk is low; worst case a non-hashed file gets an
// immutable Cache-Control, which only matters on a re-deploy of the exact same filename.
function isHashedAsset(filename: string): boolean {
  const nameNoExt = filename.replace(/\.[^./\\]+$/, "");
  const lastSegment = nameNoExt.split(/[.\-_]/).pop() ?? "";
  return lastSegment.length >= 8 && /^[a-zA-Z0-9]+$/.test(lastSegment);
}

export function cacheControlFor(filePath: string, hostingTier?: string | null): string {
  const filename = filePath.split("/").pop() ?? filePath;
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ext === "html" || ext === "htm") {
    // STATIC-tier apps: allow CloudFront to cache HTML for up to 1 hour so repeat visits
    // never invoke Lambda. pageCachePolicy.maxTtl in published-sites-stack.ts is raised to
    // 3600s to match. LAMBDA/PROVISIONED tiers: no-cache keeps Lambda in the critical path
    // for every request (server-rendered or personalized content).
    return hostingTier === "STATIC" ? "public, s-maxage=3600, max-age=300" : "no-cache";
  }
  if (isHashedAsset(filename)) return "public, max-age=31536000, immutable";
  return "public, max-age=60, stale-while-revalidate=3600";
}

// Simple redirect rule matching — supports exact paths and a single trailing wildcard.
// Returns null on no match; returns the captures ({ splat }) on match.
function matchRedirectRule(from: string, requestedPath: string): Record<string, string> | null {
  const normalFrom = from.startsWith("/") ? from : `/${from}`;
  const normalPath = requestedPath.startsWith("/") ? requestedPath : `/${requestedPath}`;
  if (!from.includes("*")) {
    return normalFrom === normalPath ? {} : null;
  }
  const escaped = normalFrom.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)");
  const m = new RegExp(`^${escaped}$`).exec(normalPath);
  return m ? { splat: m[1] ?? "" } : null;
}

function applyRedirectDest(to: string, captures: Record<string, string>): string {
  return to.replace(/:splat/g, captures.splat ?? "");
}

type DeployedAppShape = {
  s3Prefix?: string | null;
  spaMode?: boolean | null;
  redirectRules?: unknown;
  hostingTier?: string | null;
};

export async function serveDeployedStatic(
  request: NextRequest,
  app: DeployedAppShape,
  slugSegments: string[],
  options: { onNotFound?: () => NextResponse; dailyRequestLimit?: number | null; templateId?: string } = {},
): Promise<NextResponse> {
  const notFound = options.onNotFound ?? (() => new NextResponse(null, { status: 404 }));

  // Daily Lambda-invocation cap — charged against the owner's plan limit.
  // STATIC requests served from CloudFront cache never reach here, so they don't count.
  if (options.templateId && options.dailyRequestLimit !== undefined) {
    const allowed = await checkDeployedAppDailyLimit(options.templateId, options.dailyRequestLimit ?? null);
    if (!allowed) {
      return new NextResponse("Daily request limit reached. Upgrade your plan for more capacity.", {
        status: 429,
        headers: { "Retry-After": "86400", "Content-Type": "text/plain" },
      });
    }
  }
  const s3Prefix = app.s3Prefix;
  if (!s3Prefix) return notFound();

  const spaMode = app.spaMode ?? false;
  const rules = (app.redirectRules as RedirectRule[] | null | undefined) ?? [];
  const requestedPath = "/" + slugSegments.join("/");

  // 1. Redirect rules evaluated first — same order as Netlify/Cloudflare Pages.
  for (const rule of rules) {
    if (rule.status < 300 || rule.status > 308) continue;
    const captures = matchRedirectRule(rule.from, requestedPath);
    if (captures) {
      const dest = applyRedirectDest(rule.to, captures);
      return NextResponse.redirect(new URL(dest, request.url), rule.status);
    }
  }

  // 2. Build candidate file paths in priority order.
  // A path with no file extension gets tried as-is, then with .html appended, then as a
  // directory index — same resolution order as Netlify/Vercel/GitHub Pages.
  const rawPath = slugSegments.join("/") || "index.html";
  const hasExtension = /\.[a-z0-9]{1,10}$/i.test(rawPath);
  const candidates: string[] = hasExtension
    ? [rawPath]
    : [rawPath, `${rawPath}.html`, `${rawPath}/index.html`];

  if (spaMode && !candidates.includes("index.html")) {
    candidates.push("index.html");
  }

  // 3. Try each candidate against S3.
  for (const candidate of candidates) {
    const fileUrl = deployedAppFileUrl(s3Prefix, candidate);
    const s3Res = await fetch(fileUrl, { cache: "no-store" });
    if (!s3Res.ok || !s3Res.body) continue;

    const headers = new Headers({
      "Content-Type": s3Res.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": cacheControlFor(candidate, app.hostingTier),
      "X-Content-Type-Options": "nosniff",
      "X-Plexo-Hosting-Tier": app.hostingTier ?? "LAMBDA",
    });
    const etag = s3Res.headers.get("etag");
    if (etag) headers.set("ETag", etag);
    const lastModified = s3Res.headers.get("last-modified");
    if (lastModified) headers.set("Last-Modified", lastModified);
    return new NextResponse(s3Res.body, { headers });
  }

  return notFound();
}
