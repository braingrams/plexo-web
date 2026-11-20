import { NextRequest, NextResponse } from "next/server";
import { authorizeSite } from "@/lib/sites/authorizeSite";
import { solFixSite } from "@/lib/siteHealth/solFix";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 90;

export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const a = await authorizeSite(request, (await ctx.params).id);
  if (a.error) return a.error;

  try {
    const result = await solFixSite(a.site.id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SOL could not complete all fixes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
