import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { prepareConfirmTurn, type StreamFrame } from "@/lib/ai/solChatHandler";

// LOCAL-DEV-ONLY IN PRACTICE — see the sibling messages/route.ts's own doc comment for why.
// Resumes whichever tool call SOL paused this conversation on — a destructive action
// awaiting confirm/decline (`{decision}`), or SOL's own ask_user_question meta-tool
// awaiting structured answers (`{answers}`). prepareConfirmTurn inspects the actual
// pending tool_use block to decide which shape the body needs to be.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; messageId: string }> },
): Promise<Response> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId, messageId } = await context.params;
  const body = await request.json().catch(() => ({}));

  const prepared = await prepareConfirmTurn(conversationId, messageId, resolved, body);
  if (!prepared.ok) {
    return NextResponse.json(prepared.body, { status: prepared.status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await prepared.run({
          emit: (frame: StreamFrame) => controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`)),
          end: () => controller.close(),
        });
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
