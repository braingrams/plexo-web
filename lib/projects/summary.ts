import { PublishedDomain } from "@/lib/db/contentEntities";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { AppDatabase } from "@/lib/db/appEntities";
import { previewUrl } from "./previewHost";
import type { AppTemplate } from "./appAccess";

// What the dashboard, SOL and the Deploy API show about an app at a glance.

export async function appSummary(app: AppTemplate) {
  const [{ data: domains }, latest, live, { data: dbs }] = await Promise.all([
    PublishedDomain.query.primary({ templateId: app.id }).go({ pages: "all" }),
    app.latestBuildId ? ProjectBuild.get({ id: app.latestBuildId }).go().then((r) => r.data) : Promise.resolve(null),
    app.liveBuildId ? ProjectBuild.get({ id: app.liveBuildId }).go().then((r) => r.data) : Promise.resolve(null),
    AppDatabase.query.primary({ templateId: app.id }).go({ pages: "all" }),
  ]);
  const activeDomains = domains.filter((d) => d.active !== false).map((d) => ({ domain: d.domain, type: d.type, verified: d.type === "SUBDOMAIN" || !!d.dnsVerified }));
  return {
    id: app.id,
    name: app.name,
    previewUrl: app.previewHost ? previewUrl(app.previewHost) : null,
    liveUrl: live && activeDomains[0] ? `https://${activeDomains[0].domain}` : null,
    published: !!live,
    domains: activeDomains,
    headVersionId: app.headVersionId ?? null,
    latestBuild: latest ? { id: latest.id, versionId: latest.versionId, finishedAt: latest.finishedAt ?? null, summary: latest.summary ?? null } : null,
    liveBuild: live ? { id: live.id, versionId: live.versionId, finishedAt: live.finishedAt ?? null } : null,
    databases: dbs.map((d) => ({ env: d.env, status: d.status, lastMigrationAt: d.lastMigrationAt ?? null })),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}
