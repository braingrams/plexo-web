import { randomUUID } from "node:crypto";
import {
  PAGE_TYPE_DEFAULTS,
  SITE_PAGE_TYPES,
  buildSitePage,
  chromeContentFor,
  designSystemFromBrief,
  getPageRecipe,
  siteNavLinks,
  suggestSitePages,
  type BrandChoices,
  type DesignSystem,
  type NavLink,
  type PageTemplateSection,
  type SiteBrief,
  type SitePageType,
} from "@charisol/plexo-sdk/v2/compile";

import type { ResolvedUser } from "@/lib/mcp/dispatchMcpTool";
import { BlogSite, SiteLayout, Template } from "@/lib/db/contentEntities";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { recompileSiteLayoutDependents } from "@/lib/siteLayoutCore";
import { buildV2Page } from "@/lib/v2/layoutDesigns";
import { isV2Design, V2_FORMAT, type V2Design } from "@/lib/v2/design";
import { isHomePageOnlyPlan } from "@/lib/subscription";
import { slugify } from "@/lib/slugUtils";

/**
 * site_create: a whole, connected website from one plan — the brand chosen from the brief,
 * a fitting layout for every page with the business's own words, one shared menu and footer
 * linking the real pages, and the store / blog switched on and filled in when asked for, so
 * it all works the moment it's created (CLAUDE.md: "the owner should never have to make a
 * design decision before the feature works"). Everything is built in the visual editor, so
 * the owner can keep changing it themselves.
 *
 * Split in two: planSite is pure (what to build — tested on its own), createSite does it.
 */

export const MAX_SITE_PAGES = 12;
const MAX_PRODUCTS = 12;
const MAX_POSTS = 6;

export type SitePagePlanInput = {
  type?: unknown;
  name?: unknown;
  slug?: unknown;
  layout?: unknown;
  content?: unknown;
  sections?: unknown;
};

export type SiteCreateArgs = {
  brief?: Partial<SiteBrief> & Record<string, unknown>;
  pages?: SitePagePlanInput[];
  goal?: string;
  navCta?: { label?: string; href?: string } | null;
  store?: { currency?: string; products?: Array<{ name?: string; price?: number; description?: string; imageUrl?: string; kind?: string; category?: string }> };
  blog?: { title?: string; description?: string; posts?: Array<{ title?: string; excerpt?: string; contentHtml?: string; categoryNames?: string[] }> };
};

export type PlannedPage = {
  type: SitePageType;
  name: string;
  /** "" for the home page. */
  slug: string;
  path: string;
  layout?: string;
  content?: Record<string, Record<string, unknown>>;
  sections?: PageTemplateSection[];
  isHome: boolean;
};

export type SitePlan = {
  brief: SiteBrief & { name: string };
  designSystem: DesignSystem;
  choices: BrandChoices;
  home: PlannedPage;
  /** The site's other pages (the blog is not a page of its own — it lives at /blog). */
  pages: PlannedPage[];
  blog: PlannedPage | null;
  store: boolean;
  nav: NavLink[];
  navCta?: NavLink;
  warnings: string[];
};

export class SiteBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteBuildError";
  }
}

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const PAGE_TYPES = new Set<string>(SITE_PAGE_TYPES);
const ALIASES: Record<string, SitePageType> = {
  shop: "store", storefront: "store", products: "store", homepage: "home", index: "home", "about-us": "about", "contact-us": "contact",
  prices: "pricing", plans: "pricing", news: "blog", articles: "blog", journal: "blog", portfolio: "gallery", work: "gallery", reviews: "testimonials",
  questions: "faq", faqs: "faq", "our-team": "team", people: "team", sales: "landing", offer: "landing",
};

function pageTypeOf(raw: unknown): SitePageType | null {
  const v = slugify(str(raw, 40));
  if (PAGE_TYPES.has(v)) return v as SitePageType;
  return ALIASES[v] ?? null;
}

