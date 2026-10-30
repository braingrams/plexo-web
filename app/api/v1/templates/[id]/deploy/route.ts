import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import mime from "mime";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { DeployedApp, type RedirectRule } from "@/lib/db/appEntities";
import { uploadObject } from "@/lib/storage";
import { getTierFeatures } from "@/lib/subscription";
import { updateProvisionedConcurrency } from "@/lib/pub/updateProvisionedConcurrency";

type HostingTier = "STATIC" | "LAMBDA" | "PROVISIONED";

// Framework builds produce binary/compiled files that the plain RAW_UPLOAD path rejects.
// This set is intentionally broader — we skip unrecognised extensions silently rather than
// error, so lock files, .gitignore, README etc. inside a dist folder are ignored harmlessly.
const ALLOWED_EXTENSIONS = new Set([
  "html", "htm", "css", "js", "mjs", "cjs", "json", "txt", "xml", "map",
  "webmanifest", "ts", "tsx",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico",
  "woff", "woff2", "ttf", "otf", "eot",
  "wasm", "data",
  "br", "gz",
  "mp4", "webm", "ogg", "mp3", "wav",
  "pdf",
]);

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_FILE_COUNT = 10_000;

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

// Detect the common "zip a folder rather than its contents" wrapper and strip it.
// E.g. all entries start with "dist/" → strip that prefix.
function stripWrapperPrefix(entries: JSZip.JSZipObject[]): string {
  const names = entries.map((e) => e.name);
  const topSegments = new Set(names.map((n) => n.split("/")[0]));
  const hasWrapper = topSegments.size === 1 && names.every((n) => n.includes("/"));
  return hasWrapper ? `${Array.from(topSegments)[0]}/` : "";
}

// Infer static serving hints from the built output's directory structure, not from
// source config files (which aren't in a build output zip). Returns the detected
// framework name and whether to enable SPA fallback mode.
function detectFramework(filePaths: string[]): { framework: string; spaMode: boolean } {
  if (filePaths.some((p) => p.startsWith("_next/"))) return { framework: "nextjs-export", spaMode: false };
  if (filePaths.some((p) => p.startsWith("_nuxt/"))) return { framework: "nuxt-static", spaMode: false };
  if (filePaths.some((p) => p.startsWith("_app/"))) return { framework: "sveltekit-static", spaMode: false };
  // Multiple HTML files means pre-rendered routes (Astro static, Eleventy, etc.) — each
  // path has its own real file, so index.html fallback would serve the wrong content.
  const htmlFiles = filePaths.filter((p) => /\.(html|htm)$/.test(p));
  if (htmlFiles.length > 1) return { framework: "static-multipage", spaMode: false };
  // Single index.html + hashed assets → classic SPA (Vite, CRA, Vue CLI).
  return { framework: "spa", spaMode: true };
}

// Netlify-compatible _redirects format. Lines: `from   to   [status]`
// Status defaults to 301. 200 (rewrite/proxy) is silently skipped — Phase 1 only.
function parseRedirects(content: string): RedirectRule[] {
  const rules: RedirectRule[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [from, to, statusStr] = parts;
    const status = statusStr ? parseInt(statusStr, 10) : 301;
    if (isNaN(status) || status === 200 || status < 300 || status > 308) continue;
    rules.push({ from, to, status });
  }
  return rules;
}

