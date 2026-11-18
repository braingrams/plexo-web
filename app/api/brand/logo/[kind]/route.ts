import { getPlexoLogo } from "@/lib/brand/plexoLogos";
import { isLogoKind } from "@/lib/brand/strataTokens";

// Public, unauthenticated, same-origin: Plexo's own logos by role, always the current Strata
// asset (or the bundled file when Strata is unreachable/invalid/off). The URL never changes,
// so emails can use it forever. See docs/PLEXO_BRAND_FROM_STRATA.md.
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isLogoKind(kind)) return new Response("Unknown logo.", { status: 404 });
  const logo = await getPlexoLogo(kind);
  const headers: Record<string, string> = {
    "Content-Type": logo.contentType,
    "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
    ETag: logo.etag,
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
  if (logo.contentType === "image/svg+xml") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  if (request.headers.get("if-none-match") === logo.etag) return new Response(null, { status: 304, headers });
  return new Response(logo.bytes as BodyInit, { status: 200, headers });
}
