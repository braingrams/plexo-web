import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

// Every Lambda-backed construct in this app should pass `logGroup` built from this
// helper rather than let CDK create an unmanaged, unretained log group — unmanaged
// retention is the single easiest way a small serverless app blows past CloudWatch's
// free tier (see the migration roadmap's cost analysis). 30 days is enough for real
// debugging without the log group growing without bound.
export const DEFAULT_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

const isProd = (process.env.PLEXO_ENV || "development") === "production";

// `logRetention` on lambda.Function is deprecated (CDK flags it for removal in a future
// major version) in favor of passing an explicit `logGroup` — this is that log group,
// pre-wired with the retention above and a removal policy matching the rest of this
// migration's non-prod-is-disposable / prod-is-retained convention.
export function buildLogGroup(scope: Construct, id: string): logs.LogGroup {
  return new logs.LogGroup(scope, `${id}LogGroup`, {
    retention: DEFAULT_LOG_RETENTION,
    removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
  });
}

// Off by default, on purpose: provisioning the WAF is real recurring AWS spend (~$20-22/mo
// combined across both distributions — see the cost note below), and it must NOT start
// accruing just because this code is merged/pushed through the normal CI auto-deploy
// pipeline. Deploying it requires an explicit, intentional flip of this flag (WAF_ENABLED=true
// in the deploy environment) — never as a side effect of an unrelated change landing on main.
export function isWafEnabled(): boolean {
  return process.env.WAF_ENABLED === "true";
}

/**
 * A baseline AWS-managed WAFv2 WebACL for a CloudFront distribution — shared by
 * compute-stack.ts (dashboard/app) and published-sites-stack.ts (customer-published
 * sites), each getting its own independent WebACL (a WebACL can only be reused across
 * distributions that live in the SAME stack's deploy; these are separate `cdk deploy`
 * invocations, so sharing one via a cross-stack export wasn't worth the coupling for a
 * first pass). MUST be created in us-east-1 regardless of the rest of the account's
 * resources — a hard CloudFront/WAFv2 requirement — which every real deploy already
 * satisfies (see .github/workflows/deploy-{staging,production}.yml's AWS_REGION).
 *
 * Cost: ~$5/month base + ~$1/month per rule (5 rules here) + $0.60 per million requests
 * inspected, PER WebACL — real, ongoing AWS spend, not a one-time cost. Deliberately a
 * general-purpose baseline (common web exploits, known-bad-input signatures, SQLi,
 * Amazon's own IP reputation list, plus a per-IP rate limit) rather than anything
 * app-specific — a first WAF layer, not a replacement for the app-level rate limiting
 * already in place on auth/commerce/forms endpoints.
 */
export function buildCloudFrontWebAcl(scope: Construct, id: string, metricPrefix: string): wafv2.CfnWebACL {
  const managedRule = (name: string, priority: number) => ({
    name,
    priority,
    overrideAction: { none: {} },
    statement: { managedRuleGroupStatement: { vendorName: "AWS", name } },
    visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: `${metricPrefix}${name}` },
  });

  return new wafv2.CfnWebACL(scope, id, {
    scope: "CLOUDFRONT",
    defaultAction: { allow: {} },
    visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: `${metricPrefix}WebAcl` },
    rules: [
      {
        name: "RateLimit",
        priority: 0,
        action: { block: {} },
        statement: {
          // Requests from a single IP within a rolling 5-minute window — well above any
          // real visitor's normal traffic, sized to catch scraping/brute-force/DDoS-style
          // bursts without tripping on a legitimate heavy user (e.g. the page builder's
          // own autosave polling, or a busy storefront during a sale).
          rateBasedStatement: { limit: 3000, aggregateKeyType: "IP" },
        },
        visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: `${metricPrefix}RateLimit` },
      },
      managedRule("AWSManagedRulesCommonRuleSet", 1),
      managedRule("AWSManagedRulesKnownBadInputsRuleSet", 2),
      managedRule("AWSManagedRulesSQLiRuleSet", 3),
      managedRule("AWSManagedRulesAmazonIpReputationList", 4),
    ],
  });
}
