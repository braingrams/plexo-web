import { NextRequest } from "next/server";

// Deliberately NOT an "authorization: Bearer <token>" header — this was tried first
// (matching Vercel Cron's own convention, which app/api/internal/scan-domains/route.ts's
// doc comment still references) and confirmed broken by direct reproduction against a
// real deployed Lambda Function URL: even with FunctionUrlAuthType.NONE, the Function URL
// front door itself intercepts any request carrying an "Authorization" header and tries to
// validate it as a SigV4 signature, rejecting anything that isn't one with a bare
// `403 {"Message":null}` before the request ever reaches this app's own code (confirmed via
// a direct curl against the raw *.lambda-url.on.aws address, bypassing CloudFront
// entirely). A custom header name sidesteps that AWS-level interception completely.
export function isCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");
  return !!cronSecret && provided === cronSecret;
}
