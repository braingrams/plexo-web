import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { loadSecretsFromSsm } from "@/lib/ssmEnv";
import { getBuild } from "@/lib/projects/builds";
import { finalizeBuild } from "@/lib/projects/pipeline";

// BuildFinalizeFn — runs a finished build's post-build steps (preview/live database
// migrations, server-function deploys, the live switch for a release) as soon as the build
// Lambda reports it done, so finishing a build never depends on someone polling for it.
// finalizeBuild claims the work on the build row, so this and a concurrent poll from the
// editor can't both run it.

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
      const { buildId } = JSON.parse(record.body) as { buildId?: string };
      if (!buildId) continue;
      const build = await getBuild(buildId);
      if (build) await finalizeBuild(build);
    } catch (err) {
      console.error("Finalizing build failed", err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}
