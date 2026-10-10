import type { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { createProject } from "@/lib/projects/createProject";
import { listFiles, readFiles, writeFiles, editFile, deleteFiles, renameFile, listVersions, restoreVersion, type FileWrite } from "@/lib/projects/fileStore";
import { startPreview, startPublish, waitForReport, buildReport, type BuildReport } from "@/lib/projects/pipeline";
import { formatBuildErrors } from "@/lib/projects/builds";
import { appSummary } from "@/lib/projects/summary";
import { previewUrl } from "@/lib/projects/previewHost";
import { screenshotPage, VIEWPORTS, type Viewport } from "@/lib/projects/screenshot";
import { appContextByTemplate } from "@/lib/appRuntime/context";
import { databaseOverview } from "@/lib/appData/overview";
import { runOwnerSql } from "@/lib/appData/migrations";
import { AppDbError } from "@/lib/appData/db";
import { listSecrets } from "@/lib/appFunctions/secrets";
import { functionLogs } from "@/lib/appFunctions/invoke";
import { AppRuntimeError, AppSettings } from "@/lib/db/appEntities";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { getSignedDownloadUrl } from "@/lib/storage";
import { findStockPhotos } from "@/lib/media/stockPhotos";
import { getAppSettings, forgetAppContext } from "@/lib/appRuntime/context";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Building full-stack React apps — for SOL and for any MCP client (Claude Desktop, other
// agents). Same operations as the dashboard's app editor; descriptions double as the
// guidance an AI needs to use them well.

const appId = { type: "string", description: "The app's id (from create_app or list_apps)." };
const envParam = { type: "string", enum: ["dev", "live"], description: 'Which database: "dev" (the preview, default) or "live" (the published app).' };

export const APP_MCP_TOOLS = [
  {
    name: "create_app",
    description:
      "Creates a new full-stack React app (Vite + React + TypeScript + Tailwind + shadcn/ui-style components + React Router, with a Postgres database, sign-in, file storage and server functions built in). Use this whenever someone wants an app, tool, dashboard, portal, SaaS, marketplace, booking system, CRM, game or anything interactive — not for a simple marketing page. Returns the app id and its preview link. Next: read PLEXO.md (app_read_files) for the conventions, then write the app with app_write_files / app_edit_file, then app_build.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Short, human name for the app (renameable later)." } },
      required: ["name"],
    },
  },
  {
    name: "list_apps",
    description: "Lists this account's React apps with their preview links and whether they're published.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "app_status",
    description: "An app at a glance: preview and live links, domains, latest build, whether it's published, and its databases.",
    inputSchema: { type: "object", properties: { appId }, required: ["appId"] },
  },
  {
    name: "app_list_files",
    description: "Lists the app's files (paths and sizes). Optionally only those under a folder prefix like \"src/pages\".",
    inputSchema: { type: "object", properties: { appId, prefix: { type: "string" } }, required: ["appId"] },
  },
  {
    name: "app_read_files",
    description: "Reads up to 30 files' contents. Always read a file before editing it.",
    inputSchema: { type: "object", properties: { appId, paths: { type: "array", items: { type: "string" }, maxItems: 30 } }, required: ["appId", "paths"] },
  },
  {
    name: "app_write_files",
    description:
      "Creates or completely replaces files (up to 50 per call). Use for new files or full rewrites; for changing part of an existing file use app_edit_file instead (cheaper, and can't accidentally drop code). Before fully rewriting a file that already exists, read it with app_read_files in this same turn so nothing in it is lost. Pass files as a list of { path, content } objects. Paths are from the project root, e.g. src/pages/Dashboard.tsx, db/migrations/0002_tasks.sql, functions/send-invoice.ts. Changes aren't visible until app_build.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        files: {
          type: "array",
          maxItems: 50,
          items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
        },
      },
      required: ["appId", "files"],
    },
  },
  {
    name: "app_edit_file",
    description:
      "Changes part of one file with find/replace edits. Read the file with app_read_files earlier in this same turn and copy each `find` from what you read — never from memory or an earlier turn (the file may have changed). Each `find` must match exactly once — include a few surrounding lines to make it unique, or set all: true to replace every occurrence. Small indentation/spacing differences are tolerated; if a find still isn't there, the error shows the current lines to copy from — fix it from that rather than re-reading.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        path: { type: "string" },
        edits: {
          type: "array",
          items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" }, all: { type: "boolean" } }, required: ["find", "replace"] },
        },
      },
      required: ["appId", "path", "edits"],
    },
  },
  {
    name: "app_delete_files",
    description: "Deletes files (a folder path deletes everything under it). Undoable via app_restore_version.",
    inputSchema: { type: "object", properties: { appId, paths: { type: "array", items: { type: "string" } } }, required: ["appId", "paths"] },
  },
  {
    name: "app_rename_file",
    description: "Renames or moves a file. Update its imports with app_edit_file afterwards.",
    inputSchema: { type: "object", properties: { appId, from: { type: "string" }, to: { type: "string" } }, required: ["appId", "from", "to"] },
  },
  {
    name: "app_build",
    description:
      "Saves the current files as a version and builds the preview: compiles the app, type-checks it, applies new db/migrations to the preview database, and deploys server functions. Returns every problem with file:line and a hint. Fix ALL errors (and type problems) and build again until it's clean, then check it with app_screenshot. It waits for the whole build (including database changes and server functions) before answering — don't call app_build_status after it unless it says it's still pending.",
    inputSchema: { type: "object", properties: { appId, message: { type: "string", description: "One line describing the change, for the version history." } }, required: ["appId"] },
  },
  {
    name: "app_build_status",
    description: "Only when app_build/app_publish returned pending (still running after waiting several minutes): waits again for that build and returns its result. Never call it right after a build that already returned a result.",
    inputSchema: { type: "object", properties: { appId, buildId: { type: "string" } }, required: ["appId", "buildId"] },
  },
  {
    name: "app_screenshot",
    description:
      "Opens the app's preview in a real browser and returns a screenshot plus every error the page hit (console errors, crashes, failed requests). Use after every successful build to check the result actually looks and works right — on mobile too (viewport: mobile).",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        path: { type: "string", description: "Page to open, e.g. /dashboard (default /)." },
        viewport: { type: "string", enum: Object.keys(VIEWPORTS), description: "desktop (default), tablet or mobile." },
        fullPage: { type: "boolean", description: "Capture the whole scrolling page instead of the first screen." },
      },
      required: ["appId"],
    },
  },
  {
    name: "app_find_photos",
    description:
      "Finds real, high-quality stock photos for the app (Unsplash, Pexels, Pixabay) — on topic for the business, never random placeholders. Search with a specific, visual description (\"barista pouring latte art\", \"modern dental clinic reception\"), not a generic word. Returns image URLs to use directly in <img src> or CSS backgrounds, plus a credit for each — show credits unobtrusively (a small caption or the footer).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the photo should show, specific and visual." },
        count: { type: "number", description: "How many (1–12, default 6)." },
        orientation: { type: "string", enum: ["landscape", "portrait", "any"], description: "landscape for heroes and banners, portrait for tall cards; default any." },
      },
      required: ["query"],
    },
  },
  {
    name: "app_runtime_errors",
    description: "Errors the app's preview reported recently while people (or the owner) used it — crashes, failed backend calls. Check this when the owner says something is broken.",
    inputSchema: { type: "object", properties: { appId, minutes: { type: "number", description: "How far back (default 60)." } }, required: ["appId"] },
  },
  {
    name: "app_db_schema",
    description: "The app's database: tables, columns, relations, row-level-security policies, applied migrations, and security findings with fixes.",
    inputSchema: { type: "object", properties: { appId, env: envParam }, required: ["appId"] },
  },
  {
    name: "app_sql",
    description:
      "Runs SQL on the app's PREVIEW database as its owner (sees every row; new tables get row-level security on). For exploring data or quick fixes while developing. Lasting schema changes belong in a new db/migrations/NNNN_name.sql file instead, so they reach the live database on publish.",
    inputSchema: { type: "object", properties: { appId, sql: { type: "string" } }, required: ["appId", "sql"] },
  },
  {
    name: "app_publish",
    description:
      "Publishes the app: a clean release build, then the live database gets new migrations, server functions are deployed, and the live site switches over. The first publish gives it an address (subdomain picked from the app's name unless given). Only after the preview builds cleanly and the owner wants it live.",
    inputSchema: { type: "object", properties: { appId, subdomain: { type: "string", description: "Optional, e.g. \"acme-crm\" → acme-crm.<pages domain>." } }, required: ["appId"] },
  },
  {
    name: "app_versions",
    description: "The app's version history (every build and save), newest first.",
    inputSchema: { type: "object", properties: { appId }, required: ["appId"] },
  },
  {
    name: "app_restore_version",
    description: "Puts the app's files back to an earlier version (recorded as a new version, so it's undoable) and rebuilds the preview. The live app changes only on the next publish.",
    inputSchema: { type: "object", properties: { appId, versionId: { type: "string" } }, required: ["appId", "versionId"] },
  },
  {
    name: "app_request_secret",
    description:
      "Asks the owner to add a secret (an API key a server function needs, e.g. STRIPE_SECRET_KEY). Never ask for a secret's value in chat — this shows them where to paste it safely. Returns which secrets already exist.",
    inputSchema: {
      type: "object",
      properties: { appId, name: { type: "string", description: "UPPER_SNAKE_CASE, e.g. OPENAI_API_KEY." }, why: { type: "string", description: "One line: what it's for and where to get it." } },
      required: ["appId", "name", "why"],
    },
  },
  {
    name: "app_function_logs",
    description: "Recent logs (console output and errors) of one of the app's server functions.",
    inputSchema: { type: "object", properties: { appId, name: { type: "string" }, env: envParam, minutes: { type: "number" } }, required: ["appId", "name"] },
  },
  {
    name: "app_update_auth_settings",
    description: "Turns the app's sign-in methods on or off (password, magic link, Google), requires email confirmation, or closes sign-ups (invite-only). Google sign-in works without any setup.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        password: { type: "boolean" },
        magicLink: { type: "boolean" },
        google: { type: "boolean" },
        requireEmailConfirmation: { type: "boolean" },
        allowSignups: { type: "boolean" },
      },
      required: ["appId"],
    },
  },
];

