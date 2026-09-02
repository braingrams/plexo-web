import { NextRequest, NextResponse } from "next/server";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { decryptPaystackKey } from "@/lib/crypto";
import { listPaystackCustomers } from "@/lib/paystack";
import { resolveActivePaystackKeys } from "@/lib/commerce/paystack";
import { CommerceSettings } from "@/lib/db/commerceEntities";

/**
 * Lists this site's customers straight from Paystack (the merchant account that actually
 * processed their payments), rather than re-deriving a list from our own CommerceOrder
 * rows — see the Commerce plan's Customers note; this goes one step further and reads the
 * real source of truth instead of just aggregating locally.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const activeSecretKeyEncrypted = settings
    ? resolveActivePaystackKeys({
        paystackMode: settings.paystackMode ?? "TEST",
        paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
        paystackTestSecretKeyEncrypted: settings.paystackTestSecretKeyEncrypted ?? null,
        paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
        paystackLiveSecretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted ?? null,
      }).secretKeyEncrypted
    : null;
  if (!activeSecretKeyEncrypted) {
    return NextResponse.json({ error: "Paystack isn't configured for this site yet." }, { status: 400 });
  }

  const page = Number(request.nextUrl.searchParams.get("page") ?? "1") || 1;

  try {
    const result = await listPaystackCustomers({ secretKey: decryptPaystackKey(activeSecretKeyEncrypted), page });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load customers from Paystack." }, { status: 502 });
  }
}
