import { randomUUID } from "node:crypto";
import type { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { CustomContentEntry, CustomContentType, type CustomContentField } from "@/lib/db/customContentEntities";
import { validateEntryData } from "@/lib/customContent/fields";
import { CONTENT_PRESETS, ensureContentPreset, isContentPresetId } from "@/lib/customContent/presets";
import { contentSnippet, type ContentLayout } from "@/lib/customContent/embed";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Videos, stories, events and anything else a site owner (or their content team) posts and shows
// on a page. Same data the dashboard's Content Types page manages.

export const CONTENT_MCP_TOOLS = [
  {
    name: "setup_content",
    description:
      "Adds a ready-made kind of content to a site in one step — 'videos' (a gallery: title, description, video link, thumbnail), 'stories' (title, summary, full text, picture, video, who shared it) or 'events' (called Happenings: title, description, start date and time, location, picture, link). Safe to call again (it reuses what's there). Returns the exact snippet that shows it on a page — works in the visual builder (Content list block or an HTML block), raw HTML pages and React projects. The owner or their content team then adds items with add_content_entry or in the dashboard under Content Types.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page id (see list_landing_pages)." },
        preset: { type: "string", enum: ["videos", "stories", "events"] },
      },
      required: ["templateId", "preset"],
    },
  },
  {
    name: "list_content",
    description:
      "Lists the kinds of content a site has (with how many items each has). Pass type (its slug, e.g. 'videos') to also list that type's items with their ids, status and values.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page id." },
        type: { type: "string", description: "A content type's slug, e.g. 'videos', 'stories', 'happenings'." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "add_content_entry",
    description:
      "Posts one item (a video, story, event…) under a content type. `data` is keyed by the type's field keys: videos → title, description, video (YouTube/Vimeo/direct link), image; stories → title, description (summary), body, image, video, author; events → title, description, date ('YYYY-MM-DDTHH:mm'), location, image, link. Published by default so it shows on the site straight away; pass publish:false to save a draft.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page id." },
        type: { type: "string", description: "The content type's slug." },
        data: { type: "object", description: "Field values keyed by field key." },
        publish: { type: "boolean", description: "Default true." },
      },
      required: ["templateId", "type", "data"],
    },
  },
  {
    name: "get_content_embed_code",
    description:
      "The snippet that shows a content type on a page. Layouts: gallery (video cards that play in a pop-up), stories (cards that open the full story), events (upcoming events, past ones hide themselves), featured (one big item), list, posts (the latest blog posts as linked cards — use type 'blog'; they update themselves). Paste it into an HTML block in the visual builder, into a raw HTML page, or into a React project's markup; the visual builder (new editor) also has a Content list block that prints the same thing.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "The content type's slug." },
        layout: { type: "string", enum: ["gallery", "stories", "events", "featured", "list", "posts"] },
        limit: { type: "number" },
        columns: { type: "number", description: "1–4, for gallery and stories." },
      },
      required: ["type"],
    },
  },
];

export const CONTENT_TOOL_NAMES = new Set(CONTENT_MCP_TOOLS.map((t) => t.name));

async function resolveSite(resolved: ResolvedUser, templateId: unknown): Promise<string> {
  const id = typeof templateId === "string" ? templateId.trim() : "";
  if (!id) throw new Error("templateId is required — pass the site's home page id (see list_landing_pages).");
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new Error(`No site found with id "${id}" in this account. Use a site's home page id from list_landing_pages.`);
  }
  return site.id;
}

async function findType(templateId: string, slug: unknown) {
  const s = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  const { data: types } = await CustomContentType.query.primary({ templateId }).go({ pages: "all" });
  const found = types.find((t) => t.slug === s);
  if (!found) {
    const have = types.map((t) => t.slug).join(", ") || "none yet";
    throw new Error(`This site has no content type "${slug}" (it has: ${have}). Add one with setup_content.`);
  }
  return found;
}

const SHOW_NEXT = "Paste this where it should appear (an HTML block, a raw HTML page, or a React project). In the new visual editor the Content list block does the same.";

export async function handleContentTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  if (toolName === "get_content_embed_code") {
    const slug = String(args?.type ?? "").trim().toLowerCase();
    if (!slug) throw new Error("type is required — a content type's slug, e.g. 'videos'.");
    return {
      snippet: contentSnippet(slug, { layout: args?.layout as ContentLayout | undefined, limit: Number(args?.limit) || undefined, columns: Number(args?.columns) || undefined }),
      next: SHOW_NEXT,
    };
  }

  const templateId = await resolveSite(resolved, args?.templateId);

  if (toolName === "setup_content") {
    if (!isContentPresetId(args?.preset)) throw new Error(`preset must be one of: ${Object.keys(CONTENT_PRESETS).join(", ")}.`);
    const { contentType, created } = await ensureContentPreset({ templateId, organizationId: resolved.organizationId, preset: args.preset });
    return {
      contentType: { id: contentType.id, name: contentType.name, slug: contentType.slug, fields: contentType.fields },
      created,
      snippet: contentSnippet(contentType.slug),
      next: `${created ? "Added." : "Already set up."} Add items with add_content_entry (or the owner can in the dashboard under Content Types). ${SHOW_NEXT}`,
    };
  }

  if (toolName === "list_content") {
    const { data: types } = await CustomContentType.query.primary({ templateId }).go({ pages: "all" });
    const counts = await Promise.all(types.map((t) => CustomContentEntry.query.primary({ contentTypeId: t.id }).go({ pages: "all" })));
    const out: any = {
      contentTypes: types.map((t, i) => ({ name: t.name, slug: t.slug, fields: t.fields, items: counts[i].data.length })),
    };
    if (typeof args?.type === "string" && args.type.trim()) {
      const type = await findType(templateId, args.type);
      const { data: entries } = await CustomContentEntry.query.primary({ contentTypeId: type.id }).go({ pages: "all" });
      out.entries = entries
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .map((e) => ({ id: e.id, status: e.status, createdAt: e.createdAt, data: e.data }));
    }
    if (types.length === 0) out.next = "Nothing yet. Use setup_content with 'videos', 'stories' or 'events' to start.";
    return out;
  }

  // add_content_entry
  const type = await findType(templateId, args?.type);
  const fields = (Array.isArray(type.fields) ? type.fields : []) as CustomContentField[];
  const validated = validateEntryData(fields, args?.data ?? {});
  if ("error" in validated) throw new Error(validated.error);
  const status = args?.publish === false ? "DRAFT" : "PUBLISHED";
  const id = randomUUID();
  await CustomContentEntry.create({ id, templateId, contentTypeId: type.id, organizationId: resolved.organizationId, data: validated.data, status }).go();
  return {
    entry: { id, status, data: validated.data },
    next: status === "PUBLISHED" ? "It shows on the site within about a minute, wherever this content is displayed." : "Saved as a draft; publish it from the dashboard to show it.",
  };
}
