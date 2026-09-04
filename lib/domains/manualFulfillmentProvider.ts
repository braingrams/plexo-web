import type { DomainAvailabilityResult, DomainDetail, DomainPrice, DomainRegistrarProvider, OperationStatus, RegisterDomainInput } from "./registrarProvider";

// Covers the rare TLD route53DomainsProvider.ts's isSupportedTld() says no to — deliberately
// NOT a second live registrar API integration (the user's own framing was "once in a while",
// not worth maintaining a whole second SDK relationship for). Instead: the domain search UI
// checks isSupportedTld() before payment and shows "we'll register this within 1 business
// day" copy; on payment success app/api/v1/domains/purchase/route.ts creates a
// RegisteredDomain row with registrarProvider: "MANUAL", status: "MANUAL_PENDING" directly
// (NOT by calling this provider's register(), which exists only to satisfy the shared
// interface — see its own comment below). A plexo-admin operator then registers the domain
// by hand at whatever real-world registrar Plexo uses for that TLD, hand-creates a Route53
// hosted zone for it, and marks the row MANUAL_FULFILLED with that zone's id via
// plexo-admin/app/(dashboard)/domain-purchases — from there it rejoins the exact same
// DNS_PROVISIONING → ACTIVE pipeline lib/domains/domainDns.ts drives for the Route53-native
// path, because both converge on "a hosted zone exists, go write records into it."
//
// Hand-maintained since Route53 Domains' own ListPrices call obviously can't price a TLD it
// doesn't sell — seed real numbers here before actually offering a given TLD through this
// path (Phase 4 of the Buy-a-Domain plan). Prices are registrar cost-plus-margin estimates,
// not live quotes; an admin fulfilling the order should sanity-check against whatever the
// real registrar charges before completing the purchase.
const MANUAL_TLD_PRICING_USD_CENTS: Record<string, { registration: number; renewal: number }> = {
  ai: { registration: 7000, renewal: 7000 },
  co: { registration: 3200, renewal: 3200 },
};

function tldOf(domain: string): string {
  const parts = domain.trim().toLowerCase().split(".");
  return parts[parts.length - 1] ?? "";
}

export const manualFulfillmentProvider: DomainRegistrarProvider = {
  isSupportedTld(domain: string): boolean {
    return tldOf(domain) in MANUAL_TLD_PRICING_USD_CENTS;
  },

  async checkAvailability(domainList: string[]): Promise<DomainAvailabilityResult[]> {
    // No live registry check for this path — availability is confirmed by the admin during
    // manual fulfillment. Every candidate is optimistically shown as requestable; if it
    // turns out to be taken, the admin marks the row's manualNotes and support follows up
    // with a refund, same as REGISTRATION_FAILED does for the Route53-native path.
    return domainList.map((domain) => ({ domain, available: this.isSupportedTld(domain) }));
  },

  async getSuggestions(): Promise<string[]> {
    return [];
  },

  async getPrice(domain: string): Promise<DomainPrice> {
    const pricing = MANUAL_TLD_PRICING_USD_CENTS[tldOf(domain)];
    if (!pricing) throw new Error(`No manual-fulfillment pricing configured for ${domain}`);
    return { domain, registrationPriceUsdCents: pricing.registration, renewalPriceUsdCents: pricing.renewal };
  },

  // Never actually called — app/api/v1/domains/purchase/route.ts branches on
  // registrarProvider before deciding whether to call route53DomainsProvider.register() or
  // just create a MANUAL_PENDING row directly. Throws loudly rather than silently no-op-ing
  // in case that invariant is ever broken by a future change.
  async register(input: RegisterDomainInput): Promise<{ operationId: string }> {
    throw new Error(`manualFulfillmentProvider.register() should never be called directly — create a MANUAL_PENDING RegisteredDomain row instead (domain: ${input.domain})`);
  },

  async getOperationStatus(operationId: string): Promise<OperationStatus> {
    throw new Error(`No registrar operation to poll for manually-fulfilled domains (operationId: ${operationId}) — track progress via RegisteredDomain.status instead`);
  },

  async getDomainDetail(domain: string): Promise<DomainDetail> {
    throw new Error(`getDomainDetail is not available for manually-registered domains (${domain}) — the registrar of record is outside Route53`);
  },

  async unlock(domain: string): Promise<void> {
    throw new Error(`${domain} was registered manually outside Route53 — "stop managing" isn't automated for this domain yet; contact support.`);
  },

  async retrieveAuthCode(domain: string): Promise<string> {
    throw new Error(`${domain} was registered manually outside Route53 — its transfer/auth code isn't available through Plexo yet; contact support.`);
  },

  async renew(domain: string): Promise<{ operationId: string }> {
    throw new Error(`${domain} was registered manually outside Route53 — renewal is admin-driven for this domain, not automated yet.`);
  },

  async enableAutoRenew(): Promise<void> {
    // No-op: manual-path domains don't have automated renewal yet (see renew() above).
  },

  async disableAutoRenew(): Promise<void> {
    // No-op, same reason.
  },
};
