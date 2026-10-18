import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { EntityItem } from "electrodb";
import { parseUserAgent, extractGeoFromHeaders } from "@/server/analytics";
import { resolveHideBranding, canWhiteLabel, isHomePageOnlyPlan } from "@/lib/subscription";
import { getOrganizationOwnerPlanDynamo } from "@/server/orgDynamo";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { resolveBlogRedirect } from "@/lib/blog/redirectsDynamo";
import { fillLatestPostLists } from "@/lib/pub/livePostQueries";
import { Template, TemplateAsset, BlogSite, PublishedDomain } from "@/lib/db/contentEntities";
import { CommerceSettings, CommerceProduct } from "@/lib/db/commerceEntities";
import { getStorefrontPath, getCheckoutPath, DEFAULT_STOREFRONT_SLUG } from "@/lib/commerce/storefrontLayout";
import { deriveCommerceTheme, type CommerceTheme } from "@/lib/commerce/deriveCommerceTheme";
import { PageView } from "@/lib/db/opsEntities";
import { recordPageViewRollup } from "@/lib/analyticsRollup";
import { escapeHtmlAttr, injectBrandingBar, injectFavicon, injectSeoTags } from "@/lib/pub/htmlInject";
import { serveProject } from "@/lib/projects/serve";
import { resolvePreviewHost } from "@/lib/projects/previewHost";
import { User, Organization } from "@/lib/db/coreEntities";
import { buildSiteRobotsTxt, buildSiteSitemap } from "@/lib/pub/siteSitemap";
import { collectFormFields, recordFormSubmission } from "@/lib/forms/recordSubmission";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";

type TemplateItem = EntityItem<typeof Template>;

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

// An address the owner's plan has switched off (lib/plan/lifecycle.ts — Free keeps one
// live site, on a Plexo address). Nothing is deleted: it comes back the moment the owner
// upgrades. A custom domain gets a calm landing screen — visitors typed a real brand's
// address and deserve to know the site still exists; a Plexo address just 404s.
function inactiveDomainResponse(domain: string, domainType: "SUBDOMAIN" | "CUSTOM"): NextResponse {
  if (domainType === "SUBDOMAIN") return notFoundResponse();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new NextResponse(
    `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtmlAttr(domain)} is taking a break</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f0f2ff; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 0 16px; text-align: center; }
          .container { max-width: 520px; }
          .mark { width: 56px; height: 56px; margin: 0 auto 1.5rem; border-radius: 16px; display: grid; place-items: center; background: rgba(129, 140, 248, 0.12); border: 1px solid rgba(129, 140, 248, 0.3); }
          h1 { font-size: 1.9rem; margin: 0 0 0.75rem; letter-spacing: -0.02em; }
          p { color: rgba(240, 242, 255, 0.65); line-height: 1.6; margin: 0 0 1.75rem; }
          .domain { color: #c7d2fe; font-weight: 600; }
          a { color: #c7d2fe; font-size: 0.85rem; text-decoration: none; border-bottom: 1px solid rgba(199, 210, 254, 0.35); }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="mark"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/></svg></div>
          <h1>This site is taking a break</h1>
          <p><span class="domain">${escapeHtmlAttr(domain)}</span> isn't available right now. Please check back soon.</p>
          <a href="${appUrl}/auth/login?redirectTo=%2Fdashboard%2Fsettings%2Fsubscription">Own this site? Sign in to bring it back</a>
        </div>
      </body>
    </html>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } },
  );
}

/** Free serves only a site's homepage: anything else sends the visitor home. Never cached,
 * so the page is back the moment the owner upgrades. */
function homePageRedirect(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/", request.url), { status: 302, headers: { "Cache-Control": "no-store" } });
}

const NON_HTML_FILE = /\.(css|js|mjs|map|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|txt|xml)$/i;

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

// Explicit merchant override (CommerceSettings) wins; otherwise auto-detect from the site's
// own root designJson (lib/commerce/deriveCommerceTheme.ts); null when neither exists — the
// widget then uses its own hardcoded default, unchanged from before per-site theming existed.
function resolveCommerceTheme(
  commerceSettings: { themeAccentColor?: string | null; themeButtonRadius?: string | null } | null | undefined,
  rootDesignJson: unknown,
): CommerceTheme | null {
  if (commerceSettings?.themeAccentColor) {
    return {
      accentColor: commerceSettings.themeAccentColor,
      buttonRadius: (commerceSettings.themeButtonRadius as CommerceTheme["buttonRadius"] | undefined) ?? "sharp",
    };
  }
  return deriveCommerceTheme(rootDesignJson);
}

// Plexo Commerce's runtime — the marker divs product/booking/shop_grid/etc. compile to
// (see plexo-sdk's compiler.ts) carry no inline <script> of their own (sanitizeCompiledHtml.ts
// strips script tags from the compiled body itself, BUILDER or RAW_UPLOAD), so this is
// injected outside that sanitized body, the same way as injectBrandingBar below — a
// Commerce-disabled site never gets this tag at all, see the call site's CommerceSettings
// gate.
function injectCommerceScript(html: string, storefrontPath: string, checkoutPath: string | null, theme: CommerceTheme | null, productBase: string | null = null): string {
  // ?v=<deploy sha> busts both CloudFront and any visitor's browser cache on every
  // deploy — see cdk/lib/compute-stack.ts's assetVersion comment for why the origin's
  // own shorter Cache-Control on commerce.js isn't enough by itself (a browser that
  // already cached the pre-fix immutable response never re-requests this exact URL).
  // The config script must load BEFORE commerce.js reads window.__PLEXO_COMMERCE__ at
  // parse time — storefrontPath lets the site owner rename the storefront's URL (default
  // /store) without a commerce.js code change. checkoutPath is the checkout page's own
  // REAL resolved path (see getCheckoutPath) — commerce.js used to assume it always lives
  // at "{storefrontPath}/checkout" (true for the auto-provisioned flow, where checkout is
  // a genuine child of the storefront page), which 404ed for a hand-built site whose
  // checkout page isn't nested under its shop page at all; null falls back to that same
  // old assumption client-side, for a site with no CommerceSettings row yet. `theme` is
  // null when there's neither a merchant override nor an auto-detected signal (see the
  // call site) — commerce.js falls back to its own hardcoded look in that case, unchanged
  // from before theming existed. JSON.stringify already escapes quotes; the "</" replace
  // is defense in depth against a slug somehow containing it.
  // productBase: where product pages live (CommerceSettings.productUrlBase, e.g. a migrated
  // WooCommerce store's "/product"); null = under the storefront page.
  const configTag = `<script>window.__PLEXO_COMMERCE__=${JSON.stringify({ storefrontPath, checkoutPath, theme, productBase }).replace(/<\//g, "<\\/")};</script>`;
  const scriptTag = `${configTag}<script src="/commerce.js?v=${process.env.ASSET_VERSION ?? "dev"}" defer></script>`;
  const maskedHtml = html.replace(
    /<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi,
    (block) => " ".repeat(block.length),
  );
  let insertAt = -1;
  const bodyCloseRe = /<\/body\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyCloseRe.exec(maskedHtml)) !== null) {
    insertAt = match.index;
  }
  if (insertAt !== -1) {
    return html.slice(0, insertAt) + scriptTag + html.slice(insertAt);
  }
  return html + scriptTag;
}

// The Funnel/LMS module's runtime — same shape as injectCommerceScript above, and the
// same reason: sanitizeCompiledHtml.ts strips inline <script> tags from the compiled body
// (BUILDER or RAW_UPLOAD alike), so a marker div alone can never carry its own behavior —
// this is the one place it can live. Unlike Commerce (gated on a DB flag,
// CommerceSettings.enabled), this is gated purely on the marker's PRESENCE in the page's
// own HTML (see LMS_SIGNUP_MARKER_ATTR) — a funnel's signup form isn't tied to "the site's
// root page" the way Commerce is to its whole site, and a plain content check means a
// RAW_UPLOAD page (which has no DB-backed page-level settings at all) works identically to
// a BUILDER page: an admin drops the copyable snippet from Funnel Settings ("Embed your
// signup form") anywhere in their own HTML — hand-typed into a raw upload, or pasted into
// an 'html' block on the visual canvas — and it just works, no separate enablement step.
export const LMS_SIGNUP_MARKER_ATTR = "data-plexo-lms-signup";

function injectLmsSignupScript(html: string): string {
  const scriptTag = `<script src="/lms-signup.js" defer></script>`;
  const maskedHtml = html.replace(
    /<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi,
    (block) => " ".repeat(block.length),
  );
  let insertAt = -1;
  const bodyCloseRe = /<\/body\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyCloseRe.exec(maskedHtml)) !== null) {
    insertAt = match.index;
  }
  if (insertAt !== -1) {
    return html.slice(0, insertAt) + scriptTag + html.slice(insertAt);
  }
  return html + scriptTag;
}

