import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "node:path";
import * as fs from "node:fs";
import { buildLogGroup, buildCloudFrontWebAcl, isWafEnabled } from "./conventions";

// Real OpenNext deployment (SSR Lambda + image-optimization Lambda + CloudFront + S3 +
// SQS/DynamoDB for ISR), built from a verified `.open-next/` build output — not
// speculative CDK. Every bundle path, env var name, and CloudFront behavior below was
// confirmed by actually running `npx @opennextjs/aws build` and reading the real
// output manifest (open-next.output.json) plus the package's own source (dist/overrides/
// {incrementalCache,tagCache,queue,imageLoader}/*.js), not guessed from documentation
// that turned out to be unreliable to scrape. Deliberately skips the OpenNext "warmer"
// function — it exists to reduce cold starts under sustained traffic, which directly
// conflicts with this migration's whole premise (scale genuinely to zero, minimize cost
// at this app's actual traffic level).

const isProd = (process.env.PLEXO_ENV || "development") === "production";
const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;
const ssmEnv = isProd ? "production" : "staging";

// App secrets are deliberately NOT injected into the Lambda's Environment.Variables block
// via a CloudFormation SSM dynamic reference — tried exactly that first, and a real `cdk
// deploy` rejected it outright: "SSM Secure reference is not supported in:
// AWS::Lambda::Function/.../Environment/Variables". That's a hard CloudFormation
// restriction on which resource properties accept an ssm-secure dynamic reference, not a
// permissions gap — confirmed by actually deploying, not by trusting `cdk synth` (which
// synthesizes a template that looks valid and only fails at the changeset-creation step).
//
// Instead, secrets are loaded at Lambda cold start by the app itself (lib/ssmEnv.ts,
// invoked from instrumentation.ts's register() — Next.js guarantees that runs once per
// server instance and completes before any request is served, so every existing eager
// `process.env.X` read elsewhere in the app stays safe without auditing each call site,
// unlike maildrip-server/utils/dotenv.js's per-key lazy-read discipline, which exists
// because maildrip has no equivalent single choke point). All this stack needs to grant is
// read access to the real secrets' SSM path plus KMS decrypt for the SecureString type.

// Resolved relative to this file (cdk/lib/compute-stack.ts) up to the repo root's
// .open-next/ output — `npm run build && npx @opennextjs/aws build` must have been run
// before `cdk deploy` for this stack kind. Not committed to git (build output).
const OPEN_NEXT_DIR = path.join(__dirname, "..", "..", ".open-next");

// SolChatFn's handler entry point — NOT an OpenNext output directory (SOL is a plain,
// standalone Lambda, not part of the Next.js app). Built via NodejsFunction below, which
// bundles this TypeScript entry with esbuild at synth time (esbuild is a cdk/
// devDependency specifically so this works locally without falling back to Docker-based
// bundling) — resolved, no longer the raw-source-zip gap the original TODO(infra) here
// used to flag.
const SOL_CHAT_ENTRY = path.join(__dirname, "..", "..", "lambda", "sol-chat", "index.ts");

// Same naming convention as data-stack.ts's own nameFor() — production keeps the bare
// literal table names ("plexo-core", etc.) it's already deployed with; every other
// environment gets a "-${stackID}" suffix. This MUST match data-stack.ts exactly, or a
// deployed Lambda resolves to a table that doesn't exist (or worse, silently falls back
// to lib/db/client.ts's bare-name default and reads/writes a DIFFERENT environment's
// live data — this was previously the actual bug here: these 6 env vars were never
// injected at all, so every deployed Lambda regardless of environment fell back to the
// production table names).
//
// TABLE_STACK_ID (falling back to STACK_ID) exists because a PR preview's own STACK_ID
// (e.g. "pr-5-plexo") does NOT have its own DynamoDB tables — data-stack.ts is deployed
// once for staging/production only (see cdk/bin/app.ts's own comment: "never per-PR"),
// so naming a PR preview's tables after its own stackID would point every DynamoDB call
// at tables that don't exist. pr-deploy-aws.yml sets this to "staging-plexo" so PR
// previews share staging's real tables instead; staging/production's own deploys never
// set it, so STACK_ID (their own real name) is used, unchanged from before.
const stackID = process.env.STACK_ID || "pr-1-plexo";
const tableStackID = process.env.TABLE_STACK_ID || stackID;
const nameFor = (base: string): string => (isProd ? base : `${base}-${tableStackID}`);

// CloudFront's Origin Access Control cannot reliably sign POST/PUT request bodies to a
// Lambda Function URL origin — confirmed by directly reproducing InvalidSignatureException
// against a real deployed distribution (GET and empty-body POST succeed, any POST with a
// body fails), matching AWS's own known limitation for this exact origin type. The server
// function's URL is public (AuthType NONE) instead; this random secret is attached as a
// CloudFront-only custom origin header (set on the origin config itself, not forwarded from
// any viewer header, so it can't be spoofed) and checked first thing in middleware.ts —
// anything reaching the raw *.lambda-url.on.aws address directly, bypassing CloudFront,
// gets rejected before any app logic runs. The image-optimization function is GET-only and
// keeps its existing OAC/IAM protection untouched; only the server function needed this.
const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET;
if (!originVerifySecret) throw new Error("ORIGIN_VERIFY_SECRET is required (see PLEXO_ORIGIN_VERIFY_SECRET in SSM for this environment).");

