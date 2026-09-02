import { ACMClient, RequestCertificateCommand, DescribeCertificateCommand, DeleteCertificateCommand } from "@aws-sdk/client-acm";

// Replaces CloudFront SaaS Manager's own ManagedCertificateRequest mechanism for CUSTOM
// customer domains — confirmed by direct, repeated testing (not assumed from docs) that
// ManagedCertificateRequest reproducibly issues a certificate that never actually attaches
// to its distribution tenant: GetDistributionTenant's Customizations field stays completely
// empty and the domain stays "inactive" indefinitely, even on a single clean first attempt
// with DNS and the required _cf-challenge TXT record both already correctly in place
// beforehand. This request-our-own-ACM-cert-and-attach-it-ourselves approach uses the exact
// same customizations.certificate.arn mechanism that already reliably serves the
// plexopages.com and plexo.charisol.io wildcard certs (see cdk/lib/published-sites-stack.ts,
// cdk/lib/compute-stack.ts) — just requested at runtime, per customer domain, instead of at
// CDK-deploy-time for our own domains.
//
// CloudFront requires the certificate to exist in us-east-1 regardless of which region the
// rest of the stack runs in — same requirement plexo.charisol.io's own cert has.
const acm = new ACMClient({ region: "us-east-1" });

export interface CertificateValidationRecord {
  name: string;
  value: string;
}

/**
 * Requests a new ACM certificate for a customer's domain, DNS-validated. Returns the
 * certificate ARN immediately and the CNAME record the customer must add to prove
 * ownership — ACM populates DomainValidationOptions asynchronously after the request, so
 * this polls briefly (a handful of seconds in practice, confirmed against this exact
 * account's own plexo.charisol.io/plexopages.com cert requests earlier) rather than
 * assuming it's available on the very first read.
 */
export async function requestCertificate(domain: string): Promise<{ certificateArn: string; validation: CertificateValidationRecord }> {
  const { CertificateArn } = await acm.send(
    new RequestCertificateCommand({ DomainName: domain, ValidationMethod: "DNS" }),
  );
  if (!CertificateArn) throw new Error(`ACM did not return a certificate ARN for ${domain}`);

  for (let attempt = 0; attempt < 10; attempt++) {
    const { Certificate } = await acm.send(new DescribeCertificateCommand({ CertificateArn }));
    const record = Certificate?.DomainValidationOptions?.[0]?.ResourceRecord;
    if (record?.Name && record?.Value) {
      return { certificateArn: CertificateArn, validation: { name: record.Name, value: record.Value } };
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`ACM never populated a validation record for ${domain}'s certificate (${CertificateArn}) after 15s`);
}

/** "PENDING_VALIDATION" | "ISSUED" | "FAILED" | "EXPIRED" | "VALIDATION_TIMED_OUT" |
 * "REVOKED" | "INACTIVE" — ACM's own CertificateStatus values (confirmed against
 * @aws-sdk/client-acm's own enums.d.ts, not guessed — a different, unrelated CloudFront
 * enum for the old ManagedCertificateRequest mechanism uses lowercase-hyphenated values
 * instead, easy to confuse with this one). Callers only really act on "ISSUED" (attach
 * it) vs everything else (keep waiting, or surface a failure for "FAILED"/
 * "VALIDATION_TIMED_OUT"/"REVOKED"). */
export async function getCertificateStatus(certificateArn: string): Promise<string | undefined> {
  const { Certificate } = await acm.send(new DescribeCertificateCommand({ CertificateArn: certificateArn }));
  return Certificate?.Status;
}

/** Called when a customer disconnects their domain — matches removeCloudFrontDomain's own
 * cleanup responsibility. Safe to call even if the cert was never actually attached to
 * anything (e.g. the customer disconnects before validation ever completed). */
export async function deleteCertificate(certificateArn: string): Promise<void> {
  try {
    await acm.send(new DeleteCertificateCommand({ CertificateArn: certificateArn }));
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name !== "ResourceNotFoundException") throw err;
  }
}
