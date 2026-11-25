/**
 * The two ways a site is made from the owner's answers, shared by onboarding (/api/onboarding/complete) and the
 * dashboard's "Make a new website" (/api/dashboard/new-site) so there is one implementation of each:
 *  - from the site kit (site_create), and
 *  - from a real marketplace design (the marketplace's own "use" path, which re-checks it is free or owned and
 *    enforces the plan's limits; never trusted from the browser).
 * Either way the owner's logo and colours are saved on the new site's Brand tab, and that brand is the ONE place they come from:
 * applyOwnerLook puts them into the site's design with the Brand page's own mechanism, so changing them there later recolours the site.
 */
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import type { resolveUser } from "@/lib/auth/resolveUser";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { lookOutcomeMessage, normalizeHex, readSiteBrand, siteBrandFromLook, siteBrandFromProfile, type LookApplied } from "@/lib/dashboardV3/brandLook";
import { applySiteLogo, applySiteLook } from "@/lib/sites/applyLook";
import { handleSiteTool } from "@/lib/mcp/siteTools";
import { useMarketplaceTemplate } from "@/lib/marketplaceUse";
import { designFormatOf, parseV2Design } from "@/lib/v2/design";
import { dominantAccent } from "./brandPreview";
import type { DesignEdits } from "./designEdit";
import { syncDesignData, syncDesigns, type SyncDoc } from "./designTextSync";

type Resolved = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

async function saveBrandOnSite(siteId: string, brand: SolBuildProfile["brand"] | undefined): Promise<void> {
  const own = siteBrandFromProfile(brand);
  if (own) await Template.patch({ id: siteId }).set({ brand: own }).go().catch((e) => console.error("copying brand onto the new site failed", e));
}

export async function makeSiteFromKit(resolved: Resolved, args: Record<string, unknown>, brand: SolBuildProfile["brand"] | undefined): Promise<{ siteId: string; name: string; warnings?: string[] }> {
  const made = await handleSiteTool("site_create", args, resolved);
  await saveBrandOnSite(made.siteId, brand);
  return { siteId: made.siteId, name: made.name, warnings: made.warnings };
}

/**
 * `applyLook: false` is for a caller that applies the brand itself afterwards (the new-site flow does, once the site is made).
 *
 * `design` (a new-editor design): the new site starts from the marketplace design EDITED with the owner's name and description, and SOL's
 * words and choices when it personalized it (lib/onboarding/designEdit.ts), so the site's design data holds them from its first moment and
 * the one recompile at creation builds the page from them. The source is always the listing itself, read inside useMarketplaceTemplate
 * after its free/owned/plan checks. `designApplied` is false for a design that is not a new-editor one (the caller then falls back to the
 * page-text path, applyApprovedHtml). The colours and logo are NOT written here: they come from the site's Brand tab via applyOwnerLook.
 */
export async function makeSiteFromMarketDesign(resolved: Resolved, designId: string, name: string, brand: SolBuildProfile["brand"] | undefined, opts: { applyLook?: boolean; design?: Omit<DesignEdits, "name"> } = {}): Promise<{ siteId: string; name: string; warnings?: string[]; designApplied?: boolean }> {
  const notes: string[] = [];
  const made = await useMarketplaceTemplate(resolved, designId, {
    name,
    ...(opts.design
      ? {
          deriveDesign: async (listing: { id: string; name: string; designJson: unknown }) => {
            const { editDesign } = await import("./designEdit");
            const edited = await editDesign(listing.designJson, { ...opts.design, name, designName: opts.design?.designName ?? listing.name }, { look: false });
            notes.push(...edited.warnings);
            return edited.design;
          },
        }
      : {}),
  });
  // The owner's logo and colours go on the Brand tab, then from the brand into the design (a marketplace design carries its maker's colours).
  await saveBrandOnSite(made.id, brand);
  const designApplied = made.designApplied === true;
  if (opts.applyLook === false) return { siteId: made.id, name: made.name, ...(notes.length ? { warnings: notes } : {}), ...(opts.design ? { designApplied } : {}) };
  const look = await applyOwnerLook(made.id, resolved, {});
  return { siteId: made.id, name: made.name, ...(notes.length || look.problems.length ? { warnings: [...notes, ...look.problems] } : {}), ...(opts.design ? { designApplied } : {}) };
}

/**
 * Marks a site SOL personalized (and, when the owner gave SOL their contact details, that too) in the page HTML the dashboard reads for its
 * checklist ("Review and edit your pages", "Add your contact details"). Never throws.
 */