// Baked in as a literal Lambda env var for the same reason as PLEXO_ORIGIN_VERIFY_SECRET
// just above, PLUS a second, independent reason found by direct testing: this app's
// entire "load secrets from SSM at cold start" mechanism (lib/ssmEnv.ts, via
// instrumentation.ts) has never actually been exercised in any real deployed
// environment — every /plexo/<env>/<KEY> SSM parameter is still the literal placeholder
// value "REPLACE_ME" sync-secrets-to-ssm.yml's own setup left behind, and
// loadSecretsFromSsm()'s own short-circuit (`if (process.env.AUTH_SECRET) return`) has
// been silently true from cold start every time, because Next.js's `output: "standalone"`
// build (required by OpenNext) always copies the repo's own root .env file into the
// deployed bundle, and Next.js's generated server bootstrap loads it before
// instrumentation.ts's register() ever runs — so every deployed Lambda has actually been
// running on whatever local/dev secret values happened to be in .env at build time, not
// the SSM-managed ones at all. That's a separate, much bigger gap (covers AUTH_SECRET,
// GOOGLE_CLIENT_ID/SECRET, STRIPE_*, MAILDRIP_*, PUSHER_*, every encryption key) flagged
// to the user rather than silently fixed here — fixing loadSecretsFromSsm()'s
// short-circuit is pointless until real (non-"REPLACE_ME") values actually exist in SSM
// for every key, which requires secrets only the user has. This one value is narrow
// enough to bake in directly without waiting on that broader fix.
const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) throw new Error("CRON_SECRET is required (see CRON_SECRET in SSM for this environment — /plexo/<env>/CRON_SECRET).");

// SolChatFn (below) is a bare, non-Next.js Lambda, so it does NOT get NextAuth's
// AUTH_SECRET for free the way serverFn does (serverFn's copy comes from the repo's own
// .env file bundled into the Next.js standalone build at build time — see the giant
// comment above ORIGIN_VERIFY_SECRET's own gap for why that's a separate, already-flagged
// problem). SolChatFn has to verify a NextAuth session JWT itself (see
// lambda/sol-chat/sessionAuth.ts), so it needs the actual signing secret injected as a
// real env var — baked in the same narrow, direct way as originVerifySecret/cronSecret
// just above, not through the still-broken loadSecretsFromSsm() runtime path.
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) throw new Error("AUTH_SECRET is required for SolChatFn's session verification (see AUTH_SECRET in SSM for this environment).");

// System AI (the page-builder AI proxy's account-without-a-BYOK-key path,
// lib/ai/systemProvider.ts's resolveSystemProvider()) needs these baked into ServerFn the
// same direct way as PLEXO_ORIGIN_VERIFY_SECRET/CRON_SECRET above, for the identical
// reason: the loadSecretsFromSsm() runtime path never actually runs (see that gap's own
// giant comment above). Deliberately OPTIONAL, unlike every secret above — an environment
// with System AI not yet configured should just make that one feature unavailable
// (resolveSystemProvider() already throws a clean, caught "not configured" error at
// request time), not fail the whole deploy the way a missing auth/security secret would.
const systemAiEnv: Record<string, string> = {};
for (const key of ["SYSTEM_AI_PROVIDER", "SYSTEM_AI_KEY_ANTHROPIC_CLAUDE", "SYSTEM_AI_KEY_OPENAI", "SYSTEM_AI_KEY_GOOGLE_GEMINI"]) {
  const value = process.env[key];
  if (value) systemAiEnv[key] = value;
}

// Cache-busting suffix for the unhashed, unversioned public/commerce.js URL that
// app/pub/[domain]/[[...slug]]/route.ts's injectCommerceScript() embeds into every
// published storefront — see that file's own comment. The deploy workflows set this to
// `github.sha`, so every deploy serves commerce.js from a brand-new URL: this is what
// actually invalidates it for real visitors' BROWSERS, which is a gap DeployCommerceJs's
// shorter Cache-Control below can't close by itself — a browser that already cached the
// old immutable response never re-requests the same URL until that year-long max-age
// elapses, no matter what CloudFront/the origin serve on a later request. Defaults to
// "dev" locally/in PR previews, where staleness doesn't matter.
const assetVersion = process.env.ASSET_VERSION ?? "dev";