export const APP_TOOL_NAMES = new Set(APP_MCP_TOOLS.map((t) => t.name));

/** How long a tool may wait for a build. SOL's Lambda allows minutes; a plain MCP request
 * (the app server, 60 s) returns "pending" sooner and the client polls app_build_status. */
const waitBudget = () => Number(process.env.APP_TOOL_WAIT_MS) || 45_000;

async function ownApp(resolved: ResolvedUser, raw: unknown) {
  const id = typeof raw === "string" ? raw.trim() : "";
  const { data: app } = id ? await Template.get({ id }).go() : { data: null };
  if (!app || app.organizationId !== resolved.organizationId || app.sourceType !== "REACT_PROJECT") {
    throw new Error(`No app found with id "${id}" in this account. Use list_apps to find it.`);
  }
  return app;
}

async function actor(resolved: ResolvedUser) {
  const { data: user } = await User.get({ id: resolved.userId }).go({ attributes: ["name"] });
  return { userId: resolved.userId, organizationId: resolved.organizationId, userName: user?.name ?? undefined };
}

/** A build report in the shape that's most useful to read back: problems first, as text. */
function present(report: BuildReport) {
  const lines: string[] = [];
  if (report.pending) lines.push(`Still working (${report.summary}). Call app_build_status with buildId ${report.buildId}.`);
  else if (report.ok) lines.push(`Build succeeded — ${report.summary}.`);
  else lines.push(`Build has problems — ${report.summary}.`);
  if (report.errors.length) lines.push(`Errors (fix these):\n${formatBuildErrors(report.errors)}`);
  if (report.typeProblems.length) lines.push(`Type problems (fix these too — they're usually real bugs):\n${formatBuildErrors(report.typeProblems)}`);
  if (report.migrations?.failed) lines.push(`Database migration ${report.migrations.failed.name} failed${report.migrations.failed.line ? ` at line ${report.migrations.failed.line}` : ""}: ${report.migrations.failed.message}${report.migrations.failed.hint ? ` (${report.migrations.failed.hint})` : ""}. Nothing from it was applied — fix that file (it hasn't run yet, so editing it is fine) and build again.`);
  if (report.migrations?.applied.length) lines.push(`Applied migrations: ${report.migrations.applied.join(", ")}.`);
  if (report.migrations?.edited.length) lines.push(`Note: ${report.migrations.edited.join(", ")} changed after being applied — those edits don't run. Put new changes in a new migration file.`);
  if (report.functions?.failed.length) lines.push(`Functions that failed to deploy: ${report.functions.failed.map((f) => `${f.name} (${f.message})`).join("; ")}.`);
  if (report.functions?.deployed.length) lines.push(`Functions deployed: ${report.functions.deployed.join(", ")}.`);
  return {
    ok: report.ok,
    pending: report.pending,
    buildId: report.buildId,
    previewUrl: report.previewUrl,
    liveUrl: report.liveUrl,
    report: lines.join("\n\n"),
    next: report.pending
      ? "Call app_build_status."
      : report.ok
        ? report.mode === "release"
          ? "It's live. Share the live link with the owner."
          : "Check it with app_screenshot (and on mobile), then tell the owner what you built and link the preview."
        : "Fix every problem above, then app_build again.",
  };
}

