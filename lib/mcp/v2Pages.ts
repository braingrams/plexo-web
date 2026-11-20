import { planGateMessage, templateLimitGate } from "@/lib/plan/limitGates";
import { randomUUID } from "node:crypto";
import {
  applyCommands,
  catalogSchema,
  convertV1Design,
  createDefaultDesignSystem,
  describeCommand,
  describeDesign,
  describeSection,
  isPageTemplateId,
  listPageTemplates,
  solCommandSchema,
  type CommandResult,
  type DesignSystem,
  type PageDefinition,
} from "@charisol/plexo-sdk/v2/compile";

import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { compileTemplate } from "@/lib/compileTemplate";
import { compileTemplateWithSiteLayout, findRootTemplateId, onTemplateSaved } from "@/lib/siteLayoutCore";
import { publishTemplateDraft } from "@/lib/templateVersions";
import { externalizeDesignSystem, resolveDesignSystem } from "@/lib/v2/designSystemStore";
import { designFormatOf, parseV2Design, V2DesignError, v2DesignFromTemplate, V2_FORMAT, type V2Design } from "@/lib/v2/design";
import { getTierFeatures } from "@/lib/subscription";
import { ensureUniqueSlug, pathForPage } from "@/server/slugDynamo";
import { assertCanPublishPage, planLimitText } from "@/lib/plan/publishGuard";
import { setPagePublishFlags } from "@/lib/plan/sitesStore";
import { linkDomainToTemplate } from "@/lib/sites/linkDomain";
import { User } from "@/lib/db/coreEntities";
import { chromeFor } from "@/lib/v2/siteFormat";
import { ensureSiteLayout } from "@/lib/siteLayoutProvision";
import { ensureBlankSiteLayout } from "@/lib/siteLayoutBlank";
import { addPageToSiteMenu } from "@/lib/sites/siteNav";
import { htmlOutline } from "@/lib/sites/htmlOutline";
import { BRAND_COMPONENT_COMMANDS_READY, BRAND_COMPONENT_OPS, brandComponentCommandMessage } from "@/lib/brand/brandComponentCommands";
import { sendComponentsToStrata } from "@/lib/brand/extrasWriteThrough";
import { newBrandComponents, type DesignComponent } from "@/lib/brand/brandComponents";
import { registerSectionsForRow } from "@/lib/customSections/register";
import { syncPageEntries } from "@/lib/customSections/placements";
import type { resolveUser } from "@/lib/auth/resolveUser";
import { countsAsSite } from "@/lib/plan/countsAsSite";

// The V2 page workflow behind page_describe / page_edit / page_create_from_template /
// page_publish (lib/mcp/pageTools.ts) — the site/template twin of lib/projects/designEdit.ts
// (which does the same for app pages). Everything an AI builds visually goes through here, so
// it is always a V2 design the owner can keep editing in the visual editor.
//
// Storage follows docs/v2-templates.md: one Template row = one site page, design in
// designJson (live) / draftJson (working copy, what the editor's autosave writes). Edits
// land in the draft; page_publish snapshots the draft live (a revision) and connects a domain.

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/** An error whose message is already plain English for the owner (and the AI relaying it). */
export class PageToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageToolError";
  }
}

export const MAX_COMMANDS = 40;

const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
export const editableUrlFor = (id: string) => `${baseUrl()}/dashboard/templates/${id}`;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ------------------------------------------------------------------ loading

export async function loadOwnedRow(resolved: ResolvedUser, id: unknown): Promise<Row> {
  const templateId = str(id);
  if (!templateId) throw new PageToolError("Which page? Pass its templateId (list_landing_pages shows them).");
  const { data: row } = await Template.get({ id: templateId }).go();
  if (!row || row.organizationId !== resolved.organizationId) {
    throw new PageToolError(`I can't find a page with id "${templateId}" in this account. Use list_landing_pages to see the pages and their ids.`);
  }
  if (row.kind !== "LANDING_PAGE") {
    throw new PageToolError(`"${row.name}" is an email template — emails keep using the classic email tools (update_template). page_* tools are for landing pages and sites.`);
  }
  return row;
}

