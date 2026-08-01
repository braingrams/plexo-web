import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";

/** Backs the @mention autocomplete in the comment composer. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";

  const members = await prisma.member.findMany({
    where: {
      organizationId: resolved.organizationId,
      ...(q
        ? { user: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } }
        : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    take: 20,
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    members: members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, image: m.user.image })),
  });
}
