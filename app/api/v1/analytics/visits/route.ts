import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "../../domains/route";

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
    const templates = await prisma.template.findMany({
      where: {
        userId: resolved.userId,
        ...(filter === "published" ? { publishedDomains: { some: {} } } : {}),
      },
      select: { id: true, name: true },
    });
    const templateNameById = new Map(templates.map((t) => [t.id, t.name]));

    if (templateId && !templateNameById.has(templateId)) {
      return NextResponse.json({ error: "Template not found for this account." }, { status: 404 });
    }

    const targetTemplateIds = templateId ? [templateId] : templates.map((t) => t.id);
    const where = { templateId: { in: targetTemplateIds } };

    const [visits, total] = await Promise.all([
      prisma.pageView.findMany({
        where,
        select: {
          id: true,
          templateId: true,
          domain: true,
          createdAt: true,
          country: true,
          region: true,
          city: true,
          deviceType: true,
          browser: true,
          os: true,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.pageView.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      visits: visits.map((v) => ({ ...v, templateName: templateNameById.get(v.templateId) || null })),
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
