import { NextResponse } from "next/server";
import type { EntityItem } from "electrodb";
import { Template } from "@/lib/db/contentEntities";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { resolveHideBranding, canWhiteLabel } from "@/lib/subscription";
import { getOrganizationOwnerPlanDynamo } from "@/server/orgDynamo";
import { injectBrandingBar, injectContentScript, injectFavicon, injectFormsScript, injectSeoTags, insertBeforeBodyEnd } from "@/lib/pub/htmlInject";
import { buildSitePrefix, getObject } from "./blobStore";
import { ANALYTICS_BEACON_JS, previewRuntimeJs } from "./previewRuntime";
import { latestSuccessfulBuild, recordLatestBuild } from "./builds";
import { injectAppSeo, type AppSeo } from "./appSeo";
import { AppSettings } from "@/lib/db/appEntities";

// Serves a REACT_PROJECT site from one of its builds. Real files are served as built; any
// other path gets index.html so the app's own router handles it. Build output never
// changes once written, so small files are also kept in memory per Lambda instance.

type TemplateItem = EntityItem<typeof Template>;

export type ServeContext = {
  template: TemplateItem;
  host: string;
  isPreview: boolean;
  noindex: boolean;
  owner: { subscriptionPlan: string; hideBranding: boolean };
  organization: { id: string; logo: string | null; whiteLabelEnabled: boolean };
  /** The owner's plan serves only the first screen (Free): other routes send visitors to "/". */
  homeOnly?: boolean;
};

const MAX_CACHED_BYTES = 256 * 1024;
const CACHE_BUDGET = 48 * 1024 * 1024;
const cache = new Map<string, { body: Buffer; contentType: string }>();
let cacheBytes = 0;

async function readBuildFile(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // LRU: most recent last
    return hit;
  }
  const object = await getObject(key);
  if (!object) return null;
  const entry = { body: object.body, contentType: object.contentType ?? "application/octet-stream" };
  if (entry.body.length <= MAX_CACHED_BYTES) {
    cache.set(key, entry);
    cacheBytes += entry.body.length;
    while (cacheBytes > CACHE_BUDGET && cache.size) {
      const [oldestKey, oldest] = cache.entries().next().value!;
      cache.delete(oldestKey);
      cacheBytes -= oldest.body.length;
    }
  }
  return entry;
}

function statusPage(title: string, message: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0f19;color:#f0f2ff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}
.c{padding:2rem;max-width:460px}h1{font-size:1.6rem;margin:0 0 .75rem;color:#a78bfa}p{color:rgba(240,242,255,.7);line-height:1.6}</style></head>
<body><div class="c"><h1>${title}</h1><p>${message}</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
  );
}

async function resolveBuildId(ctx: ServeContext): Promise<string | null> {
  if (!ctx.isPreview) return ctx.template.liveBuildId ?? null;
  if (ctx.template.latestBuildId) return ctx.template.latestBuildId;
  // latestBuildId is recorded when someone waits on a build; a build nobody waited on
  // (e.g. a Deploy API call that didn't poll) is found here and recorded for next time.
  const latest = await latestSuccessfulBuild(ctx.template.id);
  if (latest) await recordLatestBuild(latest);
  return latest?.id ?? null;
}

function safePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((s) => s === ".." || s === "." || s.includes("\0"))) return null;
  return segments.join("/");
}

