import { NextRequest, NextResponse } from "next/server";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { resendDonationReceipt } from "@/lib/commerce/donations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id: orderId } = await params;
  const auth = await resolveCommerceAdmin(request, templateId);
  if (auth.error) return auth.error;

  try {
    const result = await resendDonationReceipt(templateId, orderId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resend confirmation receipt." },
      { status: 500 },
    );
  }
}
