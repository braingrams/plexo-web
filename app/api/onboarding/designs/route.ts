import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { pickDesigns, rankDesigns, renderDesign } from "@/lib/onboarding/designs";
import { MIN_ABOUT, understandDescription, type Understood } from "@/lib/onboarding/understand";

/**
 * Onboarding's designs, rendered in the owner's own brand. POST { profile, ids?, all? }:
 *  - no ids: the 3 chosen for them (rendered) + the others (names only) for "See all designs";
 *  - ids: those designs, rendered (the live preview asks for one; "See all" asks for the rest).
 * Pure computation (no database), so it is also open in `next dev` for the preview route.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV !== "development") {
    // Imported here so the open development path never loads the database layer.
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    if (!(await resolveUser(request))) return NextResponse.json({ error: "Please sign in again to continue." }, { status: 401 });
  }
  let body: { profile?: unknown; ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn't read that. Please try again." }, { status: 400 });
  }
  const parsed = sanitizeBuildProfile(body.profile ?? {});
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const profile = parsed.value;
  // "Briefly describe what you want your website to look like": SOL names the kind of business and the feel, so the designs fit them. Free for the owner; skipped in the open dev preview.
  let understood: Understood | null = null;
  const about = profile.brand?.about?.trim() ?? "";
  if (about.length >= MIN_ABOUT && !profile.brand?.industry && process.env.NODE_ENV !== "development" && !Array.isArray(body.ids)) {
    const { resolveUser } = await import("@/lib/auth/resolveUser");
    const { checkCommerceRateLimit } = await import("@/lib/commerceRateLimitDynamo");
    const who = await resolveUser(request);
    if (who && (await checkCommerceRateLimit(`onboarding-understand:${who.userId}`, 30, 60 * 60 * 1000))) {
      understood = await understandDescription(about, profile.goal);
    }
  }
  if (understood) profile.brand = { ...(profile.brand ?? {}), industry: understood.industry, tone: understood.style };
  const ranked = rankDesigns(profile);
  const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === "string").slice(0, 12) : null;
  const wanted = ids ?? pickDesigns(profile).top.map((d) => d.id);
  const designs = wanted.map((id) => renderDesign(profile, id)).filter((d) => d !== null);
  return NextResponse.json({ designs, ...(ids ? {} : { others: pickDesigns(profile).others }), total: ranked.length, ...(understood ? { understood } : {}) });
}
