import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // CloudFront's OAC can't reliably sign POST bodies to a Lambda Function URL origin (see
  // cdk/lib/compute-stack.ts's own comment on originVerifySecret) — this Lambda's Function
  // URL is public instead, protected only by a secret CloudFront attaches as a custom
  // origin header (set on the origin config itself, never sent by any viewer, so a client
  // can't forge it). Anything reaching the raw *.lambda-url.on.aws address directly,
  // bypassing CloudFront, is rejected here before any other request handling runs. Only
  // enforced when the secret is actually configured (deployed environments, loaded from SSM
  // at cold start) — local dev has no CloudFront in front of it, so there's nothing to check.
  const expectedOriginSecret = process.env.PLEXO_ORIGIN_VERIFY_SECRET;
  if (expectedOriginSecret && request.headers.get("x-origin-verify") !== expectedOriginSecret) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const url = request.nextUrl;
  const pathname = url.pathname;
  // CloudFront's origin request policy (AllViewerExceptHostHeader — required for the
  // Lambda Function URL origin to work at all) unconditionally replaces the real Host
  // header with the origin's own domain before forwarding. A CloudFront Function on
  // viewer-request (cdk/lib/forward-host-function.js) copies the real host into
  // x-forwarded-host before that happens; prefer it, falling back to host for local dev
  // and any other context that isn't behind that CloudFront distribution.
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const hostname = host.split(":")[0];

  // Handle CORS and preflight requests for API endpoints
  if (pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin") || "";
    const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").origin;
    // Extra first-party origins allowed to make COOKIE-credentialed requests, comma
    // separated (e.g. a staging URL). The dashboard's own origin is always trusted.
    const extraTrustedOrigins = (process.env.TRUSTED_CORS_ORIGINS || "")
      .split(",").map((o) => o.trim()).filter(Boolean);
    const credentialedAllowlist = new Set([appOrigin, ...extraTrustedOrigins]);

    // Credentialed (cookie/session-based) CORS is only ever granted to explicitly
    // trusted first-party origins — previously this reflected ANY origin back with
    // Access-Control-Allow-Credentials: true unconditionally, which let a malicious
    // page make authenticated requests using a visitor's session cookie if it was ever
    // sent cross-site. Every other origin still gets a working response (needed for
    // API-key-authenticated cross-origin callers — SDK embeds, MCP, ChatGPT custom
    // actions — which never rely on cookies) but WITHOUT Allow-Credentials, which is no
    // more permissive than a plain "*" wildcard since no ambient browser credential is
    // exposed to it.
    const isTrustedOrigin = origin !== "" && credentialedAllowlist.has(origin);

    const corsHeaders: [string, string][] = [
      ["Access-Control-Allow-Origin", origin || "*"],
      ["Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT"],
      ["Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-api-key, Authorization, x-unsplash-key, x-pexels-key, x-pixabay-key"],
    ];
    if (isTrustedOrigin) {
      // Only valid when Allow-Origin echoes the exact origin (guaranteed above, since
      // isTrustedOrigin requires a non-empty origin) — browsers reject credentials
      // combined with a wildcard "*" origin.
      corsHeaders.push(["Access-Control-Allow-Credentials", "true"]);
    }

    if (request.method === "OPTIONS") {
      const response = new NextResponse(null, { status: 204 });
      for (const [key, value] of corsHeaders) response.headers.set(key, value);
      return response;
    }

    const response = NextResponse.next();
    for (const [key, value] of corsHeaders) response.headers.set(key, value);
    return response;
  }

  // Resolve base domain dynamically from env or fallback
  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const baseDomain = new URL(baseAppUrl).hostname; // e.g. "localhost" or "app.plexo.xyz" — the dashboard itself
  const pagesDomain = process.env.NEXT_PUBLIC_PAGES_DOMAIN?.trim().toLowerCase() || baseDomain; // e.g. "plexopages.io"

  // Known host = the dashboard itself, checked FIRST and exclusively — everything else
  // (a plexopages.io subdomain, or a fully custom domain) is tenant content routed to
  // /pub. This must take priority over any pages-domain check: when
  // NEXT_PUBLIC_PAGES_DOMAIN isn't set (local dev), pagesDomain falls back to baseDomain
  // itself, and an exact-match pages-domain check would then wrongly treat the
  // dashboard's own hostname as tenant content and 404 it via /pub.
  // Exact matches only — "xyz.localhost" must NOT count as known, since that's how a
  // pages subdomain is simulated locally (there's no real DNS to hit in dev).
  //
  // A bare *.cloudfront.net domain is ALSO always the dashboard app, never tenant
  // content — no real customer domain can ever literally be a `<id>.cloudfront.net`
  // subdomain (that's AWS's own auto-assigned, unclaimable name for the distribution
  // itself), and a PR preview's own CloudFront domain is exactly this shape. Without
  // this, every PR preview 404'd on its own root: pr-deploy-aws.yml can't know its
  // CloudFront domain at BUILD time (cdk deploy, which mints it, runs after the build —
  // see that workflow's own comment), so NEXT_PUBLIC_APP_URL is never set for a preview
  // build and baseDomain falls back to "localhost", which the preview's real domain
  // never matches — isKnownHost was always false for a preview, routing every request
  // (including "/") into the /pub/[domain] tenant-resolution path, which 404s since no
  // PublishedDomain row exists for a PR's own throwaway CloudFront domain.
  const isKnownHost =
    hostname === baseDomain || hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".cloudfront.net");
  const isSubdomainOrCustom = !isKnownHost;

  // Platform-level static assets served from this app's own /public directory,
  // injected into tenant pages by absolute path (e.g. commerce.js's runtime <script
  // src="/commerce.js">). These are NOT per-tenant content — every tenant domain needs
  // the same file — so they must bypass the /pub/[domain]/... rewrite below entirely
  // and fall through to Next's normal static-file serving. Without this, a tenant-site
  // request for /commerce.js got rewritten to /pub/<domain>/commerce.js, which the
  // catch-all page route resolves as a nonexistent page slug and 404s — silently
  // breaking every Commerce block (and anything else depending on that script) on
  // every published tenant domain.
  const PLATFORM_STATIC_ASSETS = new Set(["/commerce.js"]);

  // 0. The wildcard pages domain's own bare apex (e.g. "plexopages.com" with no
  // subdomain) has no site of its own — nobody publishes a site there, only at
  // "<subdomain>.plexopages.com" — so it previously 404'd via the generic /pub lookup
  // below (resolveSite() finding no PublishedDomain row for the bare apex). Redirect it
  // to the real marketing/app site instead, the same "bare platform domain sends you to
  // the actual product" convention as e.g. vercel.app -> vercel.com. Exact match only —
  // "foo.plexopages.com" must fall through to the normal tenant-resolution path below.
  // Gated on isSubdomainOrCustom (not a bare `hostname === pagesDomain` check) because
  // staging has no separate wildcard domain configured yet — its own
  // NEXT_PUBLIC_PAGES_DOMAIN is literally the same value as its NEXT_PUBLIC_APP_URL — so
  // an ungated check here would redirect the dashboard's own known host to itself,
  // an infinite loop.
  if (isSubdomainOrCustom && hostname === pagesDomain) {
    return NextResponse.redirect(baseAppUrl);
  }

  // 1. If it's a pages subdomain or a custom domain, rewrite internally to /pub/[domain]/[path]
  if (isSubdomainOrCustom && !PLATFORM_STATIC_ASSETS.has(pathname)) {
    // Normalize development subdomains (xyz.localhost -> xyz.plexopages.io or similar)
    // so we can test them in local environment
    let lookupDomain = hostname;
    if (hostname.endsWith(".localhost")) {
      const sub = hostname.replace(".localhost", "");
      lookupDomain = `${sub}.${pagesDomain}`;
    }

    // Rewrite path to /pub/${lookupDomain}${pathname}
    return NextResponse.rewrite(new URL(`/pub/${lookupDomain}${pathname}`, request.url));
  }

  // 2. Enforce session cookie check for dashboard paths. Auth.js's default cookie name
  // is "authjs.session-token" (or "__Secure-authjs.session-token" over HTTPS) — this
  // used to check better-auth's "session_token" (underscore) convention before the
  // Auth.js cutover (server/authDynamo.ts, 2026-09-02).
  if (pathname.startsWith("/dashboard")) {
    const hasSessionCookie = request.cookies
      .getAll()
      .some((cookie) => cookie.name.includes("authjs.session-token"));

    if (!hasSessionCookie) {
      const loginUrl = new URL("/auth/login", request.url);
      loginUrl.searchParams.set("redirectTo", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except /_next (Next.js internals).
     *
     * Previously this also excluded any path containing a dot (meant to skip static
     * files like favicon.ico), but that silently broke every raw-upload asset request
     * with a real extension (style.css, app.js, logo.png) — on ANY host, since the
     * exclusion ran before the tenant-vs-dashboard check even happened, so those
     * requests never reached this middleware to be rewritten to /pub at all. The
     * dashboard's own static files (_next/static/*, /public/*) don't need that
     * exclusion for correctness: on the dashboard's own host, isKnownHost is true below
     * and this middleware just falls through to NextResponse.next(), so Next's normal
     * static-file serving is unaffected — this only costs a few extra middleware
     * invocations for the dashboard's own assets, not a behavior change.
     */
    "/((?!_next/).*)",
  ],
};
