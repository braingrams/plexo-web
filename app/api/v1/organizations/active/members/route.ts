import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { Member, User } from "@/lib/db/coreEntities";

/** Backs the @mention autocomplete in the comment composer. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";

  const { data: orgMembers } = await Member.query
    .primary({ organizationId: resolved.organizationId })
    .go({ order: "asc", pages: "all" });

  const users = await Promise.all(orgMembers.map((m) => User.get({ id: m.userId }).go()));
  const withUser = orgMembers
    .map((m, i) => ({ member: m, user: users[i].data }))
    .filter((row): row is { member: (typeof orgMembers)[number]; user: NonNullable<(typeof users)[number]["data"]> } => !!row.user);

  const filtered = q
    ? withUser.filter(
        ({ user }) => user.name?.toLowerCase().includes(q) || user.email?.toLowerCase().includes(q),
      )
    : withUser;

  const members = filtered
    .sort((a, b) => (a.member.createdAt ?? "").localeCompare(b.member.createdAt ?? ""))
    .slice(0, 20)
    .map(({ user }) => ({ id: user.id, name: user.name, email: user.email, image: user.image ?? null }));

  return NextResponse.json({ members });
}
