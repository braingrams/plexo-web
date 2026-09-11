import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { SolConversation, SolPreferences } from "@/lib/db/solEntities";

/**
 * GET /api/v1/sol/conversations
 *
 * Lists the caller's SOL conversations, most-recently-active first — SolConversation's
 * primary index sort key embeds `updatedAt` (see lib/db/solEntities.ts) specifically so
 * this ordering falls straight out of the index without an application-side sort.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: conversations } = await SolConversation.query.primary({ userId: resolved.userId }).go({ order: "desc" });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title ?? null,
      modelTier: c.modelTier,
      status: c.status,
      lastMessageAt: c.lastMessageAt ?? null,
      messageCount: c.messageCount ?? 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}

/**
 * POST /api/v1/sol/conversations
 *
 * Starts a brand-new SOL conversation. Body: `{title?, modelTier?}` — both optional; an
 * absent modelTier falls back to the user's own SolPreferences.defaultModelTier (itself
 * defaulted to "BASIC"), the same way the chat composer would pre-select a tier for a
 * user who's set a preferred one. No initial message is created here — the first turn is
 * sent separately via SolChatFn's streaming endpoint once the client has this new
 * conversation's id.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { title?: string; modelTier?: string };
  const VALID_TIERS = new Set(["BASIC", "MEDIUM", "HIGH"]);

  let modelTier = body.modelTier;
  if (modelTier && !VALID_TIERS.has(modelTier)) {
    return NextResponse.json({ error: "modelTier must be one of BASIC, MEDIUM, HIGH." }, { status: 400 });
  }
  if (!modelTier) {
    const { data: prefs } = await SolPreferences.get({ userId: resolved.userId }).go();
    modelTier = prefs?.defaultModelTier ?? "BASIC";
  }

  const id = randomUUID();
  // Explicitly supplied (rather than left to the entity's own default-generator) so the
  // response below can echo back the exact persisted values without a needless
  // read-after-write query — SolConversation.create()'s readOnly createdAt/updatedAt
  // attributes both accept an explicit value at creation time (readOnly only blocks a
  // later .patch()/.update(), not the initial .create()).
  const now = new Date().toISOString();
  await SolConversation.create({
    id,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    title: body.title?.trim() || undefined,
    modelTier: modelTier as "BASIC" | "MEDIUM" | "HIGH",
    status: "ACTIVE",
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  }).go();

  return NextResponse.json({
    conversation: {
      id,
      title: body.title?.trim() || null,
      modelTier,
      status: "ACTIVE",
      lastMessageAt: null,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  });
}
