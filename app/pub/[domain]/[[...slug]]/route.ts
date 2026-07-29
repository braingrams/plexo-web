import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Template } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { parseUserAgent, extractGeoFromHeaders } from "@/server/analytics";
import { getPagesDomain } from "@/server/pagesDomain";

function notFoundResponse(): NextResponse {
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
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" } }
  );
}

function suspendedResponse(): NextResponse {
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

// Gives a nested RAW_UPLOAD page's relative asset references (href="style.css", etc.) a
// correct resolution base without needing the visited URL to have a trailing slash — see
// the call site below for why a redirect-based approach doesn't work here.
function injectBaseHref(html: string, basePath: string): string {
  const baseTag = `<base href="${basePath}">`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length;
    return html.slice(0, idx) + baseTag + html.slice(idx);
  }
  const htmlMatch = html.match(/<html[^>]*>/i);
  if (htmlMatch && htmlMatch.index !== undefined) {
    const idx = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, idx) + baseTag + html.slice(idx);
  }
  return baseTag + html;
}

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

  if (!published) {
    return notFoundResponse();
  }

  // A suspended domain (abuse takedown — see lib/safeBrowsing.ts /
  // app/api/internal/domains/[id]/suspend) serves neither its content nor a plain 404,
  // so visitors and the domain owner both get an unambiguous reason.
  if (!published.active) {
    return suspendedResponse();
  }

  // Unified page-tree walk: descend through parentId/slug as far as consecutive
  // segments match a child page, regardless of whether each page along the way is
  // BUILDER or RAW_UPLOAD — a mixed site (some pages DnD-built, some uploaded) is just
  // a tree where each node independently decides how it's served. Whatever segments are
  // left over after the walk stops are resolved as an asset path scoped to the last page
  // reached, which is what lets a RAW_UPLOAD page (root or nested) have its own css/js/
  // image files without colliding with another page's same-named files.
  const slugSegments = params.slug ?? [];
  let cursor: Template = published.template;
  let matchedSegments = 0;
  for (const segment of slugSegments) {
    const child = await prisma.template.findFirst({ where: { parentId: cursor.id, slug: segment } });
    if (!child) break;
    cursor = child;
    matchedSegments++;
  }
  const remainingSegments = slugSegments.slice(matchedSegments);

  if (remainingSegments.length === 0) {
    // `cursor` is the requested page itself (the domain root, or a matched descendant).
    // A browser resolves a page's relative links against its OWN url's directory — for
    // "/about" (no trailing slash) that directory is "/", not "/about/", which would
    // make about's own "style.css" collide with the root's. Redirecting to "/about/" was
    // the first approach here, but Next.js's own trailingSlash:false normalization
    // immediately redirects it right back to "/about", producing an infinite loop —
    // confirmed by actually running this. Injecting <base href="/about/"> into the served
    // HTML gets the same relative-resolution fix without touching the visited URL at all,
    // so there's no conflict with Next's routing. Only matters for RAW_UPLOAD pages
    // nested under another page — BUILDER pages have no page-owned asset files to
    // namespace, and the domain root itself has no "directory" to disambiguate from.
    const isNestedRawPage = cursor.id !== published.templateId && cursor.sourceType === "RAW_UPLOAD";
    const html = isNestedRawPage
      ? injectBaseHref(cursor.compiledHtml, `/${slugSegments.join("/")}/`)
      : cursor.compiledHtml;

    // Record analytics view asynchronously (does not block client response)
    try {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "127.0.0.1";
      const ipHash = createHash("sha256").update(ip).digest("hex");
      const userAgent = request.headers.get("user-agent") || null;
      const { deviceType, browser, os } = parseUserAgent(userAgent);
      const { country, region, city } = extractGeoFromHeaders(request.headers);

      void prisma.pageView.create({
        data: {
          templateId: cursor.id,
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

    // Both BUILDER and RAW_UPLOAD pages store their own served HTML in compiledHtml —
    // for BUILDER it's the compiler's output, for RAW_UPLOAD it's the uploaded file
    // verbatim (unsanitized by design — see prisma/schema.prisma's TemplateSourceType).
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // Leftover segments after the walk are an asset path under whichever page the walk
  // stopped at. Only RAW_UPLOAD pages have TemplateAsset files hanging off them.
  if (cursor.sourceType !== "RAW_UPLOAD") {
    return notFoundResponse();
  }

  const requestedPath = remainingSegments.join("/");
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
    where: { templateId: cursor.id, path: { in: candidatePaths } },
  });
  const asset = candidatePaths.map((p) => matches.find((m) => m.path === p)).find(Boolean);
  if (!asset) {
    return notFoundResponse();
  }
  const assetRes = await fetch(asset.blobUrl);
  if (!assetRes.ok || !assetRes.body) {
    return notFoundResponse();
  }
  return new NextResponse(assetRes.body, {
    headers: {
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
