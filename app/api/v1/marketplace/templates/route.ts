import { NextRequest, NextResponse } from "next/server";
import { TemplateKind } from "@prisma/client";

import { listMarketplaceTemplates } from "@/lib/marketplace";

/**
 * GET /api/v1/marketplace/templates
 * Public (no auth) — for external/AI-tool consumers. app/marketplace itself calls
 * lib/marketplace.ts's listMarketplaceTemplates directly rather than fetching this.
 *
 * Query params: category, kind (EMAIL|LANDING_PAGE), free ("true"|"false"), q (name
 * search), sort ("latest"|"popular", default "latest"), page (1-based, default 1).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const kindParam = searchParams.get("kind");
  const freeParam = searchParams.get("free");

  const result = await listMarketplaceTemplates({
    category: searchParams.get("category")?.trim() || undefined,
    kind: kindParam === "EMAIL" || kindParam === "LANDING_PAGE" ? (kindParam as TemplateKind) : undefined,
    free: freeParam === "true" ? true : freeParam === "false" ? false : undefined,
    q: searchParams.get("q")?.trim() || undefined,
    sort: searchParams.get("sort") === "popular" ? "popular" : "latest",
    page: Number(searchParams.get("page")) || 1,
  });

  return NextResponse.json(result);
}
