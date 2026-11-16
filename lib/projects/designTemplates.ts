// Starting points for a new designed page, shared by the Design tab (browser) and SOL's design
// tools (server). Only the React-free SDK entry is imported, so it's safe in both places.
import { SITE_ONLY_TEMPLATE_IDS, buildPageFromTemplate, getPageTemplate, listPageTemplates, templateSeed, type DesignSystem, type PageDefinition, type PageTemplateSummary } from "@charisol/plexo-sdk/v2/compile";

export const BLANK_TEMPLATE = "blank";

/** Where each ready-made page naturally lives. Anything else is named after the page itself. */
const TEMPLATE_ROUTES: Record<string, string> = {
  home: "/",
  landing: "/landing-page",
  about: "/about",
  services: "/services",
  contact: "/contact",
  pricing: "/pricing",
};

const RESERVED_SLUGS = new Set(["routes", "brand", "design-system"]);

/** A file-safe id for a new design, from its name ("About us" → "about-us"). */
export function slugForName(name: string, taken: Iterable<string> = []): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
  const used = new Set(taken);
  let slug = RESERVED_SLUGS.has(base) ? `${base}-page` : base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function routeFromName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/${slug || "page"}`;
}

/** The page templates an app can use — not the shop/blog/product ones, which show a Plexo site's own store or blog. */
export function templates(): PageTemplateSummary[] {
  return listPageTemplates().filter((t) => !SITE_ONLY_TEMPLATE_IDS.has(t.id));
}

/** The name a page made from this template starts with ("About us", "Pricing"…). */
export function defaultPageName(templateId: string): string {
  return templateId === BLANK_TEMPLATE ? "New page" : getPageTemplate(templateId).name;
}

/**
 * The preferred address for a new page. A page still called by its template's own name gets the
 * template's address (About us → /about); a page the owner named themselves is addressed by that name.
 */
export function defaultRoute(templateId: string, name: string): string {
  const own = TEMPLATE_ROUTES[templateId];
  const stillDefault = !name.trim() || name.trim().toLowerCase() === defaultPageName(templateId).toLowerCase();
  return own && stillDefault ? own : routeFromName(name);
}

/** An address no other page uses. A taken "/" falls back to "/home", then "/home-2"… */
export function freeRoute(taken: Iterable<string>, base: string): string {
  const used = new Set(taken);
  const start = base === "/" ? "/home" : base;
  if (!used.has(base)) return base;
  if (!used.has(start)) return start;
  for (let i = 2; ; i++) if (!used.has(`${start}-${i}`)) return `${start}-${i}`;
}

/**
 * A new page opened from a template. The seed is the page's own slug, so two pages from one
 * template never share ids and the same request always gives the same page. Blank → undefined
 * (the editor opens its own blank page).
 */
export function pageFromTemplate(templateId: string, opts: { name: string; slug: string; designSystem: DesignSystem }): PageDefinition | undefined {
  if (templateId === BLANK_TEMPLATE) return undefined;
  return buildPageFromTemplate(templateId, { name: opts.name, slug: opts.slug, designSystem: opts.designSystem, seed: `${templateSeed(templateId)}-${opts.slug}` });
}