/** Every page of the site this row belongs to (root first), as full rows. */
export async function loadSiteRows(resolved: { organizationId: string }, rootId: string): Promise<Row[]> {
  const { data: root } = await Template.get({ id: rootId }).go();
  if (!root || root.organizationId !== resolved.organizationId) return [];
  const rows: Row[] = [root];
  let frontier = [rootId];
  while (frontier.length > 0 && rows.length < 500) {
    const batches = await Promise.all(frontier.map((parentId) => Template.query.byParent({ parentId }).go({ pages: "all" })));
    const children = batches.flatMap((b) => b.data).filter((c: Row) => c.organizationId === resolved.organizationId);
    rows.push(...children);
    frontier = children.map((c: Row) => c.id);
  }
  return rows;
}

export function formatLabel(row: Row): "v2" | "classic" | "raw-html" {
  if (row.sourceType === "RAW_UPLOAD") return "raw-html";
  return designFormatOf(row) === "v2" ? "v2" : "classic";
}

const normalizeSlug = (s: string) => s.replace(/^\/+|\/+$/g, "").toLowerCase();

/** The page a call is about: the row itself, or — when `slug` is given — that page of the same site. */
async function resolveTargetRow(resolved: ResolvedUser, id: unknown, slug: unknown): Promise<{ row: Row; siteRows: Row[]; rootId: string }> {
  const row = await loadOwnedRow(resolved, id);
  const rootId = await findRootTemplateId(row.id, row.parentId ?? null);
  const siteRows = await loadSiteRows(resolved, rootId);
  const wanted = normalizeSlug(str(slug));
  if (!wanted) return { row, siteRows, rootId };
  const hit = siteRows.find((r) => r.parentId && (normalizeSlug(r.slug ?? "") === wanted || normalizeSlug(pathForPage(r.id, siteRows)) === wanted));
  if (!hit) {
    const names = siteRows.filter((r) => r.parentId).map((r) => `${r.slug} (${r.name})`);
    throw new PageToolError(`This site has no page "${wanted}". ${names.length ? `Its other pages are: ${names.join(", ")}.` : "It only has a home page — leave slug out."}`);
  }
  return { row: hit, siteRows, rootId };
}

/** The design as the owner would see it now: the working draft when there is one, else the live one. */
export async function currentDesign(row: Row): Promise<V2Design> {
  // A big brand lives in storage with a reference in the row: bring it back so the tools see the whole design.
  const parsed = parseV2Design(await resolveDesignSystem(row.draftJson ?? row.designJson));
  if (!parsed.ok) throw new PageToolError(`I can't read the design of "${row.name}" (${parsed.error}). Open it in the dashboard editor to check it.`);
  return parsed.design;
}

const systemOf = (design: V2Design): DesignSystem => design.designSystem ?? createDefaultDesignSystem();

// ------------------------------------------------------------------ describe

