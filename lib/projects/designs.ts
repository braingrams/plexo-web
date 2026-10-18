// The React-free compiler entry — the full /v2 entry (the editor) can't load on the server.
import {
  compilePageToReact,
  componentNameFor,
  convertLegacyDesign,
  createDefaultDesignSystem,
  isLegacyDesign,
  parsePages,
  repairDesignSystem,
  type DesignSystem,
  type DocumentNode,
  type PageDefinition,
} from "@charisol/plexo-sdk/v2/compile";
import { sha256 } from "./blobStore";
import { PROJECT_LIMITS } from "./paths";
import { listFiles, readFiles, writeFiles, deleteFiles, ProjectFileError, type FileWrite } from "./fileStore";

// Visual designs (the app editor's Design tab, built on @charisol/plexo-sdk/v2's editor).
// Each design is one page of the app, stored as plain project files so Code Mode, GitHub
// and SOL all see them:
//   src/plexo-canvas/<slug>.canvas.json  the design (the page's node tree + its name and route)
//   src/plexo-canvas/<Name>Page.tsx      the React page compiled from it (regular code)
//   src/plexo-canvas/routes.tsx          every design's route, which App.tsx renders
//   src/plexo-canvas/design-system.json  the app's design system (colours, fonts, shapes, components)
// The design is the source: saving recompiles the page. If someone edits a page's code by
// hand, saving the design again asks first (it would replace those edits).
// Designs saved by the previous editor ("plexo-canvas@1": nodes + pageOrder, brand.json) are
// upgraded when read and rewritten as "plexo-canvas@2" on their next save — never lost.

export const DESIGN_DIR = "src/plexo-canvas";
const DESIGN_FORMAT = "plexo-canvas@2";
const ROUTES_PATH = `${DESIGN_DIR}/routes.tsx`;
const DESIGN_SYSTEM_PATH = `${DESIGN_DIR}/design-system.json`;
const APP_PATH = "src/App.tsx";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const ROUTE = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/;
const RESERVED_SLUGS = new Set(["routes", "brand", "design-system"]);

export class DesignError extends ProjectFileError {}
export class DesignConflictError extends Error {
  constructor(message: string, readonly code: "code_edited" | "route_taken") {
    super(message);
  }
}

export type DesignDoc = {
  format: typeof DESIGN_FORMAT;
  name: string;
  route: string;
  /** The page's root node (what a PageDefinition calls rootNode). */
  page: DocumentNode;
  /** sha256 of the page code last generated from this design — tells hand edits apart. */
  generatedSha?: string;
  updatedAt: string;
};

export type DesignSummary = { slug: string; name: string; route: string; file: string; codeFile: string; codeEdited: boolean; updatedAt: string };

export const designPath = (slug: string) => `${DESIGN_DIR}/${slug}.canvas.json`;
export const pageComponentName = (slug: string) => `${componentNameFor(slug)}Page`;
const codePath = (slug: string) => `${DESIGN_DIR}/${pageComponentName(slug)}.tsx`;

/** A file-safe id for a new design, from its name ("About us" → "about-us"). */
export function slugForName(name: string, taken: Iterable<string> = []): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
  const used = new Set(taken);
  let slug = RESERVED_SLUGS.has(base) ? `${base}-page` : base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function normalizeRoute(raw: string): string {
  let route = String(raw ?? "").trim();
  if (!route.startsWith("/")) route = `/${route}`;
  route = route.replace(/\/{2,}/g, "/");
  if (route.length > 1) route = route.replace(/\/$/, "");
  if (!ROUTE.test(route)) throw new DesignError(`"${raw}" isn't a usable page address — use letters, numbers and dashes, like /about or /pricing.`);
  return route;
}

function assertSlug(slug: string) {
  if (!SLUG.test(slug) || RESERVED_SLUGS.has(slug)) throw new DesignError("That design doesn't exist.");
}

/** The page as the editor and the compiler see it. The id and slug come from the file name. */
export function pageFor(slug: string, doc: Pick<DesignDoc, "name" | "route" | "page">): PageDefinition {
  return { id: slug, name: doc.name, slug, isHome: doc.route === "/", rootNode: doc.page };
}

