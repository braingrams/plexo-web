import { tryResolveSiteBrand, siteIdOfPage } from "@/lib/brand/resolveSiteBrand";
import { voicePromptBlock } from "@/lib/brand/brandVoice";

/**
 * The brand's words as a prompt block for one AI writing request: which site it is for comes from the request (`siteId`, or
 * `context.siteId`), is checked against the caller's workspace, and the words come from the same resolver every other surface uses.
 * Never throws and never blocks a generation: no site, no words, or any error means "".
 */
export async function brandVoiceBlockFor(input: { siteId?: unknown; context?: unknown }, organizationId: string, userId?: string): Promise<string> {
  const fromContext = input.context && typeof input.context === "object" ? (input.context as { siteId?: unknown }).siteId : undefined;
  const raw = typeof input.siteId === "string" && input.siteId ? input.siteId : typeof fromContext === "string" ? fromContext : "";
  if (raw.length > 128) return "";
  try {
    // No site named (an email, a page being edited, a new site): an account with exactly one site writes in that site's voice.
    const siteId = raw ? await siteIdOfPage(raw) : await onlySiteOf(organizationId);
    if (!siteId) return "";
    const brand = await tryResolveSiteBrand({ siteId, organizationId, userId });
    return voicePromptBlock(brand?.words);
  } catch {
    return "";
  }
}

/** The account's one site, or null when it has none or several (then nobody should guess). */
export async function onlySiteOf(organizationId: string): Promise<string | null> {
  const { Template } = await import("@/lib/db/contentEntities");
  const { data } = await Template.query.byOrg({ organizationId }).go({ pages: "all", attributes: ["id", "kind", "parentId", "isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign"] });
  const sites = data.filter((t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign);
  return sites.length === 1 ? sites[0].id : null;
}
