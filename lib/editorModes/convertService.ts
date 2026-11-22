/**
 * The write side of "turn a page into code" and "go back to blocks", shared by the dashboard routes
 * (app/api/templates/[id]/convert-to-code, restore-blocks) and the MCP/SOL tools, so they can never disagree.
 * Callers have already checked sign-in, permission and that the page belongs to the account.
 */
import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";

import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { designFormatOf } from "@/lib/v2/design";
import { compileTemplateWithSiteLayout } from "@/lib/siteLayoutCore";
import { canConvertToCode, describeConvert, type ConvertNotes } from "./convertToCode";
import { ConvertError, renderBlockPageAsHtml, type ConvertSource } from "./convertPage";

type TemplateItem = EntityItem<typeof Template>;

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export type ConvertPreview = { html: string; hasUnpublishedChanges: boolean; isLive: boolean; notes: ConvertNotes };

export async function previewConvert(existing: TemplateItem, source: ConvertSource): Promise<ServiceResult<ConvertPreview>> {
  const eligible = canConvertToCode(existing);
  if (!eligible.ok) return { ok: false, status: 400, error: eligible.reason };
  try {
    const rendered = await renderBlockPageAsHtml(existing, source);
    return { ok: true, value: { html: rendered.html, hasUnpublishedChanges: rendered.hasUnpublishedChanges, isLive: rendered.isLive, notes: describeConvert(rendered) } };
  } catch (err) {
    if (err instanceof ConvertError) return { ok: false, status: 400, error: err.message };
    console.error("convert-to-code failed", err);
    return { ok: false, status: 500, error: "Something went wrong while getting this page ready. Nothing was changed. Please try again." };
  }
}

export async function convertToCode(
  existing: TemplateItem,
  source: ConvertSource,
  author: { userId: string },
): Promise<ServiceResult<{ usedWorkingCopy: boolean; notes: ConvertNotes }>> {
  const eligible = canConvertToCode(existing);
  if (!eligible.ok) return { ok: false, status: 400, error: eligible.reason };
  let rendered;
  try {
    rendered = await renderBlockPageAsHtml(existing, source);
  } catch (err) {
    if (err instanceof ConvertError) return { ok: false, status: 400, error: err.message };
    console.error("convert-to-code failed", err);
    return { ok: false, status: 500, error: "Something went wrong while getting this page ready. Nothing was changed. Please try again." };
  }

  const backupId = randomUUID();
  const backupAt = new Date().toISOString();
  await TemplateRevision.create({
    id: backupId,
    templateId: existing.id,
    designFormat: designFormatOf(existing),
    designJson: existing.designJson,
    compiledHtml: existing.compiledHtml,
    ...(existing.draftJson != null ? { draftJson: existing.draftJson, draftHtml: existing.draftHtml ?? existing.compiledHtml } : {}),
    sdkVersion: "unknown",
    authorId: author.userId,
    authorName: "Before turning into code",
    createdAt: backupAt,
  }).go();

  try {
    await Template.patch({ id: existing.id })
      .set({ sourceType: "RAW_UPLOAD", compiledHtml: rendered.html, compiledAt: backupAt, blocksBackupId: backupId, convertedFromBlocksAt: backupAt })
      .remove(["draftJson", "draftHtml"])
      // Two tabs, one page: whoever gets here second finds it already converted instead of making a second backup over the first.
      .where(({ sourceType }, { ne }) => ne(sourceType, "RAW_UPLOAD"))
      .go();
  } catch {
    await TemplateRevision.remove({ templateId: existing.id, createdAt: backupAt, id: backupId }).go().catch(() => undefined);
    return { ok: false, status: 409, error: "This page was just changed somewhere else. Please reload it and try again." };
  }
  return { ok: true, value: { usedWorkingCopy: rendered.usedWorkingCopy, notes: describeConvert(rendered) } };
}

export async function restoreBlocks(existing: TemplateItem): Promise<ServiceResult<null>> {
  if (existing.sourceType !== "RAW_UPLOAD" || !existing.blocksBackupId) {
    return { ok: false, status: 409, error: "There's no block version of this page to go back to." };
  }
  const { data: revisions } = await TemplateRevision.query.primary({ templateId: existing.id }).go({ order: "desc", pages: "all" });
  const backup = revisions.find((r) => r.id === existing.blocksBackupId);
  if (!backup) return { ok: false, status: 404, error: "The block version of this page is no longer saved, so it can't be restored." };

  // The live page is rebuilt so the shared header and footer are today's, not the copies from the day it became code.
  let compiledHtml = backup.compiledHtml;
  try {
    compiledHtml = await compileTemplateWithSiteLayout(
      { id: existing.id, parentId: existing.parentId ?? null, kind: existing.kind, name: existing.name, designFormat: backup.designFormat ?? "v1", hideHeader: existing.hideHeader, hideFooter: existing.hideFooter },
      backup.designJson,
    );
  } catch {
    // Keep exactly what was live before it became code.
  }

  const patch = Template.patch({ id: existing.id }).set({
    sourceType: "BUILDER",
    designFormat: backup.designFormat ?? "v1",
    designJson: backup.designJson,
    compiledHtml,
    compiledAt: new Date().toISOString(),
    ...(backup.draftJson != null ? { draftJson: backup.draftJson, draftHtml: backup.draftHtml ?? backup.compiledHtml } : {}),
  });
  await (backup.draftJson != null ? patch.remove(["blocksBackupId", "convertedFromBlocksAt"]) : patch.remove(["blocksBackupId", "convertedFromBlocksAt", "draftJson", "draftHtml"])).go();
  return { ok: true, value: null };
}