// Site-wide newsletter popup (public/newsletter-popup.js) — a site owner's own opt-in
// feature (CommerceSettings.newsletterPopupEnabled + maildripNewsletterGroupId, see that
// entity's own comment), deliberately independent of Commerce/payments being enabled:
// capturing emails isn't a commerce-only need. Same injection shape as
// injectLmsSignupScript above.
function injectNewsletterPopupScript(html: string): string {
  const scriptTag = `<script src="/newsletter-popup.js" defer></script>`;
  const maskedHtml = html.replace(
    /<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi,
    (block) => " ".repeat(block.length),
  );
  let insertAt = -1;
  const bodyCloseRe = /<\/body\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyCloseRe.exec(maskedHtml)) !== null) {
    insertAt = match.index;
  }
  if (insertAt !== -1) {
    return html.slice(0, insertAt) + scriptTag + html.slice(insertAt);
  }
  return html + scriptTag;
}

// The Product Detail layout is ONE physical page shared by every product (see the
// route's own product-slug branch below) — its baked <title>/meta tags are necessarily
// generic (CommerceSettings.productDetailTemplateId's own authored SEO fields, whatever
// they are). Real crawlers and link-unfurlers read the served HTML, not anything
// commerce.js does client-side after the fact, so getting a genuinely correct per-product
// title/description/image means rewriting these specific tags server-side, here, with
// the real product this particular request resolved to. Matches by tag pattern (not by
// the exact baked string) so it works regardless of what static placeholder was authored
// — including "no metaDescription/ogImageUrl authored at all", where the tag is simply
// absent from the baked HTML and nothing gets rewritten.
function injectProductSeo(html: string, product: { name: string; description: string | null; imageUrl: string | null }): string {
  const title = escapeHtmlAttr(`${product.name} — Shop Natural Products | Helimax`);
  const description = escapeHtmlAttr(
    (product.description && product.description.trim()) ||
      `${product.name} — a natural wellness product from Helimax.`
  );
  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  out = out.replace(/<meta[^>]*\bname="description"[^>]*>/, `<meta name="description" content="${description}">`);
  out = out.replace(/<meta[^>]*\bproperty="og:title"[^>]*>/, `<meta content="${title}" property="og:title">`);
  out = out.replace(/<meta[^>]*\bproperty="og:description"[^>]*>/, `<meta content="${description}" property="og:description">`);
  out = out.replace(/<meta[^>]*\bname="twitter:title"[^>]*>/, `<meta content="${title}" name="twitter:title">`);
  out = out.replace(/<meta[^>]*\bname="twitter:description"[^>]*>/, `<meta content="${description}" name="twitter:description">`);
  if (product.imageUrl) {
    const image = escapeHtmlAttr(product.imageUrl);
    const ogImageTag = `<meta content="${image}" property="og:image">`;
    out = out.replace(/<meta[^>]*\bproperty="og:image"[^>]*>/, ogImageTag);
    if (!out.includes(ogImageTag)) {
      // No og:image was authored on the layout template at all — insert one right after
      // og:title so a product with its own real photo still gets a real share image
      // instead of silently falling back to none.
      out = out.replace(/(<meta[^>]*\bproperty="og:title"[^>]*>)/, `$1${ogImageTag}`);
    }
    out = out.replace(/<meta[^>]*\bname="twitter:image"[^>]*>/, `<meta content="${image}" name="twitter:image">`);
  }
  return out;
}

