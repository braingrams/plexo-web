import { Template } from "@/lib/db/contentEntities";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { listFiles, readTextFile } from "./fileStore";
import { previewUrl } from "./previewHost";
import { formatBuildErrors } from "./builds";
import type { ProjectBuildError } from "@/lib/db/projectEntities";

// What SOL is told, every turn, about the app an app-builder conversation is bound to (the
// app editor's chat): which app, where its preview is, its file tree, its own PLEXO.md, and
// how the last build went — so SOL starts each turn oriented instead of spending tool calls
// rediscovering the project.

export async function buildSolAppContext(appId: string, resolved: { organizationId: string }): Promise<string | undefined> {
  const { data: app } = await Template.get({ id: appId }).go();
  if (!app || app.organizationId !== resolved.organizationId || app.sourceType !== "REACT_PROJECT") return undefined;

  const [files, guide, latest] = await Promise.all([
    listFiles(appId),
    readTextFile(appId, "PLEXO.md").catch(() => null),
    app.latestBuildId ? ProjectBuild.get({ id: app.latestBuildId }).go().then((r) => r.data) : Promise.resolve(null),
  ]);

  const tree = files
    .filter((f) => !f.path.startsWith("src/components/ui/"))
    .map((f) => f.path)
    .slice(0, 400);
  const uiKit = files.filter((f) => f.path.startsWith("src/components/ui/")).map((f) => f.path.replace("src/components/ui/", "").replace(/\.tsx?$/, ""));

  const lines = [
    `App: "${app.name}" — appId ${app.id} (use this id with every app_* tool; don't ask for it).`,
    `Preview: ${app.previewHost ? previewUrl(app.previewHost) : "not built yet"}. ${app.liveBuildId ? "It's published." : "Not published yet."}`,
    latest
      ? `Last preview build: ${latest.summary ?? latest.status}.${latest.status === "FAILED" ? `\n${formatBuildErrors((latest.errors ?? []) as ProjectBuildError[], 10)}` : ""}`
      : "It hasn't been built yet.",
    `Files (${files.length}):\n${tree.join("\n")}${files.length > tree.length ? "\n…" : ""}`,
    uiKit.length ? `UI components available in src/components/ui: ${uiKit.join(", ")}.` : "",
    guide ? `The app's PLEXO.md (its conventions — follow them):\n${guide.slice(0, 6000)}` : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}
