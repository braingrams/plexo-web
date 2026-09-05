import { NextRequest, NextResponse } from "next/server";
import { Template, LmsFunnel } from "@/lib/db/contentEntities";
import { CommerceProduct, CommerceSettings } from "@/lib/db/commerceEntities";

// Public, unauthenticated funnel metadata for the signup screen — name, free/paid, and
// price if a signup product is linked. Never exposes anything else about the funnel.
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;

  const [{ data: site }, { data: funnel }] = await Promise.all([
    Template.get({ id: templateId }).go(),
    LmsFunnel.get({ templateId }).go(),
  ]);
  if (!site || !funnel || !funnel.enabled) {
    return NextResponse.json({ error: "This funnel isn't available." }, { status: 404 });
  }

  let price: { priceMinor: number; currency: string } | null = null;
  if (funnel.signupMode === "PAID" && funnel.signupProductId) {
    const [{ data: product }, { data: settings }] = await Promise.all([
      CommerceProduct.get({ templateId, id: funnel.signupProductId }).go(),
      CommerceSettings.get({ templateId }).go(),
    ]);
    if (product) price = { priceMinor: product.priceMinor, currency: settings?.currency ?? "NGN" };
  }

  return NextResponse.json({
    name: site.name,
    signupMode: funnel.signupMode ?? "FREE",
    requireName: funnel.requireName ?? true,
    collectPhone: funnel.collectPhone ?? false,
    price,
  });
}
