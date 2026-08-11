import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/app/api/v1/domains/route";
import { getTierFeatures } from "@/lib/subscription";
import { detectPlatform } from "@/lib/siteImport/detect";

/**
 * POST /api/v1/site-import/detect
 *
 * Standalone, job-less pre-check used by the "Import a website" wizard's first step: fetch
 * the given URL's homepage once and report back the detected platform + reachability, so the
 * wizard can show "We detected: WordPress" (with a manual override) before the user commits
 * to creating a SiteImportJob. Gated the same way the rest of site-import is (Ultra plan via
 * multiPageSitesEnabled) so the probe itself can't be used by ineligible accounts as a free
 * SSRF-guarded fetch proxy.
 *
 * Body: { sourceUrl: string }
 * Response: { platform: SiteImportPlatform, reachable: boolean }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid session or API key required." }, { status: 401 });
  }

  const features = getTierFeatures(resolved.subscriptionPlan);
  if (!features.multiPageSitesEnabled) {
    return NextResponse.json({ error: "Importing a full website requires the Ultra plan." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const sourceUrl = typeof body?.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  if (!sourceUrl) {
    return NextResponse.json({ error: "sourceUrl is required." }, { status: 400 });
  }

  const result = await detectPlatform(sourceUrl);
  return NextResponse.json({ platform: result.platform, reachable: result.reachable });
}
