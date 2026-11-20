import { randomUUID } from "node:crypto";
import { catalogSchema, createDefaultDesignSystem, describeDesign } from "@charisol/plexo-sdk/v2/compile";

import type { resolveUser } from "@/lib/auth/resolveUser";
import { BlogSite, Template } from "@/lib/db/contentEntities";
import { sellProductOnPage } from "@/lib/commerce/sellProduct";
import { hasBlogMarker, type BlogMarkerName } from "@/lib/pub/blogLayoutRender";
import { resolveDesignSystem } from "@/lib/v2/designSystemStore";
import { blankV2Design, designFormatOf, parseV2Design } from "@/lib/v2/design";
import {
  PageToolError,
  MAX_COMMANDS,
  applyToDesign,
  createV2Page,
  describePages,
  editPage,
  editableUrlFor,
  loadOwnedRow,
  pageTemplateIds,
  publishPage,
  saveEdit,
  summarizeSections,
} from "./v2Pages";
import { SITE_CORE_MCP_TOOLS, SITE_CORE_TOOL_NAMES, handleSiteCoreTool } from "./siteCoreTools";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Building visual pages and sites — for SOL and for any MCP client. Everything built here is
// "V2" (Plexo's visual editor), so the owner can keep changing it themselves afterwards. The
// descriptions double as the guidance an AI needs: describe first, edit with section commands,
// then publish — and write real copy for the business.

const templateId = { type: "string", description: "The page's templateId (from page_create_from_template, list_landing_pages or get_landing_page_pages). For a site's home page this is also the siteId." };

const COMMANDS_HELP =
  "Each command is one of: " +
  '{op:"addSection", kind, variant?, content?, style?, afterSectionId? | index?} · {op:"updateSection", sectionId, content?, variant?, style?} · {op:"updateElement", nodeId, text?, href?, src?, alt?, name?, hidden?, style?:{any style setting}, responsive?:{tablet?,mobile?}} · {op:"addElement", parentId, element:{type, content?, props?, styles?, responsive?, children?}, index? | afterNodeId?} · {op:"removeElement", nodeId} · {op:"moveElement", nodeId, parentId?, index? | afterNodeId?} · {op:"duplicateElement", nodeId} · {op:"addCustomSection", pageId, element:{type:"section", children}, afterSectionId? | index?} · {op:"replaceSection", sectionId, element} (the element commands and replaceSection change anything inside a hand-designed section — premium templates are built that way; use the ids page_describe lists in the elements outline of that section) · {op:"removeSection", sectionId} · {op:"moveSection", sectionId, index? | afterSectionId?} · {op:"duplicateSection", sectionId} · {op:"setBrand", tokens:{primaryColor?, secondaryColor?, headingFont?, bodyFont?, neutrals? (cool|warm|dark), roundness? (sharp|soft|round)}} · {op:"renamePage", name}. ' +
  'kind/variant and the content field paths ("headline", "items.0.title") come from the catalog in page_describe; a list field needs the whole list; style is {background? (canvas|surface|sunken|primary|inverted|gradient|image), align? (left|center), spacing? (tight|normal|airy)}. ' +
  "sectionId values come from page_describe and are only valid for that page. Write real, specific copy for the business — never lorem ipsum. " +
  "Each command is checked on its own: good ones are saved, bad ones come back with a plain-English reason, so read the results and resend only the ones that failed.";

