// CloudFront Function, viewer-response event. Lambda Function URLs (and API Gateway
// HTTP APIs) treat WWW-Authenticate as a reserved response header — reserved for their
// own AWS_IAM auth-challenge responses — and silently rename ANY response header with
// that exact name to "x-amzn-remapped-www-authenticate" before it reaches CloudFront,
// regardless of the function's own AuthType (confirmed live: this compute stack's Lambda
// Function URL uses AuthType NONE, origin-verify only, yet the header still got renamed).
// A real OAuth-aware MCP client looks for the literal "WWW-Authenticate" header on a 401
// to discover where to authenticate (see mcpServer.ts's handleMcpJsonRpc and
// app/api/v1/mcp/route.ts) — the renamed header is invisible to it. This restores the
// real header name on the way out, the one point in the request path (CloudFront) that
// sits after the Lambda's renaming and before the header reaches a real client.
function handler(event) {
  var headers = event.response.headers;
  headers["x-debug-fn-ran"] = { value: "true" };
  var remapped = headers["x-amzn-remapped-www-authenticate"];
  if (remapped) {
    headers["www-authenticate"] = { value: remapped.value };
    delete headers["x-amzn-remapped-www-authenticate"];
  }
  return event.response;
}
