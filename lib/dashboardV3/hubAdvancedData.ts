import { Template, BlogRedirect, SiteLayout, PublishedDomain } from "@/lib/db/contentEntities";
import { CustomContentType, CustomContentEntry } from "@/lib/db/customContentEntities";
import { FormSubmission } from "@/lib/db/opsEntities";
import { DeployedApp } from "@/lib/db/appEntities";
import { requireSiteLayoutAccess } from "@/lib/siteLayoutDynamo";
import { requireCustomContentPageAccess } from "@/lib/customContent/adminAuthDynamo";
import { getOrganizationOwnerPlanDynamo } from "@/server/orgDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { loadHubPages } from "./hubData";
import type { AdvancedSectionId } from "./hubAdvanced";
import type { RedirectSummary } from "@/app/dashboard/templates/[id]/redirects/RedirectsClient";
import type { ContentTypeSummary } from "@/app/dashboard/templates/[id]/content-types/ContentTypesClient";
import type { FeaturesData } from "@/app/dashboard/_v3/hub/advanced/FeaturesSection";

export type DeployInfo = { framework: string; spaMode: boolean; updatedAt: string; hostingTier: string; allowedTiers: string[]; ssr: boolean } | null;

/** What the owner's plan allows for servers, needed to know which Advanced sections apply. Cheap: one read. */
export async function loadServerPlan(organizationId: string): Promise<{ ssrEnabled: boolean; allowedTiers: string[] }> {
  const plan = await getOrganizationOwnerPlanDynamo(organizationId);
  const f = getTierFeatures(plan);
  return { ssrEnabled: f.ssrEnabled, allowedTiers: f.deployedAppHostingTiers };
}

export type AdvancedData = {
  redirects?: RedirectSummary[];
  contentTypes?: ContentTypeSummary[];
  layout?: { enabled: boolean; header: { templateId: string; updatedAt: string } | null; footer: { templateId: string; updatedAt: string } | null };
  features?: FeaturesData;
  deploy?: { app: DeployInfo; liveDomain: string | null };
};

/** Only what the chosen section needs, so opening Advanced stays quick. */
export async function loadAdvancedData(organizationId: string, siteId: string, section: AdvancedSectionId, allowedTiers: string[]): Promise<AdvancedData> {
  switch (section) {
    case "redirects": {
      const { data } = await BlogRedirect.query.primary({ templateId: siteId }).go({ pages: "all" });
      data.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      return { redirects: data.map((r) => ({ fromPath: r.fromPath, toPath: r.toPath, createdAt: r.createdAt ?? new Date().toISOString() })) };
    }
    case "lists": {
      await requireCustomContentPageAccess(siteId, `/dashboard/sites/${siteId}?tab=advanced&section=lists`);
      return { contentTypes: await contentTypes(siteId) };
    }
    case "layout": {
      const access = await requireSiteLayoutAccess(siteId, `/dashboard/sites/${siteId}?tab=advanced&section=layout`);
      const { data: layout } = await SiteLayout.get({ templateId: access.templateId }).go();
      const [h, f] = await Promise.all([
        layout?.headerTemplateId ? Template.get({ id: layout.headerTemplateId }).go() : null,
        layout?.footerTemplateId ? Template.get({ id: layout.footerTemplateId }).go() : null,
      ]);
      const frag = (r: typeof h) => (r?.data ? { templateId: r.data.id, updatedAt: r.data.updatedAt ?? new Date().toISOString() } : null);
      return { layout: { enabled: layout?.enabled ?? false, header: frag(h), footer: frag(f) } };
    }
    case "features": {
      const [{ data: layout }, pages, { data: subs }, types] = await Promise.all([
        SiteLayout.get({ templateId: siteId }).go(),
        loadHubPages(organizationId, siteId),
        FormSubmission.query.primary({ templateId: siteId }).go({ pages: "all" }),
        CustomContentType.query.primary({ templateId: siteId }).go({ pages: "all" }),
      ]);
      return { features: { layoutEnabled: layout?.enabled ?? false, pageCount: pages.length, submissionCount: subs.length, contentTypeCount: types.data.length } };
    }
    case "deploy": {
      const [{ data: app }, { data: domains }] = await Promise.all([DeployedApp.get({ templateId: siteId }).go(), PublishedDomain.query.primary({ templateId: siteId }).go({ pages: "all" })]);
      const live = domains.find((d) => d.active !== false);
      return {
        deploy: {
          liveDomain: live?.domain ?? null,
          app: app ? { framework: app.framework ?? "spa", spaMode: app.spaMode ?? false, updatedAt: app.updatedAt ?? app.createdAt ?? new Date().toISOString(), hostingTier: app.hostingTier ?? "LAMBDA", allowedTiers, ssr: app.type === "SSR" } : null,
        },
      };
    }
    default:
      return {};
  }
}

async function contentTypes(siteId: string): Promise<ContentTypeSummary[]> {
  const { data } = await CustomContentType.query.primary({ templateId: siteId }).go({ pages: "all" });
  data.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const counts = await Promise.all(data.map((ct) => CustomContentEntry.query.primary({ contentTypeId: ct.id }).go({ pages: "all" })));
  return data.map((ct, i) => ({ id: ct.id, name: ct.name, slug: ct.slug, fields: Array.isArray(ct.fields) ? ct.fields : [], entryCount: counts[i].data.length, createdAt: ct.createdAt ?? new Date().toISOString() }));
}
