import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { findRootTemplateId } from "@/lib/siteLayoutDynamo";
import { getTierFeatures, isHomePageOnlyPlan } from "@/lib/subscription";
import { findSecondaryPageLinks, isDomainLive, otherLiveSites } from "@/lib/plan/siteLimits";
import { listGovernedSites } from "@/lib/plan/sitesStore";
import { canStartTrial } from "@/lib/plan/entitlement";

/**
 * GET /api/v1/plan/site?templateId=<any page of the site>
 *
 * What the owner's plan means for this site right now — powers the editor's plan notice
 * (app/dashboard/_components/SitePlanNotice.tsx): whether the site is live, which other
 * site is live instead on Free, its unpublished pages, and links on the page being edited
 * that lead to pages Free doesn't publish.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templateId = request.nextUrl.searchParams.get("templateId") ?? "";
  const { data: page } = templateId ? await Template.get({ id: templateId }).go() : { data: null };
  if (!page || page.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }

  const rootId = await findRootTemplateId(page.id, page.parentId ?? null);
  const [sites, { data: user }] = await Promise.all([listGovernedSites(resolved.userId), User.get({ id: resolved.userId }).go()]);
  const site = sites.find((s) => s.id === rootId) ?? null;
  const plan = resolved.subscriptionPlan;
  const homeOnly = isHomePageOnlyPlan(plan);
  const limit = getTierFeatures(plan).maxPublishedSites;

  const liveAddresses = site?.domains.filter(isDomainLive).map((d) => d.domain) ?? [];
  const otherLive = limit === null ? [] : otherLiveSites(sites, rootId);
  const allHosts = site?.domains.map((d) => d.domain) ?? [];

  // Links only matter on the homepage — on Free it's the one page visitors can reach.
  const secondaryLinks =
    homeOnly && !page.parentId && page.sourceType !== "REACT_PROJECT"
      ? findSecondaryPageLinks(`${page.draftHtml ?? ""}\n${page.compiledHtml ?? ""}`, allHosts)
      : [];

  return NextResponse.json({
    plan,
    previousPlan: user?.planBeforeDowngrade ?? null,
    trialAvailable: !!user && canStartTrial(user),
    homeOnly,
    /** True on any page that isn't the homepage: on Free, visitors can't open it. */
    isSecondaryPage: !!page.parentId,
    isApp: page.sourceType === "REACT_PROJECT",
    site: site
      ? {
          id: site.id,
          name: site.name,
          isLive: liveAddresses.length > 0,
          liveAddress: liveAddresses[0] ?? null,
          pausedCustomDomains: site.domains.filter((d) => d.type === "CUSTOM" && d.planDisabledAt).map((d) => d.domain),
          everPublished: site.domains.length > 0,
        }
      : null,
    otherLiveSite: otherLive[0] ? { id: otherLive[0].id, name: otherLive[0].name } : null,
    pageCount: (site?.pages.length ?? 0) + 1,
    unpublishedPageCount: site?.pages.filter((p) => p.isPublished === false).length ?? 0,
    archivedByPlanPageCount: site?.pages.filter((p) => !!p.planArchivedAt).length ?? 0,
    secondaryLinks,
  });
}
