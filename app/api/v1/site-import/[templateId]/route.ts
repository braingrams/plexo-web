import { NextRequest, NextResponse } from "next/server";
import { SiteImportPhase, SiteImportPlatform } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { resolveSiteImportSite } from "@/lib/siteImport/adminAuth";
import { normalizeSiteUrl } from "@/lib/blogImport/wpClient";
import { checkUrlsForThreats } from "@/lib/safeBrowsing";

// Mirrors server/rawUpload.ts's RAW_UPLOAD_DAILY_LIMIT pattern (plain DB count, no Redis in
// this stack) — set lower than that limit's 15/day, since a whole-site crawl is far more
// expensive than a single zip upload.
const SITE_IMPORT_DAILY_LIMIT = 3;
// A whole-site crawl is a meaningfully heavier concurrent load than a blog-post batch —
// org-scoped (not template-scoped) so one org can't run several crawls in parallel.
const SITE_IMPORT_MAX_CONCURRENT = 1;

const NON_TERMINAL_PHASES: SiteImportPhase[] = [
  SiteImportPhase.PENDING,
  SiteImportPhase.DETECTING,
  SiteImportPhase.DISCOVERING,
  SiteImportPhase.FETCHING,
  SiteImportPhase.REWRITING,
  SiteImportPhase.PAUSED_ERROR,
];

function parsePlatformOverride(value: unknown): SiteImportPlatform | null {
  if (typeof value !== "string") return null;
  return (Object.values(SiteImportPlatform) as string[]).includes(value) ? (value as SiteImportPlatform) : null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveSiteImportSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const jobs = await prisma.siteImportJob.findMany({
    where: { templateId: resolved.context.templateId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ jobs });
}

/**
 * POST /api/v1/site-import/[templateId]
 *
 * Creates a whole-website import job targeting this site's root Template — its own
 * compiledHtml/assets are overwritten with the source site's crawled homepage, and every
 * other discovered page becomes a new child page underneath it (see lib/siteImport/runJob.ts).
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
  const user = await prisma.user.findUnique({ where: { id: resolved.context.userId }, select: { aupAcceptedAt: true } });
  if (!user?.aupAcceptedAt) {
    if (body.acceptAup !== true) {
      return NextResponse.json(
        { error: "You must accept the Acceptable Use Policy before importing unsanitized HTML.", requiresAupAcceptance: true, aupUrl: "/legal/acceptable-use" },
        { status: 403 },
      );
    }
    await prisma.user.update({ where: { id: resolved.context.userId }, data: { aupAcceptedAt: new Date() } });
  }

  const sourceUrlForScan = normalizeSiteUrl(body.sourceUrl);
  const threats = await checkUrlsForThreats([sourceUrlForScan]);
  if (threats.length > 0) {
    return NextResponse.json({ error: "That URL was flagged as unsafe (malware/phishing) and can't be imported." }, { status: 400 });
  }

  // One import per site at a time — mirrors blog-import's existingActive dedupe check.
  const existingActive = await prisma.siteImportJob.findFirst({
    where: { templateId: resolved.context.templateId, phase: { in: NON_TERMINAL_PHASES } },
  });
  if (existingActive) {
    return NextResponse.json({ job: existingActive, alreadyRunning: true });
  }

  const [dailyCount, concurrentCount] = await Promise.all([
    prisma.siteImportJob.count({
      where: { organizationId: resolved.context.organizationId, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    prisma.siteImportJob.count({
      where: { organizationId: resolved.context.organizationId, phase: { in: NON_TERMINAL_PHASES } },
    }),
  ]);
  if (dailyCount >= SITE_IMPORT_DAILY_LIMIT) {
    return NextResponse.json({ error: `You've reached the limit of ${SITE_IMPORT_DAILY_LIMIT} website imports per 24 hours. Try again later.` }, { status: 429 });
  }
  if (concurrentCount >= SITE_IMPORT_MAX_CONCURRENT) {
    return NextResponse.json({ error: "Another website import is already running for your account. Wait for it to finish first." }, { status: 429 });
  }

  const platformOverride = parsePlatformOverride(body.platformOverride);

  const job = await prisma.siteImportJob.create({
    data: {
      templateId: resolved.context.templateId,
      organizationId: resolved.context.organizationId,
      sourceUrl: sourceUrlForScan,
      platform: platformOverride ?? SiteImportPlatform.UNKNOWN,
      importBlogPosts: body.importBlogPosts === true,
      phase: SiteImportPhase.PENDING,
      ownershipAttestedAt: new Date(),
      ownershipAttestedBy: resolved.context.userId,
      createdBy: resolved.context.userId,
    },
  });

  return NextResponse.json({ job }, { status: 201 });
}
