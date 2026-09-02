import {
  CloudFrontClient,
  CreateDistributionTenantCommand,
  UpdateDistributionTenantCommand,
  DeleteDistributionTenantCommand,
  GetDistributionTenantCommand,
} from "@aws-sdk/client-cloudfront";
import { requestCertificate, deleteCertificate } from "@/lib/acmCertificates";

// Replaces lib/vercelDomains.ts's addVercelDomain/removeVercelDomain now that custom-
// domain publishing runs on CloudFront SaaS Manager (cdk/lib/published-sites-stack.ts)
// instead of Vercel's Domains API. Every CUSTOMER custom domain gets its own
// AWS::CloudFront::DistributionTenant, created/deleted one at a time here — unlike the
// wildcard "*.plexopages.com" tenant, which is pre-provisioned once by the CDK stack
// itself, not by this file.
//
// Connecting a domain is now a two-phase, asynchronous process — NOT a single synchronous
// call the way addVercelDomain (and this file's own first version, addCloudFrontDomain)
// used to be:
//
// 1. requestCustomDomainConnection() below requests our own ACM certificate for the
//    domain and returns the DNS validation record the customer must add. No tenant exists
//    yet at this point.
// 2. Once the customer's DNS validation record propagates and ACM issues the certificate
//    (this app polls for that — see lib/lambda/certificateAttachment.ts, running on a
//    schedule via published-sites-stack.ts's own EventBridge rule), createOrAttachTenant()
//    creates the distribution tenant with that certificate attached, and only then does
//    the domain actually start serving traffic.
//
// This replaces CloudFront's own ManagedCertificateRequest mechanism entirely — confirmed
// by direct, repeated testing (not assumed from docs) that it reproducibly issues a
// certificate that never actually attaches to its distribution tenant
// (GetDistributionTenant's Customizations field stays completely empty and the domain
// stays "inactive" indefinitely, even on a single clean first attempt with DNS and the
// required _cf-challenge TXT record both already correctly in place beforehand).
// customizations.certificate.arn is the same mechanism the plexopages.com/
// plexo.charisol.io wildcard certs already use reliably — just requested at runtime, per
// customer domain, instead of at CDK-deploy-time for our own domains.
//
// PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID/PLEXO_PUBLISHED_SITES_CONNECTION_GROUP_ID come
// from SSM via lib/ssmEnv.ts (see that file's own comment on why these can't be injected
// the same way PLEXO_*_TABLE is) for the main Next.js app; the scheduled
// certificateAttachment Lambda gets them as plain environment variables instead, since
// published-sites-stack.ts creates both together and can wire them directly.

