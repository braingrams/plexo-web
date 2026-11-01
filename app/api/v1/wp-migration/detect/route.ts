import { NextRequest, NextResponse } from "next/server";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { checkUrlsForThreats } from "@/lib/safeBrowsing";
import { resolveMigrationAccess } from "@/lib/wpMigration/access";
import { discoverWordPressInstall, WordPressNotFoundError } from "@/lib/wpMigration/discover";
import { previewInstall } from "@/lib/wpMigration/inventory";
import { estimateMigrationSeconds, formatDuration } from "@/lib/wpMigration/estimate";

export const maxDuration = 60;

/**
 * The owner gave an address with a folder in it ("example.com/blog"), so only that WordPress would be moved. When the
 * domain itself has pages in front of it (a splash page, a chooser) they'd be silently left behind — so say so and offer
 * the whole site instead. Undefined when the folder really is all there is, or the domain root can't be read.
 */
async function wholeSiteOption(origin: string, homeUrl: string): Promise<{ url: string; staticPages: string[] } | undefined> {
  try {
    const whole = await discoverWordPressInstall(`${origin}/`);
    const sameWordPress = whole.homeUrl.replace(/\/+$/, "") === homeUrl.replace(/\/+$/, "");
    if (!sameWordPress || whole.staticPages.length === 0) return undefined;
    return { url: `${origin}/`, staticPages: whole.staticPages };
  } catch {
    return undefined;
  }
}

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
    const wholeSite = install.scopedToPath ? await wholeSiteOption(install.origin, install.homeUrl) : undefined;
    return NextResponse.json({ install, preview: wholeSite ? { ...preview, wholeSite } : preview, estimatedDuration: formatDuration(estimateMigrationSeconds(preview.counts)) });
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
