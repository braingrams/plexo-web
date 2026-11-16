import { plexoAuthCss } from "@/lib/brand/authCss";

// The live Plexo brand for the sign-in screens (linked by app/auth/_kit/AuthShell). Public; values
// are validated in lib/brand/strataTokens. Bundled values apply if this ever fails to load.
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(await plexoAuthCss(), {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=3600", "X-Content-Type-Options": "nosniff" },
  });
}
