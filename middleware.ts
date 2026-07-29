import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const pathname = url.pathname;
  const host = request.headers.get("host") || "";
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
  const isKnownHost =
    hostname === baseDomain || hostname === "localhost" || hostname === "127.0.0.1";
  const isSubdomainOrCustom = !isKnownHost;

  // 1. If it's a pages subdomain or a custom domain, rewrite internally to /pub/[domain]/[path]
  if (isSubdomainOrCustom) {
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

  // 2. Enforce session cookie check for dashboard paths
  if (pathname.startsWith("/dashboard")) {
    const hasSessionCookie = request.cookies
      .getAll()
      .some((cookie) => cookie.name.includes("session_token"));

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
