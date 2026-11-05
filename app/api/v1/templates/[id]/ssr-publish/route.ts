import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { publishSsrPreview } from "@/lib/appFunctions/deploy";
import { getTierFeatures } from "@/lib/subscription";

/**
 * POST /api/v1/templates/:id/ssr-publish
 *
 * Promotes the app's latest SSR preview to live: the live function runs the same bundle the
 * preview tested, and the public site switches to it. ULTRA plan only.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 });
  }
  if (!getTierFeatures(resolved.subscriptionPlan).ssrEnabled) {
    return NextResponse.json({ error: "Server-rendered apps are available on the ULTRA plan." }, { status: 403 });
  }
  const { id: templateId } = await context.params;
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 });
  }
  const result = await publishSsrPreview(templateId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({
    functionName: result.functionName,
    warnings: result.warnings,
    message: result.warnings.length ? "The preview is now live, with warnings." : "The preview is now live.",
  });
}