export async function describePages(resolved: ResolvedUser, args: { templateId?: unknown; siteId?: unknown; slug?: unknown; includeCatalog?: unknown }) {
  const { row, siteRows, rootId } = await resolveTargetRow(resolved, args.templateId ?? args.siteId, args.slug);
  const root = siteRows.find((r) => r.id === rootId) ?? row;
  const pages = siteRows.map((r) => ({
    templateId: r.id,
    name: r.name,
    slug: r.parentId ? r.slug ?? null : null,
    route: pathForPage(r.id, siteRows),
    designFormat: formatLabel(r),
    isHomePage: !r.parentId,
    published: r.isPublished !== false,
  }));

  const target = formatLabel(row);
  let page: Record<string, unknown>;
  let brand: unknown;
  if (target === "v2") {
    const design = await currentDesign(row);
    const summary = describeDesign(design.pages, systemOf(design));
    brand = summary.brand;
    const p = summary.pages[0];
    page = {
      templateId: row.id,
      name: row.name,
      route: pathForPage(row.id, siteRows),
      designFormat: "v2",
      pageId: p?.id,
      sections: p?.sections ?? [],
      hasUnpublishedChanges: !!row.draftJson,
    };
  } else {
    // No sections to list, but SOL can still read what's on it.
    const outline = htmlOutline(String(row.draftHtml || row.compiledHtml || ""));
    page = {
      templateId: row.id,
      name: row.name,
      route: pathForPage(row.id, siteRows),
      designFormat: target,
      outline: outline || "(This page has no readable text yet.)",
      note:
        target === "raw-html"
          ? "This page is hand-written HTML, so it has no sections to edit visually. Replace it with update_raw_landing_page, or build a visual page with page_create_from_template."
          : "This page was built in the classic editor, so it can't be edited section by section. update_template still changes it; for a new page that stays editable in the visual editor use page_create_from_template.",
    };
  }

  return {
    site: { siteId: rootId, name: root.name, pages },
    page,
    ...(brand ? { brand } : {}),
    ...(args.includeCatalog === false ? {} : { catalog: catalogSchema() }),
    note:
      target === "v2"
        ? "Change this page with page_edit using section commands — each command is checked on its own. Section ids are only valid for this page. Write real copy for the business, then page_publish to put it live. To add a page to the site use page_create_from_template with siteId."
        : "Only pages marked designFormat \"v2\" can be changed with page_edit.",
  };
}

// ------------------------------------------------------------------ applying commands

export type CommandReport = { n: number; change: string; ok: boolean; message: string };

type Applied = { design: V2Design; results: CommandResult[]; reports: CommandReport[]; anyOk: boolean; renamed: boolean; /** Brand components this call made (saveAsBrandComponent), to be sent to the site's Strata project. */ newComponents: DesignComponent[] };

/** Runs section commands against a one-page design. Pure apart from reading the SDK. Never throws. */
export function applyToDesign(design: V2Design, rawCommands: unknown[], opts: { allowAddPage?: boolean } = {}): Applied {
  const page = design.pages[0];
  const preResults = new Map<number, CommandResult>();
  const toApply: unknown[] = [];
  const originalIndex: number[] = [];

  rawCommands.forEach((c, i) => {
    const cmd = c && typeof c === "object" ? ({ ...(c as Record<string, unknown>) } as Record<string, unknown>) : null;
    if (!cmd) {
      preResults.set(i, { ok: false, message: "That change isn't in the right shape — each one is an object with an op, like {op:\"updateSection\", sectionId, content}." });
      return;
    }
    if (cmd.op === "addPage" && !opts.allowAddPage) {
      preResults.set(i, {
        ok: false,
        message: `Pages of a site are separate pages: use page_create_from_template (with this site's siteId) to add "${typeof cmd.name === "string" ? cmd.name : "the new page"}", then fill it in with page_edit.`,
      });
      return;
    }
    // Brand-component commands are part of the SDK since 2.0.33 (lib/brand/brandComponentCommands.ts).
    if (typeof cmd.op === "string" && BRAND_COMPONENT_OPS.has(cmd.op) && !BRAND_COMPONENT_COMMANDS_READY) {
      preResults.set(i, { ok: false, message: brandComponentCommandMessage(cmd.op) });
      return;
    }
    // One page per call, so any page reference (missing, a slug, a name) means "this page".
    if ((cmd.op === "addSection" || cmd.op === "renamePage") && cmd.pageId !== page.id && String(cmd.pageId ?? "").trim().toLowerCase() !== page.name.trim().toLowerCase()) {
      cmd.pageId = page.id;
    }
    originalIndex.push(i);
    toApply.push(cmd);
  });

  const applied = applyCommands(design.pages, systemOf(design), toApply);
  const results: CommandResult[] = rawCommands.map((_, i) => preResults.get(i) ?? ({ ok: false, message: "Not applied." } as CommandResult));
  applied.results.forEach((r, k) => (results[originalIndex[k]] = r));

  const reports: CommandReport[] = rawCommands.map((c, i) => {
    let change = typeof (c as { op?: unknown })?.op === "string" ? String((c as { op: string }).op) : "change";
    const parsed = solCommandSchema.safeParse(toApply[originalIndex.indexOf(i)]);
    if (parsed.success) {
      try {
        change = describeCommand(parsed.data, design.pages);
      } catch {
        /* keep the op name */
      }
    }
    return { n: i + 1, change, ok: results[i].ok, message: results[i].message };
  });

  const renamed = rawCommands.some((c, i) => results[i].ok && (c as { op?: unknown })?.op === "renamePage");
  const next: V2Design = { ...design, pages: applied.pages.slice(0, 1) as PageDefinition[], designSystem: applied.designSystem };
  // saveAsBrandComponent adds a component to the brand: the ones that were not there before are the new ones (the SDK keeps the others as they were).
  const newComponents = newBrandComponents(systemOf(design).components, applied.designSystem.components);
  return { design: next, results, reports, anyOk: results.some((r) => r.ok), renamed, newComponents };
}

