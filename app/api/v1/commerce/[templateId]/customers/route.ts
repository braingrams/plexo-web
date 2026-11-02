import { NextRequest, NextResponse } from "next/server";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { resolveCommerceCustomers } from "@/lib/commerce/customers";
import { parsePageRequest } from "@/lib/pagination";

/** Lists this site's customers, derived from its own CommerceOrder rows — see
 * resolveCommerceCustomers's own comment for why this replaced a Paystack-only
 * implementation (it simply errored out for any site on Stripe). */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { page, pageSize } = parsePageRequest(request.nextUrl.searchParams);

  const result = await resolveCommerceCustomers(templateId, { page, perPage: pageSize });
  return NextResponse.json({ ...result, pageSize });
}
