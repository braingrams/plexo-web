import { Route53Client, ListHostedZonesByNameCommand, ChangeResourceRecordSetsCommand } from "@aws-sdk/client-route-53";

// Route53 (zone records) — distinct from Route53 Domains (registration), see
// route53DomainsProvider.ts's own comment. This is what turns a freshly-registered domain
// into a live site with zero manual CNAME copy-pasting: once RegisterDomain succeeds, Route53
// auto-creates a public hosted zone for the domain in this same AWS account and points its
// nameservers at it — this module writes the same two records a manually-connected CUSTOM
// domain's owner would otherwise copy-paste by hand (see lib/cloudfrontDomains.ts's
// getRoutingEndpoint()/requestCertificate() in lib/acmCertificates.ts) directly into that
// zone instead.
//
// Route53's own SDK/API is global (no region-specific endpoints the way most services have),
// so no fixed-region pin is needed here the way route53DomainsProvider.ts/acmCertificates.ts
// both need for their respective global-but-us-east-1-hosted APIs.
const route53 = new Route53Client({});

// CloudFront's own fixed "alias target" hosted zone id — the same constant for every
// CloudFront distribution in every AWS account (it identifies the CloudFront *service* as
// an alias target type, not any particular distribution; the actual distribution is named
// by AliasTarget.DNSName instead). Confirmed live against this account's real production
// distribution (see provisionDomainDns()'s own comment on why an ALIAS record is required
// here at all) rather than assumed from docs.
const CLOUDFRONT_ALIAS_HOSTED_ZONE_ID = "Z2FDTNDATAQYW2";

/**
 * Resolves the hosted zone Route53 Domains auto-created for a just-registered domain.
 * RegisterDomain/GetOperationDetail never return the zone id directly, so this is a one-time
 * lookup by name, cached by the caller on RegisteredDomain.hostedZoneId once found. Route53
 * can take a short while after registration to finish provisioning the zone, so this doesn't
 * throw on an empty result — callers should treat "not found yet" as "try again next poll,"
 * the same way the registration-poller route already treats an in-progress operation.
 */
export async function resolveHostedZoneId(domain: string): Promise<string | null> {
  const normalizedDomain = domain.endsWith(".") ? domain : `${domain}.`;
  const { HostedZones } = await route53.send(new ListHostedZonesByNameCommand({ DNSName: domain, MaxItems: 1 }));
  const zone = HostedZones?.find((z) => z.Name === normalizedDomain);
  return zone?.Id ?? null;
}

/**
 * Writes (or overwrites) one CNAME record into a hosted zone — UPSERT so this is safe to
 * re-run if the reconciliation poller retries after a partial failure. `name` is the full
 * record name (e.g. the bare domain, or the ACM validation record's own name — both are
 * passed through as ACM/Route53 return them, already fully-qualified).
 */
export async function upsertCnameRecord(hostedZoneId: string, name: string, value: string): Promise<void> {
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Comment: "Managed by Plexo — written automatically when this domain was purchased",
        Changes: [
          {
            Action: "UPSERT",
            ResourceRecordSet: { Name: name, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: value }] },
          },
        ],
      },
    }),
  );
}

/**
 * Provisions everything a purchased domain needs to converge to ACTIVE with zero user
 * action: the routing record (target = the same shared CloudFront SaaS Manager connection-
 * group endpoint every manually-connected CUSTOM domain points at) and the ACM cert-
 * validation CNAME (from lib/acmCertificates.ts's requestCertificate(), unmodified — same
 * call a manual CUSTOM-domain connection makes, just written here instead of shown to a user
 * to copy). All records land in the same UPSERT batch so a retry after a partial failure
 * (e.g. the process crashes mid-way) is still safe.
 *
 * `routingEndpointRaw` MUST be lib/cloudfrontDomains.ts's getRoutingEndpointRaw() (the literal
 * CloudFront hostname), not getRoutingEndpoint() (the friendlier branded alias) — an ALIAS
 * record's target has to be the real distribution hostname, not another CNAME/alias hop.
 *
 * Apex caveat, confirmed LIVE (real `aws route53 change-resource-record-sets` calls against
 * this account's actual production distribution, cleaned up after — not assumed from docs):
 * Route53 flatly REJECTS a plain CNAME at a hosted zone's apex
 * ("InvalidChangeBatch: RRSet of type CNAME ... is not permitted at apex"), which a bought
 * domain commonly needs (bare "acmestudio.co", not "www.acmestudio.co"). An ALIAS record
 * (Type "A"/"AAAA" with AliasTarget, HostedZoneId = CLOUDFRONT_ALIAS_HOSTED_ZONE_ID) works at
 * the apex AND at any other depth, so this writes ALIAS A+AAAA records for the routing
 * endpoint unconditionally rather than branching on apex-vs-subdomain. The ACM validation
 * record stays a plain CNAME — ACM validation names are always sub-labels (e.g. a random
 * hash under `_acme-challenge`-style prefixes), never the bare apex, so the apex restriction
 * never applies to it.
 */
export async function provisionDomainDns(hostedZoneId: string, domain: string, routingEndpointRaw: string, validation: { name: string; value: string }): Promise<void> {
  const aliasTarget = { HostedZoneId: CLOUDFRONT_ALIAS_HOSTED_ZONE_ID, DNSName: routingEndpointRaw, EvaluateTargetHealth: false };
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Comment: "Managed by Plexo — routing + ACM validation records written automatically at purchase",
        Changes: [
          { Action: "UPSERT", ResourceRecordSet: { Name: domain, Type: "A", AliasTarget: aliasTarget } },
          { Action: "UPSERT", ResourceRecordSet: { Name: domain, Type: "AAAA", AliasTarget: aliasTarget } },
          {
            Action: "UPSERT",
            ResourceRecordSet: { Name: validation.name, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: validation.value }] },
          },
        ],
      },
    }),
  );
}
