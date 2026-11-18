import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { MarketplaceUseError, useMarketplaceTemplate } from "@/lib/marketplaceUse";

/**
 * POST /api/v1/marketplace/templates/:id/use
 * Spins up a new site/email in the caller's own account from a marketplace template (free or
 * already purchased) — see lib/marketplaceUse.ts, shared with SOL's create_site_from_template.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const created = await useMarketplaceTemplate(resolved, id);
    return NextResponse.json({ template: { id: created.id, name: created.name, kind: created.kind } }, { status: 201 });
  } catch (err) {
    if (err instanceof MarketplaceUseError) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    throw err;
  }
}
