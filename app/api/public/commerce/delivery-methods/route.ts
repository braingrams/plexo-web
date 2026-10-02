import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { resolveAvailableDeliveryMethods, pickupLocationFor } from "@/lib/commerce/delivery";

/**
 * The storefront checkout flow's real delivery options for a given address — replaces
 * what used to be a hardcoded 2-option PICKUP/COURIER radio with a fake single pickup
 * location. `country`/`state` are optional: with neither, this returns every method with
 * no country/state restriction (i.e. what's eligible before the customer has typed an
 * address); the storefront re-calls this once they have, to narrow to what actually
 * covers them. Pickup options (including the built-in "Store pickup") are never
 * address-scoped — see resolveAvailableDeliveryMethods.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId } = siteResult.published;

  const country = request.nextUrl.searchParams.get("country");
  const state = request.nextUrl.searchParams.get("state");

  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const currency = settings?.currency ?? "NGN";

  const methods = await resolveAvailableDeliveryMethods(templateId, { country, state });

  return NextResponse.json({
    currency,
    methods: methods.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      feeMinor: m.feeMinor ?? 0,
      description: m.description ?? null,
      estimatedTimeLabel: m.estimatedTimeLabel ?? null,
      // Lets the storefront hold back country-limited options until the customer has
      // actually picked a country (otherwise they could choose one the server then rejects).
      countries: m.countries ?? [],
      // Where a PICKUP option is collected from — the built-in store pickup's own
      // pickupLocation setting, or a custom pickup method's description. null when the
      // owner hasn't said yet (the storefront then tells the customer the store will
      // follow up with pickup details).
      location: pickupLocationFor(m, settings) ?? null,
    })),
  });
}