// designJson (unlike compiledHtml) is never run through sanitizeCompiledHtml.ts —
// server/sanitizer.ts's sanitizePlexoPayload only Zod-validates + prototype-pollution-
// cleans it (see that file's own comment) — so the raw customJs string the author typed
// into BodyGlobalSettingsTab.tsx is still sitting in cursor.designJson right where the
// compiler's own <script> tag for it got stripped out of compiledHtml on publish (the
// sanitizer's exclusiveFilter only lets a <script src="..."> through, for the MailDrip
// embed — any inline <script> with no src, customJs's included, is always removed).
// Re-injecting it here at serve time, straight from designJson, is the fix: this is the
// site owner's own authored code for their own site (the same trust model as the
// customCss sibling field, which already survives publish untouched), not third-party or
// visitor-supplied content, so there's no new XSS surface — just restoring a feature the
// UI already promises but silently drops.
function injectCustomJs(html: string, customJs: string | null | undefined): string {
  const script = (customJs ?? "").trim();
  if (!script) return html;
  const scriptTag = `<script>\n${script}\n</script>`;
  const maskedHtml = html.replace(
    /<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi,
    (block) => " ".repeat(block.length),
  );
  let insertAt = -1;
  const bodyCloseRe = /<\/body\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyCloseRe.exec(maskedHtml)) !== null) {
    insertAt = match.index;
  }
  if (insertAt !== -1) {
    return html.slice(0, insertAt) + scriptTag + html.slice(insertAt);
  }
  return html + scriptTag;
}

// Routes <img> tags served from our own uploads bucket (see lib/storage.ts's
// publicUrlFor — allowlisted in next.config.ts's images.remotePatterns) through Next's
// /_next/image optimizer (resize + modern-format re-encode), and adds loading="lazy" to
// every image but the first (left eager so it doesn't regress LCP on the common
// hero-image-first layout). An externally-hosted image URL (an author's direct link, the
// Unsplash placeholder) is left as a plain <img> — remotePatterns can't practically
// allowlist arbitrary third-party hosts, so those only get the lazy-loading attribute.
function optimizeImages(html: string): string {
  let seenImage = false;
  return html.replace(/<img\b([^>]*)>/gi, (fullMatch, attrs: string) => {
    const isFirst = !seenImage;
    seenImage = true;
    const srcMatch = attrs.match(/\bsrc="([^"]*)"/i);
    const src = srcMatch?.[1];
    let newAttrs = attrs;
    if (src) {
      try {
        const host = new URL(src).hostname;
        if (host.endsWith(".amazonaws.com") && !/\/_next\/image\?/.test(src)) {
          // 1920, not an arbitrary round number — next.config.ts doesn't override
          // images.deviceSizes/imageSizes, so Next's own defaults apply
          // ([640,750,828,1080,1200,1920,2048,3840] / [16,32,48,64,96,128,256,384]), and
          // the optimizer 400s on any "w" outside that exact list ("w" parameter (width)
          // of 1600 is not allowed — confirmed live, once the separate CloudFront
          // query-string-forwarding bug in published-sites-stack.ts/compute-stack.ts was
          // fixed enough for this validation to even run: before that fix the origin
          // never received the query string at all, which is why this masked as the same
          // failure regardless of "w").
          const optimizedSrc = `/_next/image?url=${encodeURIComponent(src)}&w=1920&q=75`;
          newAttrs = newAttrs.replace(srcMatch![0], `src="${optimizedSrc}"`);
        }
      } catch {
        // Not an absolute URL (relative asset path on a RAW_UPLOAD page, or malformed) —
        // leave src untouched, still eligible for the lazy-loading attribute below.
      }
    }
    if (!isFirst && !/\bloading=/i.test(newAttrs)) {
      newAttrs += ` loading="lazy" decoding="async"`;
    }
    return `<img${newAttrs}>`;
  });
}