const BASE_PAGE_MCP_TOOLS = [
  {
    name: "page_describe",
    title: "Describe Page",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "START HERE for any landing page or site. Shows a site's pages (name, slug, address, whether each uses the new visual editor) and, for a visual (V2) page, its sections in order (id, kind, layout, a few words of what each says), the brand (colours, fonts, corners) and the catalog of everything you can add — every section kind with its layouts and fillable fields, the ready-made page templates (blank, home, landing, about, services, contact, pricing), and the blog, shop and funnel sections. " +
      "Pass templateId (or siteId — the home page's id) and optionally slug to look at one of the site's other pages. Call it before page_edit, and again after edits if you need fresh section ids. Pass includeCatalog:false on later calls to keep the reply short. The workflow is: page_describe → page_edit with section commands → page_publish.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "A page's id — or the site's home page id to see the whole site." },
        siteId: { type: "string", description: "The site's home page id (same as templateId; use whichever you have)." },
        slug: { type: "string", description: "Optional: a page of the site by its address segment, e.g. \"about\", when templateId/siteId is the site's home page." },
        includeCatalog: { type: "boolean", description: "Default true. Pass false once you already know the catalog." },
      },
    },
  },
  {
    name: "page_edit",
    title: "Edit Page",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      "Changes a visual page section by section — the way to edit any page made with page_create_from_template (and any page the owner designed in the visual editor). Saves it as the page's working copy in the editor (exactly what the editor's own autosave does); nothing goes live until page_publish. " +
      COMMANDS_HELP +
      " Up to 40 commands per call. To add a whole new page to the site use page_create_from_template with siteId — an addPage command here is declined with that hint. Pages built with the classic tools (create_landing_page etc.) or as raw HTML can't be edited with this.",
    inputSchema: {
      type: "object",
      properties: {
        templateId,
        slug: { type: "string", description: "Optional: edit the site's page with this address segment instead of templateId's own page." },
        commands: { type: "array", maxItems: MAX_COMMANDS, items: { type: "object", properties: { op: { type: "string" } }, required: ["op"], additionalProperties: true } },
      },
      required: ["templateId", "commands"],
    },
  },
  {
    name: "page_create_from_template",
    title: "Create Page From Template",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      "Creates a visual page that is already complete: sections filled in with starting wording. A NEW site also gets its shared site-wide header and footer (\"site core\", editable once for every page with site_layout_edit), so the page itself carries no header or footer; a page added with siteId shows the site's shared ones. Without siteId it starts a NEW single-page SITE (for a whole multi-page site use site_create instead); with siteId it adds a page to that site — it takes the site's brand and menu, and joins the site's shared menu (any plan can build and preview a multi-page site; Free publishes only the home page). templateId is a page template: blank, home, landing, about, services, contact, pricing, store, blog, product, faq, gallery, team or menu, or any layout id from list_site_templates (home for a first page, landing for a one-page sales site). " +
      "Pass content — the same commands as page_edit — to personalise it in the same call (headline, copy, brand colours with setBrand), so the owner sees a finished page for their business straight away; any wording you don't change stays as the template's sample text, so replace the key copy. It isn't published: call page_publish with a domain when the owner is ready. Never ask the owner for a name or address first — name the page yourself from what it's about.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Page name, e.g. \"Home\", \"Pricing\" or the business's name for a new site." },
        templateId: { type: "string", description: "Which ready-made page to start from: blank, home, landing, about, services, contact, pricing, store, blog, product, faq, gallery, team or menu — or a layout id from list_site_templates (e.g. home-editorial). Default home." },
        siteId: { type: "string", description: "Add the page to this existing visual site (its home page id). Omit to start a new site." },
        content: { type: "array", maxItems: MAX_COMMANDS, items: { type: "object", properties: { op: { type: "string" } }, required: ["op"], additionalProperties: true }, description: "Optional page_edit commands applied right after creating the page. " + "Section ids don't exist yet, so use addSection / setBrand, or call page_describe first to get ids for updateSection." },
      },
      required: ["name"],
    },
  },
  {
    name: "page_publish",
    title: "Publish Page",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Puts a visual page's latest changes live (and keeps the previous version in its history). For a site's home page, also pass domain to give it an address: a short subdomain like \"careconnect\" (becomes careconnect.<pages domain>) or the owner's own domain. Other pages of the site go live at that same address automatically (e.g. /about) once the home page has a domain — publish them too so their latest edits are live. If the home page has no address yet and none is given, the reply lists suggestedDomains to offer the owner. Free plans publish only the home page on a Plexo address and one live site; the reply says plainly when a limit applies.",
    inputSchema: {
      type: "object",
      properties: {
        templateId,
        domain: { type: "string", description: "Home page only. Subdomain slug (e.g. 'kicks') or custom domain ('kicks.com')." },
        type: { type: "string", enum: ["SUBDOMAIN", "CUSTOM"], description: "Inferred from the domain string if omitted." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "blog_layout_describe",
    title: "Describe Blog Layout",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Shows a blog's custom post page or listing (index) page layout built with the visual editor: its sections, the brand and the catalog (the blogArticle section is the post body, blogList the list of posts). If the blog has no custom layout yet it says so and what blog_layout_edit will start from. Use before blog_layout_edit.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page id." },
        kind: { type: "string", enum: ["post", "listing"], description: "post = a single article's page; listing = the blog index." },
        includeCatalog: { type: "boolean", description: "Default true. Pass false once you know the catalog." },
      },
      required: ["templateId", "kind"],
    },
  },
  {
    name: "blog_layout_edit",
    title: "Edit Blog Layout",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      "Designs a blog's post page or listing page with the visual editor, using the same section commands as page_edit. Creates the layout the first time (an empty page you fill with commands). A post layout needs a blogArticle section and a listing layout needs a blogList section — until it has one the blog falls back to the default theme, and the reply warns about it. Typical post layout: header, blogArticle, cta, footer. Takes effect immediately (blog layouts have no separate publish step). " +
      COMMANDS_HELP,
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The blog site's home page id." },
        kind: { type: "string", enum: ["post", "listing"] },
        commands: { type: "array", maxItems: MAX_COMMANDS, items: { type: "object", properties: { op: { type: "string" } }, required: ["op"], additionalProperties: true } },
        startFresh: { type: "boolean", description: "Only if the blog's current layout was built in the classic editor and has content: true replaces it. Ask the owner first." },
      },
      required: ["templateId", "kind", "commands"],
    },
  },
  {
    name: "sell_product_on_page",
    title: "Sell a Product on a Page",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Makes a page SELL one product, end to end — the one call to use whenever someone wants to sell a course, ebook, download or product from a page (never a hand-made payment link). Every purchase is recorded as an order in Commerce. It does whatever is still missing: " +
      "(1) no product yet → creates it from name + price (a digital product; pass deliveryUrl — where buyers get the course/files after paying — if you know it, otherwise buyers are told the owner will email access and the reply warns the owner to add the link); " +
      "(2) Commerce off or no way to be paid → turns it on with Plexo's own Paystack, which needs no keys; " +
      "(3) the page already has a hosted pay link (Flutterwave, Paystack, Selar, a Stripe payment link, Gumroad…) → switches that link to open Plexo's checkout on the same page, so the page keeps its design and only the payment changes; " +
      "(4) otherwise → adds a buy card. A buy card opens a checkout over the page and brings the buyer back to it, so it needs no checkout page and works on the Free plan's home page for digital products. " +
      "Works on whatever the page is made of: a visual page (published for you when nothing else is waiting in its working copy), a classic page, a hand-written HTML page, and for a React app it returns what to place and which link to change (use the app tools to make that edit, then publish the app). Any button anywhere can also open the checkout with href=\"#plexo-buy-<productId>\" (the reply's buyLink) or data-plexo-buy=\"<productId>\". " +
      "Safe to repeat. If the page has several different payment links it leaves them alone and lists them in unclearLinks — ask which one is this product's and pass part of its URL as paymentLink. Pass the reply's warnings on to the owner in plain words.",
    inputSchema: {
      type: "object",
      properties: {
        siteId: { type: "string", description: "The site's home page id (list_landing_pages shows it)." },
        productId: { type: "string", description: "An existing product to sell (list_commerce_products). Services are booked, not bought — they can't be used here. Leave out to create one with name + price." },
        name: { type: "string", description: "Creates the product: its name, e.g. \"AI Video Creation Course\"." },
        price: { type: "number", description: "Creates the product: price in whole currency units, e.g. 5000 for ₦5,000 (the site's currency)." },
        description: { type: "string", description: "Creates the product: a short description shown on the buy card." },
        imageUrl: { type: "string", description: "Creates the product: a picture for the buy card." },
        deliveryUrl: { type: "string", description: "Creates the product: the link buyers are sent after paying (the course, a drive folder, a members' area)." },
        deliveryInstructions: { type: "string", description: "Creates the product: instructions emailed to buyers instead of a link." },
        fileUrl: { type: "string", description: "Creates the product: a file already uploaded to Plexo that buyers can download." },
        pageId: { type: "string", description: "Optional: put it on this page of the site instead of the home page." },
        convertLinks: { type: "boolean", description: "Switch the page's existing hosted payment links to the new checkout. Default true." },
        paymentLink: { type: "string", description: "When the page has several different payment links: part of the URL of the one that is this product's (e.g. \"aivideocreationcourse\")." },
        addCard: { type: "boolean", description: "Also add a buy card. Default: only when the page had no payment link to switch." },
        heading: { type: "string", description: "Visual pages: the heading above the buy card. Default: the product's name." },
        text: { type: "string", description: "Visual pages: one line of text under the heading." },
        buttonLabel: { type: "string", description: "Text on the buy card's button. Default \"Buy now\"." },
        publish: { type: "boolean", description: "Visual pages: publish too. Default true — skipped automatically if the page has other unpublished edits." },
      },
      required: ["siteId"],
    },
  },
];

