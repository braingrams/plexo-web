import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { DeployedApp } from "@/lib/db/appEntities";
import { serveDeployedStatic } from "@/lib/pub/serveDeployedStatic";
import { serveDeployedSsr } from "@/lib/pub/serveDeployedSsr";
import { getTierFeatures } from "@/lib/subscription";
import { withAppPageExtras } from "@/lib/customCode/appServe";

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

  const site = { templateId: siteResult.published.templateId, type: siteResult.published.type, plan: siteResult.published.user.subscriptionPlan, secFetchDest: request.headers.get("sec-fetch-dest"), host: domain, path: request.nextUrl.pathname, siteName: siteResult.published.template.name || domain, headers: request.headers };
  const { data: deployedApp } = await DeployedApp.get({ templateId: siteResult.published.templateId }).go();
  if (deployedApp?.type === "STATIC") {
    // Deployed static app owns all routes. Serve directly from S3 — the URL stays at
    // /blog/... without any redirect, so the browser address bar never changes.
    return withAppPageExtras(await serveDeployedStatic(request, deployedApp, ["blog", ...blogPath]), site);
  }

  if (deployedApp?.type === "SSR") {
    // A server app owns its /blog pages (they're its own routes), so the app serves them, on the same plan rules
    // as every other page of a server app.
    const features = getTierFeatures(siteResult.published.user.subscriptionPlan);
    if (!features.ssrEnabled) return new NextResponse(null, { status: 404 });
    return withAppPageExtras(
      await serveDeployedSsr(request, deployedApp, ["blog", ...blogPath], {
        templateId: siteResult.published.templateId,
        dailyRequestLimit: features.deployedAppDailyRequestLimit,
        onNotFound: () => new NextResponse(null, { status: 404 }),
      }),
      site,
    );
  }

  // Regular Plexo blog site — proxy to the RSC pages that live under /_blog/.
  // Middleware rewrites /_blog/... on a tenant domain to /pub/{domain}/_blog/..., which
  // resolves to app/pub/[domain]/%5Fblog/**/page.tsx. The folder MUST be spelled %5Fblog,
  // not _blog: Next treats any folder starting with "_" as private and never routes it,
  // which made every /blog URL on every Plexo site 404 (see tests/blogRoutable.test.ts).
  // %5F is Next's documented way to get a URL segment that starts with "_". Self-fetching via the public URL
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
  // The blog's pages are made by Plexo and relayed from here, so the owner's header/footer code is added on the way out.
  return withAppPageExtras(new NextResponse(blogResponse.body, { status: blogResponse.status, headers }), site);
}