/** Reads a stored design — current format as is, the previous editor's format upgraded in memory. */
function parseDoc(content: string | undefined, slug: string): DesignDoc | null {
  if (!content) return null;
  try {
    const raw = JSON.parse(content);
    if (!raw || typeof raw !== "object") return null;
    if (raw.format === DESIGN_FORMAT && raw.page && typeof raw.page === "object") return raw as DesignDoc;
    if (isLegacyDesign(raw)) {
      const meta = raw as unknown as Record<string, unknown>;
      const name = typeof meta.name === "string" && meta.name.trim() ? meta.name : slug;
      const page = convertLegacyDesign(raw, { name, slug });
      return {
        format: DESIGN_FORMAT,
        name,
        route: typeof meta.route === "string" ? meta.route : `/${slug}`,
        page: page.rootNode,
        generatedSha: typeof meta.generatedSha === "string" ? meta.generatedSha : undefined,
        updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : new Date().toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

const MAX_DESIGN_SYSTEM_BYTES = 1_500_000;

/** A stored or incoming design system, repaired — or null when it isn't one. */
function asDesignSystem(value: unknown): DesignSystem | null {
  const ds = value as DesignSystem | null;
  if (!ds || typeof ds !== "object" || !Array.isArray(ds.tokens) || !Array.isArray(ds.components)) return null;
  try {
    return repairDesignSystem(ds);
  } catch {
    return null;
  }
}

/** Checks a page from the editor with the SDK's own validator and returns its root node. */
function validatePage(slug: string, name: string, route: string, page: unknown): DocumentNode {
  const root = page && typeof page === "object" ? ((page as PageDefinition).rootNode ?? null) : null;
  if (!root) throw new DesignError("The design is missing its content — reload the Design tab and try again.");
  const parsed = parsePages([{ id: slug, name, slug, isHome: route === "/", rootNode: root }]);
  if (!parsed.ok) throw new DesignError(parsed.error);
  return parsed.pages[0].rootNode;
}

export function compileDesign(slug: string, doc: Pick<DesignDoc, "name" | "route" | "page">, designSystem: DesignSystem): { code: string; warnings: string[] } {
  return compilePageToReact(pageFor(slug, doc), { componentName: pageComponentName(slug), designSystem });
}

export function renderRoutesFile(entries: Array<{ slug: string; route: string }>): string {
  const sorted = [...entries].sort((a, b) => a.route.localeCompare(b.route));
  const imports = sorted.map((e) => `import ${pageComponentName(e.slug)} from "./${pageComponentName(e.slug)}";`).join("\n");
  const rows = sorted.map((e) => `  { path: ${JSON.stringify(e.route)}, Component: ${pageComponentName(e.slug)} },`).join("\n");
  return `// Generated by Plexo from the visual designs in this folder (the Design tab). It's rewritten
// whenever a design is saved, so don't edit it by hand — App.tsx renders these routes.
import type { ComponentType } from "react";
${imports}${imports ? "\n" : ""}
export const designRoutes: Array<{ path: string; Component: ComponentType }> = [
${rows}${rows ? "\n" : ""}];
`;
}

/**
 * Adds the design routes to an App.tsx that doesn't render them yet (apps created before the
 * Design tab, or whose App.tsx was rewritten). Design routes go first inside <Routes>, so a
 * design at "/" becomes the home page. Returns null when App.tsx has no <Routes> to add to.
 */
export function wireDesignRoutes(source: string): string | null {
  if (source.includes("plexo-canvas/routes")) return source;
  const routes = /<Routes(?:\s[^>]*)?>/.exec(source);
  if (!routes || !/\bRoute\b/.test(source.slice(0, routes.index))) return null;
  const afterTag = routes.index + routes[0].length;
  const nextLine = source.slice(afterTag).match(/\n([ \t]*)\S/);
  const indent = nextLine?.[1] ?? "            ";
  let out = `${source.slice(0, afterTag)}\n${indent}{designRoutes.map(({ path, Component }) => <Route key={path} path={path} element={<Component />} />)}${source.slice(afterTag)}`;

  const lines = out.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i]) || /^\s*}\s*from\s/.test(lines[i])) {
      let j = i;
      while (j < lines.length && !/["'];?\s*$/.test(lines[j])) j++;
      last = j;
      i = j;
    } else if (lines[i].trim() && !lines[i].trim().startsWith("//") && last >= 0) {
      break;
    }
  }
  lines.splice(last + 1, 0, `import { designRoutes } from "./plexo-canvas/routes";`);
  out = lines.join("\n");
  return out;
}

async function loadAll(appId: string) {
  const files = await listFiles(appId);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const docPaths = files.map((f) => f.path).filter((p) => p.startsWith(`${DESIGN_DIR}/`) && p.endsWith(".canvas.json") && !p.slice(DESIGN_DIR.length + 1).includes("/"));
  const hasSystem = byPath.has(DESIGN_SYSTEM_PATH);
  const read = docPaths.length || hasSystem ? await readFiles(appId, [...docPaths, ...(hasSystem ? [DESIGN_SYSTEM_PATH] : [])]) : { files: [] };
  const content = new Map(read.files.map((f) => [f.path, f.content]));
  const docs = new Map<string, DesignDoc>();
  for (const path of docPaths) {
    const slug = path.slice(DESIGN_DIR.length + 1, -".canvas.json".length);
    const doc = SLUG.test(slug) ? parseDoc(content.get(path), slug) : null;
    if (doc) docs.set(slug, doc);
  }
  // No design-system.json yet (or an unreadable one) → the built-in design system. A leftover
  // brand.json from the previous editor is left alone and no longer used.
  let stored: DesignSystem | null = null;
  try {
    stored = hasSystem ? asDesignSystem(JSON.parse(content.get(DESIGN_SYSTEM_PATH) ?? "null")) : null;
  } catch {
    stored = null;
  }
  const designSystem = stored ?? createDefaultDesignSystem();
  const codeEdited = (slug: string, doc: DesignDoc) => {
    const code = byPath.get(codePath(slug));
    return !!code && !!doc.generatedSha && code.sha !== doc.generatedSha;
  };
  return { byPath, docs, designSystem, hasStoredSystem: !!stored, codeEdited };
}

function summarize(slug: string, doc: DesignDoc, codeEdited: boolean): DesignSummary {
  return { slug, name: doc.name, route: doc.route, file: designPath(slug), codeFile: codePath(slug), codeEdited, updatedAt: doc.updatedAt };
}

export async function listDesigns(appId: string): Promise<{ designs: DesignSummary[]; designSystem: DesignSystem }> {
  const { docs, designSystem, codeEdited } = await loadAll(appId);
  const designs = [...docs.entries()].map(([slug, doc]) => summarize(slug, doc, codeEdited(slug, doc)));
  designs.sort((a, b) => a.route.localeCompare(b.route));
  return { designs, designSystem };
}

export async function getDesign(appId: string, slug: string): Promise<{ design: DesignSummary; page: PageDefinition; designSystem: DesignSystem } | null> {
  assertSlug(slug);
  const { docs, designSystem, codeEdited } = await loadAll(appId);
  const doc = docs.get(slug);
  if (!doc) return null;
  return { design: summarize(slug, doc, codeEdited(slug, doc)), page: pageFor(slug, doc), designSystem };
}

export type SaveDesignInput = {
  name: string;
  route: string;
  /** The page as the editor reports it (a PageDefinition); only its rootNode is kept. */
  page: unknown;
  /** The app's design system, when it changed. Omitted → the saved one is used. */
  designSystem?: unknown;
  /** Replace hand edits made to this page's code since it was last generated. */
  overwrite?: boolean;
};

export type SaveDesignResult = {
  design: DesignSummary;
  /** False when App.tsx couldn't be updated to show design pages (no <Routes> found). */
  routesWired: boolean;
  /** Other designs recompiled because the design system changed; skipped ones had hand-edited code. */
  recompiled: string[];
  skipped: string[];
  /** Things the owner should fix in this design (e.g. a form with nowhere to send messages). */
  warnings: string[];
};

export async function saveDesign(appId: string, slug: string, input: SaveDesignInput, updatedBy?: string): Promise<SaveDesignResult> {
  assertSlug(slug);
  const name = String(input.name ?? "").trim().slice(0, 80) || slug;
  const route = normalizeRoute(input.route);
  const rootNode = validatePage(slug, name, route, input.page);

  let incomingSystem: DesignSystem | null = null;
  if (input.designSystem != null) {
    if (JSON.stringify(input.designSystem).length > MAX_DESIGN_SYSTEM_BYTES) throw new DesignError("The design system is too large to save.");
    incomingSystem = asDesignSystem(input.designSystem);
    if (!incomingSystem) throw new DesignError("The design system couldn't be read — reload the Design tab and try again.");
  }
  const { byPath, docs, designSystem: savedSystem, hasStoredSystem, codeEdited } = await loadAll(appId);

  const clash = [...docs.entries()].find(([other, d]) => other !== slug && d.route === route);
  if (clash) throw new DesignConflictError(`The design "${clash[1].name}" already uses ${route}. Pick another address for this page.`, "route_taken");
  const existing = docs.get(slug);
  if (existing && codeEdited(slug, existing) && !input.overwrite) {
    throw new DesignConflictError(`${pageComponentName(slug)}.tsx was edited in code since this design was last saved. Saving replaces those code changes with the design.`, "code_edited");
  }

  const designSystem = incomingSystem ?? savedSystem;
  const systemChanged = incomingSystem != null && JSON.stringify(incomingSystem) !== JSON.stringify(savedSystem);

  const draft: DesignDoc = { format: DESIGN_FORMAT, name, route, page: rootNode, updatedAt: new Date().toISOString() };
  let compiled: { code: string; warnings: string[] };
  try {
    compiled = compileDesign(slug, draft, designSystem);
  } catch (err) {
    throw new DesignError(err instanceof Error ? err.message : "This design couldn't be turned into a page.");
  }
  const doc: DesignDoc = { ...draft, generatedSha: sha256(compiled.code) };
  docs.set(slug, doc);

  const writes: FileWrite[] = [
    { path: designPath(slug), content: `${JSON.stringify(doc, null, 2)}\n` },
    { path: codePath(slug), content: compiled.code },
  ];
  // Written the first time too, so a later SDK update to the built-in defaults can't silently restyle the app.
  if (systemChanged || !hasStoredSystem || !byPath.has(DESIGN_SYSTEM_PATH)) writes.push({ path: DESIGN_SYSTEM_PATH, content: `${JSON.stringify(designSystem, null, 2)}\n` });

  // A new design system restyles every page — except ones whose code was hand-edited.
  const recompiled: string[] = [];
  const skipped: string[] = [];
  if (systemChanged) {
    for (const [other, otherDoc] of docs) {
      if (other === slug) continue;
      if (codeEdited(other, otherDoc)) {
        skipped.push(otherDoc.name);
        continue;
      }
      try {
        const otherCode = compileDesign(other, otherDoc, designSystem).code;
        const updated: DesignDoc = { ...otherDoc, generatedSha: sha256(otherCode) };
        writes.push({ path: codePath(other), content: otherCode }, { path: designPath(other), content: `${JSON.stringify(updated, null, 2)}\n` });
        recompiled.push(otherDoc.name);
      } catch {
        skipped.push(otherDoc.name);
      }
    }
  }

  writes.push({ path: ROUTES_PATH, content: renderRoutesFile([...docs.entries()].map(([s, d]) => ({ slug: s, route: d.route }))) });

  let routesWired = true;
  if (byPath.has(APP_PATH)) {
    const app = (await readFiles(appId, [APP_PATH])).files[0]?.content;
    const wired = app != null ? wireDesignRoutes(app) : null;
    if (wired == null) routesWired = false;
    else if (wired !== app) writes.push({ path: APP_PATH, content: wired });
  } else {
    routesWired = false;
  }

  for (let i = 0; i < writes.length; i += PROJECT_LIMITS.maxFilesPerWrite) await writeFiles(appId, writes.slice(i, i + PROJECT_LIMITS.maxFilesPerWrite), updatedBy);
  return { design: summarize(slug, doc, false), routesWired, recompiled, skipped, warnings: compiled.warnings };
}

export async function deleteDesign(appId: string, slug: string, updatedBy?: string): Promise<void> {
  assertSlug(slug);
  const { docs } = await loadAll(appId);
  if (!docs.has(slug)) throw new DesignError("That design doesn't exist.");
  docs.delete(slug);
  await writeFiles(appId, [{ path: ROUTES_PATH, content: renderRoutesFile([...docs.entries()].map(([s, d]) => ({ slug: s, route: d.route }))) }], updatedBy);
  await deleteFiles(appId, [designPath(slug), codePath(slug)]);
}
