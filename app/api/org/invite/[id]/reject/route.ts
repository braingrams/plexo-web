import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { getInvitation, rejectInvitation } from "@/server/orgDynamo";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const invitation = await getInvitation(id);
  if (!invitation || invitation.status !== "pending") {
    return NextResponse.json({ error: "This invitation is invalid, expired, or already used." }, { status: 404 });
  }
  if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
    return NextResponse.json({ error: "This invitation was sent to a different email." }, { status: 403 });
  }

  await rejectInvitation(id);
  return NextResponse.json({ ok: true });
}
