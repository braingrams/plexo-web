import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";
import { decryptPaystackKey } from "@/lib/crypto";
import { listPaystackCustomers } from "@/lib/paystack";

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

  const settings = await prisma.commerceSettings.findUnique({ where: { templateId } });
  if (!settings?.paystackSecretKeyEncrypted) {
    return NextResponse.json({ error: "Paystack isn't configured for this site yet." }, { status: 400 });
  }

  const page = Number(request.nextUrl.searchParams.get("page") ?? "1") || 1;

  try {
    const result = await listPaystackCustomers({ secretKey: decryptPaystackKey(settings.paystackSecretKeyEncrypted), page });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load customers from Paystack." }, { status: 502 });
  }
}
