import { NextRequest, NextResponse } from "next/server";
import { resolveUser as resolveUserDynamo } from "@/lib/auth/resolveUser";
import { requirePermission as requirePermissionDynamo } from "@/server/requirePermissionDynamo";
import { resolveRegistrarProvider } from "@/lib/domains/registrarProvider";
import { RegisteredDomain } from "@/lib/db/contentEntities";

/**
 * POST /api/v1/domains/auto-renew — toggles auto-renew for a Plexo-purchased domain from
 * the settings panel. A separate small route rather than folding into the existing
 * PATCH /api/v1/domains (which strictly requires `noindex` and applies to PublishedDomain,
 * not RegisteredDomain) — same "one small dedicated route per action" shape as /verify and
 * /unlock in this same directory.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUserDynamo(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermissionDynamo(resolved.role, { domain: ["manage"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  const autoRenew = body.autoRenew;
  if (!domain || typeof autoRenew !== "boolean") {
    return NextResponse.json({ error: "Missing domain or autoRenew." }, { status: 400 });
  }

  const { data: matches } = await RegisteredDomain.query.byDomain({ domain }).go();
  const record = matches[0] ?? null;
  if (!record || record.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Domain not found or unauthorized." }, { status: 404 });
  }

  const { provider, kind } = await resolveRegistrarProvider(domain);
  if (kind === "ROUTE53" && record.status === "ACTIVE") {
    try {
      if (autoRenew) await provider.enableAutoRenew(domain);
      else await provider.disableAutoRenew(domain);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Could not update auto-renew." }, { status: 502 });
    }
  }

  await RegisteredDomain.patch({ templateId: record.templateId, id: record.id }).set({ autoRenew }).go();
  return NextResponse.json({ success: true, autoRenew });
}
