// The React-free compiler entry — the full /v2 entry (the editor) can't load on the server.
import { compilePageToReact, componentNameFor, textStyleSlots, type PlexoNode, type TextStyleSlots } from "@charisol/plexo-sdk/v2/compile";
import { sha256 } from "./blobStore";
import { PROJECT_LIMITS } from "./paths";
import { listFiles, readFiles, writeFiles, deleteFiles, ProjectFileError, type FileWrite } from "./fileStore";

// Visual designs (the app editor's Design tab, built on @charisol/plexo-sdk/v2's canvas).
// Each design is one page of the app, stored as plain project files so Code Mode, GitHub
// and SOL all see them:
//   src/plexo-canvas/<slug>.canvas.json  the design (canvas nodes + its name and route)
//   src/plexo-canvas/<Name>Page.tsx      the React page compiled from it (regular code)
//   src/plexo-canvas/routes.tsx          every design's route, which App.tsx renders
//   src/plexo-canvas/brand.json          the app's brand kit (text styles, buttons, colours)
// The design is the source: saving recompiles the page. If someone edits a page's code by
// hand, saving the design again asks first (it would replace those edits).

export const DESIGN_DIR = "src/plexo-canvas";
const DESIGN_FORMAT = "plexo-canvas@1";
const ROUTES_PATH = `${DESIGN_DIR}/routes.tsx`;
const BRAND_PATH = `${DESIGN_DIR}/brand.json`;
const APP_PATH = "src/App.tsx";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const ROUTE = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/;
const RESERVED_SLUGS = new Set(["routes", "brand"]);

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
  nodes: Record<string, PlexoNode>;
  pageOrder: string[];
  /** sha256 of the page code last generated from this design — tells hand edits apart. */
  generatedSha?: string;
  updatedAt: string;
};

export type BrandKit = {
  colors?: unknown[];
  buttonSets?: unknown[];
  activeButtonSetId?: string;
  boxSets?: unknown[];
  activeBoxSetId?: string;
  textStyleSets?: Array<{ id: string; slots: Array<{ id: string; styles: Record<string, string | number> }> }>;
  activeTextStyleSetId?: string;
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

function parseDoc(content: string | undefined): DesignDoc | null {
  if (!content) return null;
  try {
    const doc = JSON.parse(content);
    return doc && typeof doc === "object" && doc.nodes && Array.isArray(doc.pageOrder) ? (doc as DesignDoc) : null;
  } catch {
    return null;
  }
}

function validateCanvas(nodes: unknown, pageOrder: unknown): { nodes: Record<string, PlexoNode>; pageOrder: string[] } {
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) throw new DesignError("The design is missing its content.");
  if (!Array.isArray(pageOrder) || pageOrder.some((id) => typeof id !== "string")) throw new DesignError("The design's sections are missing.");
  const map = nodes as Record<string, PlexoNode>;
  for (const [id, node] of Object.entries(map)) {
    if (!node || typeof node !== "object" || node.id !== id || typeof node.type !== "string") throw new DesignError("Part of the design is damaged — reload the Design tab and try again.");
  }
  return { nodes: map, pageOrder: (pageOrder as string[]).filter((id) => map[id]?.type === "Section") };
}

/** The brand's text style slots, which text linked to a style ("Heading 1"…) compiles with. */
export function textStylesFor(brand: BrandKit | null): TextStyleSlots {
  return brand?.textStyleSets?.length ? textStyleSlots(brand.textStyleSets, brand.activeTextStyleSetId) : textStyleSlots(undefined, brand?.activeTextStyleSetId);
}

export function compileDesign(slug: string, doc: Pick<DesignDoc, "nodes" | "pageOrder">, brand: BrandKit | null): string {
  return compilePageToReact(doc.nodes, doc.pageOrder, { componentName: pageComponentName(slug), textStyles: textStylesFor(brand) });
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
  const read = docPaths.length || byPath.has(BRAND_PATH) ? await readFiles(appId, [...docPaths, ...(byPath.has(BRAND_PATH) ? [BRAND_PATH] : [])]) : { files: [] };
  const content = new Map(read.files.map((f) => [f.path, f.content]));
  const docs = new Map<string, DesignDoc>();
  for (const path of docPaths) {
    const slug = path.slice(DESIGN_DIR.length + 1, -".canvas.json".length);
    const doc = SLUG.test(slug) ? parseDoc(content.get(path)) : null;
    if (doc) docs.set(slug, doc);
  }
  let brand: BrandKit | null = null;
  try {
    brand = content.has(BRAND_PATH) ? (JSON.parse(content.get(BRAND_PATH) ?? "null") as BrandKit) : null;
  } catch {
    brand = null;
  }
  const codeEdited = (slug: string, doc: DesignDoc) => {
    const code = byPath.get(codePath(slug));
    return !!code && !!doc.generatedSha && code.sha !== doc.generatedSha;
  };
  return { byPath, docs, brand, codeEdited };
}

