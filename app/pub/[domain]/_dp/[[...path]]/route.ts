import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { DeployedApp } from "@/lib/db/appEntities";
import { serveDeployedStatic } from "@/lib/pub/serveDeployedStatic";

// Deployed-app path proxy. Blog RSC pages at app/pub/[domain]/blog/ take Next.js routing
// precedence over the [[...slug]] catch-all, so any /blog/* path on a deployed static app
// would render plexo-web's own blog page instead of the site's uploaded HTML. To fix this,
// the blog pages redirect here (/_dp/{original-path}) when they detect a DeployedApp entity.
// This route fetches the static file from S3 and injects a history.replaceState call so
// the browser restores the original URL immediately after the redirect lands.
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ domain: string; path?: string[] }> },
): Promise<NextResponse> {
  const { domain: rawDomain, path: pathSegments = [] } = await context.params;
  const domain = decodeURIComponent(rawDomain);

  const siteResult = await resolveSite(domain);
  if (siteResult.status !== "ok") {
    return new NextResponse(null, { status: 404 });
  }

  const { data: deployedApp } = await DeployedApp.get({ templateId: siteResult.published.templateId }).go();
  if (!deployedApp || deployedApp.type !== "STATIC") {
    return new NextResponse(null, { status: 404 });
  }

  const result = await serveDeployedStatic(request, deployedApp, pathSegments);

  // For HTML responses, inject a tiny script that restores the pre-redirect URL so the
  // browser address bar shows /blog/… instead of /_dp/blog/… after the redirect lands.
  const contentType = result.headers.get("content-type") ?? "";
  if (result.ok && contentType.includes("text/html")) {
    const html = await result.text();
    const originalPath = "/" + pathSegments.join("/");
    const script = `<script>if(location.pathname.startsWith('/_dp/'))history.replaceState(null,'','${originalPath}')</script>`;
    const modified = /<head>/i.test(html)
      ? html.replace(/<head>/i, `<head>${script}`)
      : script + html;
    const headers = new Headers(result.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new NextResponse(modified, { status: result.status, headers });
  }

  return result;
}