/** Prisma's `prisma.template.findFirst({ where: { parentId, slug } })` — Template has no
 * (parentId, slug) direct index, only byParent (GSI2, sorted by order), so this fetches the
 * parent's children (small in practice — a site's own page tree) and matches in memory,
 * same discipline as server/slugDynamo.ts's ensureUniqueSlug. */
function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function findChildBySlug(parentId: string, slug: string): Promise<TemplateItem | null> {
  // Every child, not just the first DynamoDB page (1 MB): a site whose subpages are large
  // (a migrated Elementor page is 100-300 KB of HTML) otherwise 404s every page past the
  // first few. Only id/slug are projected here — the matched page is then read in full —
  // so this per-request lookup doesn't drag every sibling's HTML along with it.
  const { data: children } = await Template.query.byParent({ parentId }).go({ pages: "all", attributes: ["id", "slug", "parentId", "order"] });
  // Slugs are stored decoded (a migrated WordPress page can be "hope-for-every-heart-❤️");
  // accept the segment either way it arrives so a percent-encoded request still matches.
  const decoded = safeDecode(slug);
  const match = children.find((c) => c.slug === slug || c.slug === decoded);
  if (!match) return null;
  const { data: full } = await Template.get({ id: match.id }).go();
  return full ?? null;
}

