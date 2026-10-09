import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "node:path";
import { buildLogGroup } from "./conventions";

// The databases of apps built on Plexo (docs/plexo-projects/ARCHITECTURE.md §5). Deployed
// once per environment (STACK_KIND=app-data), like data-stack.ts — PR previews share
// staging's cluster.
//
// - Aurora Serverless v2 PostgreSQL, auto-pausing to 0 ACU after 5 idle minutes in every
//   environment (zero compute cost while idle; the first query after a pause waits ~15 s,
//   which every client absorbs — see lib/appData/db.ts).
// - One shared cluster; each app gets its own databases and IAM-authenticated logins.
// - A private, isolated VPC: no NAT gateway, no VPC endpoints, no internet — nothing in it
//   costs anything while idle, and the only way in is AppDbFn.
// - AppDbFn runs app SQL as the app's own roles. Its IAM policy only allows connecting as
//   "a_*" logins, never as the admin. Platform administration (creating databases and
//   roles) uses the RDS Data API from outside the VPC instead (lib/appData/admin.ts).

const isProd = (process.env.PLEXO_ENV || "development") === "production";
const envName = isProd ? "production" : "staging";

export class AppDataStack extends cdk.Stack {
  // Explicit zones (overriding CDK's account lookup): deterministic across deploys, and
  // synthesizable without AWS credentials.
  get availabilityZones(): string[] {
    return (process.env.APP_DB_AZS ?? `${this.region}a,${this.region}b`).split(",");
  }

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "AppDataVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 22 }],
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, "AppDbSecurityGroup", { vpc, allowAllOutbound: false, description: "App databases: reachable only from AppDbFn" });
    const fnSecurityGroup = new ec2.SecurityGroup(this, "AppDbFnSecurityGroup", { vpc, allowAllOutbound: false, description: "AppDbFn: may only reach the app databases" });
    dbSecurityGroup.addIngressRule(fnSecurityGroup, ec2.Port.tcp(5432), "AppDbFn");
    fnSecurityGroup.addEgressRule(dbSecurityGroup, ec2.Port.tcp(5432), "App databases");

    const engine = rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_17_9 });
    const parameterGroup = new rds.ParameterGroup(this, "AppDbParameters", {
      engine,
      description: "Plexo app databases",
      parameters: {
        // Sessions idle for a minute are closed by the server, so connections a frozen
        // Lambda still holds never keep the cluster from pausing.
        idle_session_timeout: "60000",
        "rds.force_ssl": "1",
        password_encryption: "scram-sha-256",
        log_min_duration_statement: "2000",
        // A runaway statement can never hold a connection for more than 5 minutes, whatever
        // a role's own setting says.
        statement_timeout: "300000",
      },
    });

    const cluster = new rds.DatabaseCluster(this, "AppDbCluster", {
      // A fixed name, so the app's IAM grants (project-runtime.ts) can name this exact cluster.
      clusterIdentifier: `plexo-app-db-${envName}`,
      engine,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      writer: rds.ClusterInstance.serverlessV2("writer", { enablePerformanceInsights: false }),
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: Number(process.env.APP_DB_MAX_ACU || (isProd ? 32 : 8)),
      serverlessV2AutoPauseDuration: cdk.Duration.minutes(5),
      credentials: rds.Credentials.fromGeneratedSecret("plexo_admin", { secretName: `plexo/${envName}/app-db-admin` }),
      iamAuthentication: true,
      enableDataApi: true,
      storageEncrypted: true,
      parameterGroup,
      backup: { retention: cdk.Duration.days(isProd ? 14 : 3) },
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.SNAPSHOT : cdk.RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
    });

    const appDbFn = new NodejsFunction(this, "AppDbFn", {
      functionName: `plexo-app-db-${envName}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, "..", "..", "lambda", "app-db", "index.ts"),
      handler: "handler",
      projectRoot: path.join(__dirname, "..", ".."),
      depsLockFilePath: path.join(__dirname, "..", "..", "package-lock.json"),
      bundling: {
        tsconfig: path.join(__dirname, "..", "..", "tsconfig.json"),
        minify: false,
        sourceMap: true,
        // node-postgres's optional native binding is never used.
        externalModules: ["pg-native"],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          // AWS's RDS certificate bundle, read at cold start to verify the database's TLS.
          afterBundling: (inputDir: string, outputDir: string) => [`cp ${inputDir}/lambda/app-db/rds-global-bundle.pem ${outputDir}/`],
        },
      },
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [fnSecurityGroup],
      // Caps the connections all app traffic can open (≤ 12 pooled per instance).
      reservedConcurrentExecutions: Number(process.env.APP_DB_FN_CONCURRENCY || 100),
      environment: { APP_DB_HOST: cluster.clusterEndpoint.hostname, APP_DB_PORT: String(cluster.clusterEndpoint.port) },
      logGroup: buildLogGroup(this, "AppDbFn"),
    });
    // Connect as app logins only — the admin (and any future platform role) is out of reach.
    appDbFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["rds-db:connect"],
        resources: [`arn:aws:rds-db:${this.region}:${this.account}:dbuser:${cluster.clusterResourceIdentifier}/a_*`],
      }),
    );

    // Read by the app at cold start (lib/ssmEnv.ts), like USER_CONTENT_BUCKET_NAME.
    const param = (name: string, value: string) =>
      new ssm.StringParameter(this, `${name}Param`, { parameterName: `/plexo/${envName}/${name}`, stringValue: value });
    param("APP_DB_CLUSTER_ARN", cluster.clusterArn);
    param("APP_DB_ADMIN_SECRET_ARN", cluster.secret!.secretArn);
    param("APP_DB_CLUSTER_ID", cluster.clusterIdentifier);
    param("APP_DB_FUNCTION_NAME", appDbFn.functionName);

    // "Sign in with Google" for the visitors of apps built on Plexo (lib/appAuth/oauth.ts).
    // A pool of its own: app visitors are not Charisol accounts and never appear in (or count
    // against) the Charisol pool. Federated-only — nobody signs up here directly; the pool
    // just turns a Google sign-in into a verified ID token for the platform callback.
    const visitorPool = new cognito.UserPool(this, "AppVisitorPool", {
      userPoolName: `plexo-app-visitors-${envName}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: false, mutable: true }, fullname: { required: false, mutable: true }, profilePicture: { required: false, mutable: true } },
      accountRecovery: cognito.AccountRecovery.NONE,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    // The Google OAuth client Plexo already uses, copied once into Secrets Manager
    // (docs/plexo-projects/SETUP.md §3) so its secret never appears in the template.
    const google = new cognito.UserPoolIdentityProviderGoogle(this, "AppVisitorGoogle", {
      userPool: visitorPool,
      clientId: cdk.SecretValue.secretsManager(`plexo/${envName}/app-signin-google`, { jsonField: "clientId" }).unsafeUnwrap(),
      clientSecretValue: cdk.SecretValue.secretsManager(`plexo/${envName}/app-signin-google`, { jsonField: "clientSecret" }),
      scopes: ["openid", "email", "profile"],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
        fullname: cognito.ProviderAttribute.GOOGLE_NAME,
        profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
      },
    });
    const dashboardOrigin = isProd ? "https://plexo.charisol.io" : "https://staging-plexo.charisol.io";
    const visitorClient = visitorPool.addClient("AppVisitorClient", {
      userPoolClientName: "plexo-apps",
      generateSecret: false,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.GOOGLE],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          `${dashboardOrigin}/api/app-oauth/google/callback`,
          ...(isProd ? [] : ["http://localhost:3000/api/app-oauth/google/callback"]),
        ],
      },
      preventUserExistenceErrors: true,
      idTokenValidity: cdk.Duration.minutes(60),
    });
    visitorClient.node.addDependency(google);
    const visitorDomain = visitorPool.addDomain("AppVisitorDomain", {
      cognitoDomain: { domainPrefix: process.env.APP_SIGNIN_DOMAIN_PREFIX || `plexo-apps-${envName}` },
    });
    // One Plexo GitHub App serves both environments: production relays staging's webhooks
    // and install redirects (lib/projects/github/relay.ts).
    if (isProd) param("PLEXO_GITHUB_RELAY_ORIGIN", process.env.GITHUB_RELAY_ORIGIN || "https://staging-plexo.charisol.io");
    param("APP_SIGNIN_COGNITO_USER_POOL_ID", visitorPool.userPoolId);
    param("APP_SIGNIN_COGNITO_CLIENT_ID", visitorClient.userPoolClientId);
    param("APP_SIGNIN_COGNITO_DOMAIN", `${visitorDomain.domainName}.auth.${this.region}.amazoncognito.com`);
    new cdk.CfnOutput(this, "AppSigninGoogleRedirectUri", {
      description: "Add to the Google OAuth client's authorized redirect URIs",
      value: `https://${visitorDomain.domainName}.auth.${this.region}.amazoncognito.com/oauth2/idpresponse`,
    });

    new cdk.CfnOutput(this, "AppDbClusterArn", { value: cluster.clusterArn });
    new cdk.CfnOutput(this, "AppDbFunctionName", { value: appDbFn.functionName });
  }
}
