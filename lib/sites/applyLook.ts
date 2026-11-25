import { describeDesign } from "@charisol/plexo-sdk/v2/compile";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { findRootTemplateId, onTemplateSaved } from "@/lib/siteLayoutCore";
import { publishTemplateDraft } from "@/lib/templateVersions";
import { currentDesign, formatLabel, loadSiteRows, saveEdit } from "@/lib/mcp/v2Pages";
import { lookTokens, type BrandLook, type LookApplied } from "@/lib/dashboardV3/brandLook";
import { logoCommandFor } from "@/lib/sites/headerLogo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

/**
 * Puts a site's own colours (and logo) into its design, with the same "setBrand" change SOL and the editor use, so the
 * pages really change. Pages that are live with no unpublished edits go straight live (nothing half-finished gets
 * published by surprise); pages with unpublished edits keep the new look in their working copy. The shared header
 * and footer are live fragments, so they change at once. Classic, uploaded and app sites are left alone and counted.
 */
export async function applySiteLook(input: { organizationId: string; userId: string; userName: string; siteId: string; look: BrandLook; hadLogo: boolean }): Promise<LookApplied> {
  const { organizationId, siteId, look } = input;
  const tokens = lookTokens(look.colors);
  const out: LookApplied = { updated: 0, needsPublish: 0, skipped: 0, logoPlaced: false };
  const rootId = await findRootTemplateId(siteId, null);
  const rows: Row[] = await loadSiteRows({ organizationId }, rootId);
  const { data: layout } = await SiteLayout.get({ templateId: rootId }).go();
  const wantsLogo = !!look.logoUrl || input.hadLogo;
  // A site made from a marketplace design has no shared header: each page carries its own header section, and the logo is in that.
  const logoInPages = wantsLogo && !layout?.headerTemplateId;

  for (const row of rows) {
    if (formatLabel(row) !== "v2") {
      out.skipped++;
      continue;
    }
    const hadDraft = !!row.draftJson;
    const wasLive = !!row.activeVersionId;
    const commands: unknown[] = [{ op: "setBrand", tokens }];
    let pageLogoAt = -1;
    if (logoInPages) {
      const pageLogo = logoCommandFor(await currentDesign(row).catch(() => null), look.logoUrl ?? "");
      if (pageLogo) {
        pageLogoAt = commands.length;
        commands.push(pageLogo);
      }
    }
    const res = await saveEdit(row, commands, { live: false });
    if (!res.saved) {
      out.skipped++;
      continue;
    }
    out.updated++;
    if (pageLogoAt >= 0 && look.logoUrl && res.results?.[pageLogoAt]?.ok) out.logoPlaced = true;
    if (wasLive && !hadDraft) {
      const { data: fresh } = await Template.get({ id: row.id }).go();
      if (fresh?.draftHtml) {
        const design = await currentDesign(fresh);
        await publishTemplateDraft(fresh, { userId: input.userId, userName: input.userName }, design, fresh.draftHtml);
        continue;
      }
    }
    out.needsPublish++;
  }

  // The shared header and footer (one per site), where the logo lives.
  for (const [id, isHeader] of [[layout?.headerTemplateId, true], [layout?.footerTemplateId, false]] as const) {
    if (!id) continue;
    const { data: frag } = await Template.get({ id }).go();
    if (!frag || frag.organizationId !== organizationId || formatLabel(frag) !== "v2") continue;
    const commands: unknown[] = [{ op: "setBrand", tokens }];
    let logoAt = -1;
    if (isHeader && wantsLogo) {
      const design = await currentDesign(frag);
      const section = describeDesign(design.pages, design.designSystem as never).pages[0]?.sections.find((s: { kind?: string }) => s.kind === "header");
      if (section) logoAt = commands.length;
      if (section) commands.push({ op: "updateSection", sectionId: (section as { id: string }).id, content: { logo: look.logoUrl ?? "" } });
    }
    const res = await saveEdit(frag, commands, { live: true });
    if (res.saved) {
      out.updated++;
      if (logoAt >= 0 && look.logoUrl && res.results?.[logoAt]?.ok) out.logoPlaced = true;
      await onTemplateSaved(id);
    }
  }
  return out;
}

/**
 * Puts one logo into the site's shared header (the only place a V2 site keeps its logo), live at once, like the header's other
 * brand changes. Used when the linked Strata brand's logo changes. `placed` is false for sites with no V2 header (classic,
 * uploaded and app sites): their logo is still read from the brand wherever it is used.
 */
export async function applySiteLogo(input: { organizationId: string; siteId: string; logoUrl: string }): Promise<{ placed: boolean }> {
  const rootId = await findRootTemplateId(input.siteId, null);
  const { data: layout } = await SiteLayout.get({ templateId: rootId }).go();
  const id = layout?.headerTemplateId;
  if (!id) {
    // No shared header (a site made from a marketplace design): the logo goes in the header section of each page that has one.
    const rows: Row[] = await loadSiteRows({ organizationId: input.organizationId }, rootId);
    let placedAny = false;
    for (const row of rows) {
      if (formatLabel(row) !== "v2") continue;
      const command = logoCommandFor(await currentDesign(row).catch(() => null), input.logoUrl);
      if (!command) continue;
      const res = await saveEdit(row, [command], { live: false });
      if (res.saved) placedAny = true;
    }
    return { placed: placedAny };
  }
  const { data: frag } = await Template.get({ id }).go();
  if (!frag || frag.organizationId !== input.organizationId || formatLabel(frag) !== "v2") return { placed: false };
  const design = await currentDesign(frag);
  const section = describeDesign(design.pages, design.designSystem as never).pages[0]?.sections.find((s: { kind?: string }) => s.kind === "header");
  if (!section) return { placed: false };
  const res = await saveEdit(frag, [{ op: "updateSection", sectionId: (section as { id: string }).id, content: { logo: input.logoUrl } }], { live: true });
  if (!res.saved) return { placed: false };
  await onTemplateSaved(id);
  return { placed: true };
}
