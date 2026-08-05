import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/app/api/v1/domains/route";
import { submitTemplateForMarketplace } from "@/lib/marketplaceListing";

/**
 * POST /api/v1/marketplace/listings
 *
 * Lets a user submit one of their own root templates for sale on the marketplace. Creates
 * a decoupled clone (see lib/marketplaceListing.ts) owned by the same seller, starting at
 * PENDING_REVIEW unless PlatformSettings.autoPublishMarketplaceListings is on.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    templateId?: string;
    priceCents?: number;
    category?: string;
    description?: string;
  };

  const templateId = body.templateId?.trim();
  if (!templateId) {
    return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  }

  const priceCents = typeof body.priceCents === "number" && Number.isFinite(body.priceCents) ? body.priceCents : null;
  if (priceCents !== null && priceCents < 0) {
    return NextResponse.json({ error: "priceCents cannot be negative." }, { status: 400 });
  }

  try {
    const listing = await submitTemplateForMarketplace(
      resolved.userId,
      resolved.organizationId,
      templateId,
      {
        priceCents,
        category: body.category ?? null,
        description: body.description ?? null,
      },
    );
    return NextResponse.json({ listing }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to submit listing." },
      { status: 400 },
    );
  }
}
