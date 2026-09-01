import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { acceptInvitation, getInvitation, setActiveOrganizationCookie } from "@/server/orgDynamo";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const invitation = await getInvitation(id);
  if (!invitation || invitation.status !== "pending") {
    return NextResponse.json({ error: "This invitation is invalid, expired, or already used." }, { status: 404 });
  }
  if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
    return NextResponse.json(
      { error: `This invitation was sent to ${invitation.email}, not your signed-in email.` },
      { status: 403 },
    );
  }

  const result = await acceptInvitation(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "This invitation is no longer valid." }, { status: 409 });
  }

  await setActiveOrganizationCookie(result.organizationId);
  return NextResponse.json({ organizationId: result.organizationId });
}