function summarize(slug: string, doc: DesignDoc, codeEdited: boolean): DesignSummary {
  return { slug, name: doc.name, route: doc.route, file: designPath(slug), codeFile: codePath(slug), codeEdited, updatedAt: doc.updatedAt };
}

export async function listDesigns(appId: string): Promise<{ designs: DesignSummary[]; brand: BrandKit | null }> {
  const { docs, brand, codeEdited } = await loadAll(appId);
  const designs = [...docs.entries()].map(([slug, doc]) => summarize(slug, doc, codeEdited(slug, doc)));
  designs.sort((a, b) => a.route.localeCompare(b.route));
  return { designs, brand };
}

export async function getDesign(appId: string, slug: string): Promise<{ design: DesignSummary; nodes: DesignDoc["nodes"]; pageOrder: string[]; brand: BrandKit | null } | null> {
  assertSlug(slug);
  const { docs, brand, codeEdited } = await loadAll(appId);
  const doc = docs.get(slug);
  if (!doc) return null;
  return { design: summarize(slug, doc, codeEdited(slug, doc)), nodes: doc.nodes, pageOrder: doc.pageOrder, brand };
}

export type SaveDesignInput = {
  name: string;
  route: string;
  nodes: unknown;
  pageOrder: unknown;
  brand?: BrandKit | null;
  /** Replace hand edits made to this page's code since it was last generated. */
  overwrite?: boolean;
};

export type SaveDesignResult = {
  design: DesignSummary;
  /** False when App.tsx couldn't be updated to show design pages (no <Routes> found). */
  routesWired: boolean;
  /** Other designs recompiled because the brand changed; skipped ones had hand-edited code. */
  recompiled: string[];
  skipped: string[];
};

export async function saveDesign(appId: string, slug: string, input: SaveDesignInput, updatedBy?: string): Promise<SaveDesignResult> {
  assertSlug(slug);
  const name = String(input.name ?? "").trim().slice(0, 80) || slug;
  const route = normalizeRoute(input.route);
  const canvas = validateCanvas(input.nodes, input.pageOrder);
  const { byPath, docs, brand: savedBrand, codeEdited } = await loadAll(appId);

  const clash = [...docs.entries()].find(([other, d]) => other !== slug && d.route === route);
  if (clash) throw new DesignConflictError(`The design "${clash[1].name}" already uses ${route}. Pick another address for this page.`, "route_taken");
  const existing = docs.get(slug);
  if (existing && codeEdited(slug, existing) && !input.overwrite) {
    throw new DesignConflictError(`${pageComponentName(slug)}.tsx was edited in code since this design was last saved. Saving replaces those code changes with the design.`, "code_edited");
  }

  const brand = input.brand !== undefined && input.brand !== null ? input.brand : savedBrand;
  const brandChanged = input.brand != null && JSON.stringify(input.brand) !== JSON.stringify(savedBrand);

  let code: string;
  try {
    code = compileDesign(slug, canvas, brand);
  } catch (err) {
    throw new DesignError(err instanceof Error ? err.message : "This design couldn't be turned into a page.");
  }
  const now = new Date().toISOString();
  const doc: DesignDoc = { format: DESIGN_FORMAT, name, route, nodes: canvas.nodes, pageOrder: canvas.pageOrder, generatedSha: sha256(code), updatedAt: now };
  docs.set(slug, doc);

  const writes: FileWrite[] = [
    { path: designPath(slug), content: `${JSON.stringify(doc, null, 2)}\n` },
    { path: codePath(slug), content: code },
  ];
  if (brandChanged) writes.push({ path: BRAND_PATH, content: `${JSON.stringify(input.brand, null, 2)}\n` });

  // A new brand restyles every page — except ones whose code was hand-edited.
  const recompiled: string[] = [];
  const skipped: string[] = [];
  if (brandChanged) {
    for (const [other, otherDoc] of docs) {
      if (other === slug) continue;
      if (codeEdited(other, otherDoc)) {
        skipped.push(otherDoc.name);
        continue;
      }
      const otherCode = compileDesign(other, otherDoc, brand);
      const updated: DesignDoc = { ...otherDoc, generatedSha: sha256(otherCode) };
      writes.push({ path: codePath(other), content: otherCode }, { path: designPath(other), content: `${JSON.stringify(updated, null, 2)}\n` });
      recompiled.push(otherDoc.name);
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
  return { design: summarize(slug, doc, false), routesWired, recompiled, skipped };
}

export async function deleteDesign(appId: string, slug: string, updatedBy?: string): Promise<void> {
  assertSlug(slug);
  const { docs } = await loadAll(appId);
  if (!docs.has(slug)) throw new DesignError("That design doesn't exist.");
  docs.delete(slug);
  await writeFiles(appId, [{ path: ROUTES_PATH, content: renderRoutesFile([...docs.entries()].map(([s, d]) => ({ slug: s, route: d.route }))) }], updatedBy);
  await deleteFiles(appId, [designPath(slug), codePath(slug)]);
}
