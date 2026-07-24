import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "../../domains/route";
import { resolveStrataProjectId, fetchStrataTokens } from "@/server/strata";

/**
 * GET /api/v1/strata/tokens?projectId=optional
 *
 * Companion to publish_landing_page/create_email_template for AI tools (MCP server) —
 * checks whether the account has a Strata design-system project connected and, if so,
 * fetches its design tokens (colors, typography, spacing) so generated designJson can
 * be built to match the user's brand.
 *
 * Passing ?projectId=<id> connects (or switches) the account to that project before
 * fetching — so this single endpoint covers both "check connection status" (no query
 * param, uses the previously connected project) and "connect + fetch" (with one).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized. Valid API Key or Session required." }, { status: 401 });
  }

  const incomingProjectId = request.nextUrl.searchParams.get("projectId") || undefined;
  const projectId = await resolveStrataProjectId(resolved.userId, incomingProjectId);

  if (!projectId) {
    return NextResponse.json({
      connected: false,
      projectId: null,
      tokens: [],
      message: "No Strata project connected yet. Pass a projectId to connect (find it in your Strata project's snapshot/share URL).",
    });
  }

  const result = await fetchStrataTokens(projectId);
  if ("error" in result) {
    return NextResponse.json({ connected: false, projectId, tokens: [], error: result.error });
  }

  return NextResponse.json({
    connected: true,
    projectId,
    tokenCount: result.tokens.length,
    tokens: result.tokens,
  });
}
