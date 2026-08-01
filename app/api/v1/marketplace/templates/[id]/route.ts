import { NextRequest, NextResponse } from "next/server";

import { getMarketplaceTemplateDetail } from "@/lib/marketplace";
import { resolveUser } from "@/app/api/v1/domains/route";

/**
 * GET /api/v1/marketplace/templates/:id
 * Public detail — for external/AI-tool consumers. app/marketplace/[id] itself calls
 * lib/marketplace.ts's getMarketplaceTemplateDetail directly rather than fetching this.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const resolved = await resolveUser(request);
  const detail = await getMarketplaceTemplateDetail(id, resolved?.userId ?? null);

  if (!detail) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  return NextResponse.json({ template: detail });
}
