import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { resolveRegistrarProvider } from "@/lib/domains/registrarProvider";
import { RegisteredDomain } from "@/lib/db/contentEntities";

/**
 * GET /api/internal/domain-transfer-poller
 *
 * Scheduled daily (see cdk/lib/published-sites-stack.ts) — the other half of "stop Plexo
 * from managing this domain" (app/api/v1/domains/unlock/route.ts does the unlock+email
 * half). ICANN transfers take days, not minutes, once actually initiated at the gaining
 * registrar, so a daily cadence is plenty — unlike domain-registration-poller.ts's tight
 * loop, there's no user-visible "how long until..." expectation being raced here.
 *
 * Detection is by nameserver drift: every Route53-hosted zone's nameservers are
 * "*.awsdns-*.{org,com,net,co.uk}" — once a domain's real nameservers (via
 * GetDomainDetail, which reflects the registry's own record, not this app's DNS) no longer
 * include any of those, the registrant has pointed it elsewhere, which is what a completed
 * transfer-out (or a deliberate self-managed DNS switch) actually looks like from here.
 * Deliberately does NOT touch the linked PublishedDomain/CDN/cert rows — registrar-of-
 * record and DNS-serving are separable, see the plan's own note on this.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: pending } = await RegisteredDomain.query.byStatus({ status: "TRANSFER_PENDING" }).go({ pages: "all" });

  let transferredOut = 0;
  const errors: string[] = [];

  for (const row of pending) {
    try {
      const { provider, kind } = await resolveRegistrarProvider(row.domain);
      if (kind !== "ROUTE53") continue; // manual-path domains have no GetDomainDetail to poll

      const detail = await provider.getDomainDetail(row.domain);
      const stillOnRoute53 = detail.nameservers.some((ns) => ns.toLowerCase().includes("awsdns"));
      if (!stillOnRoute53) {
        await RegisteredDomain.patch({ templateId: row.templateId, id: row.id })
          .set({ status: "TRANSFERRED_OUT", transferOutDetectedAt: new Date().toISOString() })
          .go();
        transferredOut++;
      }
    } catch (err) {
      errors.push(`${row.domain}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ checked: pending.length, transferredOut, errors });
}
