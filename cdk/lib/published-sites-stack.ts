import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as fs from "node:fs";
import * as path from "node:path";

// CloudFront SaaS Manager (GA April 2025) — serves every PUBLISHED tenant site (the
// plexopages.com wildcard, plus every customer's own custom domain via
// AWS::CloudFront::DistributionTenant, created at runtime by
// app/api/v1/domains/route.ts). Deliberately a SEPARATE distribution from
// compute-stack.ts's own (which serves only the dashboard's own domain) — both point at
// THE SAME two Lambdas (imported below via real CloudFormation cross-stack exports,
// compute-stack.ts must already be deployed first), since app code (middleware.ts) does
// its own host-based tenant-vs-dashboard routing regardless of which CloudFront
// distribution a request arrived through. No second copy of the app is deployed.
//
// Only `AWS::CloudFront::Distribution`'s L1 form (CfnDistribution) exposes
// ConnectionMode/TenantConfig — the L2 `Distribution` construct used in compute-stack.ts
// has no equivalent, confirmed by reading aws-cdk-lib's own .d.ts (aws-cloudfront-lib/
// distribution.d.ts has no such property; cloudfront.generated.d.ts's CfnDistribution
// does). This file is more verbose than compute-stack.ts's Distribution as a direct
// result — every behavior/origin/cache-policy id has to be spelled out explicitly instead
// of using the L2 construct's smart defaults.

export interface PublishedSitesStackProps extends cdk.StackProps {
  /** The compute stack's CloudFormation stack name — where ServerFn/ImageFn/AssetsBucket
   * are exported from (see compute-stack.ts's own CfnOutput block). */
  computeStackName: string;
  /** The wildcard domain this environment's own plexopages-style subdomain traffic uses,
   * e.g. "plexopages.com" (real production) or a test domain fully owned in Route53. Every
   * "*.<wildcardDomain>" default-tier published site resolves here. */
  wildcardDomain: string;
  /** A Route53 hosted zone for `wildcardDomain`, if this environment owns one (lets the
   * ACM certificate validate itself with zero manual DNS step). Omit for a domain hosted
   * elsewhere (e.g. plexopages.com's real Cloudflare DNS) — the cert then needs a manual
   * CNAME added at that provider before the deploy can finish; see the stack's own
   * CfnOutput for the exact validation record to add. */
  hostedZone?: route53.IHostedZone;
  /** This environment's own dashboard URL (e.g. "https://plexo.charisol.io" for
   * production, or the bare "https://<id>.cloudfront.net" compute-stack.ts's own
   * DistributionDomainName output prints for staging, which has no APP_DOMAIN) —
   * NOT the customer-facing wildcardDomain above. Only used as the target the
   * certificate-attachment EventBridge schedule below calls; nothing about tenant
   * routing depends on it. */
  appUrl: string;
}

export class PublishedSitesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PublishedSitesStackProps) {
    super(scope, id, props);

    const { computeStackName, wildcardDomain, hostedZone, appUrl } = props;

    // Same secret compute-stack.ts uses for its own distribution, same reason (see that
    // file's own comment on originVerifySecret): CloudFront OAC can't reliably sign POST
    // bodies to a Lambda Function URL origin. The server function's URL is public
    // (compute-stack.ts sets AuthType NONE and grants public invoke once, covering every
    // distribution that origins to it — this stack does not need its own invoke grant for
    // it); this custom origin header is the only thing standing between a direct hit on the
    // raw Function URL and middleware.ts's check rejecting it.
    const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET;
    if (!originVerifySecret) throw new Error("ORIGIN_VERIFY_SECRET is required (see PLEXO_ORIGIN_VERIFY_SECRET in SSM for this environment).");

