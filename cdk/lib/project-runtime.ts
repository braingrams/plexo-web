import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "node:path";
import { buildLogGroup } from "./conventions";
import { ssrFunctionScope } from "./ssrScope";

/** A PR's throwaway preview stack (STACK_ID "pr-<number>-plexo"), not staging or production. */
const IS_PR_PREVIEW = /^pr-\d+/.test(process.env.STACK_ID ?? "");


// Infrastructure for apps built on Plexo (docs/plexo-projects/ARCHITECTURE.md), added to the
// compute stack (so every environment, PR previews included, gets its own build pipeline):
//
//   BuildQueue ──► ProjectBuildFn (container image: Node 24 + the scaffold's dependencies
//                  pre-installed). Its own role can only assume BuildWorkerRole — narrowed
//                  per build by a session policy to one project's S3 prefix and one build
//                  row — and send to BuildEventsQueue.
//   BuildEventsQueue ──► BuildFinalizeFn: migrations, function deploys, the live switch.
//
//   FunctionExecutionRole: what every app server function runs as — logging only, no AWS
//   access at all. FunctionSchedulerRole: lets EventBridge Scheduler invoke plexo-fn-*.
//
// The app databases themselves live in app-data-stack.ts (once per environment).

export type ProjectRuntimeProps = {
  /** The Lambdas that run app code paths (serverFn, SolChatFn): they queue builds, deploy
   *  functions, administer databases. */
  appFunctions: lambda.Function[];
  /** Environment for BuildFinalizeFn (tables, PLEXO_ENV, public URLs). */
  finalizeEnvironment: Record<string, string>;
  /** IAM statements BuildFinalizeFn shares with serverFn (DynamoDB tables, SSM, KMS). */
  sharedStatements: iam.PolicyStatement[];
  envName: "production" | "staging";
  contentTableName: string;
};