function cleanBrief(raw: SiteCreateArgs["brief"]): SiteBrief & { name: string } {
  const b = isRecord(raw) ? raw : {};
  const name = str(b.name, 80);
  if (!name) throw new SiteBuildError("Tell me the business's name (brief.name) — it goes in the menu, the footer and the page titles.");
  const contact = isRecord(b.contact) ? b.contact : {};
  const fonts = isRecord(b.fonts) ? b.fonts : {};
  return {
    name,
    about: str(b.about, 600) || undefined,
    tagline: str(b.tagline, 120) || undefined,
    industry: str(b.industry, 80) || undefined,
    tone: str(b.tone, 80) || undefined,
    colors: Array.isArray(b.colors) ? b.colors.map((c) => str(c, 32)).filter(Boolean).slice(0, 4) : undefined,
    fonts: str(fonts.heading) || str(fonts.body) ? { heading: str(fonts.heading, 60) || undefined, body: str(fonts.body, 60) || undefined } : undefined,
    logoUrl: /^https?:\/\//i.test(str(b.logoUrl)) ? str(b.logoUrl) : undefined,
    contact: { email: str(contact.email, 120) || undefined, phone: str(contact.phone, 40) || undefined, address: str(contact.address, 200) || undefined, hours: str(contact.hours, 120) || undefined },
    socials: Array.isArray(b.socials) ? b.socials.filter(isRecord).map((s) => ({ network: str(s.network, 20).toLowerCase(), url: str(s.url, 500) })).filter((s) => s.network && s.url).slice(0, 8) : undefined,
  };
}

