import { randomUUID } from "node:crypto";
import {
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

import { docClient } from "@/lib/db/client";
import { Template, TemplateRevision } from "@/lib/db/contentEntities";

// Retention cap — same generous-but-bounded undo window as the pre-draft/publish model
// (lib/templateRevisions.ts), applied here to published-version history instead.
const MAX_VERSIONS_PER_TEMPLATE = 20;

type TransactItem = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

type ExistingTemplate = {
  id: string;
  designJson: unknown;
  compiledHtml: string;
  draftJson?: unknown;
  draftHtml?: string | null;
};

/**
 * Publishes a template's current draft (or, if nothing's been drafted yet, its current
 * live content) as a new immutable TemplateRevision, then atomically flips it live and
 * clears the draft — the "changes go live only upon Publish" half of the draft/publish
 * model (lib/db/contentEntities.ts's Template.draftJson/draftHtml/activeVersionId).
 *
 * One TransactWriteItems call (create revision + patch template) since both live in the
 * same physical table (TABLES.content) — see lib/db/commerceOperations.ts for the same
 * ElectroDB-.params()-into-raw-TransactWriteCommand pattern this follows.
 */
export async function publishTemplateDraft(
  existing: ExistingTemplate,
  author: { userId: string; userName: string },
  publishedDesignJson: unknown,
  publishedCompiledHtml: string,
): Promise<{ revisionId: string; createdAt: string }> {
  const revisionId = randomUUID();
  const createdAt = new Date().toISOString();

  const createRevision = TemplateRevision.create({
    id: revisionId,
    templateId: existing.id,
    designJson: publishedDesignJson,
    compiledHtml: publishedCompiledHtml,
    sdkVersion: "unknown",
    authorId: author.userId,
    authorName: author.userName,
    createdAt,
  }).params();

  const patchTemplate = Template.patch({ id: existing.id })
    .set({
      designJson: publishedDesignJson,
      compiledHtml: publishedCompiledHtml,
      activeVersionId: revisionId,
    })
    .remove(["draftJson", "draftHtml"])
    .params();

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { Put: createRevision as any },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { Update: patchTemplate as any },
      ] satisfies TransactItem[],
    }),
  );

  await pruneOldVersions(existing.id);

  return { revisionId, createdAt };
}

/** Prunes published versions beyond the retention cap — mirrors the pre-existing
 * snapshotTemplateRevision behavior, just run after a publish instead of every save. */
async function pruneOldVersions(templateId: string): Promise<void> {
  const { data: revisions } = await TemplateRevision.query
    .primary({ templateId })
    .go({ order: "desc" });
  const stale = revisions.slice(MAX_VERSIONS_PER_TEMPLATE);
  if (stale.length === 0) return;
  await Promise.all(
    stale.map((r) =>
      TemplateRevision.remove({
        templateId: r.templateId,
        createdAt: r.createdAt,
        id: r.id,
      }).go(),
    ),
  );
}

/**
 * Restores a prior published version, making it the active live site immediately — the
 * restored version's content becomes both the live content AND the new draft baseline
 * (any not-yet-published draft edits are discarded, same as any other overwrite of
 * unpublished work). No new TemplateRevision is created: versions are immutable rows
 * already, so restoring is just moving the activeVersionId pointer back to one of them,
 * not manufacturing a new snapshot.
 */
export async function restoreTemplateVersion(
  templateId: string,
  revision: { id: string; designJson: unknown; compiledHtml: string },
): Promise<void> {
  await Template.patch({ id: templateId })
    .set({
      designJson: revision.designJson,
      compiledHtml: revision.compiledHtml,
      activeVersionId: revision.id,
    })
    .remove(["draftJson", "draftHtml"])
    .go();
}

/**
 * Deletes a non-active published version. Throws if revisionId is the template's current
 * activeVersionId — the currently-active/live version must never be deletable (callers
 * should surface this as a 400, not a 500).
 */
export async function deleteTemplateVersion(
  templateId: string,
  activeVersionId: string | null | undefined,
  revisionId: string,
  revisionCreatedAt: string,
): Promise<void> {
  if (activeVersionId && activeVersionId === revisionId) {
    throw new Error(
      "The active, live version can't be deleted. Restore a different version first.",
    );
  }
  await TemplateRevision.remove({
    templateId,
    createdAt: revisionCreatedAt,
    id: revisionId,
  }).go();
}
