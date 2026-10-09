import { NextRequest, NextResponse } from "next/server";
import { loadApp } from "@/lib/projects/appAccess";
import { ensureAppConversation } from "@/lib/projects/appConversation";

/**
 * POST — the app editor's chat: this user's SOL conversation bound to this app (created on
 * first use). SOL then works on this app in every turn, with its files and conventions in
 * context. Returns the conversation's id for the normal SOL chat endpoints.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  const conversation = await ensureAppConversation({ userId: loaded.resolved.userId, organizationId: loaded.resolved.organizationId, appId: id, appName: loaded.app.name });
  return NextResponse.json({ conversationId: conversation.id, modelTier: conversation.modelTier });
}
