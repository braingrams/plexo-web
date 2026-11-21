import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { personalizeTemplateLocally } from "@/lib/onboarding/personalize";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = sanitizeBuildProfile(body.profile ?? {});
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const recipeId = typeof body.designId === "string" ? body.designId : "home-lead";
    const result = personalizeTemplateLocally(parsed.value, recipeId);

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to personalize template." },
      { status: 500 }
    );
  }
}
