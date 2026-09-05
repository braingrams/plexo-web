// Shared contract every domain-registrar backend implements. Route53Domains
// (route53DomainsProvider.ts) is the only automated implementation; manualFulfillmentProvider.ts
// covers the rare TLD Route53 Domains doesn't support by handing off to a plexo-admin queue
// instead of a second live registrar API integration — see RegisteredDomain's own state
// machine in lib/db/contentEntities.ts for how both converge on the same DNS_PROVISIONING →
// ACTIVE pipeline once a hosted zone exists.

export interface DomainAvailabilityResult {
  domain: string;
  available: boolean;
  reason?: string;
}

export interface DomainPrice {
  domain: string;
  registrationPriceUsdCents: number;
  renewalPriceUsdCents: number;
  transferPriceUsdCents?: number;
}

export interface DomainContact {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  addressLine1: string;
  city: string;
  countryCode: string;
  zipCode: string;
  state?: string;
}

export interface RegisterDomainInput {
  domain: string;
  years: 1;
  autoRenew: boolean;
  contact: DomainContact;
}

export interface OperationStatus {
  operationId: string;
  status: "SUBMITTED" | "IN_PROGRESS" | "SUCCESSFUL" | "FAILED" | "ERROR";
  message?: string;
}

export interface DomainDetail {
  domain: string;
  nameservers: string[];
  expirationDate?: string;
  transferLocked: boolean;
}

export interface DomainRegistrarProvider {
  checkAvailability(domains: string[]): Promise<DomainAvailabilityResult[]>;
  getSuggestions(query: string, count?: number): Promise<string[]>;
  getPrice(domain: string): Promise<DomainPrice>;
  register(input: RegisterDomainInput): Promise<{ operationId: string }>;
  getOperationStatus(operationId: string): Promise<OperationStatus>;
  getDomainDetail(domain: string): Promise<DomainDetail>;
  unlock(domain: string): Promise<void>;
  retrieveAuthCode(domain: string): Promise<string>;
  renew(domain: string): Promise<{ operationId: string }>;
  enableAutoRenew(domain: string): Promise<void>;
  disableAutoRenew(domain: string): Promise<void>;
  isSupportedTld(domain: string): boolean;
}

export type RegistrarProviderKind = "ROUTE53" | "MANUAL";

/**
 * Picks which provider owns a given domain: Route53 Domains for anything on its supported-
 * TLD allow-list, the manual-fulfillment path otherwise. Route53 is checked first since it's
 * the instant, automated path Plexo wants the vast majority of purchases to take — the
 * manual path is deliberately the fallback, not a peer choice a caller picks between.
 */
export async function resolveRegistrarProvider(domain: string): Promise<{ kind: RegistrarProviderKind; provider: DomainRegistrarProvider }> {
  const { route53DomainsProvider } = await import("./route53DomainsProvider");
  if (route53DomainsProvider.isSupportedTld(domain)) {
    return { kind: "ROUTE53", provider: route53DomainsProvider };
  }
  const { manualFulfillmentProvider } = await import("./manualFulfillmentProvider");
  return { kind: "MANUAL", provider: manualFulfillmentProvider };
}
