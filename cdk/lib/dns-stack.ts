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
// NS records need to be added as an NS record set for "aws.plexo" under the existing
// aws.charisol.io zone in the MAIN Charisol account (692239535551) — a different account
// than this stack deploys into. That's the one write that ever touches shared company
// DNS; everything after it (every record below) is entirely within this account.
export class DnsStack extends cdk.Stack {
  public readonly zone: route53.PublicHostedZone;
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.zone = new route53.PublicHostedZone(this, "Zone", {
      zoneName: "aws.plexo.charisol.io",
    });

    // One wildcard cert covers every subdomain this migration needs (production,
    // staging, and every "pr-<n>." preview) without provisioning a new cert per
    // environment. CloudFront requires ACM certs to exist in us-east-1 specifically —
    // this stack must be deployed there regardless of where compute/data stacks run.
    this.certificate = new acm.Certificate(this, "WildcardCert", {
      domainName: "aws.plexo.charisol.io",
      subjectAlternativeNames: ["*.aws.plexo.charisol.io"],
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
      description: "Add these as an NS record set for 'aws.plexo' under aws.charisol.io in the main Charisol account (692239535551) — one-time, done once ever.",
    });
  }
}
