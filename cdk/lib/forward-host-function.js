// CloudFront Function, viewer-request event — runs BEFORE the origin request policy
// (AllViewerExceptHostHeader) replaces the real Host header with the Lambda Function
// URL's own domain. Captures the viewer's real requested hostname into a custom header
// so middleware.ts can still do its own host-based tenant-vs-dashboard routing, which
// AWS's own CloudFront docs confirm is otherwise impossible with a Lambda Function URL
// origin (Host is unconditionally replaced for ALL custom origins, and CloudFront does
// NOT auto-add any equivalent like X-Forwarded-Host the way it does X-Forwarded-For —
// verified against docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/
// RequestAndResponseBehaviorCustomOrigin.html directly, not assumed). Shared by both
// compute-stack.ts's own distribution and published-sites-stack.ts's multi-tenant one —
// same fix, same reason, in both places.
function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value : "";
  request.headers["x-forwarded-host"] = { value: host };
  return request;
}
