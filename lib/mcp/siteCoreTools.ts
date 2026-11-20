import { createDefaultDesignSystem, describeDesign } from "@charisol/plexo-sdk/v2/compile";

import type { resolveUser } from "@/lib/auth/resolveUser";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { getStorefrontPath } from "@/lib/commerce/storefrontLayout";
import { readCustomCode, saveCustomCode } from "@/lib/customCode/store";
import { MAX_CUSTOM_CODE_CHARS } from "@/lib/customCode/sanitize";
import { compileTemplateWithSiteLayout, onTemplateSaved, recompileSiteLayoutDependents } from "@/lib/siteLayoutCore";
import { ensureSiteLayout } from "@/lib/siteLayoutProvision";
import { adoptLook, ensureBlankSiteLayout, fragmentIsBlank, pagesWithOwnChrome, removeOwnChrome, siteKindForLayout, unsupportedLayoutMessage } from "@/lib/siteLayoutBlank";
import { buildSiteFooterV2, buildSiteHeaderV2 } from "@/lib/v2/layoutDesigns";
import { parseV2Design } from "@/lib/v2/design";
import { resolveDesignSystem } from "@/lib/v2/designSystemStore";
import { siteInfo } from "@/lib/v2/siteFormat";
import { PageToolError, MAX_COMMANDS, editableUrlFor, formatLabel, loadOwnedRow, saveEdit } from "./v2Pages";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// "Site core": the header and footer every page of a site shares, plus the owner's own header/footer code.
// New visual sites get a header and footer automatically (page_create_from_template, site_create), so pages
// carry NO header or footer of their own: edit the shared ones here, once, and every page changes.

const siteId = { type: "string", description: "The site's home page id (list_landing_pages shows it)." };
const kindProp = { type: "string", enum: ["header", "footer"] };

