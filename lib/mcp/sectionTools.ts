import type { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { customKindOf } from "@charisol/plexo-sdk/v2/compile";
import { normalizeSectionTypeInput } from "@/lib/customSections/model";
import { applySectionTypeToPages, createSectionType, getSectionType, listSectionTypes, siteIdForTemplate, updateSectionType } from "@/lib/customSections/service";
import { registerSiteSections } from "@/lib/customSections/register";
import { getEntry, removeEntries, updateEntry } from "@/lib/customSections/entries";
import { siteEntries } from "@/lib/customSections/placements";
import { applyRowOps, type RowOps } from "@/lib/customSections/rowOps";
import { PageToolError } from "./v2Pages";
import { editPage } from "./v2Pages";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Custom reusable sections ("Testimonials", "Team members"…): design once, add to any page, each page keeps its own
// content. Same data the dashboard's "Your sections" page manages.

export const SECTION_MCP_TOOLS = [
  {
    name: "list_section_types",
    description:
      "Lists the reusable sections a site has (Testimonials and FAQ are set up for every site, plus anything the owner or you made): each one's id, the fields to fill in (a 'list' field repeats — one row per testimonial/question/team member) and its HTML design. Use the ids with add_custom_section.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "Any page id of the site (see list_landing_pages)." } },
      required: ["templateId"],
    },
  },
  {
    name: "create_section_type",
    description:
      "Creates a reusable section the owner can add to ANY page of the site (it appears under 'Yours' in the editor's Add section panel). Give it a name (what's being created, e.g. 'Team members'), the fields people fill in, and its HTML design. Field types: text, longtext, richtext (bold/italic/links/lists — value is simple HTML like <p>Hi <strong>you</strong></p>, shown with {{field}} inside a <div>; give it a key no other field uses), image, link (one address), button (label + link), icon, toggle, color (a #hex value), select (needs options), and list — a repeating group with its own item fields (add as many rows as needed). The HTML uses {{field}} for a value, {{#list}}…{{/list}} to repeat per row ({{@number}} is the row number), {{#field}}…{{/field}} to show something only when filled in, {{button.label}}/{{button.href}} for buttons, and {{tone.heading}}/{{tone.body}}/{{tone.muted}}/{{tone.accent}}/{{tone.line}}/{{tone.card}} for colours that suit the section's background. Style with inline style attributes using the site's tokens (var(--semantic-space-md), var(--radius-xl), var(--font-size-lg), var(--font-family-heading)) — scripts and unsafe code are stripped. Starting content is filled in automatically unless you pass defaults ({fieldKey: value, listKey: [{...}]}).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Any page id of the site." },
        name: { type: "string", description: "What are you creating? e.g. 'Testimonials'." },
        description: { type: "string" },
        fields: {
          type: "array",
          description: "[{label, type, hint? (help shown under the box), placeholder? (example in the empty box), options?, item?: [{label, type}], itemName?, min?, limit?}]. The key is made from the label.",
          items: { type: "object" },
        },
        html: { type: "string", description: "The section's design, with {{placeholders}}." },
        defaults: { type: "object", description: "Optional starting content." },
      },
      required: ["templateId", "name", "fields", "html"],
    },
  },
  {
    name: "update_section_type",
    description:
      "Changes a reusable section's name, fields, design or starting content. The design is shared: every page already using it is redrawn with the new design (each page keeps its own content) and rebuilt — the reply says how many pages changed. Pass only what changes; fields/html are validated together.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Any page id of the site." },
        sectionTypeId: { type: "string", description: "From list_section_types." },
        name: { type: "string" },
        description: { type: "string" },
        fields: { type: "array", items: { type: "object" } },
        html: { type: "string" },
        defaults: { type: "object" },
      },
      required: ["templateId", "sectionTypeId"],
    },
  },
  {
    name: "add_custom_section",
    description:
      "Puts a reusable section on a page (saved as a draft, like page_edit; publish with page_publish). Pass content with a value for each field to fill it in — for a repeating group pass an array with one object per row (e.g. items: [{quote, name}, …]). Leave content out to start from the sample content, then change it with page_edit's updateSection. Use afterSectionId to place it below an existing section; otherwise it goes at the end.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The page to add it to." },
        sectionTypeId: { type: "string", description: "From list_section_types." },
        content: { type: "object", description: "{fieldKey: value, listKey: [{...}, {...}]}" },
        afterSectionId: { type: "string", description: "A section id from page_describe." },
      },
      required: ["templateId", "sectionTypeId"],
    },
  },
  {
    name: "list_section_entries",
    description:
      "Lists every place a reusable section is used across the site's pages: page, the section's id on that page (sectionId), the words that identify it (keyText), how many repeated rows it has, and when it last changed. Optionally filter to one section type and/or search the words. Use the pageId + sectionId with get_section_entry / update_section_entry.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Any page id of the site." },
        sectionTypeId: { type: "string", description: "Only this section type (from list_section_types)." },
        search: { type: "string", description: "Only entries whose words, page or section name contain this." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "get_section_entry",
    description: "Reads one use of a reusable section: its fields and the content in them right now (the page's working copy when it has one), including each repeated row by position.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Any page id of the site." },
        pageId: { type: "string", description: "The page the section is on (from list_section_entries)." },
        sectionId: { type: "string", description: "From list_section_entries." },
      },
      required: ["templateId", "pageId", "sectionId"],
    },
  },
  {
    name: "update_section_entry",
    description:
      "Changes the words in one use of a reusable section, without touching the rest of the page. It goes live right away (the page's own unpublished changes stay waiting). Pass `content` to set fields ({heading: 'New'} or one cell of a row: {'items.1.name': 'Ada'}), and/or row operations for a repeating group: addRows {field, rows:[{…}], at?}, removeRows {field, indexes:[…]}, moveRow {field, from, to}, duplicateRow {field, index}. Rows are counted from 0. Formatted-text fields take simple HTML (<p>, <strong>, <em>, <a href>, <ul>/<ol>/<li>); anything else is removed.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Any page id of the site." },
        pageId: { type: "string" },
        sectionId: { type: "string" },
        content: { type: "object", description: "{fieldKey: value} or {'list.0.field': value}" },
        addRows: { type: "object" },
        removeRows: { type: "object" },
        moveRow: { type: "object" },
        duplicateRow: { type: "object" },
      },
      required: ["templateId", "pageId", "sectionId"],
    },
  },
  {
    name: "remove_section_entries",
    description: "Takes reusable sections off their pages (live and working copy). Pass the pageId + sectionId pairs from list_section_entries. The section's design stays available to add again.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Any page id of the site." },
        items: { type: "array", items: { type: "object", properties: { pageId: { type: "string" }, sectionId: { type: "string" } }, required: ["pageId", "sectionId"] } },
      },
      required: ["templateId", "items"],
    },
  },
];

