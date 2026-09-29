import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { SolMemoryFact } from "@/lib/db/solEntities";

/**
 * PATCH /api/v1/sol/memories/:id
 *
 * Edits a memory fact's text and/or category. Unlike SolConversation, SolMemoryFact's
 * primary key (`userId` + a bare `id`, see solEntities.ts) doesn't embed any attribute
 * this route would ever change, so a plain `.patch()` is safe here — no
 * delete-and-recreate needed (contrast app/api/v1/sol/conversations/[id]/route.ts).
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: existing } = await SolMemoryFact.get({ userId: resolved.userId, id }).go();
  if (!existing) {
    return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { text?: string; category?: string };
  const updates: { text?: string; category?: "PREFERENCE" | "FACT" | "TONE" } = {};

  if (body.text !== undefined) {
    const text = body.text.trim();
    if (!text) return NextResponse.json({ error: "`text` cannot be empty." }, { status: 400 });
    if (text.length > 500) return NextResponse.json({ error: "`text` must be 500 characters or fewer." }, { status: 400 });
    updates.text = text;
  }
  if (body.category !== undefined) {
    if (body.category !== "PREFERENCE" && body.category !== "FACT" && body.category !== "TONE") {
      return NextResponse.json({ error: "`category` must be one of PREFERENCE, FACT, TONE." }, { status: 400 });
    }
    updates.category = body.category;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Provide at least one of `text` or `category`." }, { status: 400 });
  }

  await SolMemoryFact.patch({ userId: resolved.userId, id }).set(updates).go();
  const { data: updated } = await SolMemoryFact.get({ userId: resolved.userId, id }).go();

  return NextResponse.json({
    memory: {
      id,
      text: updated?.text,
      category: updated?.category,
      source: updated?.source,
      sourceConversationId: updated?.sourceConversationId ?? null,
      createdAt: updated?.createdAt,
      updatedAt: updated?.updatedAt,
    },
  });
}

/**
 * DELETE /api/v1/sol/memories/:id
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: existing } = await SolMemoryFact.get({ userId: resolved.userId, id }).go();
  if (!existing) {
    return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  }

  await SolMemoryFact.remove({ userId: resolved.userId, id }).go();
  return NextResponse.json({ success: true });
}
