import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { resolveRegistrarProvider } from "@/lib/domains/registrarProvider";
import { requestCertificate } from "@/lib/acmCertificates";
import { getRoutingEndpointRaw } from "@/lib/cloudfrontDomains";
import { resolveHostedZoneId, provisionDomainDns } from "@/lib/domains/domainDns";
import { refundFailedDomainPurchase } from "@/lib/domains/refundDomainPurchase";
import { RegisteredDomain, PublishedDomain } from "@/lib/db/contentEntities";

/**
 * GET /api/internal/domain-registration-poller
 *
 * Scheduled (see cdk/lib/published-sites-stack.ts's EventBridge rule) — advances every
 * RegisteredDomain row through the async part of buying a domain: REGISTERING (waiting on
 * Route53's own RegisterDomain operation) → DNS_PROVISIONING (writing the routing + ACM
 * validation CNAMEs into the auto-created hosted zone, matching a manually-connected CUSTOM
 * domain's own records — see lib/domains/domainDns.ts) → CERT_PENDING, at which point
 * app/api/internal/certificate-attachment/route.ts takes over unmodified (it already drives
 * any PublishedDomain from PENDING_VALIDATION to ATTACHED regardless of how the row was
 * created) and flips this row's status to ACTIVE once that finishes — see that route's own
 * addition for the RegisteredDomain hand-off.
 *
 * A tighter cadence than certificate-attachment's 5 minutes (~1-2 min, set in the CDK
 * schedule) since this is the user-visible "how long until my new domain is live" latency
 * budget the whole feature is sold on. Same honest-scan reasoning as certificate-attachment
 * would apply here too, except RegisteredDomain DOES carry a byStatus GSI (contentEntities.ts)
 * specifically because this table is expected to scale past the tiny CUSTOM-domain counts
 * that make certificate-attachment's plain scan fine.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let registering = 0;
  let dnsProvisioned = 0;
  let failed = 0;
  const errors: string[] = [];

  // --- REGISTERING: poll Route53's async RegisterDomain operation ---
  const { data: registeringDomains } = await RegisteredDomain.query.byStatus({ status: "REGISTERING" }).go({ pages: "all" });
  for (const row of registeringDomains) {
    if (!row.registrarOperationId) continue; // shouldn't happen — set at the same time status becomes REGISTERING
    try {
      const { provider } = await resolveRegistrarProvider(row.domain);
      const op = await provider.getOperationStatus(row.registrarOperationId);

      if (op.status === "SUCCESSFUL") {
        const hostedZoneId = await resolveHostedZoneId(row.domain);
        if (!hostedZoneId) continue; // zone not provisioned yet — try again next run
        // Renewal-billing input (app/api/internal/domain-renewal-billing/route.ts) — read
        // once here rather than on every renewal-poller tick. Best-effort: a failure here
        // shouldn't block the domain going live, just leave renewalDate unset for now
        // (the renewal poller simply skips a row with no renewalDate).
        const renewalDate = await provider.getDomainDetail(row.domain).then((d) => d.expirationDate).catch(() => undefined);
        await RegisteredDomain.patch({ templateId: row.templateId, id: row.id })
          .set({ status: "DNS_PROVISIONING", hostedZoneId, ...(renewalDate ? { renewalDate } : {}) })
          .go();
        registering++;
      } else if (op.status === "FAILED" || op.status === "ERROR") {
        await RegisteredDomain.patch({ templateId: row.templateId, id: row.id })
          .set({ status: "REGISTRATION_FAILED", statusReason: op.message ?? `Route53 operation ${op.status}` })
          .go();
        await refundFailedDomainPurchase(row);
        failed++;
      }
      // SUBMITTED / IN_PROGRESS — still working, check again next run.
    } catch (err) {
      errors.push(`${row.domain} (operation poll): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- DNS_PROVISIONING: write the routing + ACM validation records, create the linked
  // PublishedDomain row. Includes MANUAL_FULFILLED rows too — a plexo-admin operator setting
  // hostedZoneId there (app/(dashboard)/domain-purchases in plexo-admin) is the manual-path
  // equivalent of Route53 auto-creating the zone, and both converge on this exact same step.
  const [dnsProvisioningBatch, manualFulfilledBatch] = await Promise.all([
    RegisteredDomain.query.byStatus({ status: "DNS_PROVISIONING" }).go({ pages: "all" }),
    RegisteredDomain.query.byStatus({ status: "MANUAL_FULFILLED" }).go({ pages: "all" }),
  ]);
  const readyForDns = [...dnsProvisioningBatch.data, ...manualFulfilledBatch.data];

  let routingEndpointRaw: string;
  try {
    routingEndpointRaw = getRoutingEndpointRaw();
  } catch (err) {
    return NextResponse.json({
      registering, dnsProvisioned, failed, errors,
      skippedDnsProvisioning: readyForDns.length,
      warning: `Routing endpoint not configured — skipped DNS provisioning for ${readyForDns.length} domain(s): ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  for (const row of readyForDns) {
    if (!row.hostedZoneId) continue; // shouldn't happen for either path — set before entering this status
    try {
      const { certificateArn, validation } = await requestCertificate(row.domain);
      await provisionDomainDns(row.hostedZoneId, row.domain, routingEndpointRaw, validation);

      const publishedDomainId = crypto.randomUUID();
      await PublishedDomain.create({
        id: publishedDomainId,
        userId: row.userId,
        organizationId: row.organizationId,
        templateId: row.templateId,
        domain: row.domain,
        type: "CUSTOM",
        certificateArn,
        certificateStatus: "PENDING_VALIDATION",
        certificateValidationName: validation.name,
        certificateValidationValue: validation.value,
        registeredDomainId: row.id,
      }).go();

      await RegisteredDomain.patch({ templateId: row.templateId, id: row.id })
        .set({ status: "CERT_PENDING", publishedDomainId })
        .go();
      dnsProvisioned++;
    } catch (err) {
      errors.push(`${row.domain} (DNS provisioning): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ registering, dnsProvisioned, failed, errors });
}
