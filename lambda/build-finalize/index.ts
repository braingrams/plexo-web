import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { loadSecretsFromSsm } from "@/lib/ssmEnv";
import { getBuild } from "@/lib/projects/builds";
import { finalizeBuild } from "@/lib/projects/pipeline";
import { parseSsrControlMessage } from "@/lib/appFunctions/ssrControl";
import { runSsrControl } from "@/lib/appFunctions/ssrControlRun";
import { parseLiveBuildMessage, publishBuildLog, publishBuildStatus } from "@/lib/realtime/buildLog";

// BuildFinalizeFn — runs a finished build's post-build steps (preview/live database
// migrations, server-function deploys, the live switch for a release) as soon as the build
// Lambda reports it done, so finishing a build never depends on someone polling for it.
// finalizeBuild claims the work on the build row, so this and a concurrent poll from the
// editor can't both run it.
//
// It also relays the build worker's live output (build-log and build-status messages) to subscribers,
// and runs server-app control messages from SSR_CONTROL_QUEUE_URL (publish a preview, apply
// variables). Those change plexo-ssr-* functions, which only this function's role may do.

let secretsLoaded: Promise<void> | null = null;
function ensureSecrets(): Promise<void> {
  secretsLoaded ??= loadSecretsFromSsm().catch((err) => {
    secretsLoaded = null;
    throw err;
  });
  return secretsLoaded;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await ensureSecrets();
  const failures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      // Live build output and status come from the build worker. They are relayed to the build's
      // private channel, and nothing else is done for them.
      const live = parseLiveBuildMessage(record.body);
      if (live) {
        if (live.type === "build-log") await publishBuildLog(live);
        else await publishBuildStatus(live);
        continue;
      }
      const body = JSON.parse(record.body) as { buildId?: string; kind?: string };
      if (body.kind) {
        const message = parseSsrControlMessage(record.body);
        if (!message) console.error("Dropping an invalid server app message", record.body.slice(0, 200));
        else await runSsrControl(message);
        continue;
      }
      if (!body.buildId) continue;
      const build = await getBuild(body.buildId);
      if (build) await finalizeBuild(build);
    } catch (err) {
      console.error("Finalizing build failed", err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}
