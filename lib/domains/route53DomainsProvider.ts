import {
  Route53DomainsClient,
  CheckDomainAvailabilityCommand,
  GetDomainSuggestionsCommand,
  ListPricesCommand,
  RegisterDomainCommand,
  GetOperationDetailCommand,
  GetDomainDetailCommand,
  DisableDomainTransferLockCommand,
  RetrieveDomainAuthCodeCommand,
  RenewDomainCommand,
  EnableDomainAutoRenewCommand,
  DisableDomainAutoRenewCommand,
  type ContactDetail,
  type CountryCode,
} from "@aws-sdk/client-route-53-domains";
import type {
  DomainAvailabilityResult,
  DomainContact,
  DomainDetail,
  DomainPrice,
  DomainRegistrarProvider,
  OperationStatus,
  RegisterDomainInput,
} from "./registrarProvider";

// Route53 Domains is a GLOBAL API reachable only from us-east-1 regardless of which region
// the rest of the stack runs in — same constraint ACM's own client has for CloudFront certs
// (see lib/acmCertificates.ts's own comment on why that client is pinned the same way).
const domains = new Route53DomainsClient({ region: "us-east-1" });

// AWS publishes the supported-TLD list at
// https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/registrar-tld-list.html — there
// is no "list supported TLDs" API call (ListPrices returns prices for whatever TLD you ask
// about, not a catalog), so this is a hand-maintained allow-list of the common TLDs Plexo
// offers instantly. Anything not in this set routes to the manual-fulfillment path (see
// manualFulfillmentProvider.ts) rather than attempting — and failing — a live RegisterDomain
// call. Refresh this list by hand if/when Plexo wants to offer more TLDs.
const SUPPORTED_TLDS = new Set([
  "com", "net", "org", "info", "biz", "co", "me", "us",
  "io", "xyz", "shop", "store", "studio", "online", "site", "app",
  "dev", "tech", "blog", "design", "agency", "club", "life", "live",
]);

function tldOf(domain: string): string {
  const parts = domain.trim().toLowerCase().split(".");
  return parts[parts.length - 1] ?? "";
}

function toContactDetail(contact: DomainContact): ContactDetail {
  return {
    FirstName: contact.firstName,
    LastName: contact.lastName,
    ContactType: "PERSON",
    AddressLine1: contact.addressLine1,
    City: contact.city,
    State: contact.state,
    CountryCode: contact.countryCode as CountryCode,
    ZipCode: contact.zipCode,
    PhoneNumber: contact.phoneNumber,
    Email: contact.email,
  };
}

