import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { prepareMessagesTurn, type StreamFrame } from "@/lib/ai/solChatHandler";

// LOCAL-DEV-ONLY IN PRACTICE. In every real deployed environment, CloudFront routes
// `api/v1/sol/chat/*` straight to the dedicated streaming Lambda (SolChatFn —
// lambda/sol-chat/index.ts, wired in cdk/lib/compute-stack.ts) before the request ever
// reaches this Next.js app at all, so this route never actually runs in staging/production.
// It exists so `next dev` — which has no CloudFront, no Lambda, no `awslambda` global — can
// still exercise the exact same turn logic (lib/ai/solChatHandler.ts) via ordinary Next.js
// request/response streaming instead. Auth here is the real `resolveUser()` session check
// (not the Lambda's own cookie-decoding sessionAuth.ts, which only exists because a bare
// Lambda has no Next.js request context to call `auth()` from).
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId } = await context.params;
  const body = await request.json().catch(() => ({}));

  const prepared = await prepareMessagesTurn(conversationId, resolved, body);
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
