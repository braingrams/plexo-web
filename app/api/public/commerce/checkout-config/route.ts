import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { CommerceSettings, CommerceDiscountCode } from "@/lib/db/commerceEntities";
import { isGatewayReady } from "@/lib/commerce/checkoutPayment";
import { publicBankDetails } from "@/lib/commerce/bankTransfer";
import { readCheckoutFields, toPublicCheckoutFields } from "@/lib/commerce/checkoutFields";
import { resolveFulfillmentOptions } from "@/lib/commerce/delivery";
import { termsLink } from "@/lib/commerce/terms";

/**
 * Everything the storefront's checkout UI needs to decide WHAT to show — which payment
 * options exist (card gateway, bank transfer + the bank details to pay into), the owner's
 * extra checkout questions, whether delivery/pickup are offered, and whether a discount
 * code box is worth showing at all (a store with no usable codes shouldn't ask for one).
 * Read-only and secret-free by construction: bank details are meant to be shown to every
 * customer.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const templateId = siteResult.published.templateId;
  const [{ data: settings }, { data: discountCodes }] = await Promise.all([
    CommerceSettings.get({ templateId }).go(),
    CommerceDiscountCode.query.primary({ templateId }).go({ pages: "all" }),
  ]);
  const now = new Date().toISOString();
  const discounts = discountCodes.some(
    (d) => (d.active ?? true) && (!d.expiresAt || d.expiresAt > now) && (d.usageLimit == null || (d.usedCount ?? 0) < d.usageLimit),
  );
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
    discounts,
    terms: termsLink(settings, request.nextUrl.origin),
  });
}
