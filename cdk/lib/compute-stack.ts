import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

// Placeholder for the Phase 6 OpenNext compute layer (SSR Lambda, image-optimization
// Lambda, CloudFront, S3 static assets). Deliberately empty for now — the point is to
// let the PR deploy/destroy CI lifecycle be built and proven safe today, at zero cost,
// against a real (if trivial) stack, rather than waiting for Phase 6 to exist before
// the pipeline can be tested. Every future compute resource here should read the
// staging table names from STAGING_TABLE_NAMES below rather than provisioning its own
// tables — PR previews share one persistent staging data set, they don't each get a
// fresh one.
export const STAGING_TABLE_NAMES = {
  core: "plexo-core-staging-plexo",
  ledger: "plexo-ledger-staging-plexo",
  commerce: "plexo-commerce-staging-plexo",
  content: "plexo-content-staging-plexo",
  ops: "plexo-ops-staging-plexo",
  import: "plexo-import-staging-plexo",
};

export class ComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // TODO(Phase 6): when the real SSR Lambda is defined here, pull AUTH_SECRET /
    // GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET into its `environment` via
    // ssm.StringParameter.valueForStringParameter(this, `/plexo/${env}/AUTH_SECRET`) —
    // not hardcoded, not passed as a CDK prop with the value inline (see
    // sync-secrets-to-ssm.yml for why: keeps secret material out of the CloudFormation
    // template/change history).

    new cdk.CfnOutput(this, "Status", {
      value: "placeholder — Phase 6 (OpenNext SSR + CloudFront) not yet implemented",
    });
  }
}
