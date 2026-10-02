import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { CommerceSettings } from "@/lib/db/commerceEntities";
import { isGatewayReady } from "@/lib/commerce/checkoutPayment";
import { publicBankDetails } from "@/lib/commerce/bankTransfer";
import { readCheckoutFields, toPublicCheckoutFields } from "@/lib/commerce/checkoutFields";
import { resolveFulfillmentOptions } from "@/lib/commerce/delivery";

/**
 * Everything the storefront's checkout UI needs to decide WHAT to show — which payment
 * options exist (card gateway, bank transfer + the bank details to pay into), the owner's
 * extra checkout questions, and whether delivery/pickup are offered. Read-only and
 * secret-free by construction: bank details are meant to be shown to every customer.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { data: settings } = await CommerceSettings.get({ templateId: siteResult.published.templateId }).go();
  const fulfillment = resolveFulfillmentOptions(settings);
  const provider = settings?.paymentProvider ?? "BYO_PAYSTACK";

  return NextResponse.json({
    payment: {
      online: settings ? isGatewayReady(settings) : false,
      gateway: provider === "PLATFORM_STRIPE" || provider === "BYO_STRIPE" ? "stripe" : "paystack",
      bankTransfer: publicBankDetails(settings),
    },
    fields: toPublicCheckoutFields(readCheckoutFields(settings?.checkoutFields)),
    fulfillment,
  });
}
