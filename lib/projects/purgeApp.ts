import { ProjectBuild, ProjectPreviewHost } from "@/lib/db/projectEntities";
import { Template } from "@/lib/db/contentEntities";
import { deletePrefix, projectPrefix } from "./blobStore";
import { deleteAllFunctions } from "@/lib/appFunctions/deploy";
import { dropAppDatabase } from "@/lib/appData/provision";
import { chunk } from "./concurrency";

// Everything a React app owns outside its content partition (that partition — files,
// versions, database records, secrets, settings, functions, GitHub link — is swept by
// lib/sites/purgeSiteData.ts like any site's). Called from deleteTemplateAndContents before
// the site itself goes. Each step is independent, so one failing (logged) never strands the
// rest.

export async function purgeAppProject(templateId: string): Promise<void> {
  const { data: template } = await Template.get({ id: templateId }).go({ attributes: ["previewHost"] });
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["functions", () => deleteAllFunctions(templateId)],
    ["preview database", () => dropAppDatabase(templateId, "dev")],
    ["live database", () => dropAppDatabase(templateId, "live")],
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