    // --- Import the already-deployed compute stack's Lambdas/bucket (real CloudFormation
    // cross-stack exports, not a same-synthesis object reference — see compute-stack.ts's
    // own comment on why: this app's cdk/bin/app.ts deploys one STACK_KIND per invocation,
    // never multiple stacks in one synthesis pass). ---
    const serverFnArn = cdk.Fn.importValue(`${computeStackName}-ServerFnArn`);
    const serverFnUrlValue = cdk.Fn.importValue(`${computeStackName}-ServerFnUrl`);
    const imageFnArn = cdk.Fn.importValue(`${computeStackName}-ImageFnArn`);
    const imageFnUrlValue = cdk.Fn.importValue(`${computeStackName}-ImageFnUrl`);
    const assetsBucketName = cdk.Fn.importValue(`${computeStackName}-AssetsBucketName`);

    const serverFn = lambda.Function.fromFunctionAttributes(this, "ImportedServerFn", {
      functionArn: serverFnArn,
      sameEnvironment: true,
    });
    const imageFn = lambda.Function.fromFunctionAttributes(this, "ImportedImageFn", {
      functionArn: imageFnArn,
      sameEnvironment: true,
    });
    const assetsBucket = s3.Bucket.fromBucketName(this, "ImportedAssetsBucket", assetsBucketName);

    // Function URL hostnames, stripped of the "https://" + trailing "/" `Fn::ImportValue`
    // hands back as a full URL — CfnDistribution's OriginProperty wants a bare domain name.
    const serverFnDomain = cdk.Fn.select(2, cdk.Fn.split("/", serverFnUrlValue));
    const imageFnDomain = cdk.Fn.select(2, cdk.Fn.split("/", imageFnUrlValue));

    // --- Origin Access Control — one per origin type, same purpose as
    // origins.FunctionUrlOrigin.withOriginAccessControl()/S3BucketOrigin.withOriginAccessControl()
    // in compute-stack.ts, just spelled out at the L1 level since this distribution is
    // built with CfnDistribution, not the L2 Distribution construct. ---
    const imageOac = new cloudfront.CfnOriginAccessControl(this, "ImageOAC", {
      originAccessControlConfig: { name: `${this.stackName}-image`, originAccessControlOriginType: "lambda", signingBehavior: "always", signingProtocol: "sigv4" },
    });
    const s3Oac = new cloudfront.CfnOriginAccessControl(this, "S3OAC", {
      originAccessControlConfig: { name: `${this.stackName}-s3`, originAccessControlOriginType: "s3", signingBehavior: "always", signingProtocol: "sigv4" },
    });

    // Same fix as compute-stack.ts's own distribution, for the same reason (see that
    // file's own comment): ALL_VIEWER_EXCEPT_HOST below unconditionally replaces the real
    // Host header before it reaches the Lambda origin, so this CloudFront Function on
    // viewer-request copies it into x-forwarded-host first. Shared source file — same
    // fix, same file, both distributions.
    const forwardHostFn = new cloudfront.CfnFunction(this, "ForwardHostFunction", {
      name: `${this.stackName}-forward-host`,
      autoPublish: true,
      functionConfig: { comment: "Copies the real viewer Host into x-forwarded-host before the origin request policy strips it", runtime: "cloudfront-js-2.0" },
      functionCode: fs.readFileSync(path.join(__dirname, "forward-host-function.js"), "utf8"),
    });

    const CACHING_DISABLED = cloudfront.CachePolicy.CACHING_DISABLED.cachePolicyId;
    const CACHING_OPTIMIZED = cloudfront.CachePolicy.CACHING_OPTIMIZED.cachePolicyId;
    const ALL_VIEWER_EXCEPT_HOST = cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER.originRequestPolicyId;
    const ALLOW_ALL_METHODS = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"];
    const CACHED_METHODS = ["GET", "HEAD"];

    // --- The multi-tenant "primary" distribution — behaviors are a straight port of
    // compute-stack.ts's own Distribution (see that file's comment: "behaviors match
    // open-next.output.json exactly"). ConnectionMode "tenant-only" + TenantConfig is what
    // makes this a SaaS Manager primary distribution instead of a standard one — every
    // real domain (the wildcard AND every customer's own) is attached via a
    // CfnDistributionTenant below/at runtime, never directly on this resource. ---

