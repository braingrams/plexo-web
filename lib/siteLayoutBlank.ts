// Older sites get a shared header and footer too — but BLANK. A blank header/footer is a real, enabled
// layout whose design has no sections (new editor) or no rows (classic editor): splicing nothing changes
// nothing, so a published page renders byte-for-byte as before until the owner adopts a look. That is what
// keeps an older site's own inline menu from showing twice. The owner sees "Site header" / "Site footer" in
// the editor with an obvious "Add a header" start; ready-made looks are drawn from the site's own existing
// menu so adopting one is a single click, and afterwards the old inline header can be removed from pages.
//
// Which sites get what:
//   - New-editor (V2) site            : blank layout + one-click looks drawn from its own menu.
//   - Classic (V1) site               : blank layout; "Add a header" opens the classic editor on it (no auto looks).
//   - Hand-written/uploaded HTML site : none (each page is its own HTML, so it carries its own header/footer).
//   - Code project (React app)        : none (the app's own code has its header).
// Free of next/server so MCP tools, SOL and scripts can call it.

import { randomUUID } from "node:crypto";

import { applyCommands, compilePageToHtml, createDefaultDesignSystem, sanitizeV2Html } from "@charisol/plexo-sdk/v2/compile";

import type { EntityItem } from "electrodb";

import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { compileTemplateWithSiteLayout, onTemplateSaved } from "@/lib/siteLayoutCore";
import { readSiteBrand } from "@/lib/dashboardV3/brandLook";
import { designFormatOf, isV2Design, type V2Design } from "@/lib/v2/design";
import { buildV2Page } from "@/lib/v2/layoutDesigns";
import { resolveDesignSystem } from "@/lib/v2/designSystemStore";

export type LayoutKind = "header" | "footer";
export type SiteKindForLayout = "visual" | "classic" | "html" | "app";

type TemplateItem = EntityItem<typeof Template>;
type RootRow = { id: string; name?: string | null; sourceType?: string | null; designFormat?: string | null; parentId?: string | null; organizationId: string };

const CLASSIC_BLANK = { body: { style: { background: "#ffffff", padding: "24px" }, rows: [] } };

/** What kind of site this is, for the purposes of a shared header/footer. */
export function siteKindForLayout(root: { sourceType?: string | null; designFormat?: string | null }): SiteKindForLayout {
  if (root.sourceType === "RAW_UPLOAD") return "html";
  if (root.sourceType === "REACT_PROJECT") return "app";
  return designFormatOf(root) === "v2" ? "visual" : "classic";
}

/** A kind, in the words an owner would use, for the kinds that can't have a shared header/footer. */
export function unsupportedLayoutMessage(kind: SiteKindForLayout): string | null {
  if (kind === "html") return "This site is made of hand-written pages, and each page carries its own header and footer. To change them, edit the pages themselves, or ask Plexo's assistant to do it for you.";
  if (kind === "app") return "This site is an app built with code, so its header and footer live inside the app. Ask Plexo's assistant to change them, or edit them in the app's files.";
  return null;
}

/** True when a header/footer design shows nothing. */
export function designIsBlank(row: { designFormat?: string | null; designJson?: unknown } | null | undefined): boolean {
  if (!row) return true;
  if (designFormatOf(row) === "v2") {
    if (!isV2Design(row.designJson)) return true;
    return row.designJson.pages.every((p) => (p.rootNode.children ?? []).length === 0);
  }
  const rows = (row.designJson as { body?: { rows?: unknown } } | null)?.body?.rows;
  return !Array.isArray(rows) || rows.length === 0;
}

/** Whether the site's header/footer fragment (or the lack of one) shows nothing — "blank" means pages bring their own. */
export async function fragmentIsBlank(fragmentId: string | null | undefined): Promise<boolean> {
  if (!fragmentId) return true;
  const { data } = await Template.get({ id: fragmentId }).go();
  return designIsBlank(data);
}

function blankDesignFor(kind: LayoutKind, visual: boolean) {
  return visual ? buildV2Page(kind === "header" ? "Site Header" : "Site Footer", kind === "header" ? "site-header" : "site-footer", []) : CLASSIC_BLANK;
}

async function createBlankFragment(kind: LayoutKind, root: RootRow, userId: string, visual: boolean): Promise<string> {
  const id = randomUUID();
  await Template.create({
    id,
    userId,
    organizationId: root.organizationId,
    name: kind === "header" ? "Site Header" : "Site Footer",
    kind: "LANDING_PAGE",
    isSiteLayoutFragment: true,
    ...(visual ? { designFormat: "v2" as const } : {}),
    designJson: blankDesignFor(kind, visual),
    compiledHtml: "",
  }).go();
  return id;
}

