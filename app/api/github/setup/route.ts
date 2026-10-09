import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { verifyInstallState, verifyAndRecordInstallation } from "@/lib/projects/github/install";
import { installBounceTarget } from "@/lib/projects/github/relay";

/**
 * GET /api/github/setup — where GitHub sends people after installing (or reconfiguring) the
 * Plexo GitHub App. Verifies the person really has access to the installation (their own
 * OAuth code, not the forgeable installation id) and returns them to the app editor.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams;
  // An install staging started lands here (the shared GitHub App's callback) — send it on.
  const bounce = installBounceTarget(q.get("state"), q);
  if (bounce) return NextResponse.redirect(bounce);
  const state = verifyInstallState(q.get("state"));
  const back = (appId: string | null, result: string) =>
    NextResponse.redirect(new URL(appId ? `/dashboard/apps/${appId}?panel=settings&github=${result}` : `/dashboard/apps?github=${result}`, request.url));

  const resolved = await resolveUser(request);
  if (!state || !resolved || resolved.userId !== state.userId || resolved.organizationId !== state.organizationId) return back(state?.appId ?? null, "expired");
  const installationId = Number(q.get("installation_id"));
  const code = q.get("code");
  if (!installationId || !code) return back(state.appId, q.get("setup_action") === "request" ? "requested" : "missing");
  try {
    await verifyAndRecordInstallation({ code, installationId, organizationId: state.organizationId, userId: state.userId });
    return back(state.appId, "connected");
  } catch {
    return back(state.appId, "denied");
  }
}
