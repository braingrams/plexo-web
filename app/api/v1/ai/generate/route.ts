import { NextRequest, NextResponse } from "next/server";

import { resolveAiCaller } from "@/lib/ai/aiCaller";
import { parseGenerateBody, planGeneration, runGeneration } from "@/lib/ai/generateRequest";

// The buffered AI builder endpoint — one JSON answer when the generation is done. The
// dashboard's long page generations use the streaming twin instead
// (/api/v1/ai/stream/generate, lambda/sol-chat), which reports progress and isn't bound by
// this server's 60s limit; both share lib/ai/generateRequest.ts.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveAiCaller(request);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const parsed = parseGenerateBody(resolved.key, await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const planned = await planGeneration(resolved.key, parsed.input);
  if ("error" in planned) return NextResponse.json({ error: planned.error }, { status: planned.status });
  try {
    return NextResponse.json(await runGeneration(resolved.key, parsed.input, planned.plan));
  } catch (err) {
    return NextResponse.json(
      // Already in plain words (lib/ai/generate.ts) — shown to the person as is.
      { error: err instanceof Error ? err.message : "Something went wrong generating this. Try again." },
      { status: 502 },
    );
  }
}