export type BlankLayoutResult = { status: "created" | "exists" | "unsupported"; kind: SiteKindForLayout };

/**
 * Lazy, idempotent migration of an older site: gives it blank header/footer fragments and an enabled layout —
 * once. Never recompiles a page (blank splices nothing), so nothing a visitor sees changes. A site that was ever
 * provisioned (even if the owner later removed the header) is left exactly as the owner left it.
 */
export async function ensureBlankSiteLayout(rootTemplateId: string, userId: string): Promise<BlankLayoutResult> {
  const { data: root } = await Template.get({ id: rootTemplateId }).go();
  if (!root || root.parentId || root.isSiteLayoutFragment || root.kind !== "LANDING_PAGE") return { status: "unsupported", kind: "classic" };
  const kind = siteKindForLayout(root);
  if (kind === "html" || kind === "app") return { status: "unsupported", kind };

  const { data: existing } = await SiteLayout.get({ templateId: rootTemplateId }).go();
  if (existing?.layoutProvisionedAt || existing?.headerTemplateId || existing?.footerTemplateId) {
    if (existing && !existing.layoutProvisionedAt) await SiteLayout.patch({ templateId: rootTemplateId }).set({ layoutProvisionedAt: new Date().toISOString() }).go();
    return { status: "exists", kind };
  }

  const visual = kind === "visual";
  const [headerTemplateId, footerTemplateId] = [await createBlankFragment("header", root, userId, visual), await createBlankFragment("footer", root, userId, visual)];
  const at = new Date().toISOString();
  if (existing) {
    // A row can already exist just to hold the owner's header/footer code.
    await SiteLayout.patch({ templateId: rootTemplateId }).set({ headerTemplateId, footerTemplateId, enabled: true, layoutProvisionedAt: at }).go();
  } else {
    await SiteLayout.create({ id: randomUUID(), templateId: rootTemplateId, organizationId: root.organizationId, enabled: true, headerTemplateId, footerTemplateId, layoutProvisionedAt: at }).go();
  }
  return { status: "created", kind };
}

// ------------------------------------------------------------------------------------------------ looks

type Link = { label: string; href: string };
type Block = { kind?: string; content?: Record<string, unknown> };
const blockOf = (n: { props?: unknown }) => (n.props as { block?: Block } | undefined)?.block;

export type LayoutLook = { variant: string; label: string; description: string };

const HEADER_LOOKS: LayoutLook[] = [
  { variant: "classic", label: "Name on the left, menu on the right", description: "The familiar bar." },
  { variant: "centered", label: "Name in the middle", description: "Your name centred, with the menu underneath." },
  { variant: "split", label: "Menu left, name centre, button right", description: "Balanced on both sides." },
];
const FOOTER_LOOKS: LayoutLook[] = [
  { variant: "simple", label: "One simple row", description: "Your name, links and the small print on one line." },
  { variant: "columns", label: "Columns of links", description: "Your name and a few words, with columns of links." },
  { variant: "centered", label: "Centred and minimal", description: "Everything in the middle." },
];

/** What the ready-made looks are made from: the site's own menu and footer words, found on its pages. */
export type LookSource = {
  brand: string;
  logo: string;
  links: Link[];
  cta: { label: string; href: string };
  footerText: string;
  footerColumns: { title: string; links: string }[];
  copyright: string;
  /** Where the words came from, for the owner ("your home page's menu", "your pages"). */
  from: "menu" | "pages";
};

const MAX_LINKS = 8;

