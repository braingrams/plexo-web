// CloudFront Function, viewer-response event. A real WWW-Authenticate challenge is what
// tells an OAuth-aware MCP client where to authenticate (see mcpServer.ts's
// handleMcpJsonRpc and app/api/v1/mcp/route.ts) — but a Lambda origin can't send that
// header name directly: CloudFront classifies ANY origin response containing a header
// literally named "WWW-Authenthenticate" as an error response (x-cache: Error from
// cloudfront) and renames it to "x-amzn-remapped-www-authenticate" — reserved for its
// own AWS_IAM auth-challenge responses, applied regardless of this origin's actual
// AuthType (NONE, origin-verify only). Worse, that error classification happens BEFORE
// viewer-response functions run, so a function trying to rename the remapped header back
// never actually executes (confirmed live: an earlier version of this exact function,
// which looked for x-amzn-remapped-www-authenticate, never once fired).
//
// The fix: the origin sends the challenge under a safe, non-reserved header name
// (x-oauth-www-authenticate) that CloudFront has no reason to intercept, so the response
// is never error-classified and this function DOES run — and only THEN, at the very last
// step before the response reaches the viewer, does the real "WWW-Authenticate" header
// get created.
function handler(event) {
  var headers = event.response.headers;
  headers["x-debug-fn-ran"] = { value: "true" };
  var challenge = headers["x-oauth-www-authenticate"];
  if (challenge) {
    headers["www-authenticate"] = { value: challenge.value };
    delete headers["x-oauth-www-authenticate"];
  }
  return event.response;
}
