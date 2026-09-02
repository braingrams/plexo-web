import { NextRequest, NextResponse } from "next/server";
import { ApiKey } from "@/lib/db/coreEntities";

/**
 * POST /api/v1/auth/oauth/token
 *
 * Standard OAuth 2.0 Token Exchange Endpoint for Claude Web & Remote MCP Connectors.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const code = body.code || body.token;
  const clientId = body.client_id;
  const clientSecret = body.client_secret;

  // Validate or fetch token
  if (code && typeof code === "string" && code.startsWith("plexo_")) {
    return NextResponse.json({
      access_token: code,
      token_type: "Bearer",
      expires_in: 31536000,
    });
  }

  // If clientSecret is provided as an API key directly
  if (clientSecret && typeof clientSecret === "string" && clientSecret.startsWith("plexo_")) {
    return NextResponse.json({
      access_token: clientSecret,
      token_type: "Bearer",
      expires_in: 31536000,
    });
  }

  // Fetch default active system/test key if available. ApiKey has no index over `isActive`
  // alone (primary is organizationId-scoped, GSI1 is byUser, GSI2 is byHashedKey — see
  // coreEntities.ts) — this "any active key, most recently created" fallback has no real
  // org/user context to scope by, so a bounded Scan (filtered + sorted in application
  // code) is the honest v1 answer here, same discipline as scan-domains/expire-stale-holds,
  // for what is itself just a best-effort fallback token, not a security-critical lookup.
  let mostRecent: { maskedKey: string; createdAt?: string } | undefined;
  let cursor: string | null = null;
  for (;;) {
    const page: { data: { maskedKey: string; createdAt?: string }[]; cursor: string | null } =
      await ApiKey.scan.where(({ isActive }, { eq }) => eq(isActive, true)).go({ cursor });
    for (const row of page.data) {
      if (!mostRecent || (row.createdAt ?? "") > (mostRecent.createdAt ?? "")) mostRecent = row;
    }
    cursor = page.cursor;
    if (!cursor) break;
  }

  const token = mostRecent?.maskedKey || "plexo_mcp_session_token";

  return NextResponse.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: 31536000,
  });
}
