import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { parseUserAgent, extractGeoFromHeaders } from "@/server/analytics";

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

  if (!published && rawDomain.endsWith(".localhost")) {
    const sub = rawDomain.replace(".localhost", "");
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const baseDomain = new URL(appUrl).hostname;
    const fallbackBase = baseDomain === "localhost" ? "plexo.charisol.io" : baseDomain;

    published = await prisma.publishedDomain.findUnique({
      where: { domain: `${sub}.${fallbackBase}` },
      include: { template: true },
    });
  }

  if (!published || !published.template) {
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
        templateId: published.templateId,
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
  return new NextResponse(published.template.compiledHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
