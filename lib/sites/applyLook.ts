import { describeDesign } from "@charisol/plexo-sdk/v2/compile";
import { SiteLayout, Template } from "@/lib/db/contentEntities";
import { findRootTemplateId, onTemplateSaved } from "@/lib/siteLayoutCore";
import { publishTemplateDraft } from "@/lib/templateVersions";
import { currentDesign, formatLabel, loadSiteRows, saveEdit } from "@/lib/mcp/v2Pages";
import { lookTokens, type BrandLook, type LookApplied } from "@/lib/dashboardV3/brandLook";

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

  for (const row of rows) {
    if (formatLabel(row) !== "v2") {
      out.skipped++;
      continue;
    }
    const hadDraft = !!row.draftJson;
    const wasLive = !!row.activeVersionId;
    const res = await saveEdit(row, [{ op: "setBrand", tokens }], { live: false });
    if (!res.saved) {
      out.skipped++;
      continue;
    }
    out.updated++;
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
  const { data: layout } = await SiteLayout.get({ templateId: rootId }).go();
  const wantsLogo = !!look.logoUrl || input.hadLogo;
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
