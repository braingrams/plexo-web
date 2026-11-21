import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import { verifyDraftPreviewToken } from "@/lib/draftPreviewToken";

/**
 * GET /api/v1/templates/[id]/draft-preview[?page=<pageId>]
 * What the owner's site looks like right now, before it is online: the working copy (draftHtml) when there is one,
 * otherwise what was last published. Only people in the site's workspace can open it.
 * Served in a sandbox (no cookies, no access to the dashboard) because it is the owner's own page code.
 *
 * Signed link: `?sig=&exp=` (lib/draftPreviewToken.ts, 5 minutes, for that one page) opens the page without a
 * sign-in, so Plexo's own browser can take a screenshot of a draft (SOL's visual review). It never grants anything
 * but GET of that page's draft HTML; with `shot=1` the preview bar is left out of the picture.
 */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

function shell(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f5f7ed;color:#121212"><main style="max-width:440px;padding:32px;text-align:center">${body}</main>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "sandbox allow-top-navigation-by-user-activation" } });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const params = request.nextUrl.searchParams;
  const signed = params.has("sig");
  const shot = signed && params.get("shot") === "1";
  if (signed && !verifyDraftPreviewToken({ templateId: id, pageId: params.get("page"), shot }, { sig: params.get("sig"), exp: params.get("exp") })) {
    return shell("Link expired", `<h1 style="font-size:22px">This preview link has expired</h1><p>Open the preview again from your site.</p>`, 403);
  }
  const resolved = signed ? null : await resolveUser(request);
  if (!signed && !resolved) return shell("Sign in to preview", `<h1 style="font-size:22px">Please sign in</h1><p>Sign in to Plexo to preview your site.</p>`, 401);

  const { data: root } = await Template.get({ id }).go();
  if (!root || (!signed && root.organizationId !== resolved!.organizationId)) return shell("Not found", `<h1 style="font-size:22px">We can't find that site</h1><p>It may have been deleted.</p>`, 404);

  const { data: children } = await Template.query.byParent({ parentId: root.id }).go({ pages: "all" });
  const wanted = request.nextUrl.searchParams.get("page");
  const page = wanted ? children.find((c) => c.id === wanted) : root;
  if (!page) return shell("Not found", `<h1 style="font-size:22px">We can't find that page</h1><p>It may have been deleted.</p>`, 404);
  const back = `/dashboard/sites/${root.id}`;

  const { data: domains } = await PublishedDomain.query.primary({ templateId: root.id }).go({ limit: 1 });
  const liveHost = domains[0]?.domain;
  const baseHref = liveHost ? `https://${liveHost}/` : root.migratedFrom ? `${root.migratedFrom.replace(/\/+$/, "")}/` : null;

  if (page.sourceType === "REACT_PROJECT") {
    return shell("Preview", `<h1 style="font-size:22px">Apps are previewed while you build them</h1><p>Open your app and use the preview next to the chat. Put it online when you are ready for people to use it.</p><p><a href="${back}" target="_top" style="color:#517a12;font-weight:700">Back to my site</a></p>`);
  }

  const html = page.draftHtml || page.compiledHtml || "";
  // thumb=1: the small inert picture on the site's page cards. No bar, no user interaction, but styles and
  // scripts run so WordPress migrated sites and custom HTML render accurately. An empty page stays blank so
  // the card's own sketch shows through.
  const thumb = !signed && request.nextUrl.searchParams.get("thumb") === "1";
  if (thumb) {
    const csp = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=60",
      "Content-Security-Policy": "sandbox allow-scripts allow-same-origin",
    };
    if (!html.trim()) return new NextResponse("<!doctype html><meta charset=\"utf-8\"><body style=\"margin:0;background:transparent\">", { headers: csp });
    const bgStyle = "<style>html{background:#fff}</style>";
    const baseTag = baseHref && !/<base\b/i.test(html) ? `<base href="${baseHref}">` : "";
    let thumbHtml = html;
    if (/<head[^>]*>/i.test(thumbHtml)) {
      thumbHtml = thumbHtml.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}${bgStyle}`);
    } else if (/<html[^>]*>/i.test(thumbHtml)) {
      thumbHtml = thumbHtml.replace(/<html[^>]*>/i, (m) => `${m}<head>${baseTag}${bgStyle}</head>`);
    } else {
      thumbHtml = `<!doctype html><meta charset="utf-8"><head>${baseTag}${bgStyle}</head><body>${thumbHtml}</body>`;
    }
    return new NextResponse(thumbHtml, { headers: csp });
  }
  if (!html.trim()) {
    return shell("Nothing to preview yet", `<h1 style="font-size:22px">There is nothing to preview yet</h1><p>This page is still empty. Open the editor, add something to it, and then preview it here.</p><p><a href="${back}" target="_top" style="color:#517a12;font-weight:700">Back to my site</a></p>`);
  }

  // Keep people inside the preview when they click to another page of the site.
  const pathToId = new Map<string, string>([["/", root.id]]);
  for (const c of children) if (c.slug) pathToId.set(`/${c.slug}`, c.id);
  let out = html.replace(/href="(\/[^"#?]*)(#[^"]*)?"/g, (m, path: string, hash?: string) => {
    const target = pathToId.get(path.length > 1 ? path.replace(/\/$/, "") : path);
    return target ? `href="/api/v1/templates/${root.id}/draft-preview?page=${target}${hash ?? ""}"` : m;
  });

  const bar = `<div style="position:fixed;z-index:2147483647;left:0;right:0;bottom:0;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:10px 16px;background:#121212;color:#fff;font:600 14px system-ui,sans-serif"><span>Preview: only you can see this. It is not online yet.</span><a href="${back}" target="_top" style="color:#b8f34a">Back to my site</a></div>`;
  if (!shot) out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${bar}</body>`) : out + bar;

  if (baseHref && (page.sourceType === "RAW_UPLOAD" || root.sourceType === "RAW_UPLOAD") && !/<base\b/i.test(out)) {
    const baseTag = `<base href="${baseHref}">`;
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}${baseTag}`) : baseTag + out;
  }

  return new NextResponse(out, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation" } });
}
