import { NextRequest, NextResponse } from "next/server";
import { requireUser, appError } from "@/lib/projects/appAccess";
import { githubConfigured, installUrl, GitHubError } from "@/lib/projects/github/client";
import { orgInstallations, signInstallState } from "@/lib/projects/github/install";
import { isSafeReturnPath } from "@/lib/projects/github/validate";

/**
 * GET /api/v1/github/connection?returnTo=/dashboard/new
 *   → { configured, installations: [{ id, account, type }], installUrl }
 *
 * The organization's GitHub connection, for the site wizard (not tied to any one app). installUrl
 * starts an install that returns to returnTo (an in-app /dashboard/ path) with ?github=<result>.
 */
const DEFAULT_RETURN = "/dashboard/new";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await requireUser(request);
  if (resolved instanceof NextResponse) return resolved;
  if (!githubConfigured()) return NextResponse.json({ configured: false, installations: [], installUrl: null });
  try {
    const requested = request.nextUrl.searchParams.get("returnTo");
    const returnTo = isSafeReturnPath(requested) ? requested : DEFAULT_RETURN;
    const installations = await orgInstallations(resolved.organizationId);
    return NextResponse.json({
      configured: true,
      installations: installations.map((i) => ({ id: i.installationId, account: i.accountLogin, type: i.accountType ?? null })),
      installUrl: installUrl(signInstallState({ appId: null, organizationId: resolved.organizationId, userId: resolved.userId, returnTo })),
    });
  } catch (err) {
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status >= 500 ? 502 : err.status });
    return appError(err);
  }
}
