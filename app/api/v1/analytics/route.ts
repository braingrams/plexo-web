import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveUser } from "../domains/route";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get("templateId")?.trim() || undefined;
  const filter = searchParams.get("filter")?.trim() || "all"; // "all" | "published"

  try {
    // 1. Build template filter matching the user
    const templateFilter: any = {
      userId: resolved.userId,
    };

    if (templateId) {
      templateFilter.id = templateId;
    } else if (filter === "published") {
      // Filter for templates that have active domain mappings
      templateFilter.publishedDomains = {
        some: {},
      };
    }

    // 2. Fetch templates that match the filters
    const templates = await prisma.template.findMany({
      where: templateFilter,
      select: {
        id: true,
        name: true,
      },
    });

    const templateIds = templates.map((t) => t.id);

    // 3. Define analytics query range (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // 4. Fetch page views in the last 7 days for these templates
    const pageViews = await prisma.pageView.findMany({
      where: {
        templateId: { in: templateIds },
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        createdAt: true,
        ipHash: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // 5. Generate daily calendar timeline (last 7 days)
    const timelineData: Record<string, { date: string; views: number; uniqueVisitors: number; ips: Set<string> }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      timelineData[key] = {
        date: key,
        views: 0,
        uniqueVisitors: 0,
        ips: new Set<string>(),
      };
    }

    // 6. Group page views by day
    pageViews.forEach((view) => {
      const key = view.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (timelineData[key]) {
        timelineData[key].views += 1;
        if (view.ipHash) {
          timelineData[key].ips.add(view.ipHash);
        }
      }
    });

    // Compute unique visitors counts per day
    const chartData = Object.values(timelineData).map((day) => ({
      date: day.date,
      views: day.views,
      uniqueVisitors: day.ips.size,
    }));

    // Calculate total aggregates
    const totalViews = pageViews.length;
    
    // Total unique visitors across the entire 7 days
    const uniqueIps = new Set(pageViews.map((pv) => pv.ipHash).filter(Boolean));
    const totalUnique = uniqueIps.size;

    return NextResponse.json({
      success: true,
      templates,
      totalViews,
      totalUnique,
      chartData,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch analytics data." },
      { status: 500 }
    );
  }
}