function checkCommands(raw: unknown): unknown[] {
  const commands = Array.isArray(raw) ? raw : [];
  if (!commands.length) throw new PageToolError("Give at least one change to make (commands). Call page_describe to see the page's sections and what can be changed.");
  if (commands.length > MAX_COMMANDS) throw new PageToolError(`Make at most ${MAX_COMMANDS} changes per call — split them into a few calls.`);
  return commands;
}

/** Validates the changed design (size caps, structure) the way every save does, then compiles it with the site's header/footer. */
export async function validateAndCompile(row: Row, design: V2Design): Promise<{ design: V2Design; html: string }> {
  const parsed = parseV2Design(design);
  if (!parsed.ok) throw new PageToolError(parsed.error);
  try {
    const html = await compileTemplateWithSiteLayout({ id: row.id, parentId: row.parentId ?? null, kind: "LANDING_PAGE", name: row.name, designFormat: "v2" }, parsed.design);
    return { design: parsed.design, html };
  } catch (err) {
    if (err instanceof V2DesignError) throw new PageToolError(err.message);
    throw err;
  }
}

// ------------------------------------------------------------------ edit

export async function editPage(resolved: ResolvedUser, args: { templateId?: unknown; slug?: unknown; commands?: unknown }) {
  const commands = checkCommands(args.commands);
  const { row, rootId } = await resolveTargetRow(resolved, args.templateId, args.slug);
  const kind = formatLabel(row);
  if (kind !== "v2") {
    throw new PageToolError(
      kind === "raw-html"
        ? `"${row.name}" is a hand-written HTML page, so it has no sections to edit. Replace its HTML with update_raw_landing_page, or build a visual page with page_create_from_template.`
        : `"${row.name}" was built in the classic editor, so page_edit can't change it. Use update_template for it, or create a new visual page with page_create_from_template.`,
    );
  }
  return saveEdit(row, commands, { live: false, who: { siteId: rootId, userId: resolved.userId, organizationId: resolved.organizationId } });
}

