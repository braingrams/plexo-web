import { NextRequest, NextResponse } from "next/server";

import { getStripe } from "@/lib/stripe";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { stripeCustomerId: true },
  });

  if (!user.stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing account yet — subscribe to a plan or buy credits first." },
      { status: 400 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl}/dashboard/settings`,
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not open billing portal." },
      { status: 503 },
    );
  }
}
