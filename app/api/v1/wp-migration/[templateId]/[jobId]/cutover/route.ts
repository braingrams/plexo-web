import { NextRequest, NextResponse } from "next/server";
import { PublishedDomain } from "@/lib/db/contentEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { isValidUuid } from "@/lib/slugUtils";
import { assertOwnSite, resolveMigrationAccess } from "@/lib/wpMigration/access";
import { analyzeDomain, plexoRoutingEndpoint } from "@/lib/wpMigration/cutover";
import type { WpInstall } from "@/lib/wpMigration/types";

export const maxDuration = 60;

/** GET — read the domain's live DNS and build the switch-over plan (records to keep, records to add, zone file). */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string; jobId: string }> }): Promise<NextResponse> {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return resolved.error;
  const notOwn = await assertOwnSite(resolved.access, templateId);
  if (notOwn) return notOwn;
  if (!isValidUuid(jobId)) return NextResponse.json({ error: "Migration not found." }, { status: 404 });
  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job) return NextResponse.json({ error: "Migration not found." }, { status: 404 });

  const origin = (job.install as WpInstall).origin;
  const host = new URL(origin).host.replace(/^www\./, "");
  const { data: domains } = await PublishedDomain.query.primary({ templateId }).go();
  const ours = domains.filter((d) => d.type === "CUSTOM" && (d.domain === host || d.domain === `www.${host}`));
  const validations = ours
    .map((d) => d as { certificateValidationName?: string; certificateValidationValue?: string })
    .filter((d) => d.certificateValidationName && d.certificateValidationValue)
    .map((d) => ({ name: d.certificateValidationName!, value: d.certificateValidationValue! }));

  let routingEndpoint: string;
  try {
    routingEndpoint = plexoRoutingEndpoint();
  } catch {
    return NextResponse.json({ error: "Custom domains aren't available in this environment." }, { status: 503 });
  }
  const plan = await analyzeDomain(origin, { routingEndpoint, validations });
  const cutover = { ...((job.cutover as object | undefined) ?? {}), plan };
  await WpMigrationJob.patch({ templateId, id: jobId }).set({ cutover }).go();
  return NextResponse.json({
    plan,
    connected: ours.map((d) => ({ domain: d.domain, ready: Boolean(d.dnsVerified) || (d as { certificateStatus?: string }).certificateStatus === "ISSUED" })),
    verification: (job.cutover as { verification?: unknown } | undefined)?.verification ?? null,
  });
}
