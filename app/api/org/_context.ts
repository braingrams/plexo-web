import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import type { OrgRole } from "@/server/accessControl";

type Resolved =
  | { error: NextResponse }
  | { error: null; userId: string; organizationId: string; role: OrgRole };

// Shared session + active-org resolution for every /api/org/* route below — the
// DynamoDB-stack equivalent of each better-auth org endpoint's own built-in session
// check, since there's no framework doing that for us anymore.
export async function resolveOrgContext(): Promise<Resolved> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }

  const resolution = await ensureActiveOrganization(session.user.id);
  if (resolution.status === "needs-choice") {
    return { error: NextResponse.json({ error: "No active organization selected." }, { status: 409 }) };
  }

  return { error: null, userId: session.user.id, organizationId: resolution.organizationId, role: resolution.role };
}
