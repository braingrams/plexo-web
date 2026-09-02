import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ssm from "aws-cdk-lib/aws-ssm";

// A dedicated subdomain delegated into plexo's own AWS account — NOT a new hosted zone
// for charisol.io itself (that stays wherever it lives today; this migration never
// touches it). Mirrors maildrip's own precedent (aws.maildrip.io, its own hosted zone,
// delegated out of maildrip.io) rather than putting plexo's AWS DNS records directly in
// the existing aws.charisol.io zone in Charisol's main account — the whole reason plexo
// got its own dedicated AWS account was isolation, and every future DNS change here
// (staging cutovers, PR preview domains, cert renewals) should stay inside that account
// rather than touching a zone shared by every other Charisol product.
//
// One-time bootstrap only this stack can't do itself: after first deploy, this zone's 4
// NS records need to be added as an NS record set named "plexo" under the existing
// aws.charisol.io zone in the MAIN Charisol account (692239535551) — a different account
// than this stack deploys into. That's the one write that ever touches shared company
// DNS; everything after it (every record below) is entirely within this account.
export class DnsStack extends cdk.Stack {
  public readonly zone: route53.PublicHostedZone;
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // NOTE: this zone is a child of aws.charisol.io — one label ("plexo") delegated under
    // it, same shape as maildrip's own aws.maildrip.io precedent (one label delegated
    // under maildrip.io). An earlier version of this file named the zone
    // "aws.plexo.charisol.io" instead, which is NOT a subdomain of aws.charisol.io at
    // all (wrong suffix entirely) — no NS delegation from aws.charisol.io could ever
    // have made that resolve. Caught by an ACM certificate stuck in PENDING_VALIDATION
    // for hours with the validation CNAME confirmed present in the zone but the zone
    // itself unreachable from public DNS (dig against 8.8.8.8 returned nothing) — the
    // stuck stack was deleted and recreated with this corrected name.
    this.zone = new route53.PublicHostedZone(this, "Zone", {
      zoneName: "plexo.aws.charisol.io",
    });

    // One wildcard cert covers every subdomain this migration needs (production,
    // staging, and every "pr-<n>." preview) without provisioning a new cert per
    // environment. CloudFront requires ACM certs to exist in us-east-1 specifically —
    // this stack must be deployed there regardless of where compute/data stacks run.
    this.certificate = new acm.Certificate(this, "WildcardCert", {
      domainName: "plexo.aws.charisol.io",
      subjectAlternativeNames: ["*.plexo.aws.charisol.io"],
      validation: acm.CertificateValidation.fromDns(this.zone),
    });

    // Published for compute-stack.ts (both plexo-web and plexo-admin, same account) to
    // pick up without a cross-stack CDK reference — same convention analytics-stack.ts
    // uses for table ARNs.
    new ssm.StringParameter(this, "ZoneIdParam", {
      parameterName: "/plexo/dns/zoneId",
      stringValue: this.zone.hostedZoneId,
    });
    new ssm.StringParameter(this, "ZoneNameParam", {
      parameterName: "/plexo/dns/zoneName",
      stringValue: this.zone.zoneName,
    });
    new ssm.StringParameter(this, "CertArnParam", {
      parameterName: "/plexo/dns/wildcardCertArn",
      stringValue: this.certificate.certificateArn,
    });

    new cdk.CfnOutput(this, "NameServers", {
      value: cdk.Fn.join(", ", this.zone.hostedZoneNameServers ?? []),
      description: "Add these as an NS record set named 'plexo' under aws.charisol.io in the main Charisol account (692239535551) — one-time, done once ever.",
    });
  }
}
