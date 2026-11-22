import type { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { convertToCode, previewConvert, restoreBlocks } from "@/lib/editorModes/convertService";
import { sourceChoices } from "@/lib/editorModes/convertToCode";
import type { ConvertSource } from "@/lib/editorModes/convertPage";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// "Turn this page into code" and "go back to blocks": parity with the dashboard's Design | Code | Text modes.

const templateId = { type: "string", description: "The page's id (see list_landing_pages / get_landing_page_pages / find_page)." };

export const CONVERT_MCP_TOOLS = [
  {
    name: "convert_page_to_code",
    description:
      "Turns ONE block-built page into a page of editable HTML code, so the owner gets the Design, Code and Text views for it. The page looks exactly the same; if Plexo can't be sure of that it refuses and changes nothing. Emails, shared layouts (header, footer, blog, shop) and apps can't be converted. Always call it with preview true first and tell the owner, in plain words, what comes along (notes.copied) and what to know (notes.heads): the site's header and footer are COPIED into the page, so later edits to the site header or footer do not reach this page; code pages have no separate draft, so saves go live straight away. A backup of the block version is kept, so restore_page_blocks can go back (code changes made since are lost). If the page has unpublished changes and is live, ask the owner which version to keep and pass source: \"working\" (their latest) or \"live\" (what visitors see now).",
    inputSchema: {
      type: "object",
      properties: {
        templateId,
        preview: { type: "boolean", description: "True changes nothing: returns what would come along and what to tell the owner first." },
        source: { type: "string", enum: ["working", "live"], description: "Which version becomes the code when the page has unpublished changes and is live. Default working." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "restore_page_blocks",
    description:
      "Goes back to blocks for a page that was turned into code with convert_page_to_code: restores the block design saved at that moment (including any unpublished changes it had) and makes it a block page again. Any changes made to the code since are NOT kept: tell the owner and confirm before calling. The page is rebuilt with the site's current header and footer.",
    inputSchema: { type: "object", properties: { templateId }, required: ["templateId"] },
  },
];

export const CONVERT_TOOL_NAMES = new Set(CONVERT_MCP_TOOLS.map((t) => t.name));

export async function handleConvertTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  const id = typeof args?.templateId === "string" ? args.templateId.trim() : "";
  if (!id) throw new Error("templateId is required — pass the page's id (see list_landing_pages).");
  const { data: page } = await Template.get({ id }).go();
  if (!page || page.organizationId !== resolved.organizationId) throw new Error(`No page found with id "${id}" in this account. Use a page id from list_landing_pages.`);

  if (toolName === "restore_page_blocks") {
    const done = await restoreBlocks(page);
    if (!done.ok) throw new Error(done.error);
    return { restored: true, next: "Tell the owner the page is a block page again, as it was before it became code, rebuilt with the site's current header and footer. Any changes made to the code since are gone." };
  }

  const source: ConvertSource = args?.source === "live" ? "live" : "working";
  const preview = await previewConvert(page, source);
  if (!preview.ok) throw new Error(preview.error);
  const { notes, hasUnpublishedChanges, isLive } = preview.value;
  const choice = sourceChoices({ hasUnpublishedChanges, isLive });

  if (args?.preview === true) {
    return {
      preview: true,
      copied: notes.copied,
      heads: notes.heads,
      ...(choice.ask ? { chooseVersion: choice.options } : {}),
      codeLength: preview.value.html.length,
      next: "Explain in simple words what comes along (copied) and what to know (heads), including that the header and footer are copied so later header or footer edits won't reach this page. " +
        (choice.ask ? "The page has changes that aren't published: ask which version to keep (chooseVersion). " : "") +
        "Then ask if they want to go ahead, and call convert_page_to_code again without preview. They can undo it with restore_page_blocks.",
    };
  }

  if (choice.ask && args?.source !== "working" && args?.source !== "live") {
    throw new Error("This page has changes that aren't published yet, and code pages have no draft. Ask the owner which version to keep, then call again with source \"working\" (their latest changes, which go live straight away) or \"live\" (what visitors see now; their newer changes stay in the backup).");
  }
  const done = await convertToCode(page, source, { userId: resolved.userId });
  if (!done.ok) throw new Error(done.error);
  return {
    converted: true,
    usedWorkingCopy: done.value.usedWorkingCopy,
    heads: done.value.notes.heads,
    next: "Tell the owner the page is now code and looks the same; they can use Design, Code and Text views. " + (done.value.notes.heads.length ? "Say: " + done.value.notes.heads.join(" ") + " " : "") + "They can go back with restore_page_blocks.",
  };
}
