import { DeployedApp } from "@/lib/db/appEntities";
import { objectExists } from "@/lib/projects/blobStore";
import { ssrLatestSourceKey } from "@/lib/projects/builds";

// A secret's value is read once per server, when the server starts. Saving a secret therefore
// doesn't change a running server. A rebuild changes the server's build id (PLEXO_BUILD_ID, see
// lib/appFunctions/deploy.ts), which starts fresh servers. The app shows a rebuild button from the
// time a secret changes until a build is queued. Secrets aren't rebuilt automatically, so ten
// saves don't start ten builds.

/** Records that a secret was saved or removed. An app that was never deployed has no server to restart. */
export async function markSecretsChanged(templateId: string): Promise<void> {
  const { data } = await DeployedApp.get({ templateId }).go({ attributes: ["templateId"] });
  if (data) await DeployedApp.patch({ templateId }).set({ secretsChangedAt: new Date().toISOString() }).go();
}

/** Called when a build is queued (an upload or a rebuild): the new build picks up current secrets. */
export async function markBuildQueued(templateId: string, buildVarsHash: string): Promise<void> {
  await DeployedApp.patch({ templateId }).set({ previewBuildVarsHash: buildVarsHash }).remove(["secretsChangedAt"]).go();
}

/** Whether a rebuild is pending for secrets, and whether the app has stored source to rebuild from. */
export async function rebuildState(templateId: string): Promise<{ needsRebuild: boolean; hasSource: boolean }> {
  const { data } = await DeployedApp.get({ templateId }).go({ attributes: ["secretsChangedAt"] });
  return { needsRebuild: !!data?.secretsChangedAt, hasSource: await objectExists(ssrLatestSourceKey(templateId)) };
}