export async function lookSourceFor(rootTemplateId: string): Promise<LookSource | null> {
  const { data: root } = await Template.get({ id: rootTemplateId }).go();
  if (!root) return null;
  const brand = root.name?.trim() || "My site";
  // The footer starts from the brand's own words (tagline, else its short description) so it never reads empty.
  const ownWords = readSiteBrand(root.brand)?.voice;
  const wordsFooter = ownWords?.tagline ?? ownWords?.aboutLine ?? "";
  const year = new Date().getFullYear();
  const base: LookSource = { brand, logo: "", links: [{ label: "Home", href: "/" }], cta: { label: "", href: "" }, footerText: wordsFooter, footerColumns: [], copyright: `© ${year} ${brand}. All rights reserved.`, from: "pages" };

  // 1. The menu and footer already on the home page.
  if (designFormatOf(root) === "v2" && isV2Design(root.designJson)) {
    const sections = root.designJson.pages[0]?.rootNode.children ?? [];
    const h = sections.map(blockOf).find((b) => b?.kind === "header")?.content;
    const f = sections.map(blockOf).find((b) => b?.kind === "footer")?.content;
    // Stored list items carry an internal "_key"; only label and href are the owner's words.
    const links: Link[] = Array.isArray(h?.links) ? (h.links as Link[]).filter((l) => l && typeof l.label === "string" && typeof l.href === "string").map((l) => ({ label: l.label, href: l.href })).slice(0, MAX_LINKS) : [];
    if (h && links.length) {
      const cta = h.cta as { label?: string; href?: string } | undefined;
      return {
        ...base,
        brand: typeof h.brand === "string" && h.brand.trim() ? h.brand : brand,
        logo: typeof h.logo === "string" ? h.logo : "",
        links,
        cta: { label: cta?.label ?? "", href: cta?.href ?? "" },
        footerText: typeof f?.text === "string" && f.text ? f.text : wordsFooter,
        footerColumns: Array.isArray(f?.columns) ? (f.columns as { title?: unknown; links?: unknown }[]).filter((c) => c && typeof c.title === "string" && typeof c.links === "string").map((c) => ({ title: c.title as string, links: c.links as string })) : [],
        copyright: typeof f?.copyright === "string" && f.copyright ? f.copyright : base.copyright,
        from: "menu",
      };
    }
  }
  // 2. Otherwise the site's own pages, in their order.
  const { data: children } = await Template.query.byParent({ parentId: rootTemplateId }).go({ pages: "all" });
  const pages = children
    .filter((c) => c.kind === "LANDING_PAGE" && !c.isSiteLayoutFragment && c.slug && c.sourceType !== "REACT_PROJECT")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, MAX_LINKS - 1)
    .map((c) => ({ label: (c.name ?? c.slug ?? "").trim().slice(0, 24), href: `/${c.slug}` }));
  return { ...base, links: [...base.links, ...pages] };
}

export async function looksFor(rootTemplateId: string): Promise<{ header: LayoutLook[]; footer: LayoutLook[]; source: LookSource } | null> {
  const source = await lookSourceFor(rootTemplateId);
  return source ? { header: HEADER_LOOKS, footer: FOOTER_LOOKS, source } : null;
}

function designFor(kind: LayoutKind, variant: string, s: LookSource): V2Design {
  if (kind === "header") {
    return buildV2Page("Site Header", "site-header", [
      { op: "addSection", kind: "header", id: "sec-header", variant, content: { brand: s.brand, logo: s.logo, links: s.links, cta: s.cta } },
    ]);
  }
  const columns = s.footerColumns.length ? s.footerColumns : [{ title: "Pages", links: s.links.map((l) => `${l.label} | ${l.href}`).join("\n") }];
  return buildV2Page("Site Footer", "site-footer", [
    { op: "addSection", kind: "footer", id: "sec-footer", variant, content: { brand: s.brand, text: s.footerText, columns, socials: [], copyright: s.copyright } },
  ]);
}

/** One look drawn in the site's own colours and fonts, as a small page of its own: what the picker shows before anyone adopts it. */
export async function previewLookHtml(rootTemplateId: string, kind: LayoutKind, variant: string): Promise<string | null> {
  const { data: root } = await Template.get({ id: rootTemplateId }).go();
  if (!root || root.parentId) return null;
  if (!(kind === "header" ? HEADER_LOOKS : FOOTER_LOOKS).some((l) => l.variant === variant)) return null;
  const source = await lookSourceFor(rootTemplateId);
  if (!source) return null;
  const design = designFor(kind, variant, source);
  const brand = isV2Design(root.designJson) ? await resolveDesignSystem(root.designJson) : null;
  try {
    const compiled = compilePageToHtml(design.pages[0], { apiKey: "workspace-internal", templateId: root.id, designSystem: brand?.designSystem ?? design.designSystem, title: root.name });
    return sanitizeV2Html(compiled.document);
  } catch {
    return null;
  }
}

export type AdoptResult = { ok: true; fragmentId: string; pagesWithOwnChrome: { id: string; name: string }[] } | { ok: false; error: string };

