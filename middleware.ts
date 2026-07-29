import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const pathname = url.pathname;
  const host = request.headers.get("host") || "";
  const hostname = host.split(":")[0];

  // Handle CORS and preflight requests for API endpoints
  if (pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin") || "";
    
    if (request.method === "OPTIONS") {
      const response = new NextResponse(null, { status: 204 });
      response.headers.set("Access-Control-Allow-Credentials", "true");
      response.headers.set("Access-Control-Allow-Origin", origin || "*");
      response.headers.set("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
      response.headers.set("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-api-key, Authorization, x-unsplash-key, x-pexels-key, x-pixabay-key");
      return response;
    }

    const response = NextResponse.next();
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Origin", origin || "*");
    response.headers.set("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    response.headers.set("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-api-key, Authorization, x-unsplash-key, x-pexels-key, x-pixabay-key");
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
     * Match all paths except:
     * 1. /_next (Next.js internals)
     * 2. static files with extensions (e.g. favicon.ico, images, css)
     */
    "/((?!_next/|.*\\..*).*)",
  ],
};
