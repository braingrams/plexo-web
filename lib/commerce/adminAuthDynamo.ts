import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import type { OrgRole } from "@/server/accessControl";

// maskSecret now lives in lib/commerce/maskSecret.ts (no `next/server` import there) so
// lib/mcp/commerceTools.ts — part of SOL's standalone Lambda bundle — can import it without
// pulling next/server into that bundle. Re-exported here so every existing call site that
// already imports it from this file keeps working unchanged. See maskSecret.ts's own
// top-of-file comment for the full story.
export { maskSecret } from "./maskSecret";

export type ResolvedCommerceAdmin = {
  userId: string;
  organizationId: string;
  role: OrgRole | null;
  templateId: string;
};

/**
 * Auth + ownership check shared by every /api/v1/commerce/[templateId]/* admin route:
 * resolves the caller (session or API key, same as every other admin route — see
 * resolveUser) and confirms templateId is a root Template (a "site") belonging to their
 * organization. Returns a ready-to-return NextResponse on any failure, or context to
 * proceed with.
 */
export async function resolveCommerceAdmin(
  request: NextRequest,
  templateId: string,
): Promise<{ error: NextResponse; context?: undefined } | { error?: undefined; context: ResolvedCommerceAdmin }> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: site } = await Template.get({ id: templateId }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    return { error: NextResponse.json({ error: "Site not found." }, { status: 404 }) };
  }

  return {
    context: {
      userId: resolved.userId,
      organizationId: resolved.organizationId,
      role: resolved.role,
      templateId,
    },
  };
}
