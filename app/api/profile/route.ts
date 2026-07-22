import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

export async function PATCH(request: Request): Promise<NextResponse> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string; layoutMode?: string };
  try {
    body = (await request.json()) as { name?: string; layoutMode?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: { name?: string; layoutMode?: "CLASSIC" | "MODERN" } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length < 1) {
      return NextResponse.json({ error: "Display name cannot be empty." }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: "Display name is too long (max 100 characters)." }, { status: 400 });
    }
    data.name = name;
  }

  if (body.layoutMode !== undefined) {
    if (body.layoutMode !== "CLASSIC" && body.layoutMode !== "MODERN") {
      return NextResponse.json({ error: "Invalid layout mode." }, { status: 400 });
    }
    data.layoutMode = body.layoutMode;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No changes to update." }, { status: 400 });
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: { id: true, name: true, email: true, layoutMode: true },
    });

    return NextResponse.json({ user: updatedUser });
  } catch {
    return NextResponse.json({ error: "Unable to update profile." }, { status: 500 });
  }
}
