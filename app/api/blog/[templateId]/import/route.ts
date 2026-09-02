import { NextRequest, NextResponse } from "next/server";
import { uploadObject, StorageError } from "@/lib/storage";
import { ImportJob } from "@/lib/db/importEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { checkWordPressReachable, normalizeSiteUrl } from "@/lib/blogImport/wpClient";
import { parseWxr } from "@/lib/blogImport/wxrParser";

type ImportMediaHandling = "RETAIN" | "REHOST";
type ImportSourceType = "WP_REST" | "WXR_UPLOAD";
type ImportJobStatus = "PENDING" | "DISCOVERING" | "RUNNING" | "PAUSED_ERROR" | "COMPLETED" | "FAILED" | "CANCELLED";

const MAX_WXR_BYTES = 50 * 1024 * 1024;

// Rehosting downloads + re-uploads every image to S3 — bounded to small imports so a
// full-site migration can't rack up unbounded storage/time. Larger imports must use
// Retain (keep hotlinking the source site's media) instead.
const MAX_REHOST_POSTS = 10;

function parseMediaHandling(value: FormDataEntryValue | string | null): ImportMediaHandling {
  return value === "REHOST" ? "REHOST" : "RETAIN";
}

function rehostCapError(totalPosts: number): NextResponse {
  return NextResponse.json(
    {
      error: `Rehost is only available for imports of ${MAX_REHOST_POSTS} posts or fewer (this site has ${totalPosts} published posts). Choose "Retain original media" instead.`,
    },
    { status: 400 },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  // Primary's SK is id (a UUID), not createdAt — a plain query order wouldn't be
  // chronological, so this sorts in memory instead. A site's import-job history is small
  // in practice (imports are rare, deliberate actions), so fetching the whole partition
  // and sorting is fine — same "small in practice" assumption used elsewhere in this
  // migration (e.g. server/slugDynamo.ts's ensureUniqueSlug).
  const { data: allJobs } = await ImportJob.query.primary({ templateId: resolved.context.templateId }).go();
  const jobs = allJobs
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 20);
  return NextResponse.json({ jobs });
}

async function createWxrJob(request: NextRequest, templateId: string, userId: string): Promise<NextResponse> {
  const form = await request.formData().catch(() => null);
  const uploaded = form?.get("file");
  if (!(uploaded instanceof File)) {
    return NextResponse.json({ error: "Choose your WordPress export (.xml) file." }, { status: 400 });
  }
  if (uploaded.size > MAX_WXR_BYTES) {
    return NextResponse.json({ error: `That export file exceeds the ${MAX_WXR_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
  }

  const mediaHandling = parseMediaHandling(form?.get("mediaHandling") ?? null);

  const buffer = Buffer.from(await uploaded.arrayBuffer());
  const xmlText = buffer.toString("utf8");

  let totalPosts: number;
  try {
    totalPosts = parseWxr(xmlText).posts.length;
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read that export file." }, { status: 400 });
  }
  if (totalPosts === 0) {
    return NextResponse.json({ error: "No published posts found in that export file." }, { status: 400 });
  }
  if (mediaHandling === "REHOST" && totalPosts > MAX_REHOST_POSTS) {
    return rehostCapError(totalPosts);
  }

  let wxrBlobUrl: string;
  try {
    const blob = await uploadObject(`blog-import-wxr/${templateId}/${Date.now()}.xml`, buffer, {
      access: "public",
      contentType: "application/xml",
    });
    wxrBlobUrl = blob.url;
  } catch (err) {
    if (err instanceof StorageError) return NextResponse.json({ error: err.message }, { status: 500 });
    throw err;
  }

  const id = crypto.randomUUID();
  await ImportJob.create({
    id,
    templateId,
    sourceType: "WXR_UPLOAD",
    wxrBlobUrl,
    status: "PENDING",
    mediaHandling,
    totalPosts,
    createdBy: userId,
    cursor: { offset: 0, batchSize: 5 },
  }).go();
  const { data: job } = await ImportJob.get({ templateId, id }).go();

  return NextResponse.json({ job }, { status: 201 });
}

async function createRestJob(request: NextRequest, templateId: string, userId: string): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as { sourceUrl?: string; mediaHandling?: string };
  if (!body.sourceUrl?.trim()) {
    return NextResponse.json({ error: "Enter your WordPress site's URL." }, { status: 400 });
  }
  const mediaHandling = parseMediaHandling(body.mediaHandling ?? null);

  const sourceUrl = normalizeSiteUrl(body.sourceUrl);
  const check = await checkWordPressReachable(sourceUrl);
  if (!check.reachable) {
    return NextResponse.json(
      {
        error:
          "Couldn't reach that site's WordPress REST API. If the site is up but this keeps failing, its REST API may be disabled — try uploading a WordPress export (.xml) file instead.",
      },
      { status: 400 },
    );
  }
  if (mediaHandling === "REHOST" && (check.totalPosts === undefined || check.totalPosts > MAX_REHOST_POSTS)) {
    return rehostCapError(check.totalPosts ?? MAX_REHOST_POSTS + 1);
  }

  const id = crypto.randomUUID();
  await ImportJob.create({
    id,
    templateId,
    sourceType: "WP_REST",
    sourceUrl,
    status: "PENDING",
    mediaHandling,
    totalPosts: check.totalPosts,
    createdBy: userId,
    cursor: { page: 1, perPage: 5 },
  }).go();
  const { data: job } = await ImportJob.get({ templateId, id }).go();

  return NextResponse.json({ job }, { status: 201 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = requirePermission(resolved.context.role, { blog: ["create"] });
  if (permissionError) return permissionError;

  // One job per site can safely run at a time — starting another while one is already
  // in flight would just double-process (harmlessly, thanks to upsert-by-externalId,
  // but wastefully) rather than run any faster.
  const { data: templateJobs } = await ImportJob.query.primary({ templateId: resolved.context.templateId }).go();
  const existingActive = templateJobs.find((j) => j.status === "PENDING" || j.status === "RUNNING");
  if (existingActive) {
    return NextResponse.json({ job: existingActive, alreadyRunning: true });
  }

  const isMultipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");
  return isMultipart
    ? createWxrJob(request, resolved.context.templateId, resolved.context.userId)
    : createRestJob(request, resolved.context.templateId, resolved.context.userId);
}
