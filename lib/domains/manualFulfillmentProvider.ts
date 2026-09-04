import type { DomainAvailabilityResult, DomainDetail, DomainPrice, DomainRegistrarProvider, OperationStatus, RegisterDomainInput } from "./registrarProvider";
import { checkExternalAvailability } from "./rdapAvailability";

// resolveRegistrarProvider's catch-all for any TLD route53DomainsProvider.ts's
// isSupportedTld() says no to — Plexo doesn't sell these directly (deliberately not a
// second live registrar API integration: a real vendor account, contract, and TLD-coverage
// tradeoff isn't worth taking on for what the user framed as a "once in a while" case).
//
// What this DOES do: a real availability check via lib/domains/rdapAvailability.ts (the
// public RDAP protocol — no API key, no vendor relationship, works for most gTLDs and many
// ccTLDs) so the search results shown for these domains are genuine, not a guess — see the
// Buy-a-Domain search UI's own plain-language handling of `available` + the
// `externalRegistrationUrl` this returns. If it comes back available, the customer is
// pointed at a plain external link to register it themselves, then connect it here as a
// Custom Domain once they own it — no purchase, no admin queue, no "we'll register it for
// you" promise this app was never actually going to keep.
export const manualFulfillmentProvider: DomainRegistrarProvider = {
  // Nothing is purchasable through this provider — it exists only to answer "is this
  // available" honestly for TLDs Plexo doesn't sell, never to gate a buy flow.
  isSupportedTld(): boolean {
    return false;
  },

  async checkAvailability(domainList: string[]): Promise<DomainAvailabilityResult[]> {
    return Promise.all(
      domainList.map(async (domain): Promise<DomainAvailabilityResult> => {
        const result = await checkExternalAvailability(domain);
        return { domain, available: result === "AVAILABLE", reason: `EXTERNAL_${result}` };
      }),
    );
  },

  async getSuggestions(): Promise<string[]> {
    return [];
  },

  async getPrice(domain: string): Promise<DomainPrice> {
    throw new Error(`Plexo doesn't sell ${domain} directly — no price to quote.`);
  },

  async register(input: RegisterDomainInput): Promise<{ operationId: string }> {
    throw new Error(`Plexo doesn't register ${input.domain} directly — this should never be called.`);
  },

  async getOperationStatus(operationId: string): Promise<OperationStatus> {
    throw new Error(`No registrar operation to poll (operationId: ${operationId}) — Plexo never registered this domain.`);
  },

  async getDomainDetail(domain: string): Promise<DomainDetail> {
    throw new Error(`getDomainDetail is not available for ${domain} — it isn't registered through Plexo.`);
  },

  async unlock(domain: string): Promise<void> {
    throw new Error(`${domain} isn't registered through Plexo — there's nothing to unlock here.`);
  },

  async retrieveAuthCode(domain: string): Promise<string> {
    throw new Error(`${domain} isn't registered through Plexo — no transfer code to retrieve.`);
  },

  async renew(domain: string): Promise<{ operationId: string }> {
    throw new Error(`${domain} isn't registered through Plexo — nothing to renew here.`);
  },

  async enableAutoRenew(): Promise<void> {
    // No-op — Plexo never registered this domain, so there's no auto-renew setting to touch.
  },

  async disableAutoRenew(): Promise<void> {
    // No-op, same reason.
  },
};