async function servePreviewHost(request: NextRequest, host: string, templateId: string): Promise<NextResponse> {
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.sourceType !== "REACT_PROJECT") return notFoundResponse();
  const [{ data: user }, { data: organization }] = await Promise.all([
    User.get({ id: template.userId }).go(),
    Organization.get({ id: template.organizationId }).go(),
  ]);
  return serveProject(request, {
    template,
    host,
    isPreview: true,
    noindex: true,
    owner: { subscriptionPlan: user?.subscriptionPlan ?? "FREE", hideBranding: user?.hideBranding ?? false },
    organization: { id: template.organizationId, logo: organization?.logo ?? null, whiteLabelEnabled: organization?.whiteLabelEnabled ?? false },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ domain: string; slug?: string[] }> }
): Promise<NextResponse> {
  const params = await context.params;
  const rawDomain = decodeURIComponent(params.domain);

  const siteResult = await resolveSite(rawDomain);
  if (siteResult.status === "not_found") {
    // A React app's preview address (preview--<id>.<pagesDomain>) isn't a PublishedDomain.
    const previewTarget = await resolvePreviewHost(rawDomain);
    if (previewTarget) return servePreviewHost(request, rawDomain, previewTarget.templateId);
    return notFoundResponse();
  }
  // A suspended domain (abuse takedown — see lib/safeBrowsing.ts /
  // app/api/internal/domains/[id]/suspend) serves neither its content nor a plain 404,
  // so visitors and the domain owner both get an unambiguous reason.
  if (siteResult.status === "suspended") {
    return suspendedResponse();
  }
  if (siteResult.status === "inactive") {
    return inactiveDomainResponse(siteResult.domain, siteResult.domainType);
  }
  const published = siteResult.published;
  // Free (published.user.subscriptionPlan is the plan the owner is entitled to right now):
  // only the homepage is served — sub-pages, the blog, the store and product pages all send
  // the visitor back to "/", and an app answers its first screen only.
  const homeOnly = isHomePageOnlyPlan(published.user.subscriptionPlan);
  if (published.template.sourceType === "REACT_PROJECT") {
    return serveProject(request, {
      template: published.template,
      host: rawDomain,
      isPreview: false,
      noindex: published.noindex ?? false,
      owner: published.user,
      organization: published.organization,
      homeOnly,
    });
  }
  const slugSegments = params.slug ?? [];
  if (isWordPressAjaxPath(slugSegments)) return wordPressAjaxStub();

  // A site migrated from WordPress keeps ONE canonical host, as WordPress did: with both
  // "example.org" and "www.example.org" connected, the one the old site didn't use
  // permanently redirects to the one it did — no duplicate-content split, every old link
  // lands on the canonical address.
  const canonicalHost = published.template.migratedFrom ? safeHost(published.template.migratedFrom) : null;
  if (canonicalHost && rawDomain !== canonicalHost && (rawDomain === `www.${canonicalHost}` || `www.${rawDomain}` === canonicalHost)) {
    const { data: canonicalRows } = await PublishedDomain.query.byDomain({ domain: canonicalHost }).go({ pages: "all" });
    if (canonicalRows.some((d) => d.templateId === published.templateId && (d.active ?? true))) {
      const target = new URL(request.url);
      return NextResponse.redirect(`https://${canonicalHost}${target.pathname}${target.search}`, 301);
    }
  }

  // WordPress's "Reading Settings: your homepage displays" toggle — when a site has
  // turned this on, its root path serves the blog listing IN PLACE (bare domain stays in
  // the address bar), not a redirect to /blog. /pub/[domain]/blog/page.tsx is a normal
  // React Server Component page — nothing this route handler can invoke directly and get
  // HTML back from, RSC only renders through Next's own page pipeline — so we self-fetch
  // it through the exact same public URL a visitor would use; middleware rewrites that
  // request to /pub/{domain}/blog the same way it rewrote this one, and we relay its
  // response back verbatim as our own. The client's original request/URL never changes.
  if (slugSegments.length === 0) {
    // (On Free the blog isn't served, so the homepage shows the site's own page instead.)
    const { data: blogSite } = homeOnly ? { data: null } : await BlogSite.get({ templateId: published.templateId }).go();
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
  let cursor: TemplateItem = published.template;
  let matchedSegments = 0;
  // Any page on the way down being unpublished hides everything beneath it too.
  let unpublishedOnPath = false;
  for (const segment of slugSegments) {
    let child = await findChildBySlug(cursor.id, segment);
    // A zip's own nav links a sibling page as "about.html" (that's the literal href baked
    // into the uploaded HTML — see upload-raw/route.ts's auto-split, which turns an extra
    // root-level .html file into a page whose slug is the bare name, "about"), so a segment
    // ending in .html/.htm that doesn't match any child verbatim gets a second look with
    // that suffix stripped before this walk gives up on it.
    if (!child && /\.html?$/i.test(segment)) {
      child = await findChildBySlug(cursor.id, segment.replace(/\.html?$/i, ""));
    }
    if (!child) break;
    cursor = child;
    matchedSegments++;
    if (child.isPublished === false) unpublishedOnPath = true;
  }
  const remainingSegments = slugSegments.slice(matchedSegments);

  // A real page of this site that the plan or the owner has taken off it. On Free every
  // page but the homepage sends visitors home (its own files, e.g. a stylesheet, are a
  // plain 404 — redirecting a stylesheet to HTML would only confuse the browser); a page
  // the owner unpublished is a 404.
  if (matchedSegments > 0) {
    const last = slugSegments[slugSegments.length - 1] ?? "";
    if (homeOnly) return remainingSegments.length > 0 && NON_HTML_FILE.test(last) ? notFoundResponse() : homePageRedirect(request);
    if (unpublishedOnPath) return notFoundResponse();
  }

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
    const requestUrl = new URL(request.url);

    // A page whose job moved elsewhere (a migrated WordPress "posts page" → the live blog).
    if (cursor.redirectTo && matchedSegments > 0) {
      return NextResponse.redirect(new URL(cursor.redirectTo, request.url), 301);
    }
    const pagePathForRedirects = matchedSegments === 0 ? "" : `/${slugSegments.slice(0, matchedSegments).join("/")}`;

    // WordPress shortlinks (?p=123 for posts, ?page_id=45 for pages) work on any page of a
    // migrated site, not just the root — a WordPress install in a subdirectory prints them
    // as /blog/?p=123. The importers write exactly "<page path>/?p=<id>" to BlogRedirect.
    for (const param of ["p", "page_id"]) {
      const id = requestUrl.searchParams.get(param);
      if (!id || !/^\d+$/.test(id) || (param === "p" && matchedSegments === 0)) continue; // root ?p= is handled above
      const redirectTo = await resolveBlogRedirect(published.templateId, `${pagePathForRedirects}/?${param}=${id}`);
      if (redirectTo) return NextResponse.redirect(new URL(redirectTo, request.url), 301);
    }

    // One canonical form per page URL. Plexo's default is no trailing slash; a page migrated
    // from WordPress keeps WordPress's trailing slash (urlTrailingSlash) so its URL — and
    // every backlink and search ranking pointing at it — stays exactly the same. The other
    // form permanently redirects, the same way WordPress itself behaves.
    // (next.config.ts sets skipTrailingSlashRedirect so the slash survives to here.)
    if (matchedSegments > 0 && !isIndexAlias) {
      const rawPath = requestUrl.pathname;
      const hasSlash = rawPath.length > 1 && rawPath.endsWith("/");
      const wantsSlash = cursor.urlTrailingSlash === true;
      if (hasSlash !== wantsSlash) {
        const encodedPath = `/${slugSegments.slice(0, matchedSegments).map((s) => encodeURIComponent(safeDecode(s))).join("/")}${wantsSlash ? "/" : ""}`;
        const target = new URL(`${encodedPath}${requestUrl.search}`, request.url);
        return NextResponse.redirect(target, wantsSlash ? 301 : 308);
      }
    }

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
    // Post lists carried over from WordPress ("Latest news", a posts grid) show the blog's
    // current posts in the site's own card design — see lib/pub/blogLivePostLists.ts.
    html = await fillLatestPostLists(html, published.templateId);

    const canonicalUrl = `https://${rawDomain}/${pageSegments.join("/")}${cursor.urlTrailingSlash && pageSegments.length > 0 ? "/" : ""}`;
    html = injectSeoTags(html, {
      canonicalUrl,
      noindex: published.noindex ?? false,
      siteName: published.template.name || rawDomain,
    });
    html = optimizeImages(html);
    // New-editor (V2) pages have their custom script baked into compiledHtml at compile time
    // (lib/v2/compile.ts); only classic pages re-inject it from designJson here.
    if (cursor.sourceType !== "RAW_UPLOAD" && cursor.designFormat !== "v2") {
      html = injectCustomJs(html, (cursor.designJson as { body?: { style?: { customJs?: string } } } | null)?.body?.style?.customJs);
    }

    // "Hosted with Plexo" bar — BUILDER and RAW_UPLOAD pages alike (see injectBrandingBar's
    // doc comment for how it stays safe against RAW_UPLOAD's arbitrary HTML), shown only
    // when the owning account isn't entitled to (or hasn't turned on) branding removal.
    // Keyed on the page's own sourceType conceptually, not published.type (SUBDOMAIN vs
    // CUSTOM is an orthogonal distinction) — a FREE user's page should show this everywhere
    // it's served, custom domain or not.
    if (!resolveHideBranding(published.user.subscriptionPlan, published.user.hideBranding)) {
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
      const ownerPlan = await getOrganizationOwnerPlanDynamo(published.organization.id);
      if (canWhiteLabel(ownerPlan)) {
        html = injectFavicon(html, published.organization.logo);
      }
    }

    // Plexo Commerce runtime — layered gate, same shape as the blog-homepage check above:
    // a site with Commerce off (the default) never gets this script, so it costs nothing.
    // Scoped to the SITE's root Template (published.templateId), not the current page —
    // Commerce is a per-site setting, same as CommerceSettings itself.
    const { data: commerceSettings } = await CommerceSettings.get({ templateId: published.templateId }).go();
    if (commerceSettings?.enabled) {
      html = injectCommerceScript(
        html,
        (await getStorefrontPath(published.templateId)) ?? `/${DEFAULT_STOREFRONT_SLUG}`,
        await getCheckoutPath(published.templateId),
        resolveCommerceTheme(commerceSettings, published.template.designJson),
        commerceSettings.productUrlBase ?? null,
      );
    }
    if (html.includes(LMS_SIGNUP_MARKER_ATTR)) {
      html = injectLmsSignupScript(html);
    }
    // Independent of commerceSettings.enabled — a site doesn't need Commerce/payments on
    // to want newsletter capture. Reuses the same commerceSettings row fetched above (both
    // live on the same entity) rather than a second DB read.
    if (commerceSettings?.newsletterPopupEnabled && commerceSettings?.maildripNewsletterGroupId) {
      html = injectNewsletterPopupScript(html);
    }

    // Record analytics view asynchronously (does not block client response)
    try {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "127.0.0.1";
      const ipHash = createHash("sha256").update(ip).digest("hex");
      const userAgent = request.headers.get("user-agent") || null;
      const { deviceType, browser, os } = parseUserAgent(userAgent);
      const { country, region, city } = extractGeoFromHeaders(request.headers);

      const viewCreatedAt = new Date();
      void PageView.create({
        id: randomUUID(),
        templateId: cursor.id,
        domain: rawDomain,
        ipHash,
        userAgent: userAgent ?? undefined,
        deviceType: deviceType ?? undefined,
        browser: browser ?? undefined,
        os: os ?? undefined,
        country: country ?? undefined,
        region: region ?? undefined,
        city: city ?? undefined,
      }).go().catch((err) => console.error("Failed to log PageView:", err));
      void recordPageViewRollup({ createdAt: viewCreatedAt, templateId: cursor.id, deviceType, browser, os }).catch((err) =>
        console.error("Failed to record PageView rollup:", err),
      );
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
        // Lets the WordPress migration's live check prove a URL on the owner's real domain
        // is now served by Plexo (and by this site), not still by the old host.
        "X-Plexo-Site": published.templateId,
      },
    });
  }

  // Exactly one segment left over after the walk, no page of its own — check whether it's
  // a real product's slug before giving up. Mirrors the blog post-layout pattern
  // (BlogSite.postLayoutTemplateId): one reusable Template (CommerceSettings.
  // productDetailTemplateId) serves EVERY product, with commerce.js's
  // renderProductDetail reading which one off this same visited URL client-side — so a
  // product added in the dashboard gets a working page immediately, with nothing to
  // create or regenerate here.
  // Also "<productUrlBase>/<slug>" — a store whose product pages live at their own base
  // (a migrated WooCommerce store's /product/<slug>/ keeps working, no redirects).
  const productCommerceSettings = remainingSegments.length >= 1 && remainingSegments.length <= 3
    ? (await CommerceSettings.get({ templateId: published.templateId }).go()).data
    : null;
  const productBase = productCommerceSettings?.productUrlBase?.replace(/\/+$/, "") ?? null;
  const requestedPagePath = "/" + slugSegments.map(safeDecode).join("/");
  const slugUnderBase =
    productBase && requestedPagePath.startsWith(`${productBase}/`) && !requestedPagePath.slice(productBase.length + 1).includes("/")
      ? requestedPagePath.slice(productBase.length + 1)
      : null;
  if (remainingSegments.length === 1 || slugUnderBase) {
    const commerceSettings = productCommerceSettings;
    if (commerceSettings?.enabled && commerceSettings.productDetailTemplateId) {
      const { data: productDetailTemplate } = await Template.get({ id: commerceSettings.productDetailTemplateId }).go();
      if (productDetailTemplate) {
        const candidateSlug = slugUnderBase ?? safeDecode(remainingSegments[0]);
        // CommerceProduct is id-keyed, not slug-keyed (see commerceEntities.ts's own
        // comment) — fans out over the site's own product list in memory, same bound as
        // every other slug/name lookup this migration uses for that entity.
        const { data: products } = await CommerceProduct.query.primary({ templateId: published.templateId }).go({ pages: "all" });
        const product = products.find((p) => p.slug === candidateSlug && p.active && p.kind === "PHYSICAL");
        if (product && homeOnly) return homePageRedirect(request);
        if (product) {
          let html = injectProductSeo(productDetailTemplate.compiledHtml, {
            name: product.name,
            description: product.description ?? null,
            imageUrl: product.imageUrl ?? null,
          });
          html = injectSeoTags(html, {
            // The product's own address — it was "/<slug>", which pointed search engines at a 404.
            canonicalUrl: `https://${rawDomain}${requestedPagePath}${new URL(request.url).pathname.endsWith("/") ? "/" : ""}`,
            noindex: published.noindex ?? false,
            siteName: published.template.name || rawDomain,
          });
          html = optimizeImages(html);
          html = injectCommerceScript(
            html,
            (await getStorefrontPath(published.templateId)) ?? `/${DEFAULT_STOREFRONT_SLUG}`,
            await getCheckoutPath(published.templateId),
            resolveCommerceTheme(commerceSettings, published.template.designJson),
            commerceSettings.productUrlBase ?? null,
          );
          if (commerceSettings.newsletterPopupEnabled && commerceSettings.maildripNewsletterGroupId) {
            html = injectNewsletterPopupScript(html);
          }
          if (!resolveHideBranding(published.user.subscriptionPlan, published.user.hideBranding)) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
            html = injectBrandingBar(html, `${appUrl}/?utm_source=branding_bar#pricing`);
          }
          return new NextResponse(html, {
            headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" },
          });
        }
      }
    }
  }

  // Nothing in the page tree matched. Before giving up, check whether this is an old
  // WordPress permalink (or a renamed Plexo page) that should 301 to its new home —
  // e.g. a WP site's "/2023/04/my-post/" migrated to "/blog/my-post". This is the ONE
  // place that check needs to live for non-/blog-prefixed old paths: anything already
  // under literal "/blog" is handled by app/pub/[domain]/blog/[...slug]/page.tsx instead,
  // since that route takes precedence over this catch-all and never reaches here.
  const fullRequestedPath = "/" + slugSegments.join("/");
  const decodedFullPath = "/" + slugSegments.map(safeDecode).join("/");
  const redirectTo =
    (await resolveBlogRedirect(published.templateId, fullRequestedPath)) ??
    (decodedFullPath !== fullRequestedPath ? await resolveBlogRedirect(published.templateId, decodedFullPath) : null);
  if (redirectTo) {
    // On Free the new home of an old link isn't served either — send the visitor home.
    if (homeOnly) return homePageRedirect(request);
    return NextResponse.redirect(new URL(redirectTo, request.url), 301);
  }

  // /sitemap.xml and /robots.txt for every site — generated from the page tree and blog,
  // unless the owner uploaded their own file at that path (checked first, so it wins).
  if (matchedSegments === 0 && remainingSegments.length === 1 && (remainingSegments[0] === "sitemap.xml" || remainingSegments[0] === "robots.txt")) {
    const own = published.template.sourceType === "RAW_UPLOAD"
      ? (await TemplateAsset.get({ templateId: published.templateId, path: remainingSegments[0] }).go()).data
      : null;
    if (!own) {
      const body = remainingSegments[0] === "sitemap.xml"
        ? await buildSiteSitemap(published.template, rawDomain, { homeOnly })
        : buildSiteRobotsTxt(rawDomain, published.noindex ?? false);
      return new NextResponse(body, {
        headers: {
          "Content-Type": remainingSegments[0] === "sitemap.xml" ? "application/xml; charset=utf-8" : "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      });
    }
  }

  // Leftover segments after the walk are an asset path under whichever page the walk
  // stopped at. Only RAW_UPLOAD pages have TemplateAsset files hanging off them.
  if (cursor.sourceType !== "RAW_UPLOAD") {
    return notFoundResponse();
  }

  // Asset paths are stored decoded (a migrated WordPress upload like "Our Team.jpg"), the
  // same way page slugs are — try the decoded form first, then the raw one.
  const decodedRequestedPath = remainingSegments.map(safeDecode).join("/");
  const requestedPath = remainingSegments.join("/");
  // Clean-URL fallback: a zip's internal links (or a visitor typing the URL) commonly
  // omit the .html extension — /about should resolve to about.html the same way
  // Netlify/Vercel/GitHub Pages static hosting does, not 404 on an exact-path miss.
  const candidatePaths = [
    ...(decodedRequestedPath !== requestedPath ? [decodedRequestedPath] : []),
    requestedPath,
    `${requestedPath}.html`,
    `${requestedPath}.htm`,
    `${requestedPath}/index.html`,
  ];
  // Direct key .get() per candidate (TemplateAsset's primary key is templateId+path — see
  // contentEntities.ts), tried in priority order and stopping at the first hit — the
  // DynamoDB equivalent of Prisma's findMany+manual-pick, which existed there only to
  // guarantee priority order Prisma's own `in` filter didn't promise.
  let asset: EntityItem<typeof TemplateAsset> | null = null;
  for (const path of candidatePaths) {
    const { data } = await TemplateAsset.get({ templateId: cursor.id, path }).go();
    if (data) {
      asset = data;
      break;
    }
  }
  if (!asset) {
    return notFoundResponse();
  }
  // no-store: an edit (e.g. a Text Content color change) overwrites this exact blob URL in
  // place rather than minting a new one, so a cached `fetch()` result here would keep
  // serving the pre-edit bytes even though the database and blob storage both already
  // have the new content — confirmed as the cause of a saved color edit not showing up on
  // the live site until a hard reload.
  const assetRes = await fetch(asset.blobUrl, { cache: "no-store" });
  if (!assetRes.ok || !assetRes.body) {
    return notFoundResponse();
  }
  const headers = new Headers({
    "Content-Type": asset.contentType,
    "X-Content-Type-Options": "nosniff",
    // Short-lived + revalidated rather than a blind long max-age, for the same reason as
    // the no-store fetch above — a stale-while-revalidate window keeps repeat requests fast
    // without risking a visitor's BROWSER cache hiding a real content change for an hour.
    "Cache-Control": "public, max-age=60, must-revalidate, stale-while-revalidate=300",
  });
  // Browsers only load web fonts cross-origin with CORS — without this, the dashboard's
  // page previews (which load a site's files from its live domain) show icon fonts as
  // empty boxes. Fonts are public files on a public site, so any origin may load them.
  if (/^(font\/|application\/(font|x-font|vnd\.ms-fontobject))/i.test(asset.contentType) || /\.(woff2?|ttf|otf|eot)$/i.test(remainingSegments.join("/"))) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  const etag = assetRes.headers.get("etag");
  if (etag) headers.set("ETag", etag);
  const lastModified = assetRes.headers.get("last-modified");
  if (lastModified) headers.set("Last-Modified", lastModified);
  return new NextResponse(assetRes.body, { headers });
}

// Pages migrated from WordPress keep their plugins' front-end scripts, and several of those
// fire background requests at WordPress's AJAX endpoint (cookie-consent logging, click
// tracking, "load more"). With no WordPress behind the site, answer the way WordPress
// itself answers an action nobody handles — a harmless, well-formed "not handled" — so
// those scripts fail quietly instead of throwing on an HTML error page.
function isWordPressAjaxPath(slug: string[] | undefined): boolean {
  const segments = slug ?? [];
  return segments.length >= 2 && segments[segments.length - 1] === "admin-ajax.php" && segments[segments.length - 2] === "wp-admin";
}

function wordPressAjaxStub(): NextResponse {
  return NextResponse.json({ success: false, data: "This site no longer runs WordPress." }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

// Keys plugins post alongside real answers — never shown in the owner's inbox.
const WP_PLUMBING_KEY_RE = /^(action|.*nonce|_wp_http_referer|security|nonce|_ajax_nonce|form_id|post_id|page_id|referer|referrer)$/i;

async function readSubmittedFields(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  let entries: [string, unknown][] = [];
  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      entries = Object.entries(body ?? {}).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((item) => [k, typeof item === "string" ? item : JSON.stringify(item)] as [string, unknown]) : [[k, typeof v === "string" ? v : v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)] as [string, unknown]],
      );
    } else {
      entries = Array.from((await request.formData()).entries());
    }
  } catch {
    return {};
  }
  const fields = collectFormFields(entries);
  for (const key of Object.keys(fields)) if (WP_PLUMBING_KEY_RE.test(key)) delete fields[key];
  return fields;
}

