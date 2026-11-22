import { randomUUID } from "node:crypto";

import { Template, TemplateRevision } from "@/lib/db/contentEntities";
import { designFormatOf } from "@/lib/v2/design";
import { staleRevisions } from "@/lib/revisionRetention";

// Retention cap — a generous undo window ("instant rollbacks") without letting a
// template's revision history grow unbounded in plexo-content.
const MAX_REVISIONS_PER_TEMPLATE = 20;

/**
 * The revisions a page can still go back to ("Go back to the classic editor", "Go back to blocks"): history cleaning must never
 * remove one, however many newer versions pile up on top of it.
 */
export async function protectedRevisionIds(templateId: string): Promise<Set<string>> {
  const { data } = await Template.get({ id: templateId }).go();
  return new Set([data?.classicBackupId, data?.blocksBackupId].filter((id): id is string => !!id));
}

/**
 * Snapshots a template's pre-overwrite designJson/compiledHtml/sdkVersion into a new
 * TemplateRevision row, then prunes anything beyond the retention cap. Called from every
 * route that overwrites a Template's content (dashboard save, public API PUT, restore)
 * so a template's history is always undoable.
 *
 * Fire-and-forget by design, same convention as lib/safeBrowsing.ts's
 * scanPublishedDomain — callers should do
 * `void snapshotTemplateRevision(existing).catch((err) => console.error(...))` immediately
 * before the overwrite, so a revision-history hiccup never blocks or fails the actual save.
 */
export async function snapshotTemplateRevision(template: {
  id: string;
  designFormat?: string | null;
  designJson: unknown;
  compiledHtml: string;
  sdkVersion?: string | null;
}): Promise<void> {
  await TemplateRevision.create({
    id: randomUUID(),
    templateId: template.id,
    designFormat: designFormatOf(template),
    designJson: template.designJson,
    compiledHtml: template.compiledHtml,
    // Template.sdkVersion is optional (nothing in the live DynamoDB-stack code path sets
    // it today — only the old migration script ever wrote it) but TemplateRevision.sdkVersion
    // is required, so fall back rather than let a missing value throw.
    sdkVersion: template.sdkVersion || "unknown",
    createdAt: new Date().toISOString(),
  }).go();

  const { data: revisions } = await TemplateRevision.query.primary({ templateId: template.id }).go({ order: "desc" });
  const stale = staleRevisions(revisions, MAX_REVISIONS_PER_TEMPLATE, await protectedRevisionIds(template.id));
  if (stale.length === 0) return;
  await Promise.all(
    stale.map((r) => TemplateRevision.remove({ templateId: r.templateId, createdAt: r.createdAt, id: r.id }).go()),
  );
}