// Site core (shared header/footer, per-page switches, header/footer code) rides with the page tools.
export const PAGE_MCP_TOOLS = [...BASE_PAGE_MCP_TOOLS, ...SITE_CORE_MCP_TOOLS];
export const PAGE_TOOL_NAMES = new Set(PAGE_MCP_TOOLS.map((t) => t.name));

// ------------------------------------------------------------------ blog layouts

type LayoutKind = "post" | "listing";
const isLayoutKind = (v: unknown): v is LayoutKind => v === "post" || v === "listing";
const requiredMarker = (kind: LayoutKind): { marker: BlogMarkerName; section: string } =>
  kind === "post" ? { marker: "content", section: "blogArticle" } : { marker: "postList", section: "blogList" };

async function loadBlogSite(resolved: ResolvedUser, id: unknown) {
  const site = await loadOwnedRow(resolved, id);
  if (site.parentId) throw new PageToolError(`"${site.name}" is a page inside a site. Pass the site's home page id (list_landing_pages shows them).`);
  return site;
}

async function layoutRowOf(siteId: string, kind: LayoutKind) {
  const { data: blog } = await BlogSite.get({ templateId: siteId }).go();
  const layoutId = kind === "post" ? blog?.postLayoutTemplateId : blog?.listingLayoutTemplateId;
  if (!layoutId) return { blog, row: null };
  const { data: row } = await Template.get({ id: layoutId }).go();
  return { blog, row: row ?? null };
}

