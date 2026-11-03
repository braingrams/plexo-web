import JSZip from "jszip";
import mime from "mime";
import { DeployedApp, type RedirectRule } from "@/lib/db/appEntities";
import { uploadObject } from "@/lib/storage";
import { updateProvisionedConcurrency } from "@/lib/pub/updateProvisionedConcurrency";
import type { HostingTier } from "@/lib/pub/hostingTier";

export class DeployError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DeployError";
  }
}

export type DeployZipResult = {
  framework: string;
  spaMode: boolean;
  fileCount: number;
  redirectRules: number;
  hostingTier: HostingTier;
};

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

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

function stripWrapperPrefix(entries: JSZip.JSZipObject[]): string {
  const names = entries.map((e) => e.name);
  const topSegments = new Set(names.map((n) => n.split("/")[0]));
  const hasWrapper = topSegments.size === 1 && names.every((n) => n.includes("/"));
  return hasWrapper ? `${Array.from(topSegments)[0]}/` : "";
}

function detectFramework(filePaths: string[]): { framework: string; spaMode: boolean } {
  if (filePaths.some((p) => p.startsWith("_next/"))) return { framework: "nextjs-export", spaMode: false };
  if (filePaths.some((p) => p.startsWith("_nuxt/"))) return { framework: "nuxt-static", spaMode: false };
  if (filePaths.some((p) => p.startsWith("_app/"))) return { framework: "sveltekit-static", spaMode: false };
  const htmlFiles = filePaths.filter((p) => /\.(html|htm)$/.test(p));
  if (htmlFiles.length > 1) return { framework: "static-multipage", spaMode: false };
  return { framework: "spa", spaMode: true };
}

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
 * Extracts, validates, rewrites, and deploys a zip buffer for a template.
 * Throws DeployError (with an HTTP status) on any user-facing validation failure.
 * All other throws should be treated as 500s by the caller.
 */
export async function processDeployZip(
  buffer: Buffer,
  templateId: string,
  options: { hostingTier?: HostingTier } = {},
): Promise<DeployZipResult> {
  const hostingTier: HostingTier = options.hostingTier ?? "LAMBDA";
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new DeployError("Could not read the uploaded file as a zip archive.", 400);
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length === 0) throw new DeployError("Zip archive is empty.", 400);
  if (entries.length > 10_000) throw new DeployError("Zip contains too many files (max 10,000).", 400);

  const wrapperPrefix = stripWrapperPrefix(entries);

  const files = new Map<string, { buf: Buffer; contentType: string }>();
  for (const entry of entries) {
    let normalized = entry.name.startsWith(wrapperPrefix)
      ? entry.name.slice(wrapperPrefix.length)
      : entry.name;
    normalized = normalized.replace(/^\.?\//, "");
    if (!normalized) continue;

    if (normalized.includes("..") || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
      throw new DeployError(`Unsafe path in zip: "${entry.name}".`, 400);
    }

    const ext = extensionOf(normalized);
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) continue;

    const content = await entry.async("nodebuffer");
    files.set(normalized, {
      buf: content,
      contentType: mime.getType(normalized) || "application/octet-stream",
    });
  }

  if (!files.has("index.html") && !files.has("index.htm")) {
    throw new DeployError(
      "No index.html found at the root of the zip (after stripping a single wrapper folder). Make sure you zip the contents of your dist/out/build directory, not the directory itself.",
      400,
    );
  }

  let redirectRules: RedirectRule[] = [];
  const redirectsEntry = files.get("_redirects");
  if (redirectsEntry) {
    redirectRules = parseRedirects(redirectsEntry.buf.toString("utf8"));
    files.delete("_redirects");
  }
  files.delete("_headers");

  const { framework, spaMode } = detectFramework(Array.from(files.keys()));

  // Next.js static exports reference /_next/ for all static assets, but CloudFront has a
  // dedicated cache behaviour routing /_next/static/* directly to plexo-web's own S3 asset
  // bucket — bypassing Lambda entirely. Customer chunks don't exist in that bucket, so every
  // asset request 403s. Rewriting to /_dn/ lets serveDeployedStatic serve them through Lambda.
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

  const s3Prefix = `deployedApps/${templateId}`;
  await Promise.all(
    Array.from(files.entries()).map(([path, { buf, contentType }]) =>
      uploadObject(`${s3Prefix}/${path}`, buf, { access: "public", contentType }),
    ),
  );

  const { data: existing } = await DeployedApp.get({ templateId }).go();
  if (existing) {
    await DeployedApp.update({ templateId })
      .set({
        type: "STATIC",
        s3Prefix,
        spaMode,
        hostingTier,
        redirectRules: redirectRules.length ? redirectRules : undefined,
        framework,
      })
      .go();
  } else {
    await DeployedApp.create({
      templateId,
      type: "STATIC",
      s3Prefix,
      spaMode,
      hostingTier,
      redirectRules: redirectRules.length ? redirectRules : undefined,
      framework,
    }).go();
  }

  if (hostingTier === "PROVISIONED") {
    void updateProvisionedConcurrency().catch(console.error);
  }

  return { framework, spaMode, fileCount: files.size, redirectRules: redirectRules.length, hostingTier };
}