const cloudfront = new CloudFrontClient({ region: process.env.AWS_REGION || "us-east-1" });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured — has cdk/lib/published-sites-stack.ts been deployed for this environment, and its IDs set in SSM?`);
  return value;
}

export interface CustomDomainConnectionRequest {
  certificateArn: string;
  certificateValidationName: string;
  certificateValidationValue: string;
  routingEndpoint: string;
}

/**
 * Phase 1 of connecting a customer's custom domain: requests our own ACM certificate and
 * returns everything the dashboard needs to show the customer — the DNS validation record
 * to prove ownership, and the routing-endpoint CNAME to actually point their traffic at.
 * Both can be added at the same time; there's no ordering requirement between them (unlike
 * the old ManagedCertificateRequest flow, standard ACM DNS validation doesn't care where
 * the domain's traffic-serving record points). No distribution tenant exists yet — the
 * domain won't actually serve anything until lib/lambda/certificateAttachment.ts's
 * scheduled check sees the certificate issued and calls createOrAttachTenant.
 */
export async function requestCustomDomainConnection(domain: string): Promise<CustomDomainConnectionRequest> {
  const { certificateArn, validation } = await requestCertificate(domain);
  return {
    certificateArn,
    certificateValidationName: validation.name,
    certificateValidationValue: validation.value,
    routingEndpoint: getRoutingEndpoint(),
  };
}

/** Phase 2, called only by lib/lambda/certificateAttachment.ts once the certificate is
 * confirmed "issued": creates (or updates, if one already exists for this domain — e.g. a
 * prior attempt got the tenant created but crashed before recording its id) the
 * distribution tenant with the certificate attached. Returns the tenant id for storage on
 * the PublishedDomain row, so removeCloudFrontDomain can delete it directly later without
 * an extra lookup. */
export async function createOrAttachTenant(domain: string, certificateArn: string): Promise<{ tenantId: string }> {
  const distributionId = requireEnv("PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID");
  const connectionGroupId = requireEnv("PLEXO_PUBLISHED_SITES_CONNECTION_GROUP_ID");

  try {
    const { DistributionTenant } = await cloudfront.send(
      new CreateDistributionTenantCommand({
        DistributionId: distributionId,
        ConnectionGroupId: connectionGroupId,
        Name: domain,
        Domains: [{ Domain: domain }],
        Customizations: { Certificate: { Arn: certificateArn } },
        Enabled: true,
      }),
    );
    if (!DistributionTenant?.Id) throw new Error(`CreateDistributionTenant for ${domain} returned no tenant id`);
    return { tenantId: DistributionTenant.Id };
  } catch (err: unknown) {
    // Two real exception names cover an already-existing tenant for this domain, both
    // confirmed by actually hitting them (not guessed from errors.d.ts alone):
    // EntityAlreadyExists for the generic SaaS Manager conflict case, CNAMEAlreadyExists
    // specifically when a tenant already exists for this exact domain.
    const name = (err as { name?: string })?.name;
    if (name !== "EntityAlreadyExists" && name !== "CNAMEAlreadyExists") throw err;
  }

  const { DistributionTenant, ETag } = await cloudfront.send(new GetDistributionTenantCommand({ Identifier: domain }));
  if (!DistributionTenant?.Id) throw new Error(`CreateDistributionTenant for ${domain} reported a conflict, but no existing tenant was found`);
  await cloudfront.send(
    new UpdateDistributionTenantCommand({
      Id: DistributionTenant.Id,
      IfMatch: ETag,
      Domains: [{ Domain: domain }],
      Customizations: { Certificate: { Arn: certificateArn } },
    }),
  );
  return { tenantId: DistributionTenant.Id };
}

/** Read-only check of whether a connected CUSTOM domain is actually serving traffic yet.
 * Returns false (not an error) if no tenant exists at all. */
export async function isDomainActive(domain: string): Promise<boolean> {
  try {
    const { DistributionTenant } = await cloudfront.send(new GetDistributionTenantCommand({ Identifier: domain }));
    return DistributionTenant?.Domains?.[0]?.Status === "active";
  } catch {
    return false;
  }
}

/** The CNAME target every tenant on this environment shares (wildcard or custom domain
 * alike) — see lib/ssmEnv.ts's own comment on why this is a stored value, not a live
 * GetConnectionGroupCommand call on every read. May be a friendly branded alias (e.g.
 * "cname.plexopages.com") rather than the raw CloudFront hostname. */
export function getRoutingEndpoint(): string {
  return requireEnv("PLEXO_PUBLISHED_SITES_ROUTING_ENDPOINT");
}

/** Disconnects a customer's custom domain — deletes the distribution tenant (if one was
 * ever created; a domain whose certificate never reached "issued" has none yet) and its
 * ACM certificate. The PublishedDomain row itself is the caller's separate
 * responsibility, same division of labor removeVercelDomain had. */
export async function removeCloudFrontDomain(domain: string, existing?: { tenantId?: string; certificateArn?: string }): Promise<void> {
  try {
    let id = existing?.tenantId;
    let etag: string | undefined;
    if (id) {
      const { ETag } = await cloudfront.send(new GetDistributionTenantCommand({ Identifier: id }));
      etag = ETag;
    } else {
      const { DistributionTenant, ETag } = await cloudfront.send(new GetDistributionTenantCommand({ Identifier: domain }));
      id = DistributionTenant?.Id;
      etag = ETag;
    }
    if (id) {
      await cloudfront.send(new DeleteDistributionTenantCommand({ Id: id, IfMatch: etag }));
    }
  } catch (err: unknown) {
    // EntityNotFound/NoSuchResource — both real exception classes (confirmed against
    // @aws-sdk/client-cloudfront's own errors.d.ts, same verification as
    // createOrAttachTenant's EntityAlreadyExists above).
    const name = (err as { name?: string })?.name;
    if (name !== "EntityNotFound" && name !== "NoSuchResource") {
      console.error(`Failed to remove CloudFront distribution tenant for ${domain}:`, err);
    }
  }

  if (existing?.certificateArn) {
    await deleteCertificate(existing.certificateArn).catch((err) =>
      console.error(`Failed to delete ACM certificate for ${domain}:`, err),
    );
  }
}