export async function markSolPersonalized(siteId: string, opts: { contact?: boolean } = {}): Promise<void> {
  try {
    const { data: row } = await Template.get({ id: siteId }).go();
    if (!row) return;
    const marks = `data-sol-personalized="true"${opts.contact ? ' data-sol-contact="true"' : ""}`;
    const stamp = (html: unknown): string | undefined => {
      if (typeof html !== "string" || !html) return undefined;
      if (/<body/i.test(html)) return html.replace(/<body([^>]*)>/i, (m, attrs: string) => (attrs.includes("data-sol-personalized") ? m : `<body${attrs} ${marks}>`));
      return html.includes("data-sol-personalized") ? html : `<div ${marks}>${html}</div>`;
    };
    const compiledHtml = stamp(row.compiledHtml);
    const draftHtml = stamp(row.draftHtml);
    // Saved on the row too: the editor's first recompile drops the HTML markers, and the checklist must stay ticked.
    const now = new Date().toISOString();
    await Template.patch({ id: siteId })
      .set({
        solPersonalizedAt: row.solPersonalizedAt || now,
        ...(opts.contact ? { solContactGivenAt: row.solContactGivenAt || now } : {}),
        ...(compiledHtml ? { compiledHtml } : {}),
        ...(draftHtml ? { draftHtml } : {}),
      })
      .go();
  } catch (e) {
    console.error(`new site ${siteId}: marking it as personalized by SOL failed`, e);
  }
}

/**
 * Puts the site's brand (its colours and logo, saved on its Brand tab) into its design, the way the Brand page does when the owner presses
 * Save: the "setBrand" change on every page and on the shared header and footer, and the logo into the header. This is what makes the brand
 * the one place a site's colours come from. It works for every design, including one whose brand is too big to sit inside the page and is
 * kept in storage: the change loads it, recolours it and stores the recoloured copy for this site only (the stored original, which other
 * sites share, is never changed). `brandColor`, when given, is first saved as the site's main colour so the Brand page shows what the site
 * uses. Never throws; a problem comes back in plain words.
 */
export async function applyOwnerLook(siteId: string, who: { userId: string; organizationId: string }, opts: { brandColor?: string }): Promise<{ applied: LookApplied | null; problems: string[] }> {
  const problems: string[] = [];
  const noPlace = "Your logo is saved, but this design has no place for it in the header yet. SOL can add it for you.";
  try {
    const { data: site } = await Template.get({ id: siteId }).go();
    const own = readSiteBrand(site?.brand);
    const main = opts.brandColor ? normalizeHex(opts.brandColor) : null;
    const colors = main ? [main, ...(own?.colors ?? []).filter((c) => c !== main)].slice(0, 6) : own?.colors;
    if (main && main !== own?.colors?.[0]) {
      await Template.patch({ id: siteId }).set({ brand: siteBrandFromLook({ colors: colors ?? [main], logoUrl: own?.logoUrl ?? null, logoSkipped: own?.noLogo === true }, own) }).go();
    }
    if (!colors?.length) {
      // Only a logo: it goes in the header.
      if (own?.logoUrl) {
        const placed = await applySiteLogo({ organizationId: who.organizationId, siteId, logoUrl: own.logoUrl });
        if (!placed.placed) problems.push(noPlace);
      }
      return { applied: null, problems };
    }
    const { data: user } = await User.get({ id: who.userId }).go({ attributes: ["name"] });
    const look = { colors, logoUrl: own?.logoUrl ?? null, logoSkipped: own?.noLogo === true };
    const applied = await applySiteLook({ organizationId: who.organizationId, userId: who.userId, userName: user?.name ?? "Plexo User", siteId, look, hadLogo: false });
    if (applied.updated === 0) problems.push("Your colours are saved on the Brand page, but this design can't be recoloured automatically. Ask SOL to restyle it with them.");
    else if (own?.logoUrl && !applied.logoPlaced && lookOutcomeMessage(applied, true).askSol) problems.push(noPlace);
    return { applied, problems };
  } catch (e) {
    console.error(`new site ${siteId}: applying the owner's colours and logo failed`, e);
    return { applied: null, problems: ["We couldn't apply your colours to the design just now. Open the Brand page and press Save to apply them."] };
  }
}

export type ApprovedHtmlResult = {
  /** True when the approved HTML was saved on the site. */
  saved: boolean;
  /** What happened to the design data of a page built in the visual editor ("not-applicable" for classic pages). */
  designData: "synced" | "not-applicable" | "skipped" | "failed";
  /** Plain-words notes about anything that could not be carried over (empty when all of it was). */
  problems: string[];
  /** The changed pieces of text that were not found in the design data (what the owner is told to check). */
  unmatched?: Array<{ from: string; to: string }>;
};

