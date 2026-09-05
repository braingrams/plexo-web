import { NextRequest, NextResponse } from "next/server";
import { lmsSessionCookieName } from "@/lib/lms/session";

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const response = NextResponse.json({ success: true });
  response.cookies.delete(lmsSessionCookieName(templateId));
  return response;
}