/** An AJAX call carrying what a person typed into a form (an email or a message), rather than a tracking ping. */
function looksLikeFormSubmission(fields: Record<string, string>): boolean {
  const keys = Object.keys(fields);
  if (keys.length < 2) return false;
  const hasEmail = Object.values(fields).some((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  return hasEmail || keys.some((k) => /message|comment|enquiry|inquiry/i.test(k));
}

function humanizeRoute(path: string): string {
  const parts = path.split("/").filter((p) => p && p !== "wp-json" && !/^v\d+$/.test(p));
  const tail = parts.slice(-2).map((p) => p.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  return tail.join(" — ") || "Website form";
}

/**
 * POSTs on a published site. Only WordPress-compatibility endpoints of a site migrated
 * from WordPress live here:
 *  - a custom plugin's own submission endpoint (recorded at migration time on
 *    Template.migratedApiCaptureRoutes) → stored in Form Submissions, so a widget or app
 *    still sending to it keeps working;
 *  - admin-ajax.php → a form a plugin submits with JavaScript is captured the same way;
 *    anything else (consent logging, click tracking) gets the harmless "not handled" reply.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ domain: string; slug?: string[] }> },
): Promise<NextResponse> {
  const { domain, slug } = await context.params;
  const segments = slug ?? [];
  const isAjax = isWordPressAjaxPath(segments);
  const path = "/" + segments.map(safeDecode).join("/");

  const siteResult = await resolveSite(decodeURIComponent(domain));
  if (siteResult.status !== "ok") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const root = siteResult.published.template;
  const captureRoutes = Array.isArray(root.migratedApiCaptureRoutes) ? (root.migratedApiCaptureRoutes as string[]) : [];
  const isCaptureRoute = captureRoutes.some((r) => path === r || path === `${r}/`);
  if (!isAjax && !isCaptureRoute) return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
  if (!root.migratedFrom) return isAjax ? wordPressAjaxStub() : NextResponse.json({ error: "Method not allowed." }, { status: 405 });

  const fields = await readSubmittedFields(request);
  if (isAjax && !looksLikeFormSubmission(fields)) return wordPressAjaxStub();
  if (Object.keys(fields).length === 0) return NextResponse.json({ success: false, message: "Nothing was submitted." }, { status: 400 });

  const templateId = siteResult.published.templateId;
  if (!(await checkCommerceRateLimit(`forms:wp:${templateId}:${clientIp(request)}`, 10))) {
    return NextResponse.json({ success: false, message: "Too many submissions. Please try again shortly." }, { status: 429 });
  }

  const action = new URL(request.url).searchParams.get("action");
  const formName = isCaptureRoute ? humanizeRoute(path) : `Website form${action ? ` (${action.replace(/[-_]+/g, " ")})` : ""}`;
  await recordFormSubmission({ templateId, organizationId: siteResult.published.organization.id, formName, fields, submitterIp: clientIp(request), siteHost: decodeURIComponent(domain) });

  const message = "Thank you — your submission has been received.";
  // Covers the response shapes WordPress plugin JavaScript commonly checks.
  return NextResponse.json({ success: true, status: "success", message, data: { message } }, { headers: { "Cache-Control": "no-store" } });
}
