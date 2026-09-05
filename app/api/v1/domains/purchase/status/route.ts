import { NextRequest, NextResponse } from "next/server";
import { resolveUser as resolveUserDynamo } from "@/lib/auth/resolveUser";
import { RegisteredDomain } from "@/lib/db/contentEntities";

/**
 * GET /api/v1/domains/purchase/status?registeredDomainId=...&templateId=...
 *
 * Powers the "Setting up your domain…" progress step in
 * app/dashboard/domains/domains-client.tsx's BuyDomainDrawer — a lightweight point lookup
 * the drawer polls every few seconds right after Stripe's embedded-checkout return_url
 * redirect, before the domain has a PublishedDomain row for GET /api/v1/domains's own join
 * to pick up (that row doesn't exist until DNS_PROVISIONING — see
 * app/api/internal/domain-registration-poller/route.ts).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUserDynamo(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get("templateId");
  const registeredDomainId = searchParams.get("registeredDomainId");
  if (!templateId || !registeredDomainId) {
    return NextResponse.json({ error: "Missing templateId or registeredDomainId." }, { status: 400 });
  }

  const { data: record } = await RegisteredDomain.get({ templateId, id: registeredDomainId }).go();
  if (!record || record.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ domain: record.domain, status: record.status, statusReason: record.statusReason });
}