export async function handleAppTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  switch (toolName) {
    case "create_app": {
      const name = typeof args?.name === "string" && args.name.trim() ? args.name.trim() : "My App";
      const who = await actor(resolved);
      const created = await createProject({ ...who, subscriptionPlan: resolved.subscriptionPlan }, { name, source: "ai" });
      return {
        appId: created.templateId,
        previewUrl: previewUrl(created.previewHost),
        files: (await listFiles(created.templateId)).map((f) => f.path),
        next: "Read PLEXO.md and src/App.tsx (app_read_files), then build the app: pages in src/pages, register routes in src/App.tsx, tables in db/migrations, then app_build.",
      };
    }
    case "list_apps": {
      const { data } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all", order: "desc" });
      return {
        apps: data
          .filter((t) => t.sourceType === "REACT_PROJECT" && !t.parentId)
          .map((t) => ({ appId: t.id, name: t.name, previewUrl: t.previewHost ? previewUrl(t.previewHost) : null, published: !!t.liveBuildId, updatedAt: t.updatedAt })),
      };
    }
    case "app_status":
      return appSummary(await ownApp(resolved, args?.appId));
    case "app_list_files": {
      const app = await ownApp(resolved, args?.appId);
      const prefix = typeof args?.prefix === "string" ? args.prefix.replace(/^\/+/, "") : "";
      return { files: (await listFiles(app.id)).filter((f) => !prefix || f.path.startsWith(prefix)).map((f) => ({ path: f.path, size: f.size })) };
    }
    case "app_read_files": {
      const app = await ownApp(resolved, args?.appId);
      const paths = Array.isArray(args?.paths) ? args.paths.slice(0, 30) : [];
      const { files, missing } = await readFiles(app.id, paths);
      return { files: files.map((f) => (f.content !== undefined ? { path: f.path, content: f.content } : { path: f.path, binary: true, size: f.size })), missing };
    }
    case "app_write_files": {
      const app = await ownApp(resolved, args?.appId);
      const files = (Array.isArray(args?.files) ? args.files : []) as FileWrite[];
      if (files.length > 50) throw new Error("Write at most 50 files per call.");
      const written = await writeFiles(app.id, files, resolved.userId);
      return { written: written.map((f) => f.path), next: "Build with app_build when this round of changes is complete." };
    }
    case "app_edit_file": {
      const app = await ownApp(resolved, args?.appId);
      const file = await editFile(app.id, String(args?.path ?? ""), args?.edits ?? [], resolved.userId);
      return { edited: file.path };
    }
    case "app_delete_files": {
      const app = await ownApp(resolved, args?.appId);
      return { deleted: await deleteFiles(app.id, Array.isArray(args?.paths) ? args.paths : []) };
    }
    case "app_rename_file": {
      const app = await ownApp(resolved, args?.appId);
      await renameFile(app.id, String(args?.from ?? ""), String(args?.to ?? ""), resolved.userId);
      return { renamed: true, next: "Update any imports of the old path with app_edit_file." };
    }
    case "app_build": {
      const app = await ownApp(resolved, args?.appId);
      const build = await startPreview(app.id, await actor(resolved), { message: typeof args?.message === "string" ? args.message : undefined, source: "ai" });
      return present(await waitForReport(build.id, waitBudget()));
    }
    case "app_build_status": {
      const app = await ownApp(resolved, args?.appId);
      const { data: build } = await ProjectBuild.get({ id: String(args?.buildId ?? "") }).go({ attributes: ["templateId"] });
      if (build?.templateId !== app.id) throw new Error("That build isn't from this app.");
      const report = await buildReport(String(args.buildId));
      if (!report) throw new Error("That build doesn't exist.");
      return present(report.pending ? await waitForReport(report.buildId, waitBudget()) : report);
    }
    case "app_find_photos": {
      const photos = await findStockPhotos(String(args?.query ?? ""), { count: Number(args?.count) || undefined, orientation: args?.orientation });
      return photos.length
        ? { photos: photos.map(({ url, alt, credit, sourceUrl }) => ({ url, alt, credit, sourceUrl })) }
        : { photos: [], note: "No photos found for that. Try a different, more visual description — or design the section without a photo (illustration, gradient, icons)." };
    }
    case "app_screenshot": {
      const app = await ownApp(resolved, args?.appId);
      if (!app.previewHost || !app.latestBuildId) throw new Error("The app hasn't been built yet — run app_build first.");
      const path = typeof args?.path === "string" && args.path.startsWith("/") ? args.path : "/";
      const viewport = (Object.keys(VIEWPORTS).includes(args?.viewport) ? args.viewport : "desktop") as Viewport;
      const shot = await screenshotPage(`${previewUrl(app.previewHost)}${path}`, { viewport, userId: resolved.userId, fullPage: args?.fullPage === true });
      const problems = [...shot.consoleErrors.map((e) => `console: ${e}`), ...shot.failedRequests.map((r) => `request: ${r}`)];
      const text = `Screenshot of ${path} (${viewport}, page title "${shot.title}", HTTP ${shot.status ?? "?"}).${problems.length ? `\nProblems on the page:\n${problems.map((p) => `• ${p}`).join("\n")}` : "\nNo errors on the page."}`;
      return {
        summary: text,
        consoleErrors: shot.consoleErrors,
        failedRequests: shot.failedRequests,
        // For MCP clients: a link to the image. SOL sees the image itself (see solAgent).
        imageUrl: await getSignedDownloadUrl(shot.imageUrl, 3600),
        __contentBlocks: [
          { type: "text", text },
          { type: "image", source: { type: "url", url: shot.imageUrl } },
        ],
      };
    }
    case "app_runtime_errors": {
      const app = await ownApp(resolved, args?.appId);
      const since = new Date(Date.now() - Math.min(Number(args?.minutes) || 60, 24 * 60) * 60_000).toISOString();
      const { data } = await AppRuntimeError.query.primary({ templateId: app.id }).gte({ createdAt: since }).go({ order: "desc", limit: 100 });
      const unique = new Map<string, any>();
      for (const e of data) if (!unique.has(e.message)) unique.set(e.message, { kind: e.kind, message: e.message, stack: e.stack?.slice(0, 1500), page: e.url, at: e.createdAt });
      return { errors: [...unique.values()].slice(0, 30) };
    }
    case "app_db_schema": {
      const app = await ownApp(resolved, args?.appId);
      const ctx = await appContextByTemplate(app.id, args?.env === "live" ? "live" : "dev");
      return databaseOverview(ctx!);
    }
    case "app_sql": {
      const app = await ownApp(resolved, args?.appId);
      const ctx = await appContextByTemplate(app.id, "dev");
      try {
        const result = await runOwnerSql({ templateId: app.id, organizationId: app.organizationId, env: "dev", sql: String(args?.sql ?? ""), maxRows: 200 });
        return { rows: result.rows, rowCount: result.rowCount, truncated: !!result.truncated, database: ctx?.database && "preview" };
      } catch (err) {
        if (err instanceof AppDbError) throw new Error(`${err.error.message}${err.error.hint ? ` (hint: ${err.error.hint})` : ""}`);
        throw err;
      }
    }
    case "app_publish": {
      const app = await ownApp(resolved, args?.appId);
      const build = await startPublish(app.id, await actor(resolved), { subdomain: typeof args?.subdomain === "string" ? args.subdomain : undefined });
      return present(await waitForReport(build.id, waitBudget()));
    }
    case "app_versions": {
      const app = await ownApp(resolved, args?.appId);
      return { versions: (await listVersions(app.id, 30)).map((v) => ({ versionId: v.id, message: v.message, source: v.source, at: v.createdAt })) };
    }
    case "app_restore_version": {
      const app = await ownApp(resolved, args?.appId);
      const who = await actor(resolved);
      const restored = await restoreVersion(app.id, String(args?.versionId ?? ""), { authorId: who.userId, authorName: who.userName });
      const build = await startPreview(app.id, who, { source: "ai" });
      return { restoredAs: restored.versionId, build: present(await waitForReport(build.id, waitBudget())) };
    }
    case "app_request_secret": {
      const app = await ownApp(resolved, args?.appId);
      const name = String(args?.name ?? "").trim();
      const existing = await listSecrets(app.id);
      const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
      return {
        alreadySet: existing.some((s) => s.name === name),
        secrets: existing.map((s) => s.name),
        addItHere: `${base}/dashboard/apps/${app.id}?panel=secrets&add=${encodeURIComponent(name)}`,
        tellTheOwner: `Ask the owner to add ${name} in the app's Secrets panel (link above) — ${String(args?.why ?? "")}. The server function reads it as ctx.env.${name}. Never ask them to paste it in chat.`,
      };
    }
    case "app_function_logs": {
      const app = await ownApp(resolved, args?.appId);
      return { logs: await functionLogs(app.id, args?.env === "live" ? "live" : "dev", String(args?.name ?? ""), { sinceMinutes: Number(args?.minutes) || 60 }) };
    }
    case "app_update_auth_settings": {
      const app = await ownApp(resolved, args?.appId);
      const current = await getAppSettings(app.id, app.organizationId);
      const set: Record<string, boolean> = {};
      for (const [arg, field] of [["password", "authPassword"], ["magicLink", "authMagicLink"], ["google", "authGoogle"], ["requireEmailConfirmation", "requireEmailConfirmation"], ["allowSignups", "allowSignups"]] as const) {
        if (typeof args?.[arg] === "boolean") set[field] = args[arg];
      }
      const { data: existing } = await AppSettings.get({ templateId: app.id }).go();
      if (!existing) await AppSettings.create({ templateId: app.id, organizationId: app.organizationId }).go();
      if (Object.keys(set).length) await AppSettings.patch({ templateId: app.id }).set(set).go();
      forgetAppContext(app.id);
      return { before: { password: current.authPassword, magicLink: current.authMagicLink, google: current.authGoogle, requireEmailConfirmation: current.requireEmailConfirmation, allowSignups: current.allowSignups }, changed: set };
    }
  }
  throw new Error(`Unknown app tool: ${toolName}`);
}