/** Applies commands to a V2 row and saves (draft for pages, live for layout fragments). */
export async function saveEdit(row: Row, commands: unknown[], opts: { live: boolean; /** Who is editing, so a brand component saved from the page can be sent to the site's Strata project. */ who?: { siteId: string; userId: string; organizationId: string } }) {
  // The site's own section types (Testimonials, Team members…) must be known before a command can add or change one.
  await registerSectionsForRow(row);
  const before = await currentDesign(row);
  const applied = applyToDesign(before, commands);

  if (!applied.anyOk) {
    return {
      ok: false,
      saved: false,
      templateId: row.id,
      results: applied.reports,
      next: "Nothing was changed — read each message, fix the failed changes and try again (page_describe shows the current sections).",
    };
  }

  let checked: { design: V2Design; html: string };
  try {
    checked = await validateAndCompile(row, applied.design);
  } catch (err) {
    if (err instanceof PageToolError) {
      return { ok: false, saved: false, templateId: row.id, results: applied.reports, notes: [`Couldn't save: ${err.message}`], next: "Nothing was changed." };
    }
    throw err;
  }

  const name = applied.renamed ? checked.design.pages[0].name : undefined;
  const toStore = await externalizeDesignSystem(checked.design); // a big brand is kept in storage, once, not in every row
  if (opts.live) {
    await Template.patch({ id: row.id })
      .set({ designFormat: "v2", designJson: toStore, compiledHtml: checked.html, ...(name ? { name } : {}) })
      .remove(["draftJson", "draftHtml"])
      .go();
  } else {
    await Template.patch({ id: row.id })
      .set({ draftJson: toStore, draftHtml: checked.html, ...(name ? { name } : {}) })
      .go();
  }

  await syncPageEntries(row.id);

  // A part saved to the brand goes to the site's Strata project (kept as a copy and retried if Strata can't be reached).
  const brand = opts.who && applied.newComponents.length ? await sendComponentsToStrata({ ...opts.who, components: applied.newComponents }) : undefined;

  const failed = applied.reports.filter((r) => !r.ok).length;
  return {
    ok: true,
    saved: true,
    ...(brand ? { brand: { components: applied.newComponents.map((c) => c.name), state: brand.state, message: brand.message } } : {}),
    partial: failed > 0,
    templateId: row.id,
    name: name ?? row.name,
    editableUrl: editableUrlFor(row.id),
    results: applied.reports,
    sections: describeDesign(checked.design.pages, systemOf(checked.design)).pages[0]?.sections ?? [],
    hasUnpublishedChanges: !opts.live,
    next: failed
      ? `${applied.reports.length - failed} change(s) saved, ${failed} couldn't be applied (see results). Fix those and send them again.${opts.live ? "" : " Then page_publish puts the page live."}`
      : opts.live
        ? "Saved — the layout is live."
        : "Saved as the page's working copy in the editor. page_publish puts it live.",
  };
}

// ------------------------------------------------------------------ create

export type CreateArgs = {
  name?: unknown;
  templateId?: unknown;
  siteId?: unknown;
  content?: unknown;
};

export const pageTemplateIds = (): string[] => listPageTemplates().map((t) => t.id);

export type CreatedPage = {
  row: Row;
  design: V2Design;
  results: CommandReport[];
  slug: string | null;
  route: string;
  siteId: string;
  conversionWarnings?: string[];
  fidelity?: string;
};

/**
 * Creates a V2 home page (a new site) or, with siteId, a new page in an existing V2 site.
 * `design` replaces the page-template start (used when an old client's classic design is converted).
 */
