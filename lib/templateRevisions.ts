import { randomUUID } from "node:crypto";

import { TemplateRevision } from "@/lib/db/contentEntities";

// Retention cap — a generous undo window ("instant rollbacks", app/new/feature-grid.tsx)
// without letting a template's revision history grow unbounded in plexo-content.
const MAX_REVISIONS_PER_TEMPLATE = 20;

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
  designJson: unknown;
  compiledHtml: string;
  sdkVersion?: string | null;
}): Promise<void> {
  await TemplateRevision.create({
    id: randomUUID(),
    templateId: template.id,
    designJson: template.designJson,
    compiledHtml: template.compiledHtml,
    // Template.sdkVersion is optional (nothing in the live DynamoDB-stack code path sets
    // it today — only the old migration script ever wrote it) but TemplateRevision.sdkVersion
    // is required, so fall back rather than let a missing value throw.
    sdkVersion: template.sdkVersion || "unknown",
    createdAt: new Date().toISOString(),
  }).go();

  const { data: revisions } = await TemplateRevision.query.primary({ templateId: template.id }).go({ order: "desc" });
  const stale = revisions.slice(MAX_REVISIONS_PER_TEMPLATE);
  if (stale.length === 0) return;
  await Promise.all(
    stale.map((r) => TemplateRevision.remove({ templateId: r.templateId, createdAt: r.createdAt, id: r.id }).go()),
  );
}
