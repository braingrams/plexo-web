#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import { DataStack } from "../lib/data-stack";
import { ComputeStack } from "../lib/compute-stack";
import { AnalyticsStack } from "../lib/analytics-stack";
import { DnsStack } from "../lib/dns-stack";
import { PublishedSitesStack } from "../lib/published-sites-stack";

const app = new cdk.App();
cdk.Tags.of(app).add("appName", "plexo-web");
cdk.Tags.of(app).add("businessName", "plexo");

const stackID = process.env.STACK_ID || "pr-1-plexo";
// "data" deploys the persistent DynamoDB tables (production, staging — never per-PR).
// "compute" deploys the app-hosting layer (production, staging, and per-PR previews).
// "analytics" deploys the export/Athena admin-query path (production, staging only —
// no PR preview needs its own export pipeline).
// "dns" deploys the plexo.aws.charisol.io hosted zone + wildcard cert — ONCE ever, same
// as "data"/"analytics" (never per-PR; every environment shares this one zone/cert).
const stackKind = process.env.STACK_KIND || "data";

const env = {
  account: process.env.AWS_ACCOUNT_ID,
  region: process.env.AWS_REGION,
};

if (stackKind === "data") {
  new DataStack(app, `${stackID}-data-stack`, { env });
} else if (stackKind === "compute") {
  new ComputeStack(app, `${stackID}-compute-stack`, { env });
} else if (stackKind === "analytics") {
  const isProd = (process.env.PLEXO_ENV || "development") === "production";
  const nameFor = (base: string): string => (isProd ? base : `${base}-${stackID}`);
  const arnFor = (base: string): string =>
    `arn:aws:dynamodb:${env.region}:${env.account}:table/${nameFor(base)}`;

  new AnalyticsStack(
    app,
    `${stackID}-analytics-stack`,
    {
      core: arnFor("plexo-core"),
      commerce: arnFor("plexo-commerce"),
      content: arnFor("plexo-content"),
    },
    { env },
  );
} else if (stackKind === "dns") {
  new DnsStack(app, `${stackID}-dns-stack`, { env });
} else if (stackKind === "published-sites") {
  // WILDCARD_DOMAIN: the "*.<domain>" every default-tier published site resolves under
  // in THIS environment — plexopages.com for real production, a test domain otherwise.
  // WILDCARD_ZONE_ID/WILDCARD_ZONE_NAME: only set when that domain's DNS is a Route53
  // zone this AWS account owns (lets the ACM cert self-validate with zero manual step);
  // omit for a domain hosted elsewhere (e.g. plexopages.com's real Cloudflare DNS) — see
  // published-sites-stack.ts's own comment on what happens then.
  const wildcardDomain = process.env.WILDCARD_DOMAIN;
  if (!wildcardDomain) throw new Error('STACK_KIND=published-sites requires WILDCARD_DOMAIN (e.g. "plexopages.com").');
  const zoneId = process.env.WILDCARD_ZONE_ID;
  const zoneName = process.env.WILDCARD_ZONE_NAME;
  // This environment's own dashboard URL — production's is its real APP_DOMAIN
  // (see compute-stack.ts); staging has none, so this is the bare
  // "https://<id>.cloudfront.net" compute-stack.ts's own DistributionDomainName output
  // prints after that stack deploys. Only used as the certificate-attachment
  // EventBridge schedule's call target (see published-sites-stack.ts's own comment).
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new Error('STACK_KIND=published-sites requires APP_URL (e.g. "https://plexo.charisol.io").');
  // See published-sites-stack.ts's own comment on wildcardCertArn — set this to reuse an
  // already-issued cert (requested + DNS-validated by hand) instead of `cdk deploy`
  // creating and blocking on a brand-new one for the same domain.
  const wildcardCertArn = process.env.WILDCARD_CERT_ARN;

  new PublishedSitesStack(app, `${stackID}-published-sites-stack`, {
    env,
    computeStackName: `${stackID}-compute-stack`,
    wildcardDomain,
    wildcardCertArn,
    appUrl,
    hostedZone:
      zoneId && zoneName
        ? route53.HostedZone.fromHostedZoneAttributes(app, "WildcardZoneLookup", { hostedZoneId: zoneId, zoneName })
        : undefined,
  });
} else {
  throw new Error(`Unknown STACK_KIND "${stackKind}" — expected "data", "compute", "analytics", "dns", or "published-sites"`);
}
