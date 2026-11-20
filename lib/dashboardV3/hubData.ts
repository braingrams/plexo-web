import { notFound, redirect } from "next/navigation";
import type { PlanId } from "@/lib/plan/plans";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { User } from "@/lib/db/coreEntities";
import { Template, PublishedDomain, BlogSite } from "@/lib/db/contentEntities";
import { DeployedApp } from "@/lib/db/appEntities";
import { CommerceSettings, CommerceProduct, CommerceCategory } from "@/lib/db/commerceEntities";
import { PageView } from "@/lib/db/opsEntities";
import { getPageTree, pathForPage } from "@/server/slugDynamo";
import { effectivePlan } from "@/lib/plan/entitlement";
import { usesNewShell } from "../dashboardVersions/state";
import { readBuildProfile, userExperience } from "./profile";
import type { Experience } from "./nav";
import { hubKindLabel, pagePath, type HubFeatures } from "./hubTabs";
import type { SiteKindLabel } from "./sites";
import { readSiteBrand, type SiteBrand } from "./brandLook";

export type HubContext = { userId: string; organizationId: string; experience: Experience; plan: PlanId; brand: Record<string, unknown> | null };

/** Signed-in owner of the v3 dashboard. Anyone else is sent where they belong (the old dashboard when v3 is off). */
export async function requireHubContext(redirectTo: string): Promise<HubContext> {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  const org = await ensureActiveOrganization(session.user.id);
  if (org.status === "needs-choice") redirect("/choose-org");
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user || !(await usesNewShell(user))) redirect("/dashboard");
  return { userId: session.user.id, organizationId: org.organizationId, experience: userExperience(user), plan: effectivePlan(user), brand: (readBuildProfile(user.buildProfile)?.brand as Record<string, unknown> | undefined) ?? null };
}

export type HubDomain = { id: string; domain: string; type: "SUBDOMAIN" | "CUSTOM"; active: boolean; certificateStatus: string | null };

export type HubPage = {
  id: string;
  name: string;
  slug: string | null;
  path: string;
  isRoot: boolean;
  parentId: string | null;
  order: number;
  isPublished: boolean;
  archivedByPlan: boolean;
  sourceType: "BUILDER" | "RAW_UPLOAD" | "REACT_PROJECT";
  updatedAt: string;
};

export type HubSite = {
  id: string;
  name: string;
  kind: SiteKindLabel;
  status: "live" | "draft";
  address: string | null;
  features: HubFeatures;
  sourceType: "BUILDER" | "RAW_UPLOAD" | "REACT_PROJECT";
  designFormat: string;
  domains: HubDomain[];
  currency: string;
  /** For a hosted app: whether visitors can open it and what it's built with. */
  deployed: "server" | "static" | null;
  app: { kind: "server" | "static"; isLive: boolean; framework: string | null } | null;
  /** Where "Edit design" goes. */
  editHref: string;
  /** This site's own logo and colours (not the account default). */
  brand?: SiteBrand;
};

const asSource = (s: unknown): HubSite["sourceType"] => (s === "RAW_UPLOAD" || s === "REACT_PROJECT" ? s : "BUILDER");

import { editHrefFor } from "./hubPaths";
import { isAppKind } from "./siteFilter";
export { editHrefFor };

/** The site (a root page) with what it uses; 404 when it isn't theirs. */
export async function loadHubSite(organizationId: string, id: string): Promise<HubSite> {
  const { data: t } = await Template.get({ id }).go();
  if (!t || t.organizationId !== organizationId || t.parentId || t.kind !== "LANDING_PAGE") notFound();
  const [{ data: commerce }, { data: blog }, { data: domains }, { data: deployed }] = await Promise.all([
    CommerceSettings.get({ templateId: id }).go(),
    BlogSite.get({ templateId: id }).go(),
    PublishedDomain.query.primary({ templateId: id }).go({ pages: "all" }),
    DeployedApp.get({ templateId: id }).go(),
  ]);
  const sourceType = asSource(t.sourceType);
  const features: HubFeatures = {
    store: !!commerce?.enabled,
    blog: !!blog?.enabled,
    course: !!t.isLmsFunnel,
    app: sourceType === "REACT_PROJECT",
    ownCode: sourceType === "RAW_UPLOAD",
    deployed: deployed ? (deployed.type === "SSR" ? "server" : "static") : null,
    migrated: !!t.migratedFrom,
  };
  const live = domains.filter((d) => d.active !== false);
  const best = live.find((d) => d.type === "CUSTOM") ?? live[0];
  return {
    id,
    name: t.name || "Untitled site",
    kind: hubKindLabel(features),
    status: live.length ? "live" : "draft",
    address: best?.domain ?? null,
    features,
    sourceType,
    designFormat: t.designFormat ?? "v1",
    domains: domains.map((d) => ({ id: d.id, domain: d.domain, type: d.type as HubDomain["type"], active: d.active !== false, certificateStatus: (d as { certificateStatus?: string }).certificateStatus ?? null })),
    currency: commerce?.currency ?? "NGN",
    deployed: features.deployed ?? null,
    app: deployed ? { kind: deployed.type === "SSR" ? "server" : "static", isLive: deployed.type === "SSR" ? Boolean(deployed.functionUrl) : Boolean(deployed.s3Prefix), framework: deployed.framework ?? null } : null,
    editHref: editHrefFor(id, sourceType),
    brand: readSiteBrand(t.brand),
  };
}