async function describeBlogLayout(resolved: ResolvedUser, args: { templateId?: unknown; kind?: unknown; includeCatalog?: unknown }) {
  const site = await loadBlogSite(resolved, args.templateId);
  if (!isLayoutKind(args.kind)) throw new PageToolError('kind must be "post" (a single article) or "listing" (the blog index).');
  const { row } = await layoutRowOf(site.id, args.kind);
  const { section } = requiredMarker(args.kind);
  const starter = `blog_layout_edit starts an empty layout; add a ${section} section (plus a header, footer and anything else) with addSection commands.`;
  if (!row) return { exists: false, kind: args.kind, message: `No custom ${args.kind} layout yet — the blog uses the default theme. ${starter}` };
  if (designFormatOf(row) !== "v2") {
    return {
      exists: true,
      kind: args.kind,
      layoutTemplateId: row.id,
      designFormat: "classic",
      message: "This layout was built in the classic editor. blog_layout_edit with startFresh:true replaces it with a visual-editor layout (ask the owner first); get_blog_layout still reads it.",
    };
  }
  const parsed = parseV2Design(await resolveDesignSystem(row.draftJson ?? row.designJson));
  if (!parsed.ok) throw new PageToolError(`I can't read this blog layout (${parsed.error}).`);
  const summary = describeDesign(parsed.design.pages, parsed.design.designSystem ?? createDefaultDesignSystem());
  return {
    exists: true,
    kind: args.kind,
    layoutTemplateId: row.id,
    designFormat: "v2",
    editableUrl: editableUrlFor(row.id),
    sections: summary.pages[0]?.sections ?? [],
    brand: summary.brand,
    hasRequiredSection: hasBlogMarker(row.compiledHtml ?? "", requiredMarker(args.kind).marker),
    ...(args.includeCatalog === false ? {} : { catalog: catalogSchema() }),
  };
}