    // Wildcard cert for this environment's own plexopages-style domain — created before
    // the primary distribution because CloudFront requires an explicit ViewerCertificate
    // on the primary distribution's own DistributionConfig even in tenant-only mode
    // (confirmed by a real deploy failure without it: "The specified distribution is
    // configured for SNI and the minimum SSL protocol version is specified as SSLv3" —
    // CloudFront's implicit default cert isn't SNI-compatible). This cert is never what
    // actually serves real tenant traffic (every real request matches a
    // CfnDistributionTenant, each with its own certificate — the wildcard tenant's own
    // below, or a customer's ManagedCertificateRequest at runtime); it only satisfies this
    // resource's own validation. DNS-validated via Route53 when `hostedZone` is supplied
    // (zero manual step); otherwise the deploy waits for a manual CNAME at whatever DNS
    // provider actually hosts `wildcardDomain` — see this stack's own
    // `WildcardCertArn`/`describe-certificate` for the exact record to add.
    const wildcardCert = new acm.Certificate(this, "WildcardCert", {
      domainName: `*.${wildcardDomain}`,
      subjectAlternativeNames: [wildcardDomain],
      validation: hostedZone ? acm.CertificateValidation.fromDns(hostedZone) : acm.CertificateValidation.fromDns(),
    });

    const primaryDistribution = new cloudfront.CfnDistribution(this, "PrimaryDistribution", {
      distributionConfig: {
        enabled: true,
        connectionMode: "tenant-only",
        tenantConfig: { parameterDefinitions: [] },
        viewerCertificate: { acmCertificateArn: wildcardCert.certificateArn, sslSupportMethod: "sni-only" },
        origins: [
          {
            id: "ServerFn",
            domainName: serverFnDomain,
            customOriginConfig: { originProtocolPolicy: "https-only", originSslProtocols: ["TLSv1.2"] },
            originCustomHeaders: [{ headerName: "x-origin-verify", headerValue: originVerifySecret }],
          },
          {
            id: "ImageFn",
            domainName: imageFnDomain,
            customOriginConfig: { originProtocolPolicy: "https-only", originSslProtocols: ["TLSv1.2"] },
            originAccessControlId: imageOac.attrId,
          },
          {
            id: "AssetsBucket",
            domainName: `${assetsBucket.bucketName}.s3.${this.region}.amazonaws.com`,
            originPath: "/_assets",
            s3OriginConfig: { originAccessIdentity: "" },
            originAccessControlId: s3Oac.attrId,
          },
        ],
        defaultCacheBehavior: {
          targetOriginId: "ServerFn",
          viewerProtocolPolicy: "redirect-to-https",
          cachePolicyId: CACHING_DISABLED,
          originRequestPolicyId: ALL_VIEWER_EXCEPT_HOST,
          allowedMethods: ALLOW_ALL_METHODS,
          cachedMethods: CACHED_METHODS,
          functionAssociations: [{ eventType: "viewer-request", functionArn: forwardHostFn.attrFunctionArn }],
        },
        cacheBehaviors: [
          { pathPattern: "_next/image*", targetOriginId: "ImageFn", viewerProtocolPolicy: "redirect-to-https", cachePolicyId: CACHING_OPTIMIZED, allowedMethods: CACHED_METHODS, cachedMethods: CACHED_METHODS },
          { pathPattern: "_next/*", targetOriginId: "AssetsBucket", viewerProtocolPolicy: "redirect-to-https", cachePolicyId: CACHING_OPTIMIZED, allowedMethods: CACHED_METHODS, cachedMethods: CACHED_METHODS },
          { pathPattern: "commerce.js", targetOriginId: "AssetsBucket", viewerProtocolPolicy: "redirect-to-https", cachePolicyId: CACHING_OPTIMIZED, allowedMethods: CACHED_METHODS, cachedMethods: CACHED_METHODS },
          { pathPattern: "uploads/*", targetOriginId: "AssetsBucket", viewerProtocolPolicy: "redirect-to-https", cachePolicyId: CACHING_OPTIMIZED, allowedMethods: CACHED_METHODS, cachedMethods: CACHED_METHODS },
        ],
      },
    });