/**
 * Makes the new site exactly what the owner saw in the preview: saves the approved HTML (their name, words and colour) on the site
 * and, for a page built in the visual editor, makes the same changes in its design data (the page, and the site's shared header and
 * footer, where the business name and menu live), because the editor and every later recompile read that data and would otherwise
 * bring the template's sample name and copy back. With `look` (a site made from a marketplace design) the site's brand is then applied
 * to the design too (applyOwnerLook). Never throws: the site already exists, so a problem is returned (and logged) instead of failing
 * the whole creation.
 */
export async function applyApprovedHtml(siteId: string, finalHtml: string, opts: { brandColor?: string; look?: { userId: string; organizationId: string } } = {}): Promise<ApprovedHtmlResult> {
  const problems: string[] = [];
  let row;
  try {
    ({ data: row } = await Template.get({ id: siteId }).go());
  } catch (e) {
    console.error("reading the new site before saving its design failed", e);
  }
  const originalHtml = row?.compiledHtml ?? "";
  try {
    await Template.patch({ id: siteId }).set({ compiledHtml: finalHtml, draftHtml: finalHtml }).go();
  } catch (e) {
    console.error("saving the approved html failed", e);
    return { saved: false, designData: "failed", problems: ["We couldn't save your words and colours on the new website."] };
  }
  if (!row || designFormatOf(row) !== "v2") return { saved: true, designData: "not-applicable", problems };
  if (!originalHtml) return { saved: true, designData: "skipped", problems: ["The template's own text could not be read, so the editor may show its sample words."] };
  let unmatched: ApprovedHtmlResult["unmatched"];
  try {
    const parsed = parseV2Design(row.designJson);
    if (!parsed.ok) throw new Error(parsed.error);
    const accent = opts.brandColor && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(opts.brandColor) ? dominantAccent(originalHtml) : null;
    const colour = accent && opts.brandColor ? { from: accent, to: opts.brandColor } : undefined;
    const input = { originalHtml, finalHtml, ...(colour ? { accent: colour } : {}) };

    // The page, and the shared header and footer it is shown with (separate designs: the business name and the menu live there).
    const docs: SyncDoc<Record<string, unknown>>[] = [{ role: "page", design: parsed.design as unknown as Record<string, unknown> }];
    const fragments: Array<{ id: string; at: number }> = [];
    try {
      const { data: layout } = await SiteLayout.get({ templateId: siteId }).go();
      for (const [id, role] of [[layout?.headerTemplateId, "header"], [layout?.footerTemplateId, "footer"]] as const) {
        if (!id) continue;
        const { data: frag } = await Template.get({ id }).go();
        if (!frag || frag.organizationId !== row.organizationId || designFormatOf(frag) !== "v2") continue;
        const fragDesign = parseV2Design(frag.designJson);
        if (!fragDesign.ok) continue;
        fragments.push({ id, at: docs.length });
        docs.push({ role, design: fragDesign.design as unknown as Record<string, unknown> });
      }
    } catch (e) {
      console.error(`new site ${siteId}: reading its shared header and footer failed (only the page's own data is updated)`, e);
    }

    const synced = syncDesigns(docs, input);
    problems.push(...synced.report.problems);
    unmatched = synced.report.unmatched.map(({ from, to }) => ({ from, to }));
    const checked = parseV2Design(synced.docs[0].design);
    if (!checked.ok) throw new Error(checked.error);
    const draft = row.draftJson ? parseV2Design(syncDesignData(row.draftJson as Record<string, unknown>, input).design) : null;
    await Template.patch({ id: siteId }).set({ designJson: checked.design, ...(draft?.ok ? { draftJson: draft.design } : {}) }).go();
    for (const { id, at } of fragments) {
      const fragChecked = parseV2Design(synced.docs[at].design);
      if (fragChecked.ok) await Template.patch({ id }).set({ designJson: fragChecked.design }).go();
    }
    if (problems.length) console.warn(`new site ${siteId}: design data only partly synced:`, problems.join(" "));
  } catch (e) {
    console.error(`new site ${siteId}: could not carry the owner's words into the design data (the HTML was kept):`, e);
    return { saved: true, designData: "failed", problems: [...problems, "Your words are on the site, but the editor may show the template's sample words until you save the page once."] };
  }
  // The brand (colours and logo) into the design, from the one place it lives. This rebuilds the pages from their data, so the approved
  // page is put back afterwards: the owner gets exactly what they previewed.
  if (opts.look) {
    const look = await applyOwnerLook(siteId, opts.look, { brandColor: opts.brandColor });
    problems.push(...look.problems);
    try {
      await Template.patch({ id: siteId }).set({ compiledHtml: finalHtml, draftHtml: finalHtml }).go();
    } catch (e) {
      console.error(`new site ${siteId}: putting the approved page back after applying the brand failed`, e);
      problems.push("Your colours were applied, but the page may look slightly different from the preview until you save it once.");
    }
  }
  return { saved: true, designData: "synced", problems, unmatched };
}
