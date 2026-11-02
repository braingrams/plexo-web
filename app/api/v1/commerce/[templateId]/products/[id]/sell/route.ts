import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { sellProductOnPage } from "@/lib/commerce/sellProduct";
import { PageToolError } from "@/lib/mcp/v2Pages";

/**
 * "Sell this product" — puts the product on a page (the home page unless pageId says
 * otherwise) so visitors can buy it right there. The dashboard's one-click button and the
 * sell_product_on_page AI tool both run lib/commerce/sellProduct.ts. See that file for what
 * happens for each kind of page.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string; id: string }> }): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const admin = await resolveCommerceAdmin(request, templateId);
  if (admin.error) return admin.error;
  const permissionError = requirePermission(admin.context.role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await sellProductOnPage(resolved, {
      siteId: templateId,
      productId: id,
      pageId: typeof body.pageId === "string" ? body.pageId : undefined,
      publish: typeof body.publish === "boolean" ? body.publish : undefined,
      heading: typeof body.heading === "string" ? body.heading : undefined,
      text: typeof body.text === "string" ? body.text : undefined,
      buttonLabel: typeof body.buttonLabel === "string" ? body.buttonLabel : undefined,
      convertLinks: typeof body.convertLinks === "boolean" ? body.convertLinks : undefined,
      paymentLink: typeof body.paymentLink === "string" ? body.paymentLink : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PageToolError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
