import { SiteGoogleAnalytics } from "@/lib/db/opsEntities";
import { organizationHasAnalyticsPlan } from "./ownerPlan";
import { disconnect, forgetTag } from "./connection";
import { lapseStep } from "./lapse";

/**
 * What happens to a Plexo-managed property when the owner's paid plan ends (the plan sweep calls this):
 *  - the tag stops straight away (lib/googleAnalytics/connection.ts tagForSite checks the plan on every page);
 *  - the property and its history are KEPT for 90 days, and paying again within that time switches everything back on;
 *  - after 90 days it moves to Google's trash, so Plexo's accounts never fill up with abandoned properties.
 */
export { LAPSE_RETENTION_DAYS, lapseStep, type LapseStep } from "./lapse";

export type ManagedSweepReport = { scanned: number; marked: number; restored: number; deleted: number };

export async function sweepManagedAnalytics(opts: { now?: Date; budgetMs?: number } = {}): Promise<ManagedSweepReport> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const report: ManagedSweepReport = { scanned: 0, marked: 0, restored: 0, deleted: 0 };
  const plans = new Map<string, boolean>();
  let cursor: string | null = null;
  do {
    const page: { data: { templateId: string; organizationId: string; mode?: string; lapsedAt?: string; propertyName?: string; handedOverTo?: string }[]; cursor: string | null } = await SiteGoogleAnalytics.scan.go({ cursor });
    cursor = page.cursor;
    for (const row of page.data) {
      if (Date.now() > deadline) return report;
      if (row.mode !== "managed") continue;
      report.scanned++;
      try {
        let entitled = plans.get(row.organizationId);
        if (entitled === undefined) {
          entitled = await organizationHasAnalyticsPlan(row.organizationId);
          plans.set(row.organizationId, entitled);
        }
        const step = lapseStep(row, entitled, now);
        if (step === "set_mark") {
          await SiteGoogleAnalytics.patch({ templateId: row.templateId }).set({ lapsedAt: now.toISOString() }).go();
          report.marked++;
        } else if (step === "clear_mark") {
          await SiteGoogleAnalytics.patch({ templateId: row.templateId }).remove(["lapsedAt"]).go();
          forgetTag(row.templateId);
          report.restored++;
        } else if (step === "delete") {
          await disconnect(row.templateId);
          report.deleted++;
        }
      } catch (err) {
        console.error("managed analytics sweep:", err instanceof Error ? err.message : "unknown error");
      }
    }
  } while (cursor);
  return report;
}