export async function serveProject(request: Request, ctx: ServeContext): Promise<NextResponse> {
  const buildId = await resolveBuildId(ctx);
  if (!buildId) {
    return ctx.isPreview
      ? statusPage("Your app is getting ready", "The first build hasn't finished yet. This page will work as soon as it does — try again in a few seconds.", 503)
      : statusPage("Not published yet", "This app hasn't been published. Its owner can publish it from Plexo.", 404);
  }
  const { data: build } = await ProjectBuild.get({ id: buildId }).go({ attributes: ["id", "templateId", "outputPrefix"] });
  if (!build || build.templateId !== ctx.template.id) return statusPage("Not found", "This app's build couldn't be found.", 404);

  const url = new URL(request.url);
  const rel = safePath(url.pathname);
  if (rel === null) return new NextResponse("Bad request", { status: 400 });
  // Sourcemaps are for Plexo's own error mapping (read straight from storage), never public.
  if (rel.endsWith(".map")) return new NextResponse("Not found", { status: 404 });

  const prefix = build.outputPrefix || buildSitePrefix(ctx.template.id, build.id);
  const isAsset = rel.startsWith("__plexo/assets/");
  const wantsFile = rel !== "" && rel !== "index.html";
  const last = rel.split("/").pop() ?? "";
  const looksLikeFile = /\.[a-z0-9]{1,8}$/i.test(last) && !/\.html?$/i.test(last);

  // Free: the app's first screen only. Any other page — a route the app's own router
  // would handle, or a pre-rendered page — sends the visitor back to "/". Scripts, styles
  // and images still load (the first screen needs them). The in-app router is covered too:
  // HOME_ONLY_GUARD_JS (htmlResponse) stops client-side navigation to other screens.
  if (ctx.homeOnly && wantsFile && !isAsset && !looksLikeFile) {
    return NextResponse.redirect(new URL(`/${url.search}`, url), { status: 302, headers: { "Cache-Control": "no-store" } });
  }

  if (wantsFile) {
    const file = await readBuildFile(`${prefix}/${rel}`) ?? (rel.endsWith("/") ? null : await readBuildFile(`${prefix}/${rel}/index.html`));
    if (file) {
      const isHtml = file.contentType.startsWith("text/html");
      if (!isHtml) {
        return new NextResponse(new Uint8Array(file.body), {
          headers: {
            "Content-Type": file.contentType,
            "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "public, max-age=0, s-maxage=60, must-revalidate",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return htmlResponse(file.body.toString("utf8"), url, ctx);
    }
    // A missing script, stylesheet or image is a real 404 — answering it with index.html
    // turns a clear "file not found" into a confusing "unexpected token <" in the browser.
    if (isAsset || looksLikeFile) {
      return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=0, s-maxage=10" } });
    }
  }

  const index = await readBuildFile(`${prefix}/index.html`);
  if (!index) return statusPage("Something went wrong", "This app's build is missing its index.html. Rebuilding it usually fixes this.", 500);
  return htmlResponse(index.body.toString("utf8"), url, ctx);
}

// Free serves an app's first screen only. The server already redirects any other address
// to "/"; this covers navigation INSIDE the app (a router's pushState never reaches the
// server): moving to another screen loads the first screen instead. Same-page changes —
// "/?tab=2", "#section" — are left alone.
export const HOME_ONLY_GUARD_JS = `(function(){try{
var home=function(u){try{var p=new URL(u,location.href);return p.origin!==location.origin||p.pathname==="/"||p.pathname===""}catch(e){return true}};
if(!home(location.href)){location.replace("/");return}
["pushState","replaceState"].forEach(function(k){var o=history[k];history[k]=function(s,t,u){if(u!=null&&!home(String(u))){location.assign("/");return}return o.apply(this,arguments)}});
window.addEventListener("popstate",function(){if(!home(location.href))location.replace("/")});
}catch(e){}})();`;

// The owner's search & sharing settings, briefly kept per Lambda instance — HTML is served on
// every page view, and a change shows up within the edge cache's own minute anyway.
const SEO_TTL_MS = 30_000;
const seoCache = new Map<string, { seo: AppSeo | null; at: number }>();

async function appSeo(templateId: string): Promise<AppSeo | null> {
  const hit = seoCache.get(templateId);
  if (hit && Date.now() - hit.at < SEO_TTL_MS) return hit.seo;
  const { data } = await AppSettings.get({ templateId }).go({ attributes: ["seo"] }).catch(() => ({ data: null }));
  const seo = (data?.seo as AppSeo | undefined) ?? null;
  seoCache.set(templateId, { seo, at: Date.now() });
  if (seoCache.size > 2000) seoCache.delete(seoCache.keys().next().value!);
  return seo;
}

async function htmlResponse(source: string, url: URL, ctx: ServeContext): Promise<NextResponse> {
  let html = source;
  const seo = await appSeo(ctx.template.id);
  html = injectSeoTags(html, {
    canonicalUrl: `https://${ctx.host}${url.pathname}`,
    // Previews are never indexed — they're work in progress at a throwaway address.
    noindex: ctx.isPreview || ctx.noindex,
    siteName: seo?.title ?? ctx.template.name,
  });
  if (ctx.isPreview) {
    const editorOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
    // First thing in <head>, so it catches errors thrown while the app itself loads.
    html = html.replace(/<head[^>]*>/i, (m) => `${m}<script>${previewRuntimeJs(editorOrigin)}</script>`);
  }
  if (ctx.homeOnly && !ctx.isPreview) {
    // First thing in <head>, before the app's own router starts.
    html = html.replace(/<head[^>]*>/i, (m) => `${m}<script>${HOME_ONLY_GUARD_JS}</script>`);
  }
  html = insertBeforeBodyEnd(html, `<script>${ANALYTICS_BEACON_JS}</script>`);
  // Plexo content blocks and form collection for apps: both watch the page, so they also pick up
  // what the app renders after load. Forms are connected only when marked data-plexo-form.
  html = injectContentScript(html);
  html = injectFormsScript(html, ctx.template.id, { auto: false });
  if (!resolveHideBranding(ctx.owner.subscriptionPlan, ctx.owner.hideBranding)) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    html = injectBrandingBar(html, `${appUrl}/?utm_source=branding_bar#pricing`);
  }
  if (!seo?.faviconUrl && ctx.organization.logo && ctx.organization.whiteLabelEnabled && canWhiteLabel(await getOrganizationOwnerPlanDynamo(ctx.organization.id))) {
    html = injectFavicon(html, ctx.organization.logo);
  }
  html = injectAppSeo(html, seo, `https://${ctx.host}${url.pathname}`);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      // Short edge cache: a publish takes effect within a minute without an invalidation.
      "Cache-Control": ctx.isPreview ? "no-store" : "public, max-age=0, s-maxage=30, must-revalidate",
      "X-Plexo-Site": ctx.template.id,
      // Only the Plexo editor may frame a preview. A live app's framing is the owner's call,
      // same as every other published site.
      ...(ctx.isPreview ? { "Content-Security-Policy": `frame-ancestors ${new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin}` } : {}),
    },
  });
}
