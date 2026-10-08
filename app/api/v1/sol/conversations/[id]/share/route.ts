import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { shareConversation, shareStatus, stopSharingOwned } from "@/lib/sol/share";

/**
 * /api/v1/sol/conversations/:id/share — the chat header's Share button (lib/sol/share.ts).
 * GET: is it shared, and at what link. POST: share it as it is now (or move the existing
 * link up to now). DELETE: stop sharing.
 */
type Context = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Conversation not found." }, { status: 404 });

export async function GET(request: NextRequest, context: Context): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await shareStatus(resolved.userId, resolved.organizationId, (await context.params).id);
  return status ? NextResponse.json(status) : notFound();
}

export async function POST(request: NextRequest, context: Context): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await shareConversation(resolved.userId, resolved.organizationId, (await context.params).id);
  return status ? NextResponse.json(status) : notFound();
}

export async function DELETE(request: NextRequest, context: Context): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const done = await stopSharingOwned(resolved.userId, resolved.organizationId, (await context.params).id);
  return done ? NextResponse.json({ shared: false, url: null, upTo: null }) : notFound();
}