export async function createV2Page(
  resolved: ResolvedUser,
  args: CreateArgs,
  opts: { design?: V2Design; fallbackName?: string; slug?: string; skipMenu?: boolean } = {},
): Promise<CreatedPage> {
  const name = str(args.name) || opts.fallbackName || "";
  if (!name) throw new PageToolError("Give the page a name, for example \"Home\" or \"Pricing\".");

  const templateId = str(args.templateId) || "home";
  if (!opts.design && !isPageTemplateId(templateId)) {
    throw new PageToolError(`There's no page template "${templateId}". Pick one of: ${pageTemplateIds().join(", ")} (or a layout id from list_site_templates).`);
  }

  const features = getTierFeatures(resolved.subscriptionPlan);
  const siteId = str(args.siteId);
  let parent: Row | null = null;
  if (siteId) {
    parent = await loadOwnedRow(resolved, siteId);
    if (formatLabel(parent) !== "v2") {
      throw new PageToolError(
        `"${parent.name}" was built in the classic editor, so pages added to it stay classic. For a page in the new visual editor, start a new site: page_create_from_template without siteId. (create_landing_page_subpage adds a classic page to this site.)`,
      );
    }
  } else {
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const rootCount = orgTemplates.filter((t: Row) => countsAsSite(t)).length;
    if (rootCount >= features.maxLandingPages) {
      throw new PageToolError(`${planGateMessage(templateLimitGate("LANDING_PAGE", features.maxLandingPages))} Or add this as a page of an existing site by passing its siteId.`);
    }
  }

  const id = randomUUID();
  const slug = parent ? await ensureUniqueSlug(parent.id, opts.slug ?? name) : null;
  // A new site's header and footer are the site's shared ones (created right after, below), so its home page
  // starts without its own copies — nav links and the footer then live in exactly one place.
  let design: V2Design = opts.design ?? v2DesignFromTemplate(templateId, { name, slug: slug ?? undefined, seed: id, ...(parent ? {} : { chrome: false }) });
  // A page added to an existing site looks like the rest of it: the site's brand, its menu, and
  // no second header/footer when the site shares one.
  let shared: SiteChrome | null = null;
  if (parent && !opts.design) {
    shared = await siteChromeFor(resolved, parent);
    design = fitPageToSite(v2DesignFromTemplate(templateId, { name, slug: slug ?? undefined, seed: id, designSystem: shared.designSystem }), shared);
  }

  let reports: CommandReport[] = [];
  if (args.content !== undefined && args.content !== null) {
    const commands = checkCommands(args.content);
    const applied = applyToDesign(design, commands);
    design = applied.design;
    reports = applied.reports;
  }

  const parsed = parseV2Design(design);
  if (!parsed.ok) throw new PageToolError(parsed.error);
  design = parsed.design;

  let html: string;
  try {
    html = parent
      ? await compileTemplateWithSiteLayout({ id, parentId: parent.id, kind: "LANDING_PAGE", name, designFormat: "v2" }, design)
      : await compileTemplate({ designFormat: "v2", designJson: design, kind: "LANDING_PAGE", id, name });
  } catch (err) {
    if (err instanceof V2DesignError) throw new PageToolError(err.message);
    throw err;
  }

  let order: number | undefined;
  if (parent) {
    const { data: siblings } = await Template.query.byParent({ parentId: parent.id }).go({ pages: "all" });
    order = siblings.reduce((max: number, s: Row) => Math.max(max, s.order ?? 0), -1) + 1;
  }

  await Template.create({
    id,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name,
    kind: "LANDING_PAGE",
    designFormat: "v2",
    designJson: design,
    compiledHtml: html,
    ...(parent ? { parentId: parent.id, slug: slug!, order } : {}),
  }).go();
  const { data: row } = await Template.get({ id }).go();
  if (!row) throw new Error(`Template ${id} vanished immediately after being created`);
  // The site-wide header and footer (site core): created on a brand-new site, never fatal.
  if (!parent && !opts.design) {
    await ensureSiteLayout(id, resolved.organizationId, resolved.userId).catch((err) => console.error("Couldn't add the default header and footer", err));
  } else if (!parent) {
    // A site made from a ready-made design keeps that design's own header and footer; it still gets the shared
    // ones, blank, so the owner sees "Site header" / "Site footer" and can adopt them whenever they like.
    await ensureBlankSiteLayout(id, resolved.userId).catch((err) => console.error("Couldn't add the blank header and footer", err));
  }

  const siteRows = parent ? await loadSiteRows(resolved, await findRootTemplateId(parent.id, parent.parentId ?? null)) : [row];
  const route = pathForPage(row.id, siteRows);
  // A shared menu learns about the new page (only a top-level one, and only when there's room).
  if (shared?.sharedHeader && parent && !parent.parentId && !opts.skipMenu) {
    await addPageToSiteMenu(siteRows[0]?.id ?? parent.id, name, route).catch(() => undefined);
  }
  return { row, design, results: reports, slug, route, siteId: parent ? siteRows[0]?.id ?? parent.id : row.id };
}

