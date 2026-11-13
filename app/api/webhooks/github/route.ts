import { NextRequest, NextResponse, after } from "next/server";
import { ProjectGitLink } from "@/lib/db/projectEntities";
import { verifyWebhookSignature } from "@/lib/projects/github/client";
import { importPush } from "@/lib/projects/github/sync";
import { startPreview } from "@/lib/projects/pipeline";
import { forwardWebhook } from "@/lib/projects/github/relay";
import { queueSsrPushBuild } from "@/lib/projects/github/ssrPush";
import { DeployedApp } from "@/lib/db/appEntities";

/**
 * POST /api/webhooks/github — events from the Plexo GitHub App. A push to a linked branch is
 * imported into the app and its preview rebuilt; a server (SSR) app builds the pushed commit and
 * publishes it (lib/projects/github/ssrPush.ts). A removed installation or repository marks
 * the link so the owner sees why syncing stopped. GitHub gives webhooks 10 seconds, so the
 * work runs after the response (Next's after()). Production also relays each event to staging
 * (lib/projects/github/relay.ts).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(raw);
  // Production passes every event on to staging too (one GitHub App, two environments).
  const headers = request.headers;
  after(() => forwardWebhook(raw, headers));

  if (event === "push" && payload.repository?.id) {
    const { data: links } = await ProjectGitLink.query.byRepo({ repoId: payload.repository.id }).go({ pages: "all" });
    const targets = links.filter((l) => payload.ref === `refs/heads/${l.branch}` && payload.after !== l.lastSyncedCommitSha);
    if (targets.length) {
      after(async () => {
        for (const link of targets) {
          try {
            const { data: app } = await DeployedApp.get({ templateId: link.templateId }).go({ attributes: ["type"] });
            if (app?.type === "SSR") {
              await queueSsrPushBuild(link, { after: payload.after });
              continue;
            }
            const imported = await importPush(link.templateId, {
              after: payload.after,
              ref: payload.ref,
              headMessage: payload.head_commit?.message ?? "Pushed from GitHub",
              author: payload.head_commit?.author?.username ?? payload.pusher?.name ?? "GitHub",
            });
            if (imported) await startPreview(link.templateId, { userId: link.linkedBy ?? "github", organizationId: link.organizationId }, { message: "Pushed from GitHub", source: "git" });
          } catch (err) {
            console.error(`GitHub push import failed for app ${link.templateId}:`, err);
            await ProjectGitLink.patch({ templateId: link.templateId }).set({ status: "ERROR", statusMessage: "Couldn't import the latest push from GitHub. Try syncing again." }).go().catch(() => undefined);
          }
        }
      });
    }
    return NextResponse.json({ accepted: targets.length });
  }

  if ((event === "installation" && payload.action === "deleted") || (event === "installation_repositories" && payload.action === "removed")) {
    const repoIds: number[] = event === "installation" ? (payload.repositories ?? []).map((r: { id: number }) => r.id) : (payload.repositories_removed ?? []).map((r: { id: number }) => r.id);
    for (const repoId of repoIds) {
      const { data: links } = await ProjectGitLink.query.byRepo({ repoId }).go({ pages: "all" });
      for (const link of links) {
        await ProjectGitLink.patch({ templateId: link.templateId }).set({ status: "ERROR", statusMessage: "Plexo lost access to this repository on GitHub. Reconnect GitHub to keep syncing." }).go();
      }
    }
  }
  return NextResponse.json({ ok: true });
}