    // Distribution-scoped Lambda invoke permissions — same pattern compute-stack.ts uses
    // for its own distribution (see that file's own comment: OAC signing needs BOTH
    // lambda:InvokeFunctionUrl AND plain lambda:InvokeFunction, confirmed by a real 403
    // AccessDeniedException from the Function URL itself when only the first was granted
    // here — CloudFront routed the request fine, the Lambda's own resource policy was
    // what rejected it), just granted here for THIS distribution via the imported function
    // names (fromFunctionAttributes doesn't support .addPermission() directly across
    // stacks, so this uses the raw CfnPermission L1 resource instead). Server excluded —
    // its Function URL is public (compute-stack.ts grants invoke once, globally).
    for (const [name, fn] of [["Image", imageFn] as const]) {
      new lambda.CfnPermission(this, `AllowPrimaryInvoke${name}Url`, {
        action: "lambda:InvokeFunctionUrl",
        functionName: fn.functionArn,
        principal: "cloudfront.amazonaws.com",
        sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${primaryDistribution.attrId}`,
        functionUrlAuthType: "AWS_IAM",
      });
      new lambda.CfnPermission(this, `AllowPrimaryInvoke${name}Function`, {
        action: "lambda:InvokeFunction",
        functionName: fn.functionArn,
        principal: "cloudfront.amazonaws.com",
        sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${primaryDistribution.attrId}`,
      });
    }
    // S3 bucket policy grant for this distribution's OAC — the bucket itself is owned by
    // compute-stack.ts, but any stack may extend an imported bucket's resource policy.
    assetsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [assetsBucket.arnForObjects("*")],
        conditions: { StringEquals: { "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${primaryDistribution.attrId}` } },
      }),
    );

    // --- Connection group — the actual routing endpoint every tenant's DNS CNAME points
    // at (one shared endpoint domain for every tenant using it, wildcard AND custom-domain
    // alike). ---
    const connectionGroup = new cloudfront.CfnConnectionGroup(this, "ConnectionGroup", {
      name: `${this.stackName}-cg`,
      enabled: true,
      ipv6Enabled: true,
    });

    // The wildcard domain's own DistributionTenant — every "*.{wildcardDomain}" default
    // site (no custom domain connected) is served through this one tenant, using the
    // manually-provisioned cert above rather than a per-domain ManagedCertificateRequest
    // (that's for CUSTOMER custom domains only — see
    // app/api/v1/domains/route.ts's CreateDistributionTenant call for those, created one
    // at a time at runtime, not pre-provisioned here).
    const wildcardTenant = new cloudfront.CfnDistributionTenant(this, "WildcardTenant", {
      distributionId: primaryDistribution.attrId,
      connectionGroupId: connectionGroup.attrId,
      name: `${this.stackName}-wildcard`,
      domains: [`*.${wildcardDomain}`, wildcardDomain],
      enabled: true,
      customizations: { certificate: { arn: wildcardCert.certificateArn } },
    });
    wildcardTenant.addDependency(primaryDistribution);
    wildcardTenant.addDependency(connectionGroup);

    // --- Scheduled internal routes — replaces every vercel.json cron entry (deleted along
    // with that file; Vercel no longer hosts anything) plus the certificate-attachment job
    // this stack already needed of its own accord. One EventBridge API Destination per
    // route rather than a new Lambda per job: all of these are already real Next.js routes
    // under app/api/internal/*, each gated by the exact "x-cron-secret header + CRON_SECRET"
    // pattern lib/cronAuth.ts establishes — reused here as a single shared Connection.
    //
    // Header name deliberately NOT "Authorization" — confirmed by direct reproduction (see
    // lib/cronAuth.ts's own comment) that a Lambda Function URL with FunctionUrlAuthType.NONE
    // still intercepts any request carrying that header and rejects it as an invalid SigV4
    // signature attempt before this app's own code ever runs, regardless of the header's
    // actual content. This is also why app/api/internal/scan-domains/route.ts's own Vercel-
    // Cron-era doc comment about "Authorization: Bearer" no longer matches its actual code.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) throw new Error("CRON_SECRET is required (see CRON_SECRET in SSM for this environment — /plexo/<env>/CRON_SECRET).");

    const cronConnection = new events.Connection(this, "CronConnection", {
      connectionName: `${this.stackName}-cron`,
      authorization: events.Authorization.apiKey("x-cron-secret", cdk.SecretValue.unsafePlainText(cronSecret)),
    });

    // rateLimitPerSecond: 1 on every destination below — none of these jobs are ever
    // invoked more than once per schedule tick, so this is purely a safety ceiling, not a
    // real throughput need.
    const scheduledRoute = (id: string, routePath: string, schedule: events.Schedule): void => {
      const destination = new events.ApiDestination(this, `${id}ApiDestination`, {
        apiDestinationName: `${this.stackName}-${id.toLowerCase()}`,
        connection: cronConnection,
        endpoint: `${appUrl}${routePath}`,
        httpMethod: events.HttpMethod.GET,
        rateLimitPerSecond: 1,
      });
      new events.Rule(this, `${id}Schedule`, {
        schedule,
        targets: [new targets.ApiDestination(destination)],
      });
    };

    // Finishes connecting every CUSTOM domain whose self-managed ACM certificate
    // (requested by app/api/v1/domains/route.ts at lib/acmCertificates.ts's
    // requestCertificate, NOT CloudFront's own ManagedCertificateRequest — see
    // lib/acmCertificates.ts's own comment on why that built-in mechanism was abandoned)
    // has finished DNS validation. At rate(5 minutes) this costs nothing extra worth
    // tracking — ~8,640 invocations/month, both EventBridge's own free tier and this
    // account's existing traffic dwarf that.
    scheduledRoute("CertAttachment", "/api/internal/certificate-attachment", events.Schedule.rate(cdk.Duration.minutes(5)));

    // Re-scans already-published domains for newly-flagged threats — see that route's own
    // doc comment. Daily matches its own stated cadence (a catch-up sweep, not a tight
    // loop) — Vercel Hobby's cron-plan ceiling forced daily originally, but that happens to
    // already be the right cadence here, unlike expire-stale-holds below.
    scheduledRoute("ScanDomains", "/api/internal/scan-domains", events.Schedule.cron({ minute: "0", hour: "0" }));

    // Catch-up backstops for an import whose dashboard tab isn't open — see each route's
    // own doc comment. Daily is the right cadence for both: "stalled" just means nobody's
    // watching, not that anything's broken, so there's no cost to a job sitting stalled for
    // up to a day before this catches it.
    scheduledRoute("BlogImportResumeStalled", "/api/internal/blog-import/resume-stalled", events.Schedule.cron({ minute: "0", hour: "12" }));
    scheduledRoute("SiteImportResumeStalled", "/api/internal/site-import/resume-stalled", events.Schedule.cron({ minute: "0", hour: "13" }));

    // Every 15 minutes, NOT once a day like the other backstops above — see that route's
    // own doc comment on why: its 15-minute hold window means a once-daily sweep would
    // leave an abandoned order's booking slot lock (and any reserved inventory) squatted
    // for up to ~24h, blocking a real customer from booking that same slot in the
    // meantime. Daily was a Vercel Hobby cron-plan ceiling this migration is no longer
    // bound by, not the actually-desired cadence.
    scheduledRoute("CommerceExpireStaleHolds", "/api/internal/commerce/expire-stale-holds", events.Schedule.rate(cdk.Duration.minutes(15)));

    new cdk.CfnOutput(this, "ConnectionGroupRoutingEndpoint", { value: connectionGroup.attrRoutingEndpoint });
    new cdk.CfnOutput(this, "PrimaryDistributionId", { value: primaryDistribution.attrId, exportName: `${this.stackName}-PrimaryDistributionId` });
    new cdk.CfnOutput(this, "ConnectionGroupId", { value: connectionGroup.attrId, exportName: `${this.stackName}-ConnectionGroupId` });
    new cdk.CfnOutput(this, "WildcardCertArn", { value: wildcardCert.certificateArn });
  }
}
