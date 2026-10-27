import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { prepareAssist, type AssistFrame } from "@/lib/ai/pageAssist";

// LOCAL-DEV-ONLY IN PRACTICE, like app/api/v1/sol/chat/**: in every deployed environment CloudFront sends
// `api/v1/ai/stream/*` to the streaming Lambda (lambda/sol-chat) before it reaches this app. This route lets
// `next dev` — no CloudFront, no Lambda — run the same code (lib/ai/pageAssist.ts) with ordinary Next streaming.
export async function POST(request: NextRequest): Promise<Response> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "You're signed out. Sign in again, then try once more." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const prepared = await prepareAssist(resolved.userId, body);
  if ("refused" in prepared) return NextResponse.json({ error: prepared.refused.error }, { status: prepared.refused.status });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await prepared.run((frame: AssistFrame) => controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`)));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}