export const SECTION_TOOL_NAMES = new Set(SECTION_MCP_TOOLS.map((t) => t.name));

async function siteFor(resolved: ResolvedUser, templateId: unknown) {
  const id = typeof templateId === "string" ? templateId.trim() : "";
  if (!id) throw new Error("templateId is required — pass a page id of the site (see list_landing_pages).");
  const { data: template } = await Template.get({ id }).go();
  if (!template || template.organizationId !== resolved.organizationId) throw new Error(`No page found with id "${id}" in this account.`);
  return { template, siteId: await siteIdForTemplate(template) };
}

export async function handleSectionTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  const { siteId } = await siteFor(resolved, args?.templateId);

  if (toolName === "list_section_types") {
    const sectionTypes = await listSectionTypes(siteId, resolved.organizationId);
    return { sectionTypes, next: "Add one to a page with add_custom_section, or make a new one with create_section_type." };
  }

  if (toolName === "create_section_type") {
    const input = normalizeSectionTypeInput(args ?? {});
    if ("error" in input) throw new Error(input.error);
    const sectionType = await createSectionType(siteId, resolved.organizationId, input.value);
    return { sectionType, next: "It now shows under 'Yours' in the editor's Add section panel. Put it on a page with add_custom_section." };
  }

  if (toolName === "list_section_entries") {
    const types = await listSectionTypes(siteId, resolved.organizationId);
    const typeId = typeof args?.sectionTypeId === "string" ? args.sectionTypeId.trim() : "";
    const q = typeof args?.search === "string" ? args.search.trim().toLowerCase() : "";
    const names = new Map(types.map((t) => [t.id, t.name]));
    const entries = (await siteEntries(siteId, resolved.organizationId, types))
      .filter((e) => (!typeId || e.typeId === typeId) && (!q || `${e.keyText} ${e.pageTitle} ${names.get(e.typeId) ?? ""}`.toLowerCase().includes(q)))
      .map((e) => ({ ...e, sectionType: names.get(e.typeId) ?? "" }));
    return { entries, total: entries.length, next: entries.length ? "Read one with get_section_entry or change it with update_section_entry." : "None yet — add one to a page with add_custom_section." };
  }

  if (toolName === "get_section_entry" || toolName === "update_section_entry" || toolName === "remove_section_entries") {
    try {
      if (toolName === "remove_section_entries") {
        const items = Array.isArray(args?.items) ? args.items.filter((i: any) => typeof i?.pageId === "string" && typeof i?.sectionId === "string") : [];
        if (!items.length) throw new PageToolError("Pass items: [{pageId, sectionId}] from list_section_entries.");
        return { ...(await removeEntries(siteId, resolved.organizationId, items)), next: "Removed from the pages' live and working copies." };
      }
      const pageId = typeof args?.pageId === "string" ? args.pageId.trim() : "";
      const sectionId = typeof args?.sectionId === "string" ? args.sectionId.trim() : "";
      if (!pageId || !sectionId) throw new PageToolError("Pass pageId and sectionId (list_section_entries shows them).");
      await registerSiteSections(siteId, resolved.organizationId);
      const entry = await getEntry(siteId, resolved.organizationId, pageId, sectionId);
      if (toolName === "get_section_entry") {
        return { pageId, pageTitle: entry.pageTitle, sectionId, sectionType: entry.type.name, fields: entry.type.fields, content: entry.content, hasUnpublishedChanges: entry.draft };
      }
      const next = applyRowOps(entry.type.fields, entry.content, { content: args?.content, addRows: args?.addRows, removeRows: args?.removeRows, moveRow: args?.moveRow, duplicateRow: args?.duplicateRow } as RowOps);
      if ("error" in next) throw new PageToolError(next.error);
      const out = await updateEntry(siteId, resolved.organizationId, pageId, sectionId, next.value);
      return { ok: true, ...out, next: out.hasWaitingChanges ? "Saved and live. The page also has other unpublished changes — page_publish puts those live." : "Saved and live." };
    } catch (err) {
      if (err instanceof PageToolError) throw new Error(err.message);
      throw err;
    }
  }

  const typeId = typeof args?.sectionTypeId === "string" ? args.sectionTypeId.trim() : "";
  const existing = typeId ? await getSectionType(siteId, typeId) : null;
  if (!existing) throw new Error("No section found with that sectionTypeId. Call list_section_types to see the ids.");

  if (toolName === "update_section_type") {
    const input = normalizeSectionTypeInput(args ?? {}, existing);
    if ("error" in input) throw new Error(input.error);
    const sectionType = await updateSectionType(siteId, typeId, input.value);
    const pagesUpdated = await applySectionTypeToPages(siteId, [sectionType]);
    return { sectionType, pagesUpdated, next: pagesUpdated ? "Every page using it now shows the new design." : "No page uses it yet." };
  }

  // add_custom_section
  await registerSiteSections(siteId, resolved.organizationId);
  const content = args?.content && typeof args.content === "object" && !Array.isArray(args.content) ? args.content : undefined;
  const after = typeof args?.afterSectionId === "string" && args.afterSectionId.trim() ? { afterSectionId: args.afterSectionId.trim() } : {};
  return editPage(resolved, {
    templateId: args.templateId,
    commands: [{ op: "addSection", kind: customKindOf(typeId), ...(content ? { content } : {}), ...after }],
  });
}