/** The layout row for a blog, created (empty, visual) and attached when there isn't one yet. */
async function ensureV2BlogLayout(resolved: ResolvedUser, siteId: string, kind: LayoutKind, startFresh: boolean) {
  const { blog, row } = await layoutRowOf(siteId, kind);
  if (row) {
    if (designFormatOf(row) === "v2") return row;
    const rows = ((row.designJson as { body?: { rows?: unknown[] } } | undefined)?.body?.rows ?? []) as unknown[];
    if (rows.length > 0 && !startFresh) {
      throw new PageToolError(
        `This blog's ${kind} layout was built in the classic editor and has content, so I haven't touched it. Ask the owner whether to replace it with a new one (then call again with startFresh: true), or keep it.`,
      );
    }
    await Template.patch({ id: row.id }).set({ designFormat: "v2", designJson: blankV2Design() }).go();
    return { ...row, designFormat: "v2", designJson: blankV2Design() };
  }

  const layoutId = randomUUID();
  await Template.create({
    id: layoutId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name: kind === "post" ? "Blog Post Layout" : "Blog Listing Layout",
    kind: "LANDING_PAGE",
    isBlogLayout: true,
    designFormat: "v2",
    designJson: blankV2Design(),
    compiledHtml: "",
  }).go();
  const field = kind === "post" ? { postLayoutTemplateId: layoutId } : { listingLayoutTemplateId: layoutId };
  if (blog) await BlogSite.patch({ templateId: siteId }).set(field).go();
  else await BlogSite.create({ id: randomUUID(), templateId: siteId, ...field }).go();
  const { data: created } = await Template.get({ id: layoutId }).go();
  if (!created) throw new Error(`Template ${layoutId} vanished immediately after being created`);
  return created;
}

async function editBlogLayout(resolved: ResolvedUser, args: { templateId?: unknown; kind?: unknown; commands?: unknown; startFresh?: unknown }) {
  const site = await loadBlogSite(resolved, args.templateId);
  if (!isLayoutKind(args.kind)) throw new PageToolError('kind must be "post" (a single article) or "listing" (the blog index).');
  const kind = args.kind;
  if (!Array.isArray(args.commands) || args.commands.length === 0) throw new PageToolError("Give at least one change to make (commands). Call blog_layout_describe to see the layout first.");
  if (args.commands.length > MAX_COMMANDS) throw new PageToolError(`Make at most ${MAX_COMMANDS} changes per call — split them into a few calls.`);
  // Nothing to build on yet: check the commands first, so a malformed call leaves no empty layout behind.
  if (!(await layoutRowOf(site.id, kind)).row) {
    const trial = applyToDesign(blankV2Design(), args.commands);
    if (!trial.anyOk) return { ok: false, saved: false, kind, results: trial.reports, next: "Nothing was changed — this layout is still empty, so start with addSection commands." };
  }

  const row = await ensureV2BlogLayout(resolved, site.id, kind, args.startFresh === true);
  const result = await saveEdit(row, args.commands, { live: true });
  const { marker, section } = requiredMarker(kind);
  if (result.saved) {
    const { data: fresh } = await Template.get({ id: row.id }).go();
    const has = hasBlogMarker(fresh?.compiledHtml ?? "", marker);
    return {
      ...result,
      kind,
      layoutTemplateId: row.id,
      ...(has ? {} : { warning: `This ${kind} layout has no ${section} section yet, so the blog still shows the default theme. Add one with an addSection command (kind "${section}").` }),
    };
  }
  return { ...result, kind, layoutTemplateId: row.id };
}

// ------------------------------------------------------------------ dispatcher

export async function handlePageTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
 
  if (SITE_CORE_TOOL_NAMES.has(toolName)) return handleSiteCoreTool(toolName, args, resolved);
  try {
    switch (toolName) {
      case "page_describe":
        return await describePages(resolved, args ?? {});
      case "page_edit":
        return await editPage(resolved, args ?? {});
      case "page_create_from_template": {
        const created = await createV2Page(resolved, args ?? {});
        const { row } = created;
        const hadContent = args?.content !== undefined && args?.content !== null;
        return {
          success: true,
          templateId: row.id,
          siteId: created.siteId,
          name: row.name,
          slug: created.slug,
          route: created.route,
          designFormat: "v2",
          sections: summarizeSections(created.design),
          ...(hadContent ? { results: created.results } : {}),
          editableUrl: editableUrlFor(row.id),
          publishedUrl: null,
          next: `Created, not published. ${hadContent ? "" : "It has the template's sample wording — use page_describe then page_edit to write the business's real copy. "}Then page_publish${row.parentId ? " (the site's home page needs an address first)" : " with a domain"} to put it live. Available page templates: ${pageTemplateIds().join(", ")}.`,
        };
      }
      case "page_publish":
        return await publishPage(resolved, args ?? {});
      case "sell_product_on_page":
        return { success: true, ...(await sellProductOnPage(resolved, args ?? {})) };
      case "blog_layout_describe":
        return await describeBlogLayout(resolved, args ?? {});
      case "blog_layout_edit":
        return await editBlogLayout(resolved, args ?? {});
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    if (err instanceof PageToolError) throw new Error(err.message);
    throw err;
  }
}
