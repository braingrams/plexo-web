import { NextRequest, NextResponse } from "next/server";
import { resolveAiCaller } from "@/lib/ai/aiCaller";
import { NOT_ENOUGH_CREDITS, creditCheck, parseGenerateBody } from "@/lib/ai/generateRequest";

/**
 * POST — would this AI request be affordable, before running it. Same body as
 * /api/v1/ai/generate. Returns who pays (Plexo credits, the account's own key, or a host
 * app), the most it could cost in credits, the balance, and whether that's enough — so the
 * dashboard can say "you need more credits" instead of starting a generation that can't run.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveAiCaller(request);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const parsed = parseGenerateBody(resolved.key, await request.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const check = await creditCheck(resolved.key, parsed.input);
  return NextResponse.json({ ...check, ...(check.enough ? {} : { message: NOT_ENOUGH_CREDITS }) });
}
