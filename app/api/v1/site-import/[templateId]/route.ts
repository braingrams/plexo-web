import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveSiteImportSite } from "@/lib/siteImport/adminAuthDynamo";
import { normalizeSiteUrl } from "@/lib/blogImport/wpClient";
import { checkUrlsForThreats } from "@/lib/safeBrowsing";
import { SiteImportJob } from "@/lib/db/importEntities";
import { User } from "@/lib/db/coreEntities";

// Mirrors server/rawUpload.ts's RAW_UPLOAD_DAILY_LIMIT pattern (plain count, no Redis in
// this stack) — set lower than that limit's 15/day, since a whole-site crawl is far more
// expensive than a single zip upload.
const SITE_IMPORT_DAILY_LIMIT = 3;
// A whole-site crawl is a meaningfully heavier concurrent load than a blog-post batch —
// org-scoped (not template-scoped) so one org can't run several crawls in parallel.
const SITE_IMPORT_MAX_CONCURRENT = 1;

const NON_TERMINAL_PHASES = new Set(["PENDING", "DETECTING", "DISCOVERING", "FETCHING", "REWRITING", "PAUSED_ERROR"]);

const VALID_PLATFORMS = new Set(["WORDPRESS", "SQUARESPACE", "WIX", "WEBFLOW", "UNKNOWN"]);
function parsePlatformOverride(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return VALID_PLATFORMS.has(value) ? value : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteImportSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { data: jobs } = await SiteImportJob.query.primary({ templateId: resolved.context.templateId }).go();
  const sorted = jobs.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).slice(0, 20);
  return NextResponse.json({ jobs: sorted });
}

/**
 * POST /api/v1/site-import/[templateId]
 *
 * Creates a whole-website import job targeting this site's root Template — its own
 * compiledHtml/assets are overwritten with the source site's crawled homepage, and every
 * other discovered page becomes a new child page underneath it (see lib/siteImport/runJobDynamo.ts).
 *
 * Body: { sourceUrl, importBlogPosts?, platformOverride?, ownershipAttested: true }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteImportSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const body = (await request.json().catch(() => ({}))) as {
    sourceUrl?: string;
    importBlogPosts?: boolean;
    platformOverride?: string;
    ownershipAttested?: boolean;
    acceptAup?: boolean;
  };

  if (!body.sourceUrl?.trim()) {
    return NextResponse.json({ error: "Enter the website's URL." }, { status: 400 });
  }
  if (body.ownershipAttested !== true) {
    return NextResponse.json({ error: "Confirm you own or are authorized to migrate this website.", requiresOwnershipAttestation: true }, { status: 400 });
  }

  // Imported pages are RAW_UPLOAD under the hood (unsanitized, served byte-for-byte) — same
  // account-level consent gate as a raw zip/HTML upload, checked once per account, not
  // duplicated as a separate dialog in the site-import wizard itself.
  const { data: user } = await User.get({ id: resolved.context.userId }).go();
  if (!user?.aupAcceptedAt) {
    if (body.acceptAup !== true) {
      return NextResponse.json(
        { error: "You must accept the Acceptable Use Policy before importing unsanitized HTML.", requiresAupAcceptance: true, aupUrl: "/legal/acceptable-use" },
        { status: 403 },
      );
    }
    await User.patch({ id: resolved.context.userId }).set({ aupAcceptedAt: new Date().toISOString() }).go();
  }

  const sourceUrlForScan = normalizeSiteUrl(body.sourceUrl);
  const threats = await checkUrlsForThreats([sourceUrlForScan]);
  if (threats.length > 0) {
    return NextResponse.json({ error: "That URL was flagged as unsafe (malware/phishing) and can't be imported." }, { status: 400 });
  }

  // One import per site at a time — mirrors blog-import's existingActive dedupe check.
  const { data: existingJobs } = await SiteImportJob.query.primary({ templateId: resolved.context.templateId }).go();
  const existingActive = existingJobs.find((j) => NON_TERMINAL_PHASES.has(j.phase ?? "PENDING"));
  if (existingActive) {
    return NextResponse.json({ job: existingActive, alreadyRunning: true });
  }

  // SiteImportJob has no direct "count in last 24h" or "count non-terminal" query for an
  // org — fan out via the byOrg GSI1 and filter in memory, same bound as every other
  // rate-limit-style check on a low-cardinality-per-org entity in this migration.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: orgJobs } = await SiteImportJob.query.byOrg({ organizationId: resolved.context.organizationId }).go({ pages: "all" });
  const dailyCount = orgJobs.filter((j) => (j.createdAt ?? "") > dayAgo).length;
  const concurrentCount = orgJobs.filter((j) => NON_TERMINAL_PHASES.has(j.phase ?? "PENDING")).length;
  if (dailyCount >= SITE_IMPORT_DAILY_LIMIT) {
    return NextResponse.json({ error: `You've reached the limit of ${SITE_IMPORT_DAILY_LIMIT} website imports per 24 hours. Try again later.` }, { status: 429 });
  }
  if (concurrentCount >= SITE_IMPORT_MAX_CONCURRENT) {
    return NextResponse.json({ error: "Another website import is already running for your account. Wait for it to finish first." }, { status: 429 });
  }

  const platformOverride = parsePlatformOverride(body.platformOverride);

  const jobId = randomUUID();
  await SiteImportJob.create({
    id: jobId,
    templateId: resolved.context.templateId,
    organizationId: resolved.context.organizationId,
    sourceUrl: sourceUrlForScan,
    platform: (platformOverride ?? "UNKNOWN") as any,
    importBlogPosts: body.importBlogPosts === true,
    phase: "PENDING",
    ownershipAttestedAt: new Date().toISOString(),
    ownershipAttestedBy: resolved.context.userId,
    createdBy: resolved.context.userId,
  }).go();
  const { data: job } = await SiteImportJob.get({ templateId: resolved.context.templateId, id: jobId }).go();

  return NextResponse.json({ job }, { status: 201 });
}
