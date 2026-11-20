import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { SeatLimitError, acceptInvitation, getInvitation, setActiveOrganizationCookie } from "@/server/orgDynamo";

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

  let result: Awaited<ReturnType<typeof acceptInvitation>>;
  try {
    result = await acceptInvitation(id, session.user.id);
  } catch (err) {
    if (err instanceof SeatLimitError) {
      return NextResponse.json(
        { error: "This team is full on its current plan, so the invite can't be accepted yet. Ask the person who invited you to free up a seat or upgrade.", code: "SEAT_LIMIT_FULL" },
        { status: 403 },
      );
    }
    throw err;
  }
  if (!result) {
    return NextResponse.json({ error: "This invitation is no longer valid." }, { status: 409 });
  }

  await setActiveOrganizationCookie(result.organizationId);
  return NextResponse.json({ organizationId: result.organizationId });
}