type SiteChrome = { designSystem?: DesignSystem; sharedHeader: boolean; sharedFooter: boolean; header?: Record<string, unknown>; footer?: Record<string, unknown> };

/** The site's brand, whether it shares a header/footer, and (when pages carry their own) the home page's menu and footer words. */
async function siteChromeFor(resolved: ResolvedUser, parent: Row): Promise<SiteChrome> {
  const rootId = await findRootTemplateId(parent.id, parent.parentId ?? null);
  const { data: root } = await Template.get({ id: rootId }).go();
  if (!root || root.organizationId !== resolved.organizationId || formatLabel(root) !== "v2") return { sharedHeader: false, sharedFooter: false };
  const chrome = await chromeFor(rootId, root.name ?? "");
  const rootDesign = await currentDesign(root).catch(() => null);
  const blocks = (rootDesign?.pages[0]?.rootNode.children ?? []).map((c) => (c.props as { block?: { kind?: string; content?: Record<string, unknown> } } | undefined)?.block);
  return {
    designSystem: rootDesign?.designSystem,
    sharedHeader: !chrome.header,
    sharedFooter: !chrome.footer,
    header: blocks.find((b) => b?.kind === "header")?.content,
    footer: blocks.find((b) => b?.kind === "footer")?.content,
  };
}

/** Drops the header/footer a shared layout already provides, and copies the home page's menu/footer words onto the new page's own. */
export function fitPageToSite(design: V2Design, site: SiteChrome): V2Design {
  const page = design.pages[0];
  if (!page) return design;
  const children = (page.rootNode.children ?? []).flatMap((node) => {
    const block = (node.props as { block?: { kind?: string; content?: Record<string, unknown> } } | undefined)?.block;
    if (block?.kind === "header" && site.sharedHeader) return [];
    if (block?.kind === "footer" && site.sharedFooter) return [];
    return [node];
  });
  let next: V2Design = { ...design, pages: [{ ...page, rootNode: { ...page.rootNode, children } }] };
  const copy = [
    ...(site.header && !site.sharedHeader ? [{ kind: "header", content: site.header }] : []),
    ...(site.footer && !site.sharedFooter ? [{ kind: "footer", content: site.footer }] : []),
  ];
  if (copy.length) {
    const commands = copy.flatMap(({ kind, content }) => {
      const section = children.find((n) => (n.props as { block?: { kind?: string } } | undefined)?.block?.kind === kind);
      return section ? [{ op: "updateSection", sectionId: section.id, content }] : [];
    });
    if (commands.length) next = applyToDesign(next, commands).design;
  }
  return next;
}

/** An old client's classic (V1-shaped) design → a V2 design, with the SDK's plain-language warnings. */
export function convertLegacyDesign(v1: unknown, name: string): { design: V2Design; warnings: string[]; fidelity: string } {
  const converted = convertV1Design(v1, { id: `page-${randomUUID().slice(0, 8)}`, name, isHome: true });
  return {
    design: {
      format: V2_FORMAT,
      pages: [converted.page],
      ...(converted.extras.customJs ? { customJs: converted.extras.customJs } : {}),
      meta: { htmlTitle: name },
    },
    warnings: converted.warnings,
    fidelity: converted.fidelity,
  };
}

export function summarizeSections(design: V2Design) {
  return design.pages[0]?.rootNode.children?.map((s) => describeSection(s)) ?? [];
}

// ------------------------------------------------------------------ publish