function cleanContent(raw: unknown): Record<string, Record<string, unknown>> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(raw)) if (isRecord(v)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

function cleanSections(raw: unknown): PageTemplateSection[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .filter(isRecord)
    .filter((s) => typeof s.kind === "string")
    .map((s) => ({
      kind: s.kind as PageTemplateSection["kind"],
      ...(typeof s.variant === "string" ? { variant: s.variant } : {}),
      ...(isRecord(s.content) ? { content: s.content } : {}),
      ...(typeof s.background === "string" ? { background: s.background as PageTemplateSection["background"] } : {}),
    }));
  return list.length ? list.slice(0, 20) : undefined;
}

/** What to build, decided before anything is saved. Throws SiteBuildError (plain English) for a plan that can't work. */
export function planSite(args: SiteCreateArgs, opts: { homeOnly?: boolean } = {}): SitePlan {
  const brief = cleanBrief(args.brief);
  const warnings: string[] = [];
  const requested: SitePagePlanInput[] = Array.isArray(args.pages) && args.pages.length
    ? args.pages.filter(isRecord)
    : suggestSitePages(args.goal, brief).map((type) => ({ type }));

  const typed: Array<{ type: SitePageType; input: SitePagePlanInput }> = [];
  for (const input of requested) {
    const type = pageTypeOf(input.type) ?? (pageTypeOf(input.name) as SitePageType | null);
    if (!type) {
      warnings.push(`I don't know a "${str(input.type, 40) || str(input.name, 40)}" page, so I left it out. Pages I can make: ${SITE_PAGE_TYPES.filter((t) => t !== "blogPost").join(", ")}.`);
      continue;
    }
    if (type === "blogPost") continue; // the blog's article layout comes with the blog
    typed.push({ type, input });
  }
  if (!opts.homeOnly && args.store && !typed.some((p) => p.type === "store")) typed.push({ type: "store", input: {} });
  if (!opts.homeOnly && args.blog && !typed.some((p) => p.type === "blog")) typed.push({ type: "blog", input: {} });

  // The first page is the home page: "home" if asked for, else a one-page "landing", else a fitting home.
  let homeIndex = typed.findIndex((p) => p.type === "home");
  if (homeIndex < 0) homeIndex = typed.findIndex((p) => p.type === "landing");
  let homeEntry = homeIndex >= 0 ? typed.splice(homeIndex, 1)[0] : { type: "home" as SitePageType, input: {} };
  // The Free plan publishes one page per site, so build ONE complete page (a one-page "landing" with
  // everything on it) rather than a multi-page site whose other pages visitors could never open.
  if (opts.homeOnly) {
    const left = typed.filter((p) => p.type !== "blogPost");
    if (left.length || args.store || args.blog) {
      warnings.push(
        `Your Free plan publishes one page, so I built one complete page${left.length ? ` instead of ${left.length + 1} separate ones` : ""}${args.store ? " (selling products comes with Starter)" : ""}. Upgrade any time and I can add pages like ${left.slice(0, 3).map((p) => PAGE_TYPE_DEFAULTS[p.type].name).join(", ") || "About and Contact"}.`,
      );
    }
    typed.length = 0;
    if (homeEntry.type === "home" && !str(homeEntry.input.layout, 60)) homeEntry = { ...homeEntry, type: "landing" as SitePageType };
  }

  const toPlanned = (entry: { type: SitePageType; input: SitePagePlanInput }, isHome: boolean): PlannedPage => {
    const defaults = PAGE_TYPE_DEFAULTS[entry.type];
    const layout = str(entry.input.layout, 60);
    const recipe = layout ? getPageRecipe(layout) : undefined;
    if (layout && (!recipe || recipe.pageType !== entry.type)) warnings.push(`"${layout}" isn't a ${entry.type} layout, so I picked one that fits.`);
    // The shop must live at /store (checkout, order pages and links expect it); the blog always lives at /blog.
    const fixedSlug = entry.type === "store" ? "store" : entry.type === "blog" ? "blog" : "";
    const slug = isHome ? "" : fixedSlug || slugify(str(entry.input.slug, 60) || str(entry.input.name, 60) || defaults.slug) || defaults.slug;
    return {
      type: entry.type,
      name: (isHome ? "Home" : str(entry.input.name, 40)) || defaults.name,
      slug,
      path: isHome ? "/" : `/${slug}`,
      ...(recipe && recipe.pageType === entry.type ? { layout } : {}),
      content: cleanContent(entry.input.content),
      sections: cleanSections(entry.input.sections),
      isHome,
    };
  };

  const home = toPlanned(homeEntry, true);
  const seen = new Set<string>(["", "blog"]);
  const pages: PlannedPage[] = [];
  let blog: PlannedPage | null = null;
  for (const entry of typed) {
    const planned = toPlanned(entry, false);
    if (planned.type === "blog") {
      blog ??= planned;
      continue;
    }
    if (seen.has(planned.slug)) {
      if (planned.type !== "landing") warnings.push(`There was already a page at /${planned.slug}, so I didn't make a second one.`);
      continue;
    }
    seen.add(planned.slug);
    pages.push(planned);
  }
  if (pages.length + 1 > MAX_SITE_PAGES) {
    warnings.push(`A site can start with up to ${MAX_SITE_PAGES} pages, so I made the first ${MAX_SITE_PAGES} — add more any time.`);
    pages.splice(MAX_SITE_PAGES - 1);
  }

  const store = pages.some((p) => p.type === "store");
  const navPages = [home, ...pages.filter((p) => PAGE_TYPE_DEFAULTS[p.type].nav), ...(blog ? [blog] : [])];
  const nav = navPages.length > 1 ? siteNavLinks(navPages.map((p) => ({ name: p.name, path: p.path })), 7) : [];
  const ctaArg = isRecord(args.navCta) ? { label: str(args.navCta.label, 24), href: str(args.navCta.href, 200) } : null;
  const navCta: NavLink | undefined =
    ctaArg?.label && ctaArg.href
      ? ctaArg
      : store
        ? { label: "Shop now", href: "/store" }
        : pages.some((p) => p.type === "contact")
          ? { label: "Get in touch", href: "/contact" }
          : undefined;

  const { designSystem, choices } = designSystemFromBrief(brief);
  return { brief, designSystem, choices, home, pages, blog, store, nav, navCta, warnings };
}

/** The design of one planned page (its own sections only — the shared menu and footer come from the Site layout). */
export function plannedPageDesign(plan: SitePlan, page: PlannedPage, seed: string): { design: V2Design; recipeId: string; warnings: string[] } {
  const built = buildSitePage(
    { pageType: page.type, name: page.name, slug: page.slug || undefined, recipeId: page.layout, content: page.content, sections: page.sections },
    { brief: plan.brief, designSystem: plan.designSystem, seed, chrome: false },
  );
  const meta = page.isHome
    ? { htmlTitle: plan.brief.tagline ? `${plan.brief.name} — ${plan.brief.tagline}` : plan.brief.name, ...(plan.brief.about ? { metaDescription: plan.brief.about.slice(0, 300) } : {}) }
    : { htmlTitle: `${page.name} — ${plan.brief.name}` };
  return { design: { format: V2_FORMAT, pages: [built.page], designSystem: plan.designSystem, meta }, recipeId: built.recipeId, warnings: built.warnings };
}

/** Header variant by style: a centred logo for elegant/editorial brands, the classic bar otherwise. */
const headerVariantFor = (style: string) => (style === "elegant" || style === "editorial" ? "centered" : "classic");

/** The shared header and footer for the site, in its brand, linking its real pages. */
export function sharedChromeDesigns(plan: SitePlan): { header: V2Design; footer: V2Design } {
  const chrome = chromeContentFor(plan.brief, plan.nav, plan.navCta);
  const header = buildV2Page("Site Header", "site-header", [{ op: "addSection", kind: "header", id: "sec-header", variant: headerVariantFor(plan.choices.style), content: chrome.header }], plan.designSystem);
  const footer = buildV2Page(
    "Site Footer",
    "site-footer",
    [{ op: "addSection", kind: "footer", id: "sec-footer", variant: plan.choices.style === "elegant" || plan.choices.style === "editorial" ? "centered" : "columns", content: chrome.footer, style: { background: plan.choices.neutrals === "dark" ? "sunken" : "inverted" } }],
    plan.designSystem,
  );
  return { header, footer };
}

// ------------------------------------------------------------------ doing it

export type SiteToolDeps = {
  createPage: (args: { name: string; siteId?: string }, opts: { design: V2Design; slug?: string; skipMenu?: boolean }) => Promise<{ row: { id: string; name: string }; route: string; siteId: string }>;
  commerceTool: (name: string, args: Record<string, unknown>) => Promise<any>;
  blogTool: (name: string, args: Record<string, unknown>) => Promise<any>;
};

export type CreatedSitePage = { type: SitePageType; name: string; templateId: string; route: string; layout: string };

/**
 * Builds the planned site. The home page is created first (so a plan-limit refusal leaves
 * nothing behind); after that, a failing extra (a product, a post) becomes a warning instead
 * of losing the whole site.
 */
export async function createSite(resolved: ResolvedUser, args: SiteCreateArgs, deps: SiteToolDeps) {
  const plan = planSite(args, { homeOnly: isHomePageOnlyPlan(resolved.subscriptionPlan) });
  const warnings = [...plan.warnings];

  // 1. The home page — the site itself.
  const homeDesign = plannedPageDesign(plan, plan.home, randomUUID());
  warnings.push(...homeDesign.warnings);
  const home = await deps.createPage({ name: plan.brief.name }, { design: homeDesign.design });
  const siteId = home.row.id;
  const pages: CreatedSitePage[] = [{ type: plan.home.type, name: plan.home.name, templateId: siteId, route: "/", layout: homeDesign.recipeId }];

  // 2. One shared menu and footer for every page (also the shop, checkout and blog pages made below).
  const chrome = sharedChromeDesigns(plan);
  const fragment = async (name: string, design: V2Design) => {
    const id = randomUUID();
    await Template.create({ id, userId: resolved.userId, organizationId: resolved.organizationId, name, kind: "LANDING_PAGE", isSiteLayoutFragment: true, designFormat: "v2", designJson: design, compiledHtml: "" }).go();
    return id;
  };
  const headerTemplateId = await fragment("Site Header", chrome.header);
  const footerTemplateId = await fragment("Site Footer", chrome.footer);
  await SiteLayout.create({ id: randomUUID(), templateId: siteId, organizationId: resolved.organizationId, enabled: true, headerTemplateId, footerTemplateId }).go();

  // 3. The other pages.
  for (const page of plan.pages) {
    try {
      const built = plannedPageDesign(plan, page, randomUUID());
      warnings.push(...built.warnings);
      const created = await deps.createPage({ name: page.name, siteId }, { design: built.design, slug: page.slug, skipMenu: true });
      pages.push({ type: page.type, name: page.name, templateId: created.row.id, route: created.route, layout: built.recipeId });
    } catch (err) {
      warnings.push(`I couldn't make the ${page.name} page: ${err instanceof Error ? err.message : "something went wrong"}.`);
    }
  }

  // 4. Selling: Commerce on with Plexo's own payments (no keys), the shop's checkout / order pages, the products.
  let store: { enabled: boolean; products: Array<{ name: string; productId?: string }>; storefrontPath: string } | null = null;
  if (plan.store) {
    store = { enabled: false, products: [], storefrontPath: "/store" };
    try {
      const currency = str(args.store?.currency, 3).toUpperCase();
      await deps.commerceTool("update_commerce_settings", { templateId: siteId, enabled: true, paymentProvider: "PLATFORM_PAYSTACK", ...(currency ? { currency } : {}) });
      store.enabled = true;
      for (const p of (args.store?.products ?? []).slice(0, MAX_PRODUCTS)) {
        const name = str(p?.name, 120);
        const price = Number(p?.price);
        if (!name || !Number.isFinite(price) || price < 0) {
          warnings.push(`A product needs a name and a price${name ? ` ("${name}")` : ""}, so I skipped it.`);
          continue;
        }
        try {
          const kind = ["PHYSICAL", "DIGITAL", "SERVICE"].includes(String(p.kind).toUpperCase()) ? String(p.kind).toUpperCase() : "PHYSICAL";
          const created = await deps.commerceTool("create_commerce_product", {
            templateId: siteId, name, priceMinor: Math.round(price * 100), kind,
            ...(str(p.description) ? { description: str(p.description) } : {}),
            ...(/^https?:\/\//i.test(str(p.imageUrl)) ? { imageUrl: str(p.imageUrl) } : {}),
            ...(str(p.category, 60) ? { category: str(p.category, 60) } : {}),
          });
          store.products.push({ name, productId: created?.product?.id ?? created?.id });
        } catch (err) {
          warnings.push(`I couldn't add "${name}" to the shop: ${err instanceof Error ? err.message : "something went wrong"}.`);
        }
      }
      if (!store.products.length) warnings.push("The shop is ready but empty — add products (name, price, photo) and they appear on the shop page straight away.");
    } catch (err) {
      warnings.push(`I couldn't switch selling on: ${err instanceof Error ? err.message : "something went wrong"}. The shop page is there; turn selling on in Commerce to use it.`);
    }
  }

  // 5. The blog: on, with its listing and article pages in the site's design, and first posts.
  let blog: { enabled: boolean; path: string; posts: string[] } | null = null;
  if (plan.blog) {
    blog = { enabled: false, path: "/blog", posts: [] };
    try {
      await deps.blogTool("update_blog_settings", {
        templateId: siteId, enabled: true,
        title: str(args.blog?.title, 80) || `${plan.brief.name} blog`,
        ...(str(args.blog?.description, 300) || plan.brief.about ? { description: str(args.blog?.description, 300) || plan.brief.about!.slice(0, 300) } : {}),
        accentColor: plan.choices.primary,
      });
      blog.enabled = true;
      const listing = plannedPageDesign(plan, plan.blog, randomUUID());
      const post = plannedPageDesign(plan, { type: "blogPost", name: "Blog Post Layout", slug: "blog-post", path: "/blog", isHome: false }, randomUUID());
      warnings.push(...listing.warnings, ...post.warnings);
      const layout = async (name: string, design: V2Design) => {
        const id = randomUUID();
        await Template.create({ id, userId: resolved.userId, organizationId: resolved.organizationId, name, kind: "LANDING_PAGE", isBlogLayout: true, designFormat: "v2", designJson: design, compiledHtml: "" }).go();
        return id;
      };
      const listingLayoutTemplateId = await layout("Blog Listing Layout", listing.design);
      const postLayoutTemplateId = await layout("Blog Post Layout", post.design);
      await BlogSite.patch({ templateId: siteId }).set({ listingLayoutTemplateId, postLayoutTemplateId }).go();
      pages.push({ type: "blog", name: plan.blog.name, templateId: listingLayoutTemplateId, route: "/blog", layout: listing.recipeId });

      const posts = (args.blog?.posts ?? []).filter((p) => str(p?.title) && str(p?.contentHtml)).slice(0, MAX_POSTS);
      const toWrite = posts.length
        ? posts
        : [{ title: `Welcome to ${plan.brief.name}`, excerpt: plan.brief.tagline ?? "", contentHtml: `<p>${escapeHtml(plan.brief.about ?? `Thanks for stopping by ${plan.brief.name}.`)}</p><p>This is where we'll share news, ideas and stories. Check back soon.</p>` }];
      for (const p of toWrite) {
        try {
          await deps.blogTool("create_blog_post", {
            templateId: siteId, title: str(p.title, 200), contentHtml: String(p.contentHtml), status: "PUBLISHED",
            ...(str(p.excerpt, 300) ? { excerpt: str(p.excerpt, 300) } : {}),
            ...(Array.isArray((p as { categoryNames?: unknown }).categoryNames) ? { categoryNames: (p as { categoryNames: string[] }).categoryNames.slice(0, 5) } : {}),
          });
          blog.posts.push(str(p.title, 200));
        } catch (err) {
          warnings.push(`I couldn't add the post "${str(p.title, 80)}": ${err instanceof Error ? err.message : "something went wrong"}.`);
        }
      }
      if (!posts.length) warnings.push("The blog has one short welcome post — write a few real posts for your readers.");
    } catch (err) {
      warnings.push(`I couldn't set up the blog: ${err instanceof Error ? err.message : "something went wrong"}.`);
    }
  }

  // 6. Pages Plexo makes for selling (checkout, order confirmation, tracking, the product page) take the site's brand too.
  if (store?.enabled) await brandGeneratedPages(siteId, plan.designSystem).catch(() => warnings.push("The checkout pages use the default colours — change them in the editor if you like."));

  // 7. Bake the shared menu and footer into every page.
  await recompileSiteLayoutDependents(siteId);

  return { siteId, name: plan.brief.name, brand: plan.choices, pages, store, blog, nav: plan.nav, warnings };
}

async function brandGeneratedPages(siteId: string, designSystem: DesignSystem): Promise<void> {
  const { data: settings } = await CommerceSettings.get({ templateId: siteId }).go();
  const ids = [settings?.storefrontCheckoutTemplateId, settings?.orderConfirmationTemplateId, settings?.trackOrderTemplateId, settings?.productDetailTemplateId, settings?.storefrontTemplateId].filter(
    (id): id is string => typeof id === "string",
  );
  for (const id of new Set(ids)) {
    const { data: row } = await Template.get({ id }).go();
    if (!row || row.designFormat !== "v2" || !isV2Design(row.designJson) || row.designJson.designSystem) continue;
    await Template.patch({ id }).set({ designJson: { ...(row.designJson as V2Design), designSystem } }).go();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
