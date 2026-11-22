import { NextRequest, NextResponse } from "next/server";
import { Template } from "@/lib/db/contentEntities";
import { setDigestEnabled, verifyUnsubscribe } from "@/lib/siteHealth/digest";

const page = (title: string, body: string, status = 200) =>
  new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f2;color:#121212;font:16px/1.6 system-ui,sans-serif}main{max-width:460px;margin:24px;padding:36px;background:#fff;border:1px solid #e4e4dc;border-radius:20px}h1{margin:0 0 8px;font-size:24px}p{margin:0 0 12px;color:#3f3f3c}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

/**
 * GET /api/public/site-health/unsubscribe?site=<id>&sig=<signed>
 * The link at the bottom of the weekly "Your site health" email. One tap, no sign-in: the signature (lib/siteHealth/digest.ts) proves
 * the link came from us for that site. It only ever switches the email off; turning it back on is in the Site health tab.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const site = request.nextUrl.searchParams.get("site");
  if (!verifyUnsubscribe(site, request.nextUrl.searchParams.get("sig"))) {
    return page("This link doesn't work", "<p>It may have been cut short when it was copied. Open your site's Site health tab in Plexo to change the weekly email there.</p>", 400);
  }
  const { data: tpl } = await Template.get({ id: site! }).go();
  if (!tpl) return page("This link doesn't work", "<p>We couldn't find that site. Open Plexo to change the weekly email there.</p>", 404);
  await setDigestEnabled({ id: tpl.id, organizationId: tpl.organizationId }, false);
  return page("You're unsubscribed", `<p>We won't send the weekly Site health email for ${tpl.name.replace(/[<>&"]/g, "")} any more.</p><p>Changed your mind? Open the Site health tab in Plexo and switch "Weekly email" back on.</p>`);
}
