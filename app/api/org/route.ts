import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { membershipsForUser } from "@/server/orgDynamo";

/** Every organization the signed-in user belongs to — the DynamoDB-stack replacement for
 * authClient.organization.list() (lib/auth-client.ts). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const memberships = await membershipsForUser(session.user.id);
  return NextResponse.json({
    data: memberships.map((m) => ({ id: m.organizationId, name: m.organization.name })),
  });
}