/** One click: fills the blank header/footer with a look built from the site's own words, live on every page at once. */
export async function adoptLook(rootTemplateId: string, kind: LayoutKind, variant: string, userId: string): Promise<AdoptResult> {
  const { data: root } = await Template.get({ id: rootTemplateId }).go();
  if (!root || root.parentId) return { ok: false, error: "That site couldn't be found." };
  const sk = siteKindForLayout(root);
  const unsupported = unsupportedLayoutMessage(sk);
  if (unsupported) return { ok: false, error: unsupported };
  if (sk === "classic") return { ok: false, error: "This site uses the classic editor, so you design its header and footer there. Choose \"Design in the editor\"." };
  const looks = kind === "header" ? HEADER_LOOKS : FOOTER_LOOKS;
  if (!looks.some((l) => l.variant === variant)) return { ok: false, error: "Pick one of the looks shown." };

  await ensureBlankSiteLayout(rootTemplateId, userId);
  const { data: layout } = await SiteLayout.get({ templateId: rootTemplateId }).go();
  let fragmentId = kind === "header" ? layout?.headerTemplateId : layout?.footerTemplateId;
  if (!fragmentId) {
    fragmentId = await createBlankFragment(kind, root, userId, true);
    await SiteLayout.patch({ templateId: rootTemplateId }).set(kind === "header" ? { headerTemplateId: fragmentId } : { footerTemplateId: fragmentId }).go();
  }
  const source = await lookSourceFor(rootTemplateId);
  if (!source) return { ok: false, error: "That site couldn't be found." };
  await Template.patch({ id: fragmentId }).set({ designFormat: "v2", designJson: designFor(kind, variant, source) }).go();
  await SiteLayout.patch({ templateId: rootTemplateId }).set({ enabled: true }).go();
  await onTemplateSaved(fragmentId);
  return { ok: true, fragmentId, pagesWithOwnChrome: await pagesWithOwnChrome(rootTemplateId, kind) };
}

// ------------------------------------------------------------------------------------------------ old inline header/footer

async function sitePages(rootTemplateId: string) {
  const out: (TemplateItem | null)[] = [];
  const { data: root } = await Template.get({ id: rootTemplateId }).go();
  if (root) out.push(root);
  let frontier = [rootTemplateId];
  while (frontier.length) {
    const batches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go({ pages: "all" })));
    const children = batches.flatMap((b) => b.data);
    out.push(...children);
    frontier = children.map((c) => c.id);
  }
  return out.filter((p): p is NonNullable<typeof p> => !!p && p.kind === "LANDING_PAGE" && p.sourceType === "BUILDER" && !p.isSiteLayoutFragment && designFormatOf(p) === "v2");
}

function inlineSections(design: unknown, kind: LayoutKind): string[] {
  if (!isV2Design(design)) return [];
  return (design.pages[0]?.rootNode.children ?? []).filter((n) => blockOf(n)?.kind === kind).map((n) => n.id);
}

/** Pages that still carry their own header (or footer) as a section, which would now show beside the shared one. */
export async function pagesWithOwnChrome(rootTemplateId: string, kind: LayoutKind): Promise<{ id: string; name: string }[]> {
  const pages = await sitePages(rootTemplateId);
  return pages.filter((p) => inlineSections(p.designJson, kind).length > 0 || inlineSections(p.draftJson, kind).length > 0).map((p) => ({ id: p.id, name: p.name }));
}

/** Takes the page's own header/footer sections out (the shared one replaces them). Live and draft copies both. Returns how many pages changed. */
export async function removeOwnChrome(rootTemplateId: string, kind: LayoutKind): Promise<number> {
  // Never take a page's own header away unless the shared one is there to replace it.
  const { data: layout } = await SiteLayout.get({ templateId: rootTemplateId }).go();
  if (!layout?.enabled || (await fragmentIsBlank(kind === "header" ? layout.headerTemplateId : layout.footerTemplateId))) {
    throw new Error(`Add your site ${kind} first. The pages' own ${kind}s are only removed once the shared one is in place.`);
  }
  const pages = await sitePages(rootTemplateId);
  let changed = 0;
  const strip = (design: unknown): V2Design | null => {
    const ids = inlineSections(design, kind);
    if (!ids.length || !isV2Design(design)) return null;
    const applied = applyCommands(design.pages, design.designSystem ?? createDefaultDesignSystem(), ids.map((sectionId) => ({ op: "removeSection", sectionId })));
    if (applied.results.some((r) => !r.ok)) return null;
    return { ...design, pages: applied.pages };
  };
  for (const page of pages) {
    const live = strip(page.designJson);
    const draft = strip(page.draftJson);
    if (!live && !draft) continue;
    const designJson = live ?? page.designJson;
    const compiledHtml = await compileTemplateWithSiteLayout(page, designJson);
    const set: Record<string, unknown> = { designJson, compiledHtml };
    if (draft) {
      set.draftJson = draft;
      set.draftHtml = await compileTemplateWithSiteLayout(page, draft);
    }
    await Template.patch({ id: page.id }).set(set).go();
    changed++;
  }
  return changed;
}
