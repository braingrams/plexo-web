import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { DeployedApp } from "@/lib/db/appEntities";
import { serveDeployedStatic } from "@/lib/pub/serveDeployedStatic";

// Single catch-all handler for all /blog/* paths. Sits at a lower specificity than
// blog/feed.xml/route.ts and blog/sitemap.xml/route.ts, which keep their own handlers.
//
// Why this exists: app/pub/[domain]/blog/page.tsx (RSC) takes Next.js routing precedence
// over [[...slug]]/route.ts (catch-all), so the deployed-app DeployedApp check in
// [[...slug]] never ran for any /blog/* path. Converting the RSC pages to this route
// handler restores the correct precedence without removing the blog feature for regular
// Plexo builder sites — those are handled by the self-fetch proxy branch below.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ domain: string; blogPath?: string[] }> },
): Promise<NextResponse> {
  const { domain: rawDomain, blogPath = [] } = await context.params;
  const domain = decodeURIComponent(rawDomain);

  const siteResult = await resolveSite(domain);
  if (siteResult.status !== "ok") {
    return new NextResponse(null, { status: 404 });
  }

  const { data: deployedApp } = await DeployedApp.get({ templateId: siteResult.published.templateId }).go();
  if (deployedApp?.type === "STATIC") {
    // Deployed static app owns all routes. Serve directly from S3 — the URL stays at
    // /blog/... without any redirect, so the browser address bar never changes.
    return serveDeployedStatic(request, deployedApp, ["blog", ...blogPath]);
  }

  // Regular Plexo blog site — proxy to the RSC pages that live under /_blog/.
  // Middleware rewrites /_blog/... on a tenant domain to /pub/{domain}/_blog/..., which
  // resolves to app/pub/[domain]/_blog/**/ page.tsx. Self-fetching via the public URL
  // (rather than a direct import) is the same technique [[...slug]] already uses for the
  // "blog on homepage" feature — it keeps the RSC rendering pipeline intact and avoids
  // the React-in-a-route-handler problem. Content-Encoding and Content-Length must be
  // stripped before relaying: fetch() transparently decompresses the body, so forwarding
  // those headers intact causes the client to double-decompress (or miscount bytes).
  const blogSubPath = blogPath.length ? `/${blogPath.join("/")}` : "";
  const internalUrl = new URL(`/_blog${blogSubPath}${request.nextUrl.search}`, request.url);
  const blogResponse = await fetch(internalUrl);
  const headers = new Headers(blogResponse.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new NextResponse(blogResponse.body, { status: blogResponse.status, headers });
}
