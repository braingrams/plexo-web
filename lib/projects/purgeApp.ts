import { ProjectBuild, ProjectPreviewHost } from "@/lib/db/projectEntities";
import { Template } from "@/lib/db/contentEntities";
import { deletePrefix, projectPrefix } from "./blobStore";
import { deleteAllFunctions } from "@/lib/appFunctions/deploy";
import { dropAppDatabase } from "@/lib/appData/provision";
import { clusterConfigured } from "@/lib/appData/admin";
import { chunk } from "./concurrency";

// Everything a React app owns outside its content partition (that partition — files,
// versions, database records, secrets, settings, functions, GitHub link — is swept by
// lib/sites/purgeSiteData.ts like any site's). Called from deleteTemplateAndContents before
// the site itself goes.
//
// The databases go first and must go: they hold the app's visitors' data, so if they can't
// be removed the deletion stops (nothing else is touched, and trying again is safe) instead
// of leaving that data on the server with nothing pointing at it — which is how a failed
// delete once orphaned two databases on staging. The rest are independent clean-ups: one
// failing (logged) never strands the others.

export const DATA_NOT_DELETED =
  "We couldn't delete this app's data just now, so the app hasn't been deleted. Nothing was removed — please try again in a minute.";

export async function dropAppDatabases(templateId: string): Promise<void> {
  if (!clusterConfigured()) return;
  try {
    await dropAppDatabase(templateId, "dev");
    await dropAppDatabase(templateId, "live");
  } catch (err) {
    console.error(`Deleting app ${templateId}: removing its databases failed:`, err);
    throw new Error(DATA_NOT_DELETED);
  }
}

export async function purgeAppProject(templateId: string): Promise<void> {
  const { data: template } = await Template.get({ id: templateId }).go({ attributes: ["previewHost"] });
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["functions", () => deleteAllFunctions(templateId)],
    ["project files", () => deletePrefix(`${projectPrefix(templateId)}/`)],
    ["public storage", () => deletePrefix(`public/apps/${templateId}/`)],
    ["private storage", () => deletePrefix(`private/apps/${templateId}/`)],
    [
      "builds",
      async () => {
        const { data } = await ProjectBuild.query.byTemplate({ templateId }).go({ pages: "all", attributes: ["id"] });
        for (const batch of chunk(data, 25)) await ProjectBuild.delete(batch.map((b) => ({ id: b.id }))).go();
      },
    ],
    ["preview address", async () => (template?.previewHost ? ProjectPreviewHost.delete({ host: template.previewHost }).go() : undefined)],
  ];
  for (const [name, run] of steps) {
    await run().catch((err) => console.error(`Deleting app ${templateId}: removing its ${name} failed (non-fatal):`, err));
  }
}
