import { NextRequest, NextResponse } from "next/server";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { personalizeTemplate } from "@/lib/onboarding/personalize";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = sanitizeBuildProfile(body.profile ?? {});
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const designId = typeof body.designId === "string" ? body.designId : undefined;
    const templateHtml = typeof body.templateHtml === "string" && body.templateHtml.trim() ? body.templateHtml : undefined;
    const templateName = typeof body.templateName === "string" && body.templateName.trim() ? body.templateName.trim() : undefined;
    const templateDescription = typeof body.templateDescription === "string" && body.templateDescription.trim() ? body.templateDescription.trim() : undefined;

    const result = await personalizeTemplate({
      profile: parsed.value,
      designId,
      templateHtml,
      templateName,
      templateDescription,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to personalize template." },
      { status: 500 }
    );
  }
}
