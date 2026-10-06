import { NextRequest, NextResponse } from "next/server";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { checkUrlsForThreats } from "@/lib/safeBrowsing";
import { resolveMigrationAccess } from "@/lib/wpMigration/access";
import { discoverWordPressInstall, WordPressNotFoundError } from "@/lib/wpMigration/discover";
import { previewInstall } from "@/lib/wpMigration/inventory";

export const maxDuration = 60;

/**
 * POST /api/v1/wp-migration/detect
 *
 * Finds the WordPress install behind any URL (domain root, deep link, subdirectory install,
 * a static splash page in front of WordPress) and previews what moving it would involve —
 * page/post/media counts, theme, and what happens to each plugin — before anything is
 * created. The wizard shows this so the owner knows exactly what they're getting first.
 *
 * Body: { sourceUrl: string }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveMigrationAccess(request, { permission: "create" });
  if ("error" in resolved) return resolved.error;

  const body = (await request.json().catch(() => ({}))) as { sourceUrl?: string };
  const sourceUrl = body.sourceUrl?.trim();
  if (!sourceUrl) return NextResponse.json({ error: "Enter your WordPress site's address, like example.com." }, { status: 400 });

  if (!(await checkCommerceRateLimit(`wp-migration:detect:${resolved.access.userId}`, 15))) {
    return NextResponse.json({ error: "That's a lot of checks in a short time — wait a minute and try again." }, { status: 429 });
  }

  try {
    const install = await discoverWordPressInstall(sourceUrl);
    const threats = await checkUrlsForThreats([install.origin]);
    if (threats.length > 0) {
      return NextResponse.json({ error: "That site was flagged as unsafe (malware or phishing), so it can't be moved." }, { status: 400 });
    }
    const preview = await previewInstall(install);
    return NextResponse.json({ install, preview });
  } catch (err) {
    if (err instanceof WordPressNotFoundError) return NextResponse.json({ error: err.message, notWordPress: true }, { status: 422 });
    if (err instanceof Error && err.name === "SsrfBlockedError") {
      return NextResponse.json({ error: "That address isn't a public website we can reach." }, { status: 400 });
    }
    return NextResponse.json(
      { error: "We couldn't reach that site. Check the address is right and the site is online, then try again." },
      { status: 502 },
    );
  }
}
