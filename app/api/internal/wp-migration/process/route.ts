import { NextRequest, NextResponse } from "next/server";
import { revalidateBlogPost } from "@/lib/blog/revalidateDynamo";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { processWpMigrationStep } from "@/lib/wpMigration/runJobDynamo";
import { MAX_BACKGROUND_HOPS, continueInBackground } from "@/lib/wpMigration/background";

// In-process, time-boxed step loop for a migration nobody is watching. When the time is
// up and there's more to do, it hands the job to a fresh invocation (lib/wpMigration/
// background.ts), so a big site keeps moving at full speed with the tab closed. It stops
// when the dashboard is driving the job itself (the step comes back busy).
export const maxDuration = 60;
const STEP_LOOP_BUDGET_MS = 15_000; // each step can itself take up to ~40s; start another only if there's clearly room

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; templateId?: string; hop?: number };
  if (!body.jobId || !body.templateId) {
    return NextResponse.json({ error: "jobId and templateId are required." }, { status: 400 });
  }
  const deadline = Date.now() + STEP_LOOP_BUDGET_MS;
  let result = await processWpMigrationStep(body.templateId, body.jobId, revalidateBlogPost);
  while (!result.done && !result.busy && result.phase !== "PAUSED_ERROR" && Date.now() < deadline) {
    result = await processWpMigrationStep(body.templateId, body.jobId, revalidateBlogPost);
  }
  const hop = Number.isInteger(body.hop) ? body.hop! : 0;
  if (!result.done && !result.busy && result.phase !== "PAUSED_ERROR" && hop < MAX_BACKGROUND_HOPS) {
    await continueInBackground(body.templateId, body.jobId, hop + 1);
  }
  return NextResponse.json(result);
}
