import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "node:path";
import { buildLogGroup } from "./conventions";

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

// Resolved relative to this file (cdk/lib/compute-stack.ts) up to the repo root's
// .open-next/ output — `npm run build && npx @opennextjs/aws build` must have been run
// before `cdk deploy` for this stack kind. Not committed to git (build output).
const OPEN_NEXT_DIR = path.join(__dirname, "..", "..", ".open-next");

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Static assets + incremental cache — matches open-next.output.json's "s3" origin
    // exactly: assets copied to `_assets`, cache to `_cache`.
    const assetsBucket = new s3.Bucket(this, "AssetsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy,
      autoDeleteObjects: !isProd,
    });
    new s3deploy.BucketDeployment(this, "DeployAssets", {
      sources: [s3deploy.Source.asset(path.join(OPEN_NEXT_DIR, "assets"))],
      destinationBucket: assetsBucket,
      destinationKeyPrefix: "_assets",
      // Versioned _next/static/* content is content-hashed and immutable — safe to
      // cache forever; everything else defaults to CloudFront's own cache policy below.
      cacheControl: [s3deploy.CacheControl.fromString("public,max-age=31536000,immutable")],
      prune: false,
    });

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
      environment: commonEnv,
      logGroup: buildLogGroup(this, "ServerFn"),
    });
    assetsBucket.grantReadWrite(serverFn);
    tagCacheTable.grantReadWriteData(serverFn);
    revalidationQueue.grantSendMessages(serverFn);
    const serverFnUrl = serverFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

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

    // CloudFront — behaviors match open-next.output.json exactly: image paths to the
    // image function, everything else dynamic to the server function, static file
    // patterns straight to S3.
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.FunctionUrlOrigin.withOriginAccessControl(serverFnUrl),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        "_next/image*": {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(imageFnUrl),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        "_next/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket, { originPath: "/_assets" }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        "commerce.js": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket, { originPath: "/_assets" }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        "uploads/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket, { originPath: "/_assets" }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
    });

    // CDK's FunctionUrlOrigin.withOriginAccessControl() only grants lambda:InvokeFunctionUrl
    // automatically. AWS's own OAC-for-Lambda doc (confirmed by actually hitting a 403
    // AccessDeniedException in a real deploy before this was added) requires a SECOND,
    // separate grant for plain lambda:InvokeFunction — CloudFront's OAC signing needs both.
    for (const [name, fn] of [["Server", serverFn] as const, ["Image", imageFn] as const]) {
      fn.addPermission(`AllowCloudFront${name}InvokeFunction`, {
        principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
        action: "lambda:InvokeFunction",
        sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
      });
    }

    new cdk.CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, "ServerFunctionName", { value: serverFn.functionName });
  }
}
