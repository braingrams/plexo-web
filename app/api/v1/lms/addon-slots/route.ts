import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { LmsFunnelAddonSlot } from "@/lib/db/contentEntities";
import { getAvailableFunnelSlots } from "@/lib/lms/funnelSlots";

/**
 * GET /api/v1/lms/addon-slots
 *
 * Purchasing a slot goes through the canonical /api/billing/checkout surface (kind:
 * "funnel_addon_slot") rather than a bespoke endpoint here — same "one checkout surface,
 * many deep-link entry points" principle as every other upsell. Cancelling one is
 * self-service through the existing Stripe Customer Portal (billing-section.tsx's "Manage
 * subscription" button already opens it) — no bespoke cancel route either. This route is
 * read-only: the org's current slot usage, for the Funnels module and Billing settings to
 * both display.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [slots, { data: addonSlots }] = await Promise.all([
    getAvailableFunnelSlots(resolved.organizationId, resolved.subscriptionPlan),
    LmsFunnelAddonSlot.query.primary({ organizationId: resolved.organizationId }).go({ pages: "all" }),
  ]);

  return NextResponse.json({
    ...slots,
    addonSlots: addonSlots
      .filter((s) => s.status !== "CANCELLED")
      .map((s) => ({ id: s.id, status: s.status, createdAt: s.createdAt })),
  });
}
