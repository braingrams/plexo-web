import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { saveSiteLook } from "@/lib/sites/saveLook";

/**
 * This site's logo and colours (the Brand tab's "Colours and logo" card). Each site has its own.
 *   PUT { colors: ["#E4572E", "#1F6FEB"?], logoUrl?: "https://...", logoSkipped?: true }
 * Saves them on the site, then puts them into the site's pages where that can be done automatically, and says plainly
 * what happened. (Shared with SOL's site_save_look: lib/sites/saveLook.ts.)
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Sign in to Plexo to continue." }, { status: 401 });
  const { id } = await ctx.params;
  const result = await saveSiteLook(resolved, id, await request.json().catch(() => null), revalidatePath);
  return NextResponse.json(result.body, { status: result.status });
}
