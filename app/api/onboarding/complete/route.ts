import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { User } from "@/lib/db/coreEntities";
import { handleSiteTool } from "@/lib/mcp/siteTools";
import { completeOnboarding, OnboardingError } from "@/lib/onboarding/complete";

/** "Use this design" / "Skip, just personalise": save the answers, build the site with site_create, finish onboarding. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Please sign in again to continue." }, { status: 401 });
  let body: { profile?: unknown; designId?: unknown; skipSite?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn't read that. Please try again." }, { status: 400 });
  }
  try {
    const result = await completeOnboarding(
      { profile: body.profile, designId: typeof body.designId === "string" ? body.designId : undefined, skipSite: body.skipSite === true },
      {
        saveUser: async (patch) => {
          await User.patch({ id: resolved.userId }).set(patch as never).go();
        },
        createSite: async (args) => {
          const made = await handleSiteTool("site_create", args, resolved);
          return { siteId: made.siteId, name: made.name, warnings: made.warnings };
        },
      },
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof OnboardingError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error && err.message ? err.message : "";
    console.error("onboarding complete failed", err);
    return NextResponse.json(
      { error: message || "We couldn't make your site just now. Nothing was lost: please try again in a moment." },
      { status: 500 },
    );
  }
}
