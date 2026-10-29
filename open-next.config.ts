import type { OpenNextConfig } from "@opennextjs/aws";

// Switch the server function to response-streaming mode so Lambda streams
// response bytes to CloudFront instead of buffering the whole payload first.
// This removes the 6 MB buffered-response ceiling — large static assets served
// via serveDeployedStatic (lib/pub/serveDeployedStatic.ts) flow through without
// hitting the RequestResponse size limit.
//
// The CDK counterpart (cdk/lib/compute-stack.ts) must set
//   invokeMode: lambda.InvokeMode.RESPONSE_STREAM
// on the serverFn function URL for this to take effect in production.
const config: OpenNextConfig = {
  default: {
    wrapper: "aws-lambda-streaming",
  },
};

export default config;
