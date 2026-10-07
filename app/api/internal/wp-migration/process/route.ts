import { NextRequest, NextResponse } from "next/server";
import { revalidateBlogPost } from "@/lib/blog/revalidateDynamo";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { processWpMigrationStep } from "@/lib/wpMigration/runJobDynamo";
import { MAX_BACKGROUND_HOPS, continueInBackground } from "@/lib/wpMigration/background";

// Runs one step of a migration nobody is watching, then — if there's more to do — hands
// the job to a fresh invocation (lib/wpMigration/background.ts), so a big site keeps
// moving at full speed with the tab closed. One step per invocation: a step can take
// ~45s, and the hand-off must still fit inside this function's 60s. It stops when the
// dashboard is driving the job itself (the step comes back busy).
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; templateId?: string; hop?: number };
  if (!body.jobId || !body.templateId) {
    return NextResponse.json({ error: "jobId and templateId are required." }, { status: 400 });
  }
  const result = await processWpMigrationStep(body.templateId, body.jobId, revalidateBlogPost);
  const hop = Number.isInteger(body.hop) ? body.hop! : 0;
  if (!result.done && !result.busy && result.phase !== "PAUSED_ERROR" && hop < MAX_BACKGROUND_HOPS) {
    await continueInBackground(body.templateId, body.jobId, hop + 1);
  }
  return NextResponse.json(result);
}
