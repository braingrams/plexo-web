import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Template } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { parseUserAgent, extractGeoFromHeaders } from "@/server/analytics";
import { resolveHideBranding, canWhiteLabel, getOrganizationOwnerPlan } from "@/lib/subscription";
import { resolveSite } from "@/lib/pub/resolveSite";
import { resolveBlogRedirect } from "@/lib/blog/redirects";

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

// White-label favicon override for a published page, splice-injected the same way as
// injectBaseHref — only called for orgs entitled to (and who've set) custom branding, see
// the call site below. A same-origin builder-compiled page won't already have its own
// <link rel="icon">, so this never needs to replace one, only add one.
function injectFavicon(html: string, logoUrl: string): string {
  const linkTag = `<link rel="icon" href="${logoUrl}">`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const idx = headMatch.index + headMatch[0].length;
    return html.slice(0, idx) + linkTag + html.slice(idx);
  }
  return html;
}

// Only ever called for BUILDER pages (platform-compiled, well-formed HTML) — never
// RAW_UPLOAD content, where an arbitrary uploaded page could contain a literal "</body>"
// string inside a <script> block or string literal that isn't the real closing tag and
// would corrupt this splice. See the call site below for the sourceType gate.
function injectBrandingBar(html: string, ctaHref: string): string {
  const bar = `<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;background:#0b0f19;color:#f0f2ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1;border-top:1px solid rgba(255,255,255,0.08);box-shadow:0 -4px 20px rgba(0,0,0,0.35);">
  <span>Hosted with <strong>Plexo</strong>.</span>
  <a href="${ctaHref}" target="_blank" rel="noopener" style="background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;padding:6px 14px;border-radius:8px;font-weight:700;text-decoration:none;">Host yours now</a>
</div>`;
  const bodyCloseMatch = html.match(/<\/body>/i);
  if (bodyCloseMatch && bodyCloseMatch.index !== undefined) {
    return html.slice(0, bodyCloseMatch.index) + bar + html.slice(bodyCloseMatch.index);
  }
  return html + bar;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ domain: string; slug?: string[] }> }
): Promise<NextResponse> {
  const params = await context.params;
  const rawDomain = decodeURIComponent(params.domain);

  const siteResult = await resolveSite(rawDomain);
  if (siteResult.status === "not_found") {
    return notFoundResponse();
  }
  // A suspended domain (abuse takedown — see lib/safeBrowsing.ts /
  // app/api/internal/domains/[id]/suspend) serves neither its content nor a plain 404,
  // so visitors and the domain owner both get an unambiguous reason.
  if (siteResult.status === "suspended") {
    return suspendedResponse();
  }
  const published = siteResult.published;
  const slugSegments = params.slug ?? [];

  // WordPress's "Reading Settings: your homepage displays" toggle — when a site has
  // turned this on, its root path serves the blog listing IN PLACE (bare domain stays in
  // the address bar), not a redirect to /blog. /pub/[domain]/blog/page.tsx is a normal
  // React Server Component page — nothing this route handler can invoke directly and get
  // HTML back from, RSC only renders through Next's own page pipeline — so we self-fetch
  // it through the exact same public URL a visitor would use; middleware rewrites that
  // request to /pub/{domain}/blog the same way it rewrote this one, and we relay its
  // response back verbatim as our own. The client's original request/URL never changes.
  if (slugSegments.length === 0) {
    const blogSite = await prisma.blogSite.findUnique({
      where: { templateId: published.templateId },
      select: { enabled: true, showOnHomepage: true },
    });
    if (blogSite?.enabled && blogSite.showOnHomepage) {
      const blogResponse = await fetch(new URL("/blog", request.url));
      // Relaying a fetch() response's headers verbatim is a known footgun: fetch already
      // transparently decompresses the body, but leaves the original content-encoding/
      // content-length headers in place — forwarded as-is, the client tries to decode an
      // already-decoded body and gets a garbled/truncated page.
      const headers = new Headers(blogResponse.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new NextResponse(blogResponse.body, { status: blogResponse.status, headers });
    }

    // WordPress's default "ugly" permalink/shortlink (/?p=123) is a root-path request
    // with a query string, not a path segment — it would never reach the redirect check
    // further down (which only runs once path segments exist), so it needs its own look
    // here. The WordPress importer writes exactly this form to BlogRedirect.fromPath.
    const wpPostId = new URL(request.url).searchParams.get("p");
    if (wpPostId) {
      const redirectTo = await resolveBlogRedirect(published.templateId, `/?p=${wpPostId}`);
      if (redirectTo) {
        return NextResponse.redirect(new URL(redirectTo, request.url), 301);
      }
    }
  }

  // Unified page-tree walk: descend through parentId/slug as far as consecutive
  // segments match a child page, regardless of whether each page along the way is
  // BUILDER or RAW_UPLOAD — a mixed site (some pages DnD-built, some uploaded) is just
  // a tree where each node independently decides how it's served. Whatever segments are
  // left over after the walk stops are resolved as an asset path scoped to the last page
  // reached, which is what lets a RAW_UPLOAD page (root or nested) have its own css/js/
  // image files without colliding with another page's same-named files.
  let cursor: Template = published.template;
  let matchedSegments = 0;
  for (const segment of slugSegments) {
    const child = await prisma.template.findFirst({ where: { parentId: cursor.id, slug: segment } });
    if (!child) break;
    cursor = child;
    matchedSegments++;
  }
  const remainingSegments = slugSegments.slice(matchedSegments);

  // A raw-uploaded page's own root document is never itself a TemplateAsset — the zip
  // importer always excludes it, storing it as this Template's compiledHtml instead (see
  // ExtractedSite.indexHtml in server/rawUpload.ts) — so a link that literally targets
  // "index.html"/"index.htm"/"index" (a common way an uploaded site links back to its own
  // home, and the exact convention every static host already treats as equivalent to the
  // directory root) can never match a TemplateAsset row and would otherwise always fall
  // through to the 404 below. Treat it as an alias for the page itself, same as how
  // "about.html"/"about" already both resolve identically further down.
  const INDEX_ALIASES = new Set(["index.html", "index.htm", "index"]);
  const isIndexAlias = remainingSegments.length === 1 && INDEX_ALIASES.has(remainingSegments[0].toLowerCase());

  if (remainingSegments.length === 0 || isIndexAlias) {
    // `cursor` is the requested page itself (the domain root, or a matched descendant) —
    // `pageSegments` is its OWN path, excluding any trailing index.html/index alias segment
    // matched above, which isn't a real subdirectory. A browser resolves a page's relative
    // links against its OWN url's directory — for "/about" (no trailing slash) that
    // directory is "/", not "/about/", which would make about's own "style.css" collide
    // with the root's. Redirecting to "/about/" was the first approach here, but Next.js's
    // own trailingSlash:false normalization immediately redirects it right back to
    // "/about", producing an infinite loop — confirmed by actually running this. Injecting
    // <base href="/about/"> into the served HTML gets the same relative-resolution fix
    // without touching the visited URL at all, so there's no conflict with Next's routing.
    // Only matters for RAW_UPLOAD pages nested under another page — BUILDER pages have no
    // page-owned asset files to namespace, and the domain root itself has no "directory" to
    // disambiguate from.
    const pageSegments = slugSegments.slice(0, matchedSegments);
    const isNestedRawPage = cursor.id !== published.templateId && cursor.sourceType === "RAW_UPLOAD";
    let html = isNestedRawPage
      ? injectBaseHref(cursor.compiledHtml, `/${pageSegments.join("/")}/`)
      : cursor.compiledHtml;

    // "Hosted with Plexo" bar — BUILDER pages only (RAW_UPLOAD is arbitrary uploaded HTML,
    // see injectBrandingBar's comment for why splicing into that specifically is unsafe),
    // and only when the owning account isn't entitled to (or hasn't turned on) branding
    // removal. Keyed on the page's own sourceType, not published.type (SUBDOMAIN vs CUSTOM
    // is an orthogonal distinction) — a FREE user's page should show this everywhere it's
    // served, custom domain or not.
    if (cursor.sourceType !== "RAW_UPLOAD" && !resolveHideBranding(published.user.subscriptionPlan, published.user.hideBranding)) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      html = injectBrandingBar(html, `${appUrl}/?utm_source=branding_bar#pricing`);
    }

    // White-label favicon — only for orgs entitled to custom branding (Pro/Ultra owner
    // plan, same gate as the dashboard chrome/emails/SDK splash) that have explicitly turned
    // white-labeling on (Organization.whiteLabelEnabled — plan eligibility alone isn't
    // enough) and have actually set a logo. BUILDER and RAW_UPLOAD both get this (unlike the
    // branding bar above, this is a single <link> tag in <head>, not a </body> splice, so
    // RAW_UPLOAD's "arbitrary uploaded HTML" safety concern doesn't apply).
    if (published.organization.logo && published.organization.whiteLabelEnabled) {
      const ownerPlan = await getOrganizationOwnerPlan(published.organization.id);
      if (canWhiteLabel(ownerPlan)) {
        html = injectFavicon(html, published.organization.logo);
      }
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

  // Nothing in the page tree matched. Before giving up, check whether this is an old
  // WordPress permalink (or a renamed Plexo page) that should 301 to its new home —
  // e.g. a WP site's "/2023/04/my-post/" migrated to "/blog/my-post". This is the ONE
  // place that check needs to live for non-/blog-prefixed old paths: anything already
  // under literal "/blog" is handled by app/pub/[domain]/blog/[...slug]/page.tsx instead,
  // since that route takes precedence over this catch-all and never reaches here.
  const fullRequestedPath = "/" + slugSegments.join("/");
  const redirectTo = await resolveBlogRedirect(published.templateId, fullRequestedPath);
  if (redirectTo) {
    return NextResponse.redirect(new URL(redirectTo, request.url), 301);
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
