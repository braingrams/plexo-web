import { DeployedApp } from "@/lib/db/appEntities";
import { applySsrVariables, publishSsrPreview } from "@/lib/appFunctions/deploy";
import type { SsrControlMessage } from "@/lib/appFunctions/ssrControl";
import { disableAlwaysOn, enableAlwaysOn, repointWarmAlias } from "@/lib/appFunctions/alwaysOn";

// Runs one queued control message. Called from BuildFinalizeFn, which is the only role that may
// change plexo-ssr-* functions.

/** Publishes the latest preview. The outcome is written to the app so the dashboard can show it. */
async function runPublish(templateId: string): Promise<void> {
  const finishedAt = new Date().toISOString();
  try {
    const result = await publishSsrPreview(templateId);
    if ("error" in result) {
      await DeployedApp.patch({ templateId }).set({ publishError: result.error, publishWarnings: "[]", publishFinishedAt: finishedAt }).go();
      return;
    }
    await DeployedApp.patch({ templateId }).set({ publishError: "", publishWarnings: JSON.stringify(result.warnings), publishFinishedAt: finishedAt }).go();
    // An always-on app's warm copy runs the live code, so it moves to the new version too.
    await repointWarmAlias(templateId).catch((err) => console.error("moving the always-on copy to the new code failed", err));
  } catch (err) {
    console.error("publishing the SSR preview failed", err);
    await DeployedApp.patch({ templateId }).set({ publishError: "Publishing failed. Try again; if it keeps failing, check the server log.", publishWarnings: "[]", publishFinishedAt: finishedAt }).go();
  }
}

export async function runSsrControl(message: SsrControlMessage): Promise<void> {
  if (message.kind === "publish") return runPublish(message.templateId);
  if (message.kind === "alwaysOn") {
    // Retried by the queue on failure; both steps are safe to repeat.
    try {
      return await (message.enabled ? enableAlwaysOn(message.templateId) : disableAlwaysOn(message.templateId));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await DeployedApp.patch({ templateId: message.templateId })
        .set({ alwaysOnStatus: "FAILED", alwaysOnError: `Couldn't switch always-on ${message.enabled ? "on" : "off"}: ${detail}. Plexo will retry.`.slice(0, 400) })
        .go()
        .catch(() => undefined);
      throw err;
    }
  }
  // Variables are re-applied from the stored values, so a retry is harmless. A failure is rethrown
  // so the queue retries it.
  await applySsrVariables(message.templateId, message.env);
}
