import { NextRequest, NextResponse } from "next/server";
import { resolveUser as resolveUserDynamo } from "@/lib/auth/resolveUser";
import { requirePermission as requirePermissionDynamo } from "@/server/requirePermissionDynamo";
import { resolveRegistrarProvider } from "@/lib/domains/registrarProvider";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildDomainTransferCodeEmail } from "@/lib/mail/templates";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import { getOrgBrandDynamo } from "@/server/orgDynamo";
import { RegisteredDomain } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";

// ICANN's own inter-registrar transfer policy: a domain can't transfer within 60 days of
// initial registration OR of a registrant/contact change. This app only ever tracks the
// former (createdAt) — a future registrant-contact-change feature would need to reset this
// the same way, but nothing here lets a user edit registrant contact info after purchase yet.
const TRANSFER_LOCK_DAYS = 60;

/**
 * POST /api/v1/domains/unlock
 *
 * The "stop Plexo from managing this domain" action from the settings panel
 * (app/dashboard/domains/domains-client.tsx): unlocks the domain at the registrar, retrieves
 * its EPP auth code, and emails it to the user — Plexo keeps billing/serving the domain
 * until the transfer-out actually completes (see the Buy-a-Domain plan's own note on why
 * that detection is a separate poller, not this route). Manually-fulfilled domains
 * (registrarProvider: "MANUAL") can't do this yet — manualFulfillmentProvider.unlock()
 * throws a clear "contact support" error rather than silently no-op-ing.
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
  if (!domain) {
    return NextResponse.json({ error: "Missing domain." }, { status: 400 });
  }

  const { data: matches } = await RegisteredDomain.query.byDomain({ domain }).go();
  const record = matches[0] ?? null;
  if (!record || record.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Domain not found or unauthorized." }, { status: 404 });
  }
  if (record.status !== "ACTIVE") {
    return NextResponse.json({ error: `This domain can't be unlocked in its current state (${record.status}).` }, { status: 409 });
  }

  const { provider } = await resolveRegistrarProvider(domain);

  let authCode: string;
  try {
    await provider.unlock(domain);
    authCode = await provider.retrieveAuthCode(domain);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not unlock this domain." }, { status: 502 });
  }

  const transferEligibleAt = new Date(record.createdAt ?? Date.now());
  transferEligibleAt.setDate(transferEligibleAt.getDate() + TRANSFER_LOCK_DAYS);

  await RegisteredDomain.patch({ templateId: record.templateId, id: record.id })
    .set({
      status: "TRANSFER_PENDING",
      transferLocked: false,
      eppAuthCodeSentAt: new Date().toISOString(),
      unlockRequestedAt: new Date().toISOString(),
      unlockRequestedByUserId: resolved.userId,
    })
    .go();

  const { data: user } = await User.get({ id: resolved.userId }).go();
  const brand = await getOrgBrandDynamo(resolved.organizationId);
  const subject = `Your transfer code for ${domain}`;
  if (user?.email) {
    try {
      await sendMaildripEmail({
        to: user.email,
        subject,
        html: buildDomainTransferCodeEmail({ domain, authCode, transferEligibleAt: transferEligibleAt.toISOString(), brand }),
      });
      logEmailDelivery({ kind: "maildrip", to: user.email, subject, status: "sent", context: "domain_transfer_code", organizationId: resolved.organizationId, templateId: record.templateId });
    } catch (err) {
      logEmailDelivery({ kind: "maildrip", to: user.email, subject, status: "failed", errorMessage: err instanceof Error ? err.message : String(err), context: "domain_transfer_code", organizationId: resolved.organizationId, templateId: record.templateId });
      console.error(`Failed to send domain transfer code email for ${domain}:`, err);
    }
  }

  return NextResponse.json({ success: true, transferEligibleAt: transferEligibleAt.toISOString() });
}
