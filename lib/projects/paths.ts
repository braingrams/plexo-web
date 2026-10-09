// Path rules and limits for project files. Every write path (SOL/MCP tools, the dashboard
// editor, the Deploy API) funnels through normalizeProjectPath, so a bad path is rejected
// once, with a message a non-technical owner — or an AI — can act on.

export const PROJECT_LIMITS = {
  maxFiles: 3000,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
  // One write call (tool or API) — keeps a single request within Lambda payload limits.
  maxFilesPerWrite: 200,
} as const;

export class ProjectPathError extends Error {}

// Plexo builds these itself (or they're build products), so a project's own copy would be
// silently ignored — rejecting the write says so instead.
const BLOCKED_PREFIXES = ["node_modules/", "dist/", ".git/", ".plexo/"];

export function normalizeProjectPath(raw: string): string {
  if (typeof raw !== "string") throw new ProjectPathError("A file path must be text, like src/App.tsx.");
  let path = raw.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!path) throw new ProjectPathError("A file path can't be empty — use something like src/App.tsx.");
  if (path.endsWith("/")) throw new ProjectPathError(`"${raw}" is a folder, not a file. Add a file name, like ${path}index.ts.`);
  if (path.length > 300) throw new ProjectPathError(`"${path.slice(0, 60)}…" is too long — keep file paths under 300 characters.`);
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === "..") throw new ProjectPathError(`"${raw}" can't contain "." or ".." — paths are always from the project root.`);
    if (/[\u0000-\u001f<>:"|?*]/.test(segment)) throw new ProjectPathError(`"${raw}" contains a character file names can't use.`);
  }
  for (const prefix of BLOCKED_PREFIXES) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) {
      throw new ProjectPathError(`"${path}" is managed by Plexo (${prefix.slice(0, -1)}) and can't be edited. Dependencies go in package.json; Plexo installs and builds them.`);
    }
  }
  path = segments.join("/");
  return path;
}

const CONTENT_TYPES: Record<string, string> = {
  ts: "text/typescript", tsx: "text/typescript", js: "text/javascript", jsx: "text/javascript", mjs: "text/javascript", cjs: "text/javascript",
  json: "application/json", css: "text/css", scss: "text/x-scss", html: "text/html", htm: "text/html", md: "text/markdown", mdx: "text/markdown",
  txt: "text/plain", svg: "image/svg+xml", xml: "application/xml", yml: "text/yaml", yaml: "text/yaml", sql: "application/sql", toml: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
  pdf: "application/pdf", wasm: "application/wasm", webmanifest: "application/manifest+json",
};

export function contentTypeForPath(path: string): string {
  const name = path.split("/").pop() ?? "";
  if (name === ".env" || name.startsWith(".env.")) return "text/plain";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export function isTextContentType(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType === "application/sql" ||
    contentType === "image/svg+xml" ||
    contentType === "application/manifest+json"
  );
}
