import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { Member } from "@/lib/db/coreEntities";
import { setActiveOrganizationCookie } from "@/server/orgDynamo";

// Sets which organization the signed-in user is currently working in — the DynamoDB-stack
// replacement for authClient.organization.setActive (see orgDynamo.ts's ACTIVE_ORG_COOKIE
// comment for why this is a cookie instead of a session field).
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }

  const { data: membership } = await Member.get({ organizationId, userId: session.user.id }).go();
  if (!membership) {
    return NextResponse.json({ error: "You're not a member of that organization." }, { status: 403 });
  }

  await setActiveOrganizationCookie(organizationId);
  return NextResponse.json({ ok: true });
}
