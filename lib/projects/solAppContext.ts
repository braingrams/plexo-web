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
- Talk to the owner in plain words: what their visitors will see and be able to do, never file names, code or technical terms.

Make it look impressive — this is the bar, every time:
- The first version is the owner's first impression of what Plexo can do. It must look like a polished, premium product a real company would ship, not a template or a wireframe.
- Give it its own icon: replace public/favicon.svg with a simple, bold SVG mark that fits this business (a cup for a café, a tooth for a dentist, a spark for a studio) in the app's palette, legible at 16px — and set the <title> and meta description in index.html.
- Before writing pages, decide the app's look: a palette that suits this business (set the tokens in src/index.css — not Plexo's purple unless it fits), a characterful heading font from Google Fonts (a <link> in index.html, set in src/index.css), and the tone of the copy.
- Every page is complete and full: a striking hero (bold headline, a specific benefit-led subheading, a clear main action, and a strong visual — a real photo from app_find_photos or a composed product mock built from components — with depth from gradients and soft layered shadows), then the sections a real page of this kind has (benefits with icons, how it works, social proof, pricing, FAQ, a closing call to action, a proper footer). Never a heading floating in empty space.
- Real, specific copy for this business — never lorem ipsum, "Company Name" or generic filler. Designed empty states (an icon, a friendly line, an action) instead of bare "No items yet" text.
- Craft: generous but intentional spacing, a clear type scale, consistent radius, lucide-react icons, subtle motion with the motion library (fade/slide in as sections appear, gentle hover lift), and it must look just as good at phone width.
- Check your own work: after building, take a screenshot and judge it honestly against this bar. If it looks plain, sparse or template-like, improve it once before telling the owner it's ready.`;

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
    guide ? `The app's PLEXO.md (its conventions — follow them):\n${guide.slice(0, 14000)}` : "",
    WORKING_ON_AN_APP,
  ];
  return lines.filter(Boolean).join("\n\n");
}