export const route53DomainsProvider: DomainRegistrarProvider = {
  isSupportedTld(domain: string): boolean {
    return SUPPORTED_TLDS.has(tldOf(domain));
  },

  async checkAvailability(domainList: string[]): Promise<DomainAvailabilityResult[]> {
    // No batch-availability call exists on this API — one CheckDomainAvailability request
    // per candidate domain, run concurrently.
    return Promise.all(
      domainList.map(async (domain): Promise<DomainAvailabilityResult> => {
        try {
          const { Availability } = await domains.send(new CheckDomainAvailabilityCommand({ DomainName: domain }));
          // Only a plain AVAILABLE result is treated as instantly purchasable — AVAILABLE_
          // RESERVED/AVAILABLE_PREORDER carry conditions this app doesn't model yet, and
          // PENDING/DONT_KNOW are transient registry responses, not real answers. Any of
          // those surface as "not available" here rather than risking a RegisterDomain call
          // against a domain in an ambiguous state.
          return { domain, available: Availability === "AVAILABLE", reason: Availability };
        } catch (err) {
          return { domain, available: false, reason: err instanceof Error ? err.message : "CHECK_FAILED" };
        }
      }),
    );
  },

  async getSuggestions(query: string, count = 10): Promise<string[]> {
    const { SuggestionsList } = await domains.send(
      new GetDomainSuggestionsCommand({ DomainName: query, SuggestionCount: count, OnlyAvailable: true }),
    );
    return (SuggestionsList ?? []).map((s) => s.DomainName).filter((name): name is string => !!name);
  },

  async getPrice(domain: string): Promise<DomainPrice> {
    const tld = tldOf(domain);
    const { Prices } = await domains.send(new ListPricesCommand({ Tld: tld }));
    const price = Prices?.[0];
    if (!price?.RegistrationPrice || !price?.RenewalPrice) {
      throw new Error(`No Route53 Domains pricing returned for .${tld}`);
    }
    // Route53 Domains prices in whole/fractional USD, not cents — round to avoid float
    // drift before this becomes a stored *UsdCents value on the RegisteredDomain row.
    return {
      domain,
      registrationPriceUsdCents: Math.round(price.RegistrationPrice.Price! * 100),
      renewalPriceUsdCents: Math.round(price.RenewalPrice.Price! * 100),
      transferPriceUsdCents: price.TransferPrice?.Price != null ? Math.round(price.TransferPrice.Price * 100) : undefined,
    };
  },

  async register(input: RegisterDomainInput): Promise<{ operationId: string }> {
    const contact = toContactDetail(input.contact);
    const { OperationId } = await domains.send(
      new RegisterDomainCommand({
        DomainName: input.domain,
        DurationInYears: input.years,
        AutoRenew: input.autoRenew,
        AdminContact: contact,
        RegistrantContact: contact,
        TechContact: contact,
        // Always on — free WHOIS privacy is part of Plexo's own "no headache" pitch, and a
        // handful of TLDs don't support it at all (another reason an unsupported TLD should
        // route to the manual path rather than a live RegisterDomain call that would ignore
        // this flag silently).
        PrivacyProtectAdminContact: true,
        PrivacyProtectRegistrantContact: true,
        PrivacyProtectTechContact: true,
      }),
    );
    if (!OperationId) throw new Error(`RegisterDomain for ${input.domain} returned no operation id`);
    return { operationId: OperationId };
  },

  async getOperationStatus(operationId: string): Promise<OperationStatus> {
    const { Status, Message } = await domains.send(new GetOperationDetailCommand({ OperationId: operationId }));
    return { operationId, status: (Status ?? "IN_PROGRESS") as OperationStatus["status"], message: Message };
  },

  async getDomainDetail(domain: string): Promise<DomainDetail> {
    const detail = await domains.send(new GetDomainDetailCommand({ DomainName: domain }));
    return {
      domain,
      nameservers: (detail.Nameservers ?? []).map((ns) => ns.Name).filter((name): name is string => !!name),
      expirationDate: detail.ExpirationDate ? new Date(detail.ExpirationDate).toISOString() : undefined,
      // StatusList carries EPP status codes (e.g. "clientTransferProhibited") rather than a
      // single boolean — the presence of a transfer-prohibited code is what "locked" means.
      transferLocked: (detail.StatusList ?? []).some((s) => s.toLowerCase().includes("transferprohibited")),
    };
  },

  async unlock(domain: string): Promise<void> {
    await domains.send(new DisableDomainTransferLockCommand({ DomainName: domain }));
  },

  async retrieveAuthCode(domain: string): Promise<string> {
    const { AuthCode } = await domains.send(new RetrieveDomainAuthCodeCommand({ DomainName: domain }));
    if (!AuthCode) throw new Error(`RetrieveDomainAuthCode for ${domain} returned no code`);
    return AuthCode;
  },

  async renew(domain: string): Promise<{ operationId: string }> {
    const { ExpirationDate } = await domains.send(new GetDomainDetailCommand({ DomainName: domain }));
    const currentExpiryYear = (ExpirationDate ? new Date(ExpirationDate) : new Date()).getUTCFullYear();
    const { OperationId } = await domains.send(
      new RenewDomainCommand({ DomainName: domain, DurationInYears: 1, CurrentExpiryYear: currentExpiryYear }),
    );
    if (!OperationId) throw new Error(`RenewDomain for ${domain} returned no operation id`);
    return { operationId: OperationId };
  },

  async enableAutoRenew(domain: string): Promise<void> {
    await domains.send(new EnableDomainAutoRenewCommand({ DomainName: domain }));
  },

  async disableAutoRenew(domain: string): Promise<void> {
    await domains.send(new DisableDomainAutoRenewCommand({ DomainName: domain }));
  },
};