export function addProjectRuntime(scope: Construct, props: ProjectRuntimeProps) {
  const stack = cdk.Stack.of(scope);
  const repoRoot = path.join(__dirname, "..", "..");

  // ---------------------------------------------------------------- queues
  const buildDlq = new sqs.Queue(scope, "ProjectBuildDlq", { retentionPeriod: cdk.Duration.days(4) });
  const buildQueue = new sqs.Queue(scope, "ProjectBuildQueue", {
    // Longer than the build Lambda's 15-minute ceiling, so a running build is never handed
    // to a second worker.
    visibilityTimeout: cdk.Duration.minutes(16),
    retentionPeriod: cdk.Duration.hours(2),
    deadLetterQueue: { queue: buildDlq, maxReceiveCount: 3 },
  });
  const eventsDlq = new sqs.Queue(scope, "BuildEventsDlq", { retentionPeriod: cdk.Duration.days(4) });
  const eventsQueue = new sqs.Queue(scope, "BuildEventsQueue", {
    visibilityTimeout: cdk.Duration.minutes(6),
    deadLetterQueue: { queue: eventsDlq, maxReceiveCount: 5 },
  });

  // ---------------------------------------------------------------- build
  const buildFn = new lambda.DockerImageFunction(scope, "ProjectBuildFn", {
    code: lambda.DockerImageCode.fromImageAsset(repoRoot, {
      file: "lambda/project-build/Dockerfile",
      platform: cdk.aws_ecr_assets.Platform.LINUX_AMD64,
      // The build context is the repo root, but the image only needs these.
      exclude: ["**", "!lambda/project-build/**", "lambda/project-build/node_modules", "lambda/project-build/dist", "!lib/projects/buildJob.ts", "!lib/projects/diagnostics.ts", "!lib/projects/scaffold/template/package.json"],
    }),
    architecture: lambda.Architecture.X86_64,
    memorySize: 4096,
    timeout: cdk.Duration.minutes(15),
    ephemeralStorageSize: cdk.Size.gibibytes(10),
    // Backpressure: a burst of builds queues instead of fanning out without limit. Staging
    // and production reserve their share of the account's Lambda capacity; a PR's
    // throwaway stack doesn't — every reservation comes out of one account-wide pool that
    // must keep 40 free, and a third or fourth stack reserving 50 more made AWS refuse to
    // create the function (pr-117). Previews are capped on the queue instead (below).
    reservedConcurrentExecutions: IS_PR_PREVIEW ? undefined : Number(process.env.PROJECT_BUILD_CONCURRENCY || 50),
    environment: { BUILD_EVENTS_QUEUE_URL: eventsQueue.queueUrl },
    logGroup: buildLogGroup(scope, "ProjectBuildFn"),
  });
  buildFn.addEventSource(new lambdaEventSources.SqsEventSource(buildQueue, { batchSize: 1, reportBatchItemFailures: true, ...(IS_PR_PREVIEW ? { maxConcurrency: 5 } : {}) }));
  eventsQueue.grantSendMessages(buildFn);

  const workerRole = new iam.Role(scope, "BuildWorkerRole", {
    assumedBy: new iam.ArnPrincipal(buildFn.role!.roleArn),
    description: "Assumed per build by ProjectBuildFn, narrowed by a session policy to one project + one build row.",
    maxSessionDuration: cdk.Duration.hours(1),
  });
  workerRole.addToPolicy(
    new iam.PolicyStatement({
      // DeleteObject: an SSR build removes its uploaded source zip when it ends.
      actions: ["s3:GetObject", "s3:PutObject", "s3:PutObjectTagging", "s3:DeleteObject"],
      resources: ["arn:aws:s3:::plexo-user-content*/private/projects/*"],
    }),
  );
  workerRole.addToPolicy(
    new iam.PolicyStatement({
      actions: ["dynamodb:UpdateItem"],
      resources: [`arn:aws:dynamodb:${stack.region}:${stack.account}:table/${props.contentTableName}`],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["pbuild#*"] } },
    }),
  );
  workerRole.grantAssumeRole(buildFn.role!);
  buildFn.addEnvironment("BUILD_WORKER_ROLE_ARN", workerRole.roleArn);

  // ---------------------------------------------------------------- server functions
  const functionExecutionRole = new iam.Role(scope, "AppFunctionExecutionRole", {
    assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    description: "What app server functions run as: CloudWatch logging only, no other AWS access.",
    managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
  });
  const fnArnPattern = `arn:aws:lambda:${stack.region}:${stack.account}:function:plexo-fn-*`;
  // Per-customer SSR Lambdas (plexo-ssr-<templateId>), created by BuildFinalizeFn and reached
  // only through their IAM-authenticated Function URLs from plexo-web.
  const ssrFnArnPattern = `arn:aws:lambda:${stack.region}:${stack.account}:function:plexo-ssr-*`;
  const schedulerRole = new iam.Role(scope, "AppFunctionSchedulerRole", {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    description: "Lets EventBridge Scheduler run app server functions on their schedules.",
  });
  schedulerRole.addToPolicy(new iam.PolicyStatement({ actions: ["lambda:InvokeFunction"], resources: [fnArnPattern] }));

  // ---------------------------------------------------------------- finalizer
  const finalizeFn = new NodejsFunction(scope, "BuildFinalizeFn", {
    runtime: lambda.Runtime.NODEJS_24_X,
    entry: path.join(repoRoot, "lambda", "build-finalize", "index.ts"),
    handler: "handler",
    projectRoot: repoRoot,
    depsLockFilePath: path.join(repoRoot, "package-lock.json"),
    bundling: { tsconfig: path.join(repoRoot, "tsconfig.json"), minify: false, sourceMap: true, externalModules: ["pg-native", "playwright-core"] },
    memorySize: 1024,
    timeout: cdk.Duration.minutes(5),
    environment: props.finalizeEnvironment,
    logGroup: buildLogGroup(scope, "BuildFinalizeFn"),
  });
  finalizeFn.addEventSource(new lambdaEventSources.SqsEventSource(eventsQueue, { batchSize: 5, reportBatchItemFailures: true }));
  for (const statement of props.sharedStatements) finalizeFn.addToRolePolicy(statement);

  // ---------------------------------------------------------------- grants for app code paths
  const appDbFunctionArn = `arn:aws:lambda:${stack.region}:${stack.account}:function:plexo-app-db-${props.envName}`;
  const statements = [
    new iam.PolicyStatement({ actions: ["sqs:SendMessage"], resources: [buildQueue.queueArn] }),
    new iam.PolicyStatement({ actions: ["lambda:InvokeFunction"], resources: [appDbFunctionArn] }),
    // Platform administration of the app-database cluster (lib/appData/admin.ts).
    new iam.PolicyStatement({
      actions: ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement"],
      // app-data-stack.ts names its cluster plexo-app-db-<env>.
      resources: [`arn:aws:rds:${stack.region}:${stack.account}:cluster:plexo-app-db-${props.envName}`],
    }),
    new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [`arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:plexo/${props.envName}/app-db-admin*`],
    }),
    // Deploying and running app server functions (lib/appFunctions).
    new iam.PolicyStatement({
      actions: [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:DeleteFunction",
        "lambda:InvokeFunction",
        "lambda:TagResource",
      ],
      resources: [fnArnPattern],
    }),
    new iam.PolicyStatement({ actions: ["iam:PassRole"], resources: [functionExecutionRole.roleArn, schedulerRole.roleArn] }),
    new iam.PolicyStatement({
      actions: ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule"],
      resources: [`arn:aws:scheduler:${stack.region}:${stack.account}:schedule/default/plexo-fn-*`],
    }),
    // Screenshots are uploaded with an expiry tag (data-stack.ts lifecycle rule).
    new iam.PolicyStatement({ actions: ["s3:PutObjectTagging"], resources: ["arn:aws:s3:::plexo-user-content*/private/sol-attachments/*"] }),
    new iam.PolicyStatement({ actions: ["logs:FilterLogEvents"], resources: [`arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/lambda/plexo-fn-*`] }),
  ];
  const env: Record<string, string> = {
    // Scopes SSR function names (lib/appFunctions/ssrNames.ts) so PR stacks never touch staging's.
    SSR_FUNCTION_SCOPE: ssrFunctionScope(process.env.STACK_ID ?? ""),
    PROJECT_BUILD_QUEUE_URL: buildQueue.queueUrl,
    FUNCTIONS_EXECUTION_ROLE_ARN: functionExecutionRole.roleArn,
    FUNCTIONS_SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
    APP_DB_FUNCTION_NAME: `plexo-app-db-${props.envName}`,
  };
  for (const fn of [...props.appFunctions, finalizeFn]) {
    for (const statement of statements) fn.addToRolePolicy(statement);
    for (const [k, v] of Object.entries(env)) fn.addEnvironment(k, v);
  }

  // SSR: plexo-web may only invoke the customer SSR Lambdas through their Function URLs...
  const ssrInvokeStatement = new iam.PolicyStatement({ actions: ["lambda:InvokeFunctionUrl"], resources: [ssrFnArnPattern] });
  for (const fn of props.appFunctions) fn.addToRolePolicy(ssrInvokeStatement);
  // ...and only BuildFinalizeFn creates, updates, configures, and deletes them. (Its PassRole for
  // functionExecutionRole already comes from the shared statements above.)
  finalizeFn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:DeleteFunction",
        "lambda:CreateFunctionUrlConfig",
        "lambda:UpdateFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig",
        "lambda:DeleteFunctionUrlConfig",
        "lambda:TagResource",
      ],
      resources: [ssrFnArnPattern],
    }),
  );

  return { buildQueue, eventsQueue, buildFn, finalizeFn, functionExecutionRole, schedulerRole };
}
