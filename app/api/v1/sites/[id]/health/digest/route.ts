import { NextRequest, NextResponse } from "next/server";
import { authorizeSite } from "@/lib/sites/authorizeSite";
import { setDigestEnabled } from "@/lib/siteHealth/digest";

type Ctx = { params: Promise<{ id: string }> };

/** POST { enabled: boolean } → switches the weekly "Your site health" email on or off for this site. */
export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;
  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Tell us whether to turn the weekly email on or off." }, { status: 400 });
  await setDigestEnabled({ id: a.site.id, organizationId: a.site.organizationId }, body.enabled);
  return NextResponse.json({ emailDigest: body.enabled });
}
