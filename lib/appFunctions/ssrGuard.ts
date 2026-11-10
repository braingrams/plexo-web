// Shared checks for the SSR settings routes: signed in, the template is the caller's, and the plan includes SSR.
import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { getTierFeatures } from "@/lib/subscription";

export async function guardSsrSettings(
  request: NextRequest,
  templateId: string,
): Promise<{ error: NextResponse } | { ok: true }> {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 }) };
  if (!getTierFeatures(resolved.subscriptionPlan).ssrEnabled) {
    return { error: NextResponse.json({ error: "Server-rendered apps are available on the ULTRA plan." }, { status: 403 }) };
  }
  const { data: template } = await Template.get({ id: templateId }).go({ attributes: ["id", "organizationId"] });
  if (!template || template.organizationId !== resolved.organizationId) {
    return { error: NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 }) };
  }
  return { ok: true };
}
