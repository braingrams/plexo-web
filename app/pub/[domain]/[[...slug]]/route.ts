import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Template } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { parseUserAgent, extractGeoFromHeaders } from "@/server/analytics";
import { getPagesDomain } from "@/server/pagesDomain";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ domain: string; slug?: string[] }> }
): Promise<NextResponse> {
  const params = await context.params;
  const rawDomain = decodeURIComponent(params.domain);

  // Find the published domain mapping and template (exact lookup first)
  let published = await prisma.publishedDomain.findUnique({
    where: { domain: rawDomain },
    include: { template: true },
  });

  // middleware.ts already normalizes "xyz.localhost" -> "xyz.{pagesDomain}" before
  // rewriting here, so this is only a defensive fallback for direct /pub testing.
  if (!published && rawDomain.endsWith(".localhost")) {
    const sub = rawDomain.replace(".localhost", "");
    published = await prisma.publishedDomain.findUnique({
      where: { domain: `${sub}.${getPagesDomain()}` },
      include: { template: true },
    });
  }

  // A suspended domain (abuse takedown — see lib/safeBrowsing.ts /
  // app/api/internal/domains/[id]/suspend) serves neither its content nor a plain 404,
  // so visitors and the domain owner both get an unambiguous reason.
  if (published && !published.active) {
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>Page Unavailable</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f0f2ff; display: grid; place-items: center; min-height: 100vh; margin: 0; text-align: center; }
            .container { padding: 2rem; max-width: 480px; }
            h1 { font-size: 2rem; margin-bottom: 1rem; color: #f59e0b; }
            p { color: rgba(240, 242, 255, 0.65); line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Page Unavailable</h1>
            <p>This page has been suspended and is not currently accessible.</p>
          </div>
        </body>
      </html>`,
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } }
    );
  }

  // Raw-upload sites are self-contained (no nested Template pages) — any non-root path
  // resolves against their stored assets instead of walking a page tree.
  const slugSegments = params.slug ?? [];
  if (published && published.template.sourceType === "RAW_UPLOAD" && slugSegments.length > 0) {
    const requestedPath = slugSegments.join("/");
    // Clean-URL fallback: a zip's internal links (or a visitor typing the URL) commonly
    // omit the .html extension — /about should resolve to about.html the same way
    // Netlify/Vercel/GitHub Pages static hosting does, not 404 on an exact-path miss.
    const candidatePaths = [
      requestedPath,
      `${requestedPath}.html`,
      `${requestedPath}.htm`,
      `${requestedPath}/index.html`,
    ];
    // findMany + manual pick (not findFirst) so priority order is guaranteed — Prisma's
    // `in` filter doesn't promise result order matches the array, and if a zip somehow
    // contains both "about" and "about.html" the exact match must win.
    const matches = await prisma.templateAsset.findMany({
      where: { templateId: published.templateId, path: { in: candidatePaths } },
    });
    const asset = candidatePaths.map((p) => matches.find((m) => m.path === p)).find(Boolean);
    if (!asset) {
      return new NextResponse("Not found", { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
    }
    const assetRes = await fetch(asset.blobUrl);
    if (!assetRes.ok || !assetRes.body) {
      return new NextResponse("Not found", { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
    }
    return new NextResponse(assetRes.body, {
      headers: {
        "Content-Type": asset.contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // Walk the requested path segment by segment through the page tree rooted at the
  // domain's home template — sub-pages can nest arbitrarily deep (e.g. /blog/post-1),
  // each segment just matches one child's slug. RAW_UPLOAD templates never have child
  // pages (handled entirely by the asset lookup above), so this only applies to BUILDER.
  let resolvedTemplate: Template | null = published?.template ?? null;
  if (resolvedTemplate && published!.template.sourceType === "BUILDER" && slugSegments.length > 0) {
    let cursor: Template = resolvedTemplate;
    let found = true;
    for (const segment of slugSegments) {
      const child = await prisma.template.findFirst({
        where: { parentId: cursor.id, slug: segment },
      });
      if (!child) {
        found = false;
        break;
      }
      cursor = child;
    }
    resolvedTemplate = found ? cursor : null;
  }

  if (!published || !resolvedTemplate) {
    return new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head>
          <title>404 - Page Not Found</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f0f2ff; display: grid; place-items: center; min-height: 100vh; margin: 0; text-align: center; }
            .container { padding: 2rem; max-width: 480px; }
            h1 { font-size: 2.5rem; margin-bottom: 1rem; color: #818cf8; }
            p { color: rgba(240, 242, 255, 0.65); line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>404</h1>
            <p>This landing page domain has not been published or the page does not exist.</p>
          </div>
        </body>
      </html>`,
      {
        status: 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }
    );
  }

  // Record analytics view asynchronously (does not block client response)
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "127.0.0.1";
    const ipHash = createHash("sha256").update(ip).digest("hex");
    const userAgent = request.headers.get("user-agent") || null;
    const { deviceType, browser, os } = parseUserAgent(userAgent);
    const { country, region, city } = extractGeoFromHeaders(request.headers);

    void prisma.pageView.create({
      data: {
        templateId: resolvedTemplate.id,
        domain: rawDomain,
        ipHash,
        userAgent,
        deviceType,
        browser,
        os,
        country,
        region,
        city,
      },
    }).catch(err => console.error("Failed to log PageView:", err));
  } catch (err) {
    console.error("Error logging PageView:", err);
  }

  // Return the compiled HTML
  return new NextResponse(resolvedTemplate.compiledHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