async function liveDomainOf(rootId: string): Promise<string | null> {
  const { data: domains } = await PublishedDomain.query.primary({ templateId: rootId }).go();
  const live = domains.find((d: Row) => !d.planDisabledAt) ?? domains[0];
  return live?.domain ?? null;
}

/** Subdomain ideas from the site's name, for the one question publishing may still need. */
export function suggestSubdomains(name: string): string[] {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "my-site";
  return [base, `${base}-site`, `get-${base}`].filter((s, i, a) => s.length >= 3 && a.indexOf(s) === i);
}

/**
 * Makes a V2 page's working copy the live page (a new revision), and for a site's home page
 * connects the domain when one is given. Compiles and checks everything BEFORE changing anything.
 */
export async function publishPage(resolved: ResolvedUser, args: { templateId?: unknown; domain?: unknown; type?: unknown }) {
  const row = await loadOwnedRow(resolved, args.templateId);
  const kind = formatLabel(row);
  if (kind !== "v2") {
    throw new PageToolError(
      kind === "raw-html"
        ? `"${row.name}" is a hand-written HTML page — publish it with publish_existing_landing_page (it has no working copy to publish).`
        : `"${row.name}" was built in the classic editor — publish it with publish_existing_landing_page.`,
    );
  }
  try {
    assertCanPublishPage(resolved.subscriptionPlan, row);
  } catch (err) {
    throw new PageToolError(planLimitText(err, "This page can't be published on the current plan."));
  }

  const design = await currentDesign(row);
  let html: string;
  try {
    html = await compileTemplateWithSiteLayout({ id: row.id, parentId: row.parentId ?? null, kind: "LANDING_PAGE", name: row.name, designFormat: "v2" }, design);
  } catch (err) {
    if (err instanceof V2DesignError) throw new PageToolError(err.message);
    throw err;
  }

  const rootId = await findRootTemplateId(row.id, row.parentId ?? null);
  const domainArg = str(args.domain);
  let linked: Awaited<ReturnType<typeof linkDomainToTemplate>> | null = null;
  if (domainArg) {
    if (row.parentId) throw new PageToolError("A domain belongs to the whole site — publish the home page with a domain. Other pages go live at that domain automatically.");
    const type = args.type === "SUBDOMAIN" || args.type === "CUSTOM" ? args.type : undefined;
    try {
      linked = await linkDomainToTemplate(resolved, row.id, domainArg, type);
    } catch (err) {
      throw new PageToolError(planLimitText(err, "I couldn't connect that address."));
    }
  }

  const { data: user } = await User.get({ id: resolved.userId }).go();
  const { revisionId } = await publishTemplateDraft(row, { userId: resolved.userId, userName: user?.name ?? "Plexo User" }, design, html);
  if (row.parentId && row.isPublished === false) await setPagePublishFlags(row.id, true, null);
  await onTemplateSaved(row.id);

  const siteDomain = linked?.finalDomain ?? (await liveDomainOf(rootId));
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const siteRows = await loadSiteRows(resolved, rootId);
  const route = pathForPage(row.id, siteRows);
  const publishedUrl = siteDomain ? `${protocol}://${siteDomain}${route === "/" ? "" : route}` : null;

  return {
    success: true,
    templateId: row.id,
    name: row.name,
    versionId: revisionId,
    publishedUrl,
    domain: siteDomain,
    editableUrl: editableUrlFor(row.id),
    ...(linked ? { routingEndpoint: linked.routingEndpoint, certificateValidationName: linked.certificateValidationName, certificateValidationValue: linked.certificateValidationValue } : {}),
    ...(siteDomain || row.parentId || row.isSiteLayoutFragment || row.isBlogLayout || row.isCommerceLayout
      ? {}
      : {
          needsDomain: true,
          suggestedDomains: suggestSubdomains(row.name),
          next: "The page is saved and ready, but nobody can see it until it has an address. Call page_publish again with a domain — a short name like one of suggestedDomains, or the owner's own domain.",
        }),
  };
}
