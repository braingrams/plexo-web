import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { getCertificateStatus } from "@/lib/acmCertificates";
import { createOrAttachTenant } from "@/lib/cloudfrontDomains";
import { PublishedDomain } from "@/lib/db/contentEntities";

/**
 * GET /api/internal/certificate-attachment
 *
 * Scheduled check (see cdk/lib/published-sites-stack.ts's EventBridge rule — an API
 * Destination target calling this route directly on a schedule, the same "internal route
 * + CRON_SECRET" pattern app/api/internal/scan-domains/route.ts already established, not
 * a separate standalone Lambda) that finishes connecting every CUSTOM domain whose
 * certificate is still pending: for each PublishedDomain row not yet ATTACHED, checks ACM
 * (lib/acmCertificates.ts's getCertificateStatus) and, once ISSUED, creates/updates the
 * CloudFront distribution tenant with that certificate (lib/cloudfrontDomains.ts's
 * createOrAttachTenant) and marks the row ATTACHED.
 *
 * Deliberately NOT triggered by page views (GET /api/v1/domains) — see that route's own
 * comment on why: an earlier version did exactly that and it repeatedly restarted
 * certificate validation from scratch every time someone reloaded the domains page,
 * which is why a real customer domain never finished connecting. Read (dashboard) and
 * write (this route) are now fully separated.
 *
 * PublishedDomain has no index over type/certificateStatus (both indexes are keyed off
 * templateId/domain, see contentEntities.ts) — a full table Scan filtered in application
 * code is the honest v1 answer here, same reasoning scan-domains/route.ts's own comment
 * gives for its own cross-partition query; this app's actual custom-domain count is tiny.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const pending: Array<{ templateId: string; id: string; domain: string; certificateArn?: string }> = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: typeof pending; cursor: string | null } = await PublishedDomain.scan
      .where(({ type, certificateStatus }, { eq }) =>
        `${eq(type, "CUSTOM")} AND (${eq(certificateStatus, "PENDING_VALIDATION")} OR ${eq(certificateStatus, "ISSUED")})`,
      )
      .go({ cursor });
    pending.push(...page.data);
    cursor = page.cursor;
    if (!cursor) break;
  }

  let attached = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const domain of pending) {
    if (!domain.certificateArn) continue; // shouldn't happen — every CUSTOM row gets one at creation
    try {
      const status = await getCertificateStatus(domain.certificateArn);
      if (status === "ISSUED") {
        const { tenantId } = await createOrAttachTenant(domain.domain, domain.certificateArn);
        await PublishedDomain.patch({ templateId: domain.templateId, id: domain.id })
          .set({ certificateStatus: "ATTACHED", tenantId })
          .go();
        attached++;
      } else if (status === "FAILED" || status === "VALIDATION_TIMED_OUT" || status === "REVOKED" || status === "EXPIRED") {
        await PublishedDomain.patch({ templateId: domain.templateId, id: domain.id }).set({ certificateStatus: "FAILED" }).go();
        failed++;
      }
      // Still PENDING_VALIDATION — nothing to do, check again next run.
    } catch (err) {
      errors.push(`${domain.domain}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ checked: pending.length, attached, failed, errors });
}
