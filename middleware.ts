import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const pathname = url.pathname;
  const host = request.headers.get("host") || "";
  const hostname = host.split(":")[0];

  // Resolve base domain dynamically from env or fallback
  const baseAppUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const baseDomain = new URL(baseAppUrl).hostname; // e.g. "localhost" or "plexo.charisol.io"

  // Check if it is a subdomain of the base domain, or a custom domain
  let isSubdomainOrCustom = false;
  if (hostname !== baseDomain && hostname !== "localhost" && hostname !== "127.0.0.1") {
    isSubdomainOrCustom = true;
  }

  // 1. If it's a subdomain or custom domain, rewrite internally to /pub/[domain]/[path]
  if (isSubdomainOrCustom) {
    // Normalize development subdomains (xyz.localhost -> xyz.plexo.charisol.io or similar)
    // so we can test them in local environment
    let lookupDomain = hostname;
    if (hostname.endsWith(".localhost")) {
      const sub = hostname.replace(".localhost", "");
      lookupDomain = `${sub}.${baseDomain}`;
    }
    
    // Rewrite path to /pub/[lookupDomain]/[path]
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
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. static files with extensions (e.g. favicon.ico, images, css)
     */
    "/((?!api/|_next/|.*\\..*).*)",
  ],
};