/**
 * POST /api/v1/templates/:id/deploy
 *
 * Deploys a pre-built static framework app to a plexo site. Accepts a multipart form
 * with a single `file` field containing a .zip of the build output (the contents of
 * `dist/`, `out/`, `build/`, etc.).
 *
 * - The zip may optionally contain a `_redirects` file (Netlify format).
 * - Framework and SPA mode are detected automatically from the output structure.
 * - All files are uploaded to S3 and the site immediately serves the new version.
 * - Calling again replaces the deployment in place (no versioning in Phase 1).
 *
 * The authenticated user must be a member of the organization that owns the template.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }

  // Resolve hosting tier from query param, defaulting to LAMBDA.
  const tierParam = (new URL(request.url).searchParams.get("hostingTier") ?? "LAMBDA").toUpperCase() as HostingTier;
  const allowedTiers = getTierFeatures(resolved.subscriptionPlan).deployedAppHostingTiers;
  if (!allowedTiers.includes(tierParam)) {
    return NextResponse.json({
      error: `Your plan does not include the "${tierParam}" hosting tier. Available on this plan: ${allowedTiers.join(", ")}. Upgrade to access faster hosting options.`,
    }, { status: 403 });
  }
  const hostingTier: HostingTier = tierParam;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded. POST a multipart form with a 'file' field containing a .zip of your build output." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    return NextResponse.json({ error: "Only .zip files are accepted. Zip the contents of your dist/ (or out/ or build/) directory." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_ZIP_BYTES) {
    return NextResponse.json({ error: `Zip exceeds the ${MAX_ZIP_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded file as a zip archive." }, { status: 400 });
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length === 0) {
    return NextResponse.json({ error: "Zip archive is empty." }, { status: 400 });
  }
  if (entries.length > MAX_FILE_COUNT) {
    return NextResponse.json({ error: `Zip contains too many files (max ${MAX_FILE_COUNT}).` }, { status: 400 });
  }

  const wrapperPrefix = stripWrapperPrefix(entries);

  // Extract and validate every file in the zip.
  const files = new Map<string, { buf: Buffer; contentType: string }>();
  for (const entry of entries) {
    let normalized = entry.name.startsWith(wrapperPrefix)
      ? entry.name.slice(wrapperPrefix.length)
      : entry.name;
    normalized = normalized.replace(/^\.?\//, "");
    if (!normalized) continue;

    // zip-slip guard
    if (normalized.includes("..") || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
      return NextResponse.json({ error: `Unsafe path in zip: "${entry.name}".` }, { status: 400 });
    }

    const ext = extensionOf(normalized);
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) continue; // skip unknown extensions silently

    const content = await entry.async("nodebuffer");
    files.set(normalized, {
      buf: content,
      contentType: mime.getType(normalized) || "application/octet-stream",
    });
  }

  const hasIndex = files.has("index.html") || files.has("index.htm");
  if (!hasIndex) {
    return NextResponse.json({
      error: "No index.html found at the root of the zip (after stripping a single wrapper folder). Make sure you zip the contents of your dist/out/build directory, not the directory itself.",
    }, { status: 400 });
  }

  // Parse _redirects before uploading so we don't serve it as a static file.
  let redirectRules: RedirectRule[] = [];
  const redirectsEntry = files.get("_redirects");
  if (redirectsEntry) {
    redirectRules = parseRedirects(redirectsEntry.buf.toString("utf8"));
    files.delete("_redirects");
  }
  files.delete("_headers"); // _headers support is a Phase 2 addition; skip for now

  const { framework, spaMode } = detectFramework(Array.from(files.keys()));

  // Next.js static exports reference /_next/ for all static assets, but CloudFront has a
  // dedicated cache behaviour routing /_next/static/* directly to plexo-web's own S3 asset
  // bucket — bypassing Lambda entirely. Customer chunks don't exist in that bucket, so every
  // asset request 403s. Rewriting to /_dn/ (no CloudFront behaviour) lets serveDeployedStatic
  // serve them normally through Lambda. Applied to file paths AND all text file contents (HTML,
  // CSS, JS all embed /_next/ references internally).
  if (framework === "nextjs-export") {
    const TEXT_EXTS = new Set(["html", "htm", "css", "js", "mjs", "cjs", "json", "xml", "txt", "webmanifest", "map"]);
    const rewritten = new Map<string, { buf: Buffer; contentType: string }>();
    for (const [path, file] of files) {
      const newPath = path.startsWith("_next/") ? `_dn/${path.slice(6)}` : path;
      let { buf, contentType } = file;
      if (TEXT_EXTS.has(extensionOf(newPath)) && buf.includes("/_next/")) {
        buf = Buffer.from(buf.toString("utf8").replaceAll("/_next/", "/_dn/"), "utf8");
      }
      rewritten.set(newPath, { buf, contentType });
    }
    files.clear();
    for (const [k, v] of rewritten) files.set(k, v);
  }

  // Upload all files to S3 in parallel. Each file lands at:
  // s3://USER_CONTENT_BUCKET/public/deployedApps/{templateId}/{path}
  const s3Prefix = `deployedApps/${templateId}`;
  await Promise.all(
    Array.from(files.entries()).map(([path, { buf, contentType }]) =>
      uploadObject(`${s3Prefix}/${path}`, buf, { access: "public", contentType }),
    ),
  );

  // Create or update the DeployedApp entity. This is the atomic moment the site switches
  // to the new deployment — all files are already in S3 by the time we write this row.
  const { data: existing } = await DeployedApp.get({ templateId }).go();
  if (existing) {
    await DeployedApp.update({ templateId })
      .set({
        type: "STATIC",
        hostingTier,
        s3Prefix,
        spaMode,
        redirectRules: redirectRules.length ? redirectRules : undefined,
        framework,
      })
      .go();
  } else {
    await DeployedApp.create({
      templateId,
      type: "STATIC",
      hostingTier,
      s3Prefix,
      spaMode,
      redirectRules: redirectRules.length ? redirectRules : undefined,
      framework,
    }).go();
  }

  if (hostingTier === "PROVISIONED") {
    void updateProvisionedConcurrency().catch(console.error);
  }

  return NextResponse.json({
    ok: true,
    framework,
    spaMode,
    hostingTier,
    fileCount: files.size,
    redirectRules: redirectRules.length,
    message: `Deployed ${files.size} file${files.size !== 1 ? "s" : ""} as a ${framework} site on the ${hostingTier} hosting tier.`,
  });
}

/**
 * GET /api/v1/templates/:id/deploy
 *
 * Returns the current deployment state: hosting tier, framework, SPA mode,
 * redirect rule count, and timestamps.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }

  const { data: deployedApp } = await DeployedApp.get({ templateId }).go();
  if (!deployedApp) {
    return NextResponse.json({ error: "No deployment found for this site. Deploy a build first with POST." }, { status: 404 });
  }

  return NextResponse.json({
    templateId,
    type: deployedApp.type,
    hostingTier: deployedApp.hostingTier ?? "LAMBDA",
    framework: deployedApp.framework,
    spaMode: deployedApp.spaMode ?? false,
    redirectRules: Array.isArray(deployedApp.redirectRules) ? (deployedApp.redirectRules as unknown[]).length : 0,
    updatedAt: deployedApp.updatedAt,
    createdAt: deployedApp.createdAt,
  });
}

/**
 * PATCH /api/v1/templates/:id/deploy
 *
 * Changes the hosting tier of an existing deployment without re-uploading.
 * Body: `{ "hostingTier": "STATIC" | "LAMBDA" | "PROVISIONED" }`
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }

  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }

  const { data: deployedApp } = await DeployedApp.get({ templateId }).go();
  if (!deployedApp) {
    return NextResponse.json({ error: "No deployment found for this site. Deploy a build first with POST." }, { status: 404 });
  }

  let body: { hostingTier?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with a `hostingTier` field." }, { status: 400 });
  }

  const VALID_TIERS = new Set<string>(["STATIC", "LAMBDA", "PROVISIONED"]);
  const requested = typeof body.hostingTier === "string" ? body.hostingTier.toUpperCase() : null;
  if (!requested || !VALID_TIERS.has(requested)) {
    return NextResponse.json({
      error: `"hostingTier" must be one of: STATIC, LAMBDA, PROVISIONED. Got: ${JSON.stringify(body.hostingTier)}.`,
    }, { status: 400 });
  }

  const hostingTier = requested as HostingTier;
  const allowedTiers = getTierFeatures(resolved.subscriptionPlan).deployedAppHostingTiers;
  if (!allowedTiers.includes(hostingTier)) {
    return NextResponse.json({
      error: `Your plan does not include the "${hostingTier}" hosting tier. Available on this plan: ${allowedTiers.join(", ")}. Upgrade to access faster hosting options.`,
    }, { status: 403 });
  }

  const previousTier = deployedApp.hostingTier ?? "LAMBDA";
  await DeployedApp.update({ templateId }).set({ hostingTier }).go();

  // Recalculate Lambda provisioned concurrency whenever a customer moves to or from
  // PROVISIONED tier. Fire-and-forget: the PC update completes asynchronously (Lambda's
  // PutProvisionedConcurrencyConfig takes a few seconds) but the customer's tier is already
  // stored in DynamoDB, so re-deploys and new requests immediately use the new tier label.
  if (hostingTier === "PROVISIONED" || previousTier === "PROVISIONED") {
    void updateProvisionedConcurrency().catch(console.error);
  }

  return NextResponse.json({
    ok: true,
    hostingTier,
    message: `Hosting tier changed to ${hostingTier}.`,
  });
}