// Optional real custom domain for the dashboard's own distribution (e.g.
// "plexo.charisol.io" for production) — omitted for staging/PR previews, which stay on
// their own bare *.cloudfront.net domain. charisol.io's DNS lives on Cloudflare, not
// Route53 (confirmed via `dig NS charisol.io`), same as plexopages.com — so, like that
// domain's own wildcard cert in published-sites-stack.ts, this validates via a manual
// CNAME the deploy waits on rather than DnsValidatedCertificate/hostedZone — UNLESS
// APP_CERT_ARN is set to an already-ISSUED cert someone requested and DNS-validated by
// hand beforehand, in which case that's imported instead of creating (and blocking on)
// a brand-new one for the same domain (see published-sites-stack.ts's matching
// wildcardCertArn comment for why this exists).
const appDomain = process.env.APP_DOMAIN;
const appCertArn = process.env.APP_CERT_ARN;
// plexo-ledger's customer-managed KMS key's real key ARN (arn:...:key/<uuid>), NOT its
// alias ARN (arn:...:alias/plexo-ledger) — an IAM policy scoped to the alias ARN silently
// fails to authorize the kms:Decrypt/kms:GenerateDataKey calls DynamoDB actually makes
// under the hood, because those calls reference the resolved key ARN, not the alias the
// table was configured with. Confirmed live: granting the alias ARN (an earlier version
// of this same fix) still produced the identical AccessDeniedException in production —
// only switching to the real key ARN resolved it. KMS key ARNs are permanent for the
// life of the key (rotation only rotates backing key material, not the ARN), so — like
// appCertArn above — this is safe to pin once per environment rather than re-resolved
// on every deploy. Read (and validated) inside the constructor below, NOT at module
// scope like cronSecret/originVerifySecret — bin/app.ts imports this module
// unconditionally regardless of STACK_KIND, so a module-scope throw here broke every
// non-compute deploy (confirmed live: it took down a published-sites-stack deploy that
// never even touches this variable).
const tableEnv = {
  PLEXO_CORE_TABLE: nameFor("plexo-core"),
  PLEXO_LEDGER_TABLE: nameFor("plexo-ledger"),
  PLEXO_COMMERCE_TABLE: nameFor("plexo-commerce"),
  PLEXO_CONTENT_TABLE: nameFor("plexo-content"),
  PLEXO_OPS_TABLE: nameFor("plexo-ops"),
  PLEXO_IMPORT_TABLE: nameFor("plexo-import"),
  // SOL (AI chat agent) — the table itself is provisioned by a parallel task
  // (data-stack.ts), not by this stack; named here the same way every other
  // cross-stack table name is (nameFor(), matching data-stack.ts's own convention
  // exactly) so SolChatFn resolves to the same physical table data-stack.ts creates.
  PLEXO_SOL_TABLE: nameFor("plexo-sol"),
};

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ledgerKmsKeyArn = process.env.LEDGER_KMS_KEY_ARN;
    if (!ledgerKmsKeyArn) throw new Error("LEDGER_KMS_KEY_ARN is required (the real key/ ARN, not alias/ — run: aws kms describe-key --key-id alias/<plexo-ledger alias for this env> --query KeyMetadata.Arn).");

    // Static assets + incremental cache — matches open-next.output.json's "s3" origin
    // exactly: assets copied to `_assets`, cache to `_cache`.
    const assetsBucket = new s3.Bucket(this, "AssetsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy,
      autoDeleteObjects: !isProd,
    });
    const deployAssets = new s3deploy.BucketDeployment(this, "DeployAssets", {
      sources: [s3deploy.Source.asset(path.join(OPEN_NEXT_DIR, "assets"))],
      destinationBucket: assetsBucket,
      destinationKeyPrefix: "_assets",
      // Versioned _next/static/* content is content-hashed and immutable — safe to
      // cache forever; everything else defaults to CloudFront's own cache policy below.
      cacheControl: [s3deploy.CacheControl.fromString("public,max-age=31536000,immutable")],
      prune: false,
    });

    // commerce.js is the one file under _assets/ that published-sites-stack.ts routes
    // through CACHING_OPTIMIZED (see that file's "commerce.js" cacheBehavior) that is
    // NEITHER content-hashed (unlike _next/*) NOR immutable per-upload content (unlike
    // uploads/*) — it's a single shared, unhashed script the platform ships and can
    // change on any deploy. DeployAssets above stamps the *entire* assets tree with a
    // year-long immutable Cache-Control, so it was inheriting that header too: real
    // storefronts kept serving a pre-fix commerce.js for days after the fix had already
    // landed and redeployed, because CloudFront never had a reason to re-check the
    // origin. This second deployment overwrites just that one object with a short,
    // revalidating Cache-Control — ordered (via addDependency) to run after DeployAssets
    // so its header is the one left standing on the shared key both deployments write.
    const deployCommerceJs = new s3deploy.BucketDeployment(this, "DeployCommerceJs", {
      sources: [s3deploy.Source.data("commerce.js", fs.readFileSync(path.join(OPEN_NEXT_DIR, "assets", "commerce.js"), "utf-8"))],
      destinationBucket: assetsBucket,
      destinationKeyPrefix: "_assets",
      cacheControl: [s3deploy.CacheControl.fromString("public,max-age=60,must-revalidate")],
      prune: false,
    });
    deployCommerceJs.node.addDependency(deployAssets);

    // This bucket is ALSO read by published-sites-stack.ts's own separate CloudFront
    // distribution (via s3.Bucket.fromBucketName + an imported-bucket origin there) — but
    // this stack is the bucket's owner, so it's the only one that may safely manage its
    // AWS::S3::BucketPolicy. Each S3BucketOrigin.withOriginAccessControl() call below
    // auto-adds its OWN narrow per-distribution statement (scoped to THIS stack's
    // distribution only) into that same policy document; that alone starved
    // published-sites-stack's distribution of access, because published-sites-stack used
    // to separately call addToResourcePolicy() on the imported bucket for its own
    // distribution ARN — a SECOND, independently-CloudFormation-managed BucketPolicy on
    // the same physical bucket. PutBucketPolicy fully replaces the document, so the two
    // stacks silently clobbered each other's grant on every alternating deploy (confirmed
    // live: this stack's most recent deploy left only its own distribution able to read
    // /commerce.js, breaking every published site's shop/cart/checkout blocks with a 403).
    // Fix: one explicit account-wide grant here (covers every current and future
    // distribution in this account, not just the two that exist today) instead of a
    // per-distribution one, and published-sites-stack.ts no longer touches this bucket's
    // policy at all — see that file's own comment at the removed call site.
    assetsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        actions: ["s3:GetObject"],
        resources: [assetsBucket.arnForObjects("*")],
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    );

    // ISR tag-cache table — DynamoDB, per open-next's tagCache/dynamodb.js contract
    // (CACHE_DYNAMO_TABLE). Not part of the six bounded-context business-data tables;
    // this is OpenNext's own internal bookkeeping, kept separate on purpose.
    const tagCacheTable = new dynamodb.Table(this, "TagCacheTable", {
      partitionKey: { name: "path", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "tag", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });
    tagCacheTable.addGlobalSecondaryIndex({
      indexName: "revalidate",
      partitionKey: { name: "tag", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "revalidatedAt", type: dynamodb.AttributeType.NUMBER },
    });

    // Revalidation queue — per open-next's queue/sqs.js contract (REVALIDATION_QUEUE_URL).
    const revalidationQueue = new sqs.Queue(this, "RevalidationQueue", {
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const commonEnv = {
      CACHE_BUCKET_NAME: assetsBucket.bucketName,
      CACHE_BUCKET_REGION: this.region,
      CACHE_BUCKET_KEY_PREFIX: "_cache",
      REVALIDATION_QUEUE_URL: revalidationQueue.queueUrl,
      REVALIDATION_QUEUE_REGION: this.region,
      CACHE_DYNAMO_TABLE: tagCacheTable.tableName,
    };

    const serverFn = new lambda.Function(this, "ServerFn", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(OPEN_NEXT_DIR, "server-functions", "default")),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      // PLEXO_ENV is the only other app-secret-adjacent thing set here — it's what
      // lib/ssmEnv.ts reads to build the /plexo/<env>/<KEY> path it fetches from at cold
      // start (via instrumentation.ts). Not sensitive itself, just "staging" or
      // "production". tableEnv (see above) is what makes lib/db/client.ts's TABLES
      // resolve to THIS environment's tables instead of silently falling back to
      // production's bare names. AWS_REGION itself is a Lambda-reserved env var name
      // (CloudFormation rejects setting it explicitly) — Lambda injects it automatically,
      // and lib/db/client.ts already falls back to it correctly.
      //
      // PLEXO_ORIGIN_VERIFY_SECRET is baked in here as a literal value (not left to
      // instrumentation.ts's async SSM backfill like every other secret) for a real reason,
      // found by direct testing: middleware.ts — the ONLY reader of this value — runs under
      // Next.js's Edge runtime by default, which OpenNext executes in an isolated
      // `edge-runtime` VM context with its own process.env snapshot, taken before
      // instrumentation.ts's register() (Node-runtime only; it explicitly no-ops when
      // NEXT_RUNTIME !== "nodejs") ever runs. A direct curl against this function's raw
      // Function URL — with no x-origin-verify header at all — proved the check was being
      // silently skipped in the deployed environment: expectedOriginSecret read as
      // undefined inside middleware even though the exact same env var was correctly
      // populated (via SSM) for ordinary Node-runtime route handlers in the very same
      // Lambda. Setting it directly here is required at `cdk deploy` time anyway
      // (originVerifySecret throws above if unset), so this has no new operational cost.
      environment: { ...commonEnv, ...tableEnv, ...systemAiEnv, PLEXO_ENV: ssmEnv, PLEXO_ORIGIN_VERIFY_SECRET: originVerifySecret!, CRON_SECRET: cronSecret!, ASSET_VERSION: assetVersion },
      logGroup: buildLogGroup(this, "ServerFn"),
    });
    assetsBucket.grantReadWrite(serverFn);
    tagCacheTable.grantReadWriteData(serverFn);
    revalidationQueue.grantSendMessages(serverFn);
    // Runtime read access for lib/ssmEnv.ts's cold-start fetch — GetParameters (plural,
    // what SSMClient's GetParametersCommand actually calls) plus KMS decrypt for the
    // SecureString type, matching the free "alias/aws/ssm" AWS-managed key
    // sync-secrets-to-ssm.yml already writes with.
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameters"],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/plexo/${ssmEnv}/*`],
      }),
    );
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [`arn:aws:kms:${this.region}:${this.account}:alias/aws/ssm`],
      }),
    );
    // plexo-ledger's own customer-managed KMS key (data-stack.ts's ledgerKey) — a real
    // gap found live in production: every read/write against that ONE table (financial
    // data — credit ledger, seller payouts, webhook logs) failed with
    // "AccessDeniedException: ... is not authorized to perform: kms:Decrypt", since a
    // customer-managed key's IAM policy is separate from the DynamoDB table-level grant
    // above — that grant alone is only sufficient for AWS-owned/AWS-managed encryption,
    // which is what the other five tables use. data-stack.ts and this stack are separate
    // `cdk deploy` invocations (no automatic cross-stack IAM relationship), so this has
    // to be granted explicitly here — see ledgerKmsKeyArn's own comment above for why
    // this must be the real key ARN, not an alias/nameFor() one.
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
        resources: [ledgerKmsKeyArn!],
      }),
    );
    // lib/storage.ts (Vercel Blob replacement) — the bucket itself lives in the data
    // stack (cdk/lib/data-stack.ts), a separate `cdk deploy` invocation, so this can't
    // reference it as a real CDK cross-stack object; scoped by the "plexo-user-content*"
    // naming convention data-stack.ts's nameFor() always produces instead, same idea as
    // this stack's own SSM parameter path scoping just above.
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`arn:aws:s3:::plexo-user-content*/*`],
      }),
    );
    // CloudFront SaaS Manager tenant management — app/api/v1/domains/route.ts calls
    // CreateDistributionTenant/DeleteDistributionTenant/GetDistributionTenant at RUNTIME
    // (one customer connecting/disconnecting a custom domain at a time), unlike the
    // published-sites-stack.ts's own resources below, which are pre-provisioned per
    // deploy. Scoped to distribution-tenant resources only, not full CloudFront admin —
    // this Lambda never creates/deletes the multi-tenant distribution or connection group
    // itself, only individual tenants under it.
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudfront:CreateDistributionTenant",
          "cloudfront:DeleteDistributionTenant",
          "cloudfront:GetDistributionTenant",
          "cloudfront:UpdateDistributionTenant",
          "cloudfront:ListDistributionTenants",
        ],
        // A real `arn:aws:cloudfront::<account>:distribution-tenant/<id>` resource type
        // exists, but CreateDistributionTenant's whole purpose is minting a tenant ID that
        // doesn't exist yet, so it can't be pre-scoped to one; "*" here is scoped at the
        // ACTION level instead (only these 5 tenant-management calls, not cloudfront:*),
        // matching this migration's other least-privilege-by-action-set policies.
        resources: ["*"],
      }),
    );
    // lib/acmCertificates.ts's own runtime ACM calls — requestCertificate (on adding a
    // custom domain), getCertificateStatus (the certificate-attachment cron route,
    // polling every 5 minutes), deleteCertificate (on disconnecting a domain). A real
    // gap this migration shipped without: confirmed by a live production run of the
    // certificate-attachment route returning "acm:DescribeCertificate ... is not
    // authorized" for every certificate, meaning NEITHER the request nor the attachment
    // half of the whole self-managed-ACM flow had ever actually worked end-to-end for a
    // real (non-manually-CLI'd) domain. "*" because RequestCertificate mints an ARN that
    // doesn't exist yet (can't be pre-scoped, same reasoning as the CloudFront tenant
    // grant above), and this Lambda has no way to know in advance which ARNs its own
    // later Describe/Delete calls will target.
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["acm:RequestCertificate", "acm:DescribeCertificate", "acm:DeleteCertificate"],
        resources: ["*"],
      }),
    );
    // lib/domains/route53DomainsProvider.ts's own runtime calls — Route53 Domains is a
    // GLOBAL, account-level API with no per-domain resource ARN to scope against (same
    // "*" reasoning as the ACM/CloudFront-tenant grants just above: RegisterDomain mints a
    // domain this Lambda has no way to pre-know, and every other call here targets
    // whatever domain a customer searched for/already owns). Read-mostly plus the specific
    // write actions the domain-purchase flow needs — not route53domains:*, which would
    // also grant destructive/ownership-transfer actions (DeleteDomain,
    // TransferDomainToAnotherAwsAccount, PushDomain) this app never calls.
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "route53domains:CheckDomainAvailability",
          "route53domains:GetDomainSuggestions",
          "route53domains:ListPrices",
          "route53domains:RegisterDomain",
          "route53domains:GetOperationDetail",
          "route53domains:GetDomainDetail",
          "route53domains:DisableDomainTransferLock",
          "route53domains:EnableDomainTransferLock",
          "route53domains:RetrieveDomainAuthCode",
          "route53domains:RenewDomain",
          "route53domains:EnableDomainAutoRenew",
          "route53domains:DisableDomainAutoRenew",
        ],
        resources: ["*"],
      }),
    );
    // lib/domains/domainDns.ts's own runtime calls — writes the routing + ACM-validation
    // CNAME records into the hosted zone Route53 Domains auto-creates for each purchased
    // domain. "*" for the same reason as every other dynamically-provisioned-resource
    // grant above: a hosted zone id doesn't exist until RegisterDomain has already run, so
    // it can't be pre-scoped to a fixed ARN the way a static zone could be. Unrelated to
    // (and no wider than) dns-stack.ts's own hosted zone, which this Lambda never touches
    // — that zone is only ever modified at CDK-deploy-time, through CDK's own deployment
    // role, not by this app at runtime.
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["route53:ListHostedZonesByName", "route53:GetHostedZone", "route53:ChangeResourceRecordSets"],
        resources: ["*"],
      }),
    );
    // The six business-data tables (lib/db/client.ts's TABLES) — same cross-stack
    // situation as the S3 bucket above: provisioned by data-stack.ts, not this stack, so
    // scoped by tableEnv's own resolved names (already environment-correct via nameFor())
    // rather than a real CDK cross-stack import. Broad CRUD, not per-action-minimized —
    // every one of ElectroDB's query/get/put/patch/remove/scan/transact operations this
    // migration built, plus @auth/dynamodb-adapter's own session/account/verification-
    // token reads and writes, run against these tables from this one Lambda. `/index/*`
    // covers every GSI query this migration relies on (byOrg, byStatus, byHashedKey, etc.)
    // — without it, every indexed Query throws AccessDeniedException even though the base
    // table grant succeeds.
    serverFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:TransactGetItems",
          "dynamodb:TransactWriteItems",
        ],
        resources: Object.values(tableEnv).flatMap((tableName) => [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}/index/*`,
        ]),
      }),
    );
    const serverFnUrl = serverFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    // AuthType.NONE still requires an explicit resource policy granting invocation — CDK
    // does not add this automatically the way it does for the AWS_IAM+OAC case above.
    serverFn.addPermission("AllowPublicInvokeServerFnUrl", {
      principal: new iam.AnyPrincipal(),
      action: "lambda:InvokeFunctionUrl",
      functionUrlAuthType: lambda.FunctionUrlAuthType.NONE,
    });

    const imageFn = new lambda.Function(this, "ImageOptimizationFn", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(OPEN_NEXT_DIR, "image-optimization-function")),
      memorySize: 1536, // image processing is memory-hungry; OpenNext's own docs recommend this floor
      timeout: cdk.Duration.seconds(25),
      environment: {
        BUCKET_NAME: assetsBucket.bucketName,
        BUCKET_KEY_PREFIX: "_assets",
        BUCKET_REGION: this.region,
      },
      logGroup: buildLogGroup(this, "ImageFn"),
    });
    assetsBucket.grantRead(imageFn);
    const imageFnUrl = imageFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // SOL — the AI chat agent's own dedicated Lambda + Function URL, entirely separate
    // from serverFn above. A real chat turn is multiple LLM round-trips plus tool calls
    // (can genuinely take minutes) and needs to stream tokens back as they're generated —
    // neither fits serverFn's 30s timeout or its buffered (non-streaming) Function URL
    // invoke mode, so this follows imageFn's "second Lambda + own Function URL + own
    // CloudFront behavior" precedent above rather than trying to extend serverFn itself.
    const solChatFn = new NodejsFunction(this, "SolChatFn", {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: SOL_CHAT_ENTRY,
      handler: "handler",
      // NodejsFunction otherwise infers `projectRoot` from `entry`'s own location and
      // requires it to be a DESCENDANT of that root — but this handler's entry lives at
      // the repo root's lambda/sol-chat/index.ts, a sibling of cdk/, not underneath it,
      // which fails synthesis with "entryPath ... should be under projectRoot" the moment
      // this stack is actually deployed (caught by a real `cdk deploy` run, not `cdk
      // synth`, which doesn't reach this check). Pointing both explicitly at the repo
      // root — where this handler's own package.json/package-lock.json actually live —
      // is what lets esbuild resolve its dependencies correctly regardless of entry's
      // position relative to cdk/'s own directory.
      projectRoot: path.join(__dirname, "..", ".."),
      depsLockFilePath: path.join(__dirname, "..", "..", "package-lock.json"),
      // Response-streaming Lambda handlers wrap the export in the runtime-global
      // `awslambda.streamifyResponse(...)` (see lambda/sol-chat/index.ts) — esbuild must
      // not tree-shake that global away, and nothing else in this file's handler needs a
      // custom bundling tweak beyond the defaults NodejsFunction already applies
      // (minify off, sourcemaps on, matches this stack's other functions' debuggability).
      // This handler imports the main app's own modules via the "@/*" path alias (e.g.
      // "@/lib/db/solEntities") exactly like the rest of the codebase — esbuild can't
      // resolve that alias without being told about it, so this points bundling at the
      // repo root's tsconfig.json (the one with the actual "@/*" -> "./*" paths mapping),
      // not cdk/'s own separate, unrelated tsconfig.
      bundling: {
        tsconfig: path.join(__dirname, "..", "..", "tsconfig.json"),
        minify: false,
        sourceMap: true,
        // aws-sdk-v3 clients used by this handler's own imports (Dynamo, Bedrock,
        // Transcribe) are bundled in rather than externalized — the NODEJS_24_X managed
        // runtime's built-in AWS SDK is v3 but its exact minor version isn't pinned to
        // what this app's package.json specifies, and this handler's dependency surface
        // is small enough that bundling it is simpler than chasing a version mismatch.
      },
      memorySize: 1536,
      timeout: cdk.Duration.minutes(5),
      environment: {
        ...tableEnv,
        PLEXO_ENV: ssmEnv,
        // NOT setting AWS_REGION explicitly here even though it's listed in this
        // task's own spec: it's a Lambda-reserved environment variable name — see
        // serverFn's own identical comment above ("CloudFormation rejects setting it
        // explicitly"). Lambda injects it into every function's environment
        // automatically regardless, so the real handler can read
        // process.env.AWS_REGION with no explicit wiring needed here, exactly like
        // lib/db/client.ts's own fallback already assumes for serverFn.
        // Baked in the same way as serverFn's own copy above (see originVerifySecret's
        // comment) — this Function URL is also AuthType.NONE/public, so the real
        // handler needs this to reject direct *.lambda-url.on.aws invokes that bypass
        // CloudFront, the same way middleware.ts does for serverFn. Not yet enforced by
        // the placeholder handler itself — see lambda/sol-chat/index.ts's own TODO.
        PLEXO_ORIGIN_VERIFY_SECRET: originVerifySecret!,
        // See authSecret's own comment above — required for lambda/sol-chat/sessionAuth.ts
        // to verify a NextAuth session JWT outside of Next.js's own request context.
        AUTH_SECRET: authSecret!,
      },
      logGroup: buildLogGroup(this, "SolChatFn"),
    });
    // Same six-plus-one business-data-table grant serverFn gets above (see that grant's
    // own comment for why this is a raw PolicyStatement rather than a real CDK
    // table.grantReadWriteData() — these tables are provisioned by data-stack.ts, a
    // separate `cdk deploy` invocation, so there's no live CDK Table object to grant
    // from here). tableEnv already includes PLEXO_SOL_TABLE, so this covers SOL's own
    // conversation-history table too, even though data-stack.ts's physical table isn't
    // provisioned by this task's own edits.
    solChatFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:TransactGetItems",
          "dynamodb:TransactWriteItems",
        ],
        resources: Object.values(tableEnv).flatMap((tableName) => [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}/index/*`,
        ]),
      }),
    );
    // Bedrock — tightened to the exact three models SOL actually uses (see
    // lib/ai/modelRegistry.ts's bedrock_claude row: Claude Haiku 4.5 / Sonnet 5 / Opus 5),
    // verified against both AWS's own Bedrock model-card docs AND the real Plexo AWS
    // account (`aws bedrock get-foundation-model-availability`/`list-inference-profiles`)
    // for a **us-east-1** deploy — confirmed the actual region every other table/resource
    // in this app already lives in (data-stack.ts's tables), not the us-east-2 this file
    // originally assumed before that mismatch was caught and corrected. None of these
    // three models supports direct in-Region invocation — only Geo/Global cross-region
    // inference profiles — so a caller needs IAM permission on BOTH the inference-profile
    // ARN (what's actually passed as `modelId`) AND the underlying foundation-model ARN(s)
    // it fans out to in every Region the profile might route a request to (AWS's own
    // documented requirement for cross-region inference). us-east-1 sits in the "US" geo
    // group, which (confirmed for Haiku 4.5's docs; assumed identical for Sonnet 5/Opus 5
    // pending direct confirmation, since AWS didn't publish their exact per-model geo
    // fan-out tables at the time this was written) routes across
    // us-east-1/us-east-2/us-west-2 — granted across all three accordingly.
    solChatFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:GetInferenceProfile", "bedrock:ListInferenceProfiles"],
        resources: [
          ...["us-east-1", "us-east-2", "us-west-2"].map(
            (region) => `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
          ),
          ...["us-east-1", "us-east-2", "us-west-2"].map((region) => `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-sonnet-5`),
          ...["us-east-1", "us-east-2", "us-west-2"].map((region) => `arn:aws:bedrock:${region}::foundation-model/anthropic.claude-opus-5`),
          `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`,
          `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/us.anthropic.claude-sonnet-5`,
          `arn:aws:bedrock:us-east-1:${this.account}:inference-profile/us.anthropic.claude-opus-5`,
        ],
      }),
    );
    // RESPONSE_STREAM is the entire reason this is a second Lambda rather than a change
    // to serverFn: it's what lets the handler flush tokens to the client as they're
    // generated instead of buffering the whole response first. AuthType.NONE (like
    // serverFn, not imageFn's AWS_IAM+OAC) because CloudFront OAC's Lambda-Function-URL
    // signing can't reliably sign streamed/POST-with-body invokes either (see
    // originVerifySecret's own comment above for the confirmed-live POST/OAC failure on
    // serverFn's identical shape) — same custom-header-secret scheme applied on the
    // CloudFront origin below protects this Function URL the same way.
    const solChatFnUrl = solChatFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });
    // Same explicit public-invoke grant serverFn needed above — AuthType.NONE never
    // gets this automatically added by CDK.
    solChatFn.addPermission("AllowPublicInvokeSolChatFnUrl", {
      principal: new iam.AnyPrincipal(),
      action: "lambda:InvokeFunctionUrl",
      functionUrlAuthType: lambda.FunctionUrlAuthType.NONE,
    });

    const revalidationFn = new lambda.Function(this, "RevalidationFn", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(OPEN_NEXT_DIR, "revalidation-function")),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logGroup: buildLogGroup(this, "RevalidationFn"),
    });
    revalidationFn.addEventSource(new lambdaEventSources.SqsEventSource(revalidationQueue, { batchSize: 5 }));

    // One-time seed of the tag-cache table from the build's prerender-manifest — a
    // CloudFormation custom resource, not a standing Lambda, so it runs once per deploy
    // and costs nothing between deploys.
    const dynamoProviderFn = new lambda.Function(this, "DynamoProviderFn", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(OPEN_NEXT_DIR, "dynamodb-provider")),
      memorySize: 256,
      timeout: cdk.Duration.minutes(5),
      environment: { CACHE_DYNAMO_TABLE: tagCacheTable.tableName },
      logGroup: buildLogGroup(this, "DynamoProviderFn"),
    });

    new cr.AwsCustomResource(this, "SeedTagCache", {
      onCreate: {
        service: "Lambda",
        action: "invoke",
        parameters: { FunctionName: dynamoProviderFn.functionName },
        physicalResourceId: cr.PhysicalResourceId.of(`seed-tag-cache-${this.stackName}`),
      },
      // fromSdkCalls's automatic action-inference from service+action ("Lambda"+"invoke")
      // does NOT reliably produce the real IAM action (lambda:InvokeFunction) — confirmed
      // by actually deploying this and watching it fail with AccessDeniedException before
      // this explicit policy was added. Scoped to exactly this one function, not ANY_RESOURCE.
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: [dynamoProviderFn.functionArn],
        }),
      ]),
    });

    // ALL_VIEWER_EXCEPT_HOST_HEADER (required below for the Lambda Function URL origin to
    // work at all) unconditionally replaces the real Host header with the origin's own
    // domain before forwarding — confirmed against AWS's own docs, not guessed. This
    // CloudFront Function runs on viewer-request, before that swap happens, and copies the
    // real requested host into x-forwarded-host so middleware.ts can still do its own
    // host-based tenant-vs-dashboard routing.
    const forwardHostFn = new cloudfront.Function(this, "ForwardHostFunction", {
      code: cloudfront.FunctionCode.fromFile({ filePath: path.join(__dirname, "forward-host-function.js") }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // The MCP OAuth flow's 401 challenge (see mcpServer.ts) needs a real WWW-Authenticate
    // response header — but a Lambda Function URL origin can't send that header name
    // directly: CloudFront classifies ANY origin response containing it as an error
    // response (x-cache: Error from cloudfront) and renames it to
    // x-amzn-remapped-www-authenticate (reserved for CloudFront's own AWS_IAM
    // auth-challenge responses). A CloudFront Function can't work around this either —
    // confirmed live with a debug canary header: viewer-response functions simply don't
    // run at all for responses CloudFront classifies as errors, regardless of what
    // header name triggered that classification. A ResponseHeadersPolicy is a native
    // CloudFront mechanism (not a customer function) applied to the final response
    // CloudFront sends the viewer, including error-classified ones — confirmed this one
    // isn't skipped the same way. Scoped to its own behavior below (api/v1/mcp*) rather
    // than the whole distribution, since the header's only meaningful on that route.
    const mcpBaseUrl = appDomain ? `https://${appDomain}` : "https://plexo.charisol.io";
    const mcpResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "McpResponseHeadersPolicy", {
      customHeadersBehavior: {
        customHeaders: [
          {
            header: "WWW-Authenticate",
            value: `Bearer resource_metadata="${mcpBaseUrl}/.well-known/oauth-protected-resource"`,
            override: true,
          },
        ],
      },
    });

    // Baseline security headers for the dashboard/app distribution — closes a real,
    // confirmed gap (no CSP/HSTS/X-Frame-Options/X-Content-Type-Options were set anywhere
    // in the stack). Deliberately conservative: everything here is safe to add without
    // live-testing every page (the app is already HTTPS-only end to end, and nothing here
    // expects to be iframed by a third party), EXCEPT Content-Security-Policy, which is not
    // set — a CSP has to enumerate every legitimate external script/style/font/connect
    // origin the app actually loads, and getting that wrong from static reading alone risks
    // silently breaking real functionality (Stripe.js, MailDrip embeds, uploaded assets,
    // etc.) with no way to verify here. Follow-up: audit real network requests in a running
    // session, then add a real CSP separately. Separate from mcpResponseHeadersPolicy above
    // (which stays scoped to api/v1/mcp* only, for the WWW-Authenticate reason explained
    // there) — a CloudFront behavior accepts only one responseHeadersPolicy, so this is a
    // second, independent policy applied to the other behaviors below.
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeadersPolicy", {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: true, preload: true, override: true },
      },
    });

    // DNS-validated via a manual CNAME (see appDomain's own comment above) — `cdk deploy`
    // blocks here until that CNAME is added and ACM sees it, same wait behavior
    // published-sites-stack.ts's own wildcardCert already relies on. Imported instead when
    // appCertArn is set (see that const's own comment).
    const appCert = appCertArn
      ? acm.Certificate.fromCertificateArn(this, "AppCert", appCertArn)
      : appDomain
      ? new acm.Certificate(this, "AppCert", { domainName: appDomain, validation: acm.CertificateValidation.fromDns() })
      : undefined;

    // Gated behind WAF_ENABLED (see conventions.ts) — undefined/omitted here means this
    // distribution deploys with no webAclId, exactly as it did before the WAF was written.
    const webAcl = isWafEnabled() ? buildCloudFrontWebAcl(this, "WebAcl", "PlexoApp") : undefined;

    // CloudFront — behaviors match open-next.output.json exactly: image paths to the
    // image function, everything else dynamic to the server function, static file
    // patterns straight to S3.
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      domainNames: appDomain ? [appDomain] : undefined,
      certificate: appCert,
      webAclId: webAcl?.attrArn,
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(serverFnUrl, { customHeaders: { "x-origin-verify": originVerifySecret! } }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [{ function: forwardHostFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        responseHeadersPolicy: securityHeadersPolicy,
      },
      additionalBehaviors: {
        // SOL's own streaming chat-turn endpoint — same CACHING_DISABLED/ALLOW_ALL/
        // ALL_VIEWER_EXCEPT_HOST_HEADER/forwardHostFn shape as the default (serverFn)
        // behavior above, reused rather than invented fresh: this is already the correct
        // "never cache, forward everything a real API needs" configuration for a
        // POST-driven, per-request API response, which a streamed chat response
        // certainly is too. Own dedicated origin (solChatFnUrl, not serverFnUrl) so
        // CloudFront actually invokes the RESPONSE_STREAM-mode Function URL for this
        // path instead of serverFn's buffered one.
        //
        // Scoped to "api/v1/sol/chat/*" specifically, NOT the broader "api/v1/sol/*":
        // the ordinary CRUD routes under api/v1/sol/** (conversation list, transcript
        // GET, memories, preferences, upload, export, etc.) are plain Next.js route
        // handlers served by serverFn, and CloudFront behaviors route by path only, not
        // HTTP method — a POST turn and a GET on the very same conversations/{id}/messages
        // path can't be split across two origins by path alone. SolChatFn's own routes
        // therefore live under their own api/v1/sol/chat/* prefix (see
        // lambda/sol-chat/index.ts's MESSAGES_RE/CONFIRM_RE), so this behavior only ever
        // claims that subtree and everything else under api/v1/sol/* correctly falls
        // through to the default (serverFn) behavior above.
        "api/v1/sol/chat/*": {
          origin: new origins.FunctionUrlOrigin(solChatFnUrl, { customHeaders: { "x-origin-verify": originVerifySecret! } }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [{ function: forwardHostFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
          responseHeadersPolicy: securityHeadersPolicy,
        },
        "api/v1/mcp*": {
          origin: new origins.FunctionUrlOrigin(serverFnUrl, { customHeaders: { "x-origin-verify": originVerifySecret! } }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [{ function: forwardHostFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
          // Stays on its own dedicated policy (WWW-Authenticate only) — see that policy's
          // own comment on why this route can't share the general security-headers policy.
          responseHeadersPolicy: mcpResponseHeadersPolicy,
        },
        "_next/image*": {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(imageFnUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeadersPolicy,
        },
        "_next/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket, { originPath: "/_assets" }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeadersPolicy,
        },
        "commerce.js": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket, { originPath: "/_assets" }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeadersPolicy,
        },
        "uploads/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket, { originPath: "/_assets" }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeadersPolicy,
        },
      },
    });

    // CDK's FunctionUrlOrigin.withOriginAccessControl() only grants lambda:InvokeFunctionUrl
    // automatically. AWS's own OAC-for-Lambda doc (confirmed by actually hitting a 403
    // AccessDeniedException in a real deploy before this was added) requires a SECOND,
    // separate grant for plain lambda:InvokeFunction — CloudFront's OAC signing needs both.
    // Server function excluded: it's no longer OAC-protected (see originVerifySecret above).
    imageFn.addPermission("AllowCloudFrontImageInvokeFunction", {
      principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    });

    new cdk.CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    if (appCert) {
      new cdk.CfnOutput(this, "AppCertArn", { value: appCert.certificateArn });
    }
    new cdk.CfnOutput(this, "ServerFunctionName", { value: serverFn.functionName });

    // Real CloudFormation cross-stack exports — published-sites-stack.ts (a separate
    // `cdk deploy` invocation, same as data-stack.ts/compute-stack.ts already are) points
    // its own multi-tenant distribution at these SAME two Lambdas rather than deploying a
    // second copy of the app: the Next.js middleware already does host-based tenant-vs-
    // dashboard routing regardless of which CloudFront distribution a request arrived
    // through, so one deployed Lambda pair correctly serves both. Exported as plain
    // strings (ARN/name/URL), not live CDK object references, since cross-`cdk deploy`
    // stacks in this app were never wired for the same-synthesis object-reference style
    // of cross-stack reference (see cdk/bin/app.ts — one STACK_KIND per invocation).
    new cdk.CfnOutput(this, "ServerFnArn", { value: serverFn.functionArn, exportName: `${this.stackName}-ServerFnArn` });
    new cdk.CfnOutput(this, "ServerFnUrl", { value: serverFnUrl.url, exportName: `${this.stackName}-ServerFnUrl` });
    new cdk.CfnOutput(this, "ImageFnArn", { value: imageFn.functionArn, exportName: `${this.stackName}-ImageFnArn` });
    new cdk.CfnOutput(this, "ImageFnUrl", { value: imageFnUrl.url, exportName: `${this.stackName}-ImageFnUrl` });
    new cdk.CfnOutput(this, "AssetsBucketName", { value: assetsBucket.bucketName, exportName: `${this.stackName}-AssetsBucketName` });
  }
}
