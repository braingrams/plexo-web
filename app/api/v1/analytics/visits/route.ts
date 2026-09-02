import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { PageView } from "@/lib/db/opsEntities";

/**
 * GET /api/v1/analytics/visits
 *
 * Paginated list of individual page-view records (not the aggregate stats
 * /api/v1/analytics returns) — backs the dashboard's "view visitor details" drill-down.
 * Never returns ipHash or userAgent raw strings to the client; only the derived,
 * already-coarse fields (country/region/city/device/browser/os).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get("templateId")?.trim() || undefined;
  const filter = searchParams.get("filter")?.trim() || "all"; // "all" | "published"
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

  try {
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go();
    let templates = orgTemplates.map((t) => ({ id: t.id, name: t.name }));

    if (filter === "published") {
      // Same fan-out-per-template discipline as /api/v1/analytics — PublishedDomain has
      // no cross-template index, only its own templateId-scoped primary key.
      const domainBatches = await Promise.all(
        orgTemplates.map((t) => PublishedDomain.query.primary({ templateId: t.id }).go()),
      );
      templates = templates.filter((_, i) => domainBatches[i].data.length > 0);
    }

    const templateNameById = new Map(templates.map((t) => [t.id, t.name]));

    if (templateId && !templateNameById.has(templateId)) {
      return NextResponse.json({ error: "Template not found for this account." }, { status: 404 });
    }

    const targetTemplateIds = templateId ? [templateId] : templates.map((t) => t.id);

    // PageView has no cross-template or org-wide index (see opsEntities.ts) — the offset
    // pagination here is inherently application-side rather than a DynamoDB paginator
    // (there's no random-access "skip N items" primitive), so this fans out per template,
    // pages through each partition in full via `pages: "all"`, and sorts/slices in memory.
    // Same discipline as app/dashboard/page.tsx's PageView usage — bounded by how many
    // sites + how much view history one org realistically has, not a hot path.
    const pageViewBatches = await Promise.all(
      targetTemplateIds.map((id) => PageView.query.primary({ templateId: id }).go({ pages: "all" })),
    );
    const allVisits = pageViewBatches
      .flatMap((batch) => batch.data)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = allVisits.length;
    const visits = allVisits.slice(offset, offset + limit).map((v) => ({
      id: v.id,
      templateId: v.templateId,
      domain: v.domain ?? null,
      createdAt: v.createdAt,
      country: v.country ?? null,
      region: v.region ?? null,
      city: v.city ?? null,
      deviceType: v.deviceType ?? null,
      browser: v.browser ?? null,
      os: v.os ?? null,
      templateName: templateNameById.get(v.templateId) || null,
    }));

    return NextResponse.json({
      success: true,
      visits,
      total,
      limit,
      offset,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch visit details." },
      { status: 500 }
    );
  }
}
