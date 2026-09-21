import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { SolMemoryFact } from "@/lib/db/solEntities";

/**
 * GET /api/v1/sol/memories
 *
 * Lists the caller's SOL memory facts. Deliberately unpaginated — see
 * lib/db/solEntities.ts's own comment on SolMemoryFact: this list is meant to stay small
 * (tens, not thousands, of user-curated facts), the same assumption
 * app/api/v1/sol/preferences and this entity's own indexing already make.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: facts } = await SolMemoryFact.query.primary({ userId: resolved.userId }).go({ pages: "all" });

  return NextResponse.json({
    memories: facts.map((f) => ({
      id: f.id,
      text: f.text,
      category: f.category,
      source: f.source,
      sourceConversationId: f.sourceConversationId ?? null,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })),
  });
}

/**
 * POST /api/v1/sol/memories
 *
 * Adds a new memory fact directly from a settings page — always `source: "USER_ADDED"`;
 * `LLM_EXTRACTED` facts (the agent noticing something worth remembering mid-conversation)
 * are created by the agent's own tool dispatch (lib/mcp/mcpServer.ts), not through this
 * public route.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { text?: string; category?: string };
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "`text` is required." }, { status: 400 });
  }
  if (text.length > 500) {
    return NextResponse.json({ error: "`text` must be 500 characters or fewer." }, { status: 400 });
  }
  const category = body.category;
  if (category !== undefined && category !== "PREFERENCE" && category !== "FACT" && category !== "TONE") {
    return NextResponse.json({ error: "`category` must be one of PREFERENCE, FACT, TONE." }, { status: 400 });
  }

  const id = randomUUID();
  await SolMemoryFact.create({
    id,
    userId: resolved.userId,
    text,
    category: category ?? "FACT",
    source: "USER_ADDED",
  }).go();

  const { data: created } = await SolMemoryFact.get({ userId: resolved.userId, id }).go();

  return NextResponse.json({
    memory: {
      id,
      text,
      category: created?.category ?? category ?? "FACT",
      source: "USER_ADDED",
      sourceConversationId: null,
      createdAt: created?.createdAt,
      updatedAt: created?.updatedAt,
    },
  });
}
