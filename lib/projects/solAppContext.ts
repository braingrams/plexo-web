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

// How SOL works inside the app editor. The owner already told Plexo what they want (the Apps
// home asks who it's for and what people should be able to do), so the first message is a
// brief to build from, not the start of an interview.
const WORKING_ON_AN_APP = `How to work on this app:
- Build first. When the owner asks for an app or a feature, build a complete, working version straight away with sensible defaults — don't ask questions before building. They've already answered Plexo's setup questions; their message is the brief. For anything they didn't specify, pick what most owners would want (e.g. a few sample products or plans with prices they can edit, a simple review form with 1–5 stars) and keep going.
- After building, say in one or two short sentences what you chose for anything they didn't specify, and that they can ask you to change it.
- Only ask (with ask_user_question) when you genuinely can't continue without them — e.g. a private key only they have, or a choice that would mean throwing away work they've already done.
- Work in small steps so the owner sees progress: write a few files per app_write_files call rather than everything at once.
- Keep packages small. Never add big server SDKs (stripe, aws-sdk, firebase-admin, googleapis) — they make the build run out of time and are refused. Call those services' HTTP APIs with fetch from a server function instead (PLEXO.md shows payments this way).
- Don't retry what isn't yours to fix. If a screenshot can't be taken, or a tool says Plexo couldn't set something up (its database, a browser), try at most once more, then stop and tell the owner plainly — repeating it only uses up their credits.
- Talk to the owner in plain words: what their visitors will see and be able to do, never file names, code or technical terms.`;

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
    WORKING_ON_AN_APP,
  ];
  return lines.filter(Boolean).join("\n\n");
}