export async function loadHubPages(organizationId: string, siteId: string): Promise<HubPage[]> {
  const tree = await getPageTree(organizationId, siteId);
  if (!tree) return [];
  return tree.pages
    .map((p) => {
      const isRoot = p.id === tree.rootId;
      const path = isRoot ? "/" : pathForPage(p.id, tree.pages);
      return { id: p.id, name: p.name, slug: p.slug, path: path === "/" ? "/" : pagePath(path.split("/").filter(Boolean)), isRoot, parentId: p.parentId, order: p.order ?? 0, isPublished: p.isPublished, archivedByPlan: p.archivedByPlan, sourceType: p.sourceType, updatedAt: p.updatedAt };
    })
    .sort((a, b) => (a.isRoot === b.isRoot ? 0 : a.isRoot ? -1 : 1));
}

export type HubProduct = { id: string; name: string; description: string | null; kind: "PHYSICAL" | "SERVICE" | "DIGITAL"; priceMinor: number; imageUrl: string | null; active: boolean; stockQuantity: number | null; category: string | null };

export async function loadHubProducts(siteId: string): Promise<HubProduct[]> {
  const [{ data: products }, { data: categories }] = await Promise.all([
    CommerceProduct.query.primary({ templateId: siteId }).go({ pages: "all" }),
    CommerceCategory.query.primary({ templateId: siteId }).go({ pages: "all" }),
  ]);
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  return [...products]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      kind: (p.kind ?? "PHYSICAL") as HubProduct["kind"],
      priceMinor: p.priceMinor,
      imageUrl: p.imageUrl ?? null,
      active: p.active ?? true,
      stockQuantity: p.stockQuantity ?? null,
      category: p.categoryId ? cat.get(p.categoryId) ?? null : null,
    }));
}

export type HubVisits = { total: number; days: { label: string; views: number }[] };

/** Page views over the last `days` days, per day (same source as the old Insights page). */
export async function loadHubVisits(siteId: string, days = 14): Promise<HubVisits> {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);
  const { data } = await PageView.query.primary({ templateId: siteId }).between({ createdAt: since.toISOString() }, { createdAt: new Date().toISOString() }).go({ pages: "all" });
  const buckets = new Map<string, number>();
  const order: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, 0);
    order.push(key);
  }
  for (const v of data) {
    const key = new Date(v.createdAt).toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return {
    total: data.length,
    days: order.map((key) => ({ label: new Date(key).toLocaleDateString("en", { month: "short", day: "numeric" }), views: buckets.get(key) ?? 0 })),
  };
}

export type HubSiteCard = { id: string; name: string; kind: SiteKindLabel; status: "live" | "draft"; address: string | null; visits7d: number; editHref: string; app: boolean };

/** Every site as a card for /dashboard/sites. */
export async function loadHubSiteCards(organizationId: string, userId: string): Promise<HubSiteCard[]> {
  const { loadV3Sites } = await import("./loadShell");
  const sites = await loadV3Sites(organizationId, userId);
  const week = new Date(Date.now() - 7 * 86400000).toISOString();
  return Promise.all(
    sites.map(async (s) => {
      const [{ data: commerce }, { data: blog }, { data: t }, { data: deployed }, views] = await Promise.all([
        CommerceSettings.get({ templateId: s.id }).go(),
        BlogSite.get({ templateId: s.id }).go(),
        Template.get({ id: s.id }).go(),
        DeployedApp.get({ templateId: s.id }).go(),
        PageView.query.primary({ templateId: s.id }).between({ createdAt: week }, { createdAt: new Date().toISOString() }).go({ pages: "all" }).then((r) => r.data.length).catch(() => 0),
      ]);
      const features: HubFeatures = { store: !!commerce?.enabled, blog: !!blog?.enabled, course: !!t?.isLmsFunnel, app: t?.sourceType === "REACT_PROJECT", ownCode: t?.sourceType === "RAW_UPLOAD", deployed: deployed ? (deployed.type === "SSR" ? "server" : "static") : null, migrated: !!t?.migratedFrom };
      return { id: s.id, name: s.name, kind: hubKindLabel(features), status: s.status, address: s.address ?? null, visits7d: views, editHref: editHrefFor(s.id, t?.sourceType), app: isAppKind(hubKindLabel(features)) };
    }),
  );
}