export const SITE_CORE_MCP_TOOLS = [
  {
    name: "site_layout_describe",
    title: "Describe Site Header and Footer",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Shows a visual site's shared header and footer (its \"site core\"): whether they're switched on, and the sections of each (the header's menu links, the footer's columns). Every page of the site shows them unless that page hides them (page_chrome_set). Look here BEFORE adding a menu or footer to a page — pages must not carry their own, they would be duplicated. An older site starts with a BLANK header/footer (blank:true: nothing shows, its pages keep their own menu) — then adding a menu to a page is fine, or adopt the shared one with site_layout_edit {kind, reset:true}. Hand-written (HTML) sites and code apps have no shared header/footer; the reply says so. Use it before site_layout_edit.",
    inputSchema: { type: "object", properties: { siteId }, required: ["siteId"] },
  },
  {
    name: "site_layout_edit",
    title: "Edit Site Header and Footer",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description:
      "Changes the site's shared header or footer, once, for every page — the menu links, logo/brand name, button, footer columns, social links, copyright. Uses the same section commands as page_edit (updateSection with content such as {links:[{label,href}]} for the header; call site_layout_describe for the section ids and fields). Live immediately. On an older site whose header/footer is still blank, kind + reset:true (or any commands) adds one built from the site's own existing menu; pass removeOldChrome:true afterwards to take each page's old inline header/footer off so it doesn't show twice (the reply lists pages that still have one). " +
      "reset:true on a header/footer that is already designed replaces it with a fresh default (the site's name, a Home link) — ask the owner first, it discards their design. enabled:false switches the shared header and footer off for the whole site (pages then show none unless they carry their own); enabled:true switches them back on. Only for sites built in the visual editor.",
    inputSchema: {
      type: "object",
      properties: {
        siteId,
        kind: { ...kindProp, description: "Which part to change. Not needed with enabled alone." },
        commands: { type: "array", maxItems: MAX_COMMANDS, items: { type: "object", properties: { op: { type: "string" } }, required: ["op"], additionalProperties: true }, description: "page_edit-style commands applied to the header or footer." },
        reset: { type: "boolean", description: "Blank header/footer: add one built from the site's menu. Already designed: replace with a fresh default (ask the owner first)." },
        removeOldChrome: { type: "boolean", description: "After the shared header/footer is in place, remove each page's own copy so it isn't shown twice." },
        enabled: { type: "boolean", description: "Switch the site's shared header and footer on or off." },
      },
      required: ["siteId"],
    },
  },
  {
    name: "page_chrome_set",
    title: "Show or Hide Header and Footer on a Page",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Shows or hides the site's shared header and/or footer on ONE page (both are shown by default) — the \"Show header\" / \"Show footer\" switches in the editor's Page settings. Use showHeader:false for a landing page or checkout that should have no menu. Live immediately. With no showHeader/showFooter it just reports the current state.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The page's id." },
        showHeader: { type: "boolean" },
        showFooter: { type: "boolean" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "site_code_get",
    title: "Get Header and Footer Code",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Shows the code the owner pasted for every page's header (inside <head>) and footer (end of <body>) — site verification tags, analytics and ad pixels — and whether they can add code right now. `blocked` says in plain words what's missing (the Starter plan or above, or a connected custom domain); `domain` is where it runs; `onCheckout` says whether it also runs on cart/checkout pages; `headSnippets`/`footerSnippets` name what is saved (e.g. 'Google Search Console site verification').",
    inputSchema: { type: "object", properties: { siteId }, required: ["siteId"] },
  },
  {
    name: "site_code_set",
    title: "Set Header and Footer Code",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    description:
      "Saves the owner's own code for every page's header and/or footer, e.g. a Google verification <meta>, a Google Analytics or Meta pixel <script>. Pass the snippet exactly as the service gave it; send only what changes and \"\" to clear one. " +
      `Rules, checked on the server exactly as in the dashboard: only <script>, <meta>, <link>, <noscript> and <style> tags (plus <img>/<iframe> inside <noscript>), at most ${MAX_CUSTOM_CODE_CHARS.toLocaleString("en-US")} characters, script src must be a full https:// address. Anything else is rejected with a plain reason — fix the snippet and retry. ` +
      "It only runs on the live site at the owner's OWN domain, and only on the Starter plan and above: on Free, or without a connected custom domain, the reply says what to do (upgrade, or connect a domain) — pass that on and don't retry. It runs once per page (header code at the end of <head>, footer code at the end of <body>), never inside an embedded frame and, unless onCheckout is true, never on cart/checkout/order/donation pages. Only add code the owner asked for from a source they trust; never invent snippets or ids.",
    inputSchema: {
      type: "object",
      properties: {
        siteId,
        head: { type: "string", description: "Code for the header (top of every page). \"\" clears it." },
        footer: { type: "string", description: "Code for the footer (end of every page). \"\" clears it." },
        onCheckout: { type: "boolean", description: "Also run on cart, checkout and order pages (off by default; only if the owner asks, since those pages take payment details)." },
      },
      required: ["siteId"],
    },
  },
];

export const SITE_CORE_TOOL_NAMES = new Set(SITE_CORE_MCP_TOOLS.map((t) => t.name));

async function loadSite(resolved: ResolvedUser, id: unknown) {
  const site = await loadOwnedRow(resolved, id);
  if (site.parentId) throw new PageToolError(`"${site.name}" is a page inside a site. Pass the site's home page id (list_landing_pages shows them).`);
  return site;
}

function requireVisualSite(site: { name: string } & Parameters<typeof formatLabel>[0]) {
  const own = unsupportedLayoutMessage(siteKindForLayout(site as { sourceType?: string | null; designFormat?: string | null }));
  if (own) throw new PageToolError(`"${site.name}": ${own}`);
  if (formatLabel(site) !== "v2") {
    throw new PageToolError(`"${site.name}" was built in the classic editor. Its shared header and footer (blank until the owner designs them) are designed in the classic editor, not with this tool. A site made with page_create_from_template has a ready-made header and footer.`);
  }
}

async function describeFragment(id: string | null | undefined) {
  if (!id) return null;
  const { data: row } = await Template.get({ id }).go();
  if (!row) return null;
  const parsed = parseV2Design(await resolveDesignSystem(row.designJson));
  return {
    templateId: row.id,
    editableUrl: editableUrlFor(row.id),
    sections: parsed.ok ? (describeDesign(parsed.design.pages, parsed.design.designSystem ?? createDefaultDesignSystem()).pages[0]?.sections ?? []) : [],
  };
}

async function describeSiteLayout(resolved: ResolvedUser, args: { siteId?: unknown }) {
  const site = await loadSite(resolved, args.siteId);
  requireVisualSite(site);
  await ensureBlankSiteLayout(site.id, resolved.userId); // older sites get their blank header/footer on first look
  const { data: layout } = await SiteLayout.get({ templateId: site.id }).go();
  if (!layout?.headerTemplateId && !layout?.footerTemplateId) {
    return { siteId: site.id, enabled: false, header: null, footer: null, message: "This site has no shared header or footer (the owner removed them). site_layout_edit with kind and reset:true adds one." };
  }
  const [header, footer, headerBlank, footerBlank, ownHeader, ownFooter] = await Promise.all([
    describeFragment(layout.headerTemplateId),
    describeFragment(layout.footerTemplateId),
    fragmentIsBlank(layout.headerTemplateId),
    fragmentIsBlank(layout.footerTemplateId),
    pagesWithOwnChrome(site.id, "header"),
    pagesWithOwnChrome(site.id, "footer"),
  ]);
  const notes: string[] = [];
  if (headerBlank) notes.push("The shared header is blank (nothing shows): pages keep their own menu. site_layout_edit {kind:\"header\", reset:true} adds one built from the site's menu.");
  if (footerBlank) notes.push("The shared footer is blank (nothing shows): pages keep their own footer. site_layout_edit {kind:\"footer\", reset:true} adds one.");
  if (!headerBlank && ownHeader.length) notes.push(`${ownHeader.length} page(s) still carry their own header too (${ownHeader.slice(0, 5).map((p) => p.name).join(", ")}); site_layout_edit {kind:"header", removeOldChrome:true} removes them so it doesn't show twice.`);
  if (!footerBlank && ownFooter.length) notes.push(`${ownFooter.length} page(s) still carry their own footer too; site_layout_edit {kind:"footer", removeOldChrome:true} removes them.`);
  return { siteId: site.id, enabled: !!layout.enabled, header: header && { ...header, blank: headerBlank, pagesWithOwnHeader: ownHeader }, footer: footer && { ...footer, blank: footerBlank, pagesWithOwnFooter: ownFooter }, ...(notes.length ? { message: notes.join(" ") } : {}) };
}

async function editSiteLayout(resolved: ResolvedUser, args: { siteId?: unknown; kind?: unknown; commands?: unknown; reset?: unknown; enabled?: unknown; removeOldChrome?: unknown }) {
  const site = await loadSite(resolved, args.siteId);
  requireVisualSite(site);
  const kind = args.kind === "header" || args.kind === "footer" ? args.kind : null;
  const commands = Array.isArray(args.commands) ? args.commands : [];
  if (args.kind !== undefined && !kind) throw new PageToolError('kind must be "header" or "footer".');
  if (commands.length && !kind) throw new PageToolError('Say which part to change: kind "header" or "footer".');
  if (commands.length > MAX_COMMANDS) throw new PageToolError(`Make at most ${MAX_COMMANDS} changes per call — split them into a few calls.`);
  if (args.enabled === undefined && !kind) throw new PageToolError("Nothing to do: pass kind with commands or reset, or enabled.");

  if (args.enabled === false) {
    const { data: existing } = await SiteLayout.get({ templateId: site.id }).go();
    if (existing) await SiteLayout.patch({ templateId: site.id }).set({ enabled: false }).go();
    await recompileSiteLayoutDependents(site.id);
    return { success: true, siteId: site.id, enabled: false, next: "The shared header and footer are off for the whole site. site_layout_edit with enabled:true brings them back." };
  }

  await ensureBlankSiteLayout(site.id, resolved.userId);
  // enabled:true alone adds both defaults; naming a part touches only that part (a blank one is built from the site's menu below).
  const ensured = await ensureSiteLayout(site.id, resolved.organizationId, resolved.userId, { turnOn: true, ...(kind ? { fill: [] } : {}) });
  if (!ensured) throw new PageToolError(`"${site.name}" can't have a shared header and footer.`);
  const result: Record<string, unknown> = { success: true, siteId: site.id, enabled: true };

  if (kind) {
    const fragmentId = kind === "header" ? ensured.headerTemplateId : ensured.footerTemplateId;
    const wasBlank = await fragmentIsBlank(fragmentId);
    if (wasBlank && (args.reset === true || commands.length)) {
      const adopted = await adoptLook(site.id, kind, kind === "header" ? "classic" : "simple", resolved.userId);
      if (!adopted.ok) throw new PageToolError(adopted.error);
      result.added = `A ${kind} built from the site's own menu is now on every page.`;
      result.reset = args.reset === true;
    } else if (args.reset === true) {
      const info = await siteInfo(site.id);
      const shopPath = await getStorefrontPath(site.id);
      await Template.patch({ id: fragmentId }).set({ designJson: kind === "header" ? buildSiteHeaderV2(info.name, shopPath) : buildSiteFooterV2(info.name, shopPath) }).go();
      await onTemplateSaved(fragmentId);
      result.reset = true;
    }
    if (commands.length) {
      const { data: row } = await Template.get({ id: fragmentId }).go();
      if (!row) throw new PageToolError("I couldn't open the shared header/footer. Try again.");
      const saved = await saveEdit(row, commands, { live: true });
      if (saved.saved) await onTemplateSaved(fragmentId);
      Object.assign(result, { saved: saved.saved, results: saved.results, ...("sections" in saved ? { sections: saved.sections } : {}) });
      if (!saved.saved) result.success = false;
    }
    result.kind = kind;
    result.editableUrl = editableUrlFor(fragmentId);
    if (args.removeOldChrome === true) {
      try {
        result.removedOldChromeFromPages = await removeOwnChrome(site.id, kind);
      } catch (err) {
        throw new PageToolError(err instanceof Error ? err.message : "Couldn't remove the old ones.");
      }
    } else {
      const own = await pagesWithOwnChrome(site.id, kind);
      if (own.length) result.pagesStillWithOwn = { count: own.length, names: own.slice(0, 8).map((p) => p.name), hint: `They would show two ${kind}s. Pass removeOldChrome:true to take their own off (ask the owner first).` };
    }
  }
  result.next = "Live on every page that shows it. page_chrome_set hides the header or footer on a single page.";
  return result;
}

async function setPageChrome(resolved: ResolvedUser, args: { templateId?: unknown; showHeader?: unknown; showFooter?: unknown }) {
  const row = await loadOwnedRow(resolved, args.templateId);
  if (row.isSiteLayoutFragment) throw new PageToolError("That is the shared header or footer itself, not a page. Change it with site_layout_edit.");
  if (row.sourceType === "RAW_UPLOAD") throw new PageToolError(`"${row.name}" is a hand-written page, so the site's shared header and footer don't apply to it. Edit the page's own HTML instead.`);
  const set: { hideHeader?: boolean; hideFooter?: boolean } = {};
  if (typeof args.showHeader === "boolean") set.hideHeader = !args.showHeader;
  if (typeof args.showFooter === "boolean") set.hideFooter = !args.showFooter;
  if (Object.keys(set).length) {
    const next = { ...row, ...set };
    const compiledHtml = await compileTemplateWithSiteLayout(next, row.designJson);
    const draft = row.draftJson ? { draftHtml: await compileTemplateWithSiteLayout(next, row.draftJson) } : {};
    await Template.patch({ id: row.id }).set({ ...set, compiledHtml, ...draft }).go();
  }
  return {
    success: true,
    templateId: row.id,
    showHeader: !(set.hideHeader ?? row.hideHeader),
    showFooter: !(set.hideFooter ?? row.hideFooter),
    next: "Live now (publish isn't needed for this switch).",
  };
}

async function getSiteCode(resolved: ResolvedUser, args: { siteId?: unknown }) {
  const site = await loadSite(resolved, args.siteId);
  return { siteId: site.id, ...(await readCustomCode(resolved.organizationId, site.id)) };
}

async function setSiteCode(resolved: ResolvedUser, args: { siteId?: unknown; head?: unknown; footer?: unknown; onCheckout?: unknown }) {
  const site = await loadSite(resolved, args.siteId);
  const result = await saveCustomCode({ organizationId: resolved.organizationId, templateId: site.id, userId: resolved.userId, head: args.head, footer: args.footer, onCheckout: args.onCheckout });
  if (!result.ok) throw new PageToolError(result.error);
  return { success: true, siteId: site.id, ...result.state, next: `Saved. It runs on every page of ${result.state.domain ?? "the owner's own domain"} within about a minute${result.state.onCheckout ? "" : " (except cart, checkout and order pages)"}; it never runs in the editor.` };
}

export async function handleSiteCoreTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  try {
    switch (toolName) {
      case "site_layout_describe":
        return await describeSiteLayout(resolved, args ?? {});
      case "site_layout_edit":
        return await editSiteLayout(resolved, args ?? {});
      case "page_chrome_set":
        return await setPageChrome(resolved, args ?? {});
      case "site_code_get":
        return await getSiteCode(resolved, args ?? {});
      case "site_code_set":
        return await setSiteCode(resolved, args ?? {});
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (err) {
    if (err instanceof PageToolError) throw new Error(err.message);
    throw err;
  }
}
