import { NextRequest, NextResponse } from "next/server";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { issueHumanCheck } from "@/lib/forms/humanCheck";

/** GET: a small signed ticket that a form on this site carries when it is sent (lib/forms/humanCheck.ts). Never cached. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(templateId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // A real page asks once per load; a generous cap stops a script from asking thousands of times.
  if (!(await checkCommerceRateLimit(`forms:check:${templateId}:${clientIp(request)}`, 60))) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ token: issueHumanCheck(templateId) }, { headers: { "Cache-Control": "no-store" } });
}
