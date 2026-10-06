import { NextRequest, NextResponse } from "next/server";
import { revalidateBlogPost } from "@/lib/blog/revalidateDynamo";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { processWpMigrationStep } from "@/lib/wpMigration/runJobDynamo";

// In-process, time-boxed step loop for a migration nobody is watching — same shape as
// app/api/internal/site-import/process/route.ts (and the same reason the loop lives in
// process rather than as a chain of self-triggered HTTP requests).
export const maxDuration = 60;
const STEP_LOOP_BUDGET_MS = 15_000; // each step can itself take up to ~40s; start another only if there's clearly room

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; templateId?: string };
  if (!body.jobId || !body.templateId) {
    return NextResponse.json({ error: "jobId and templateId are required." }, { status: 400 });
  }
  const deadline = Date.now() + STEP_LOOP_BUDGET_MS;
  let result = await processWpMigrationStep(body.templateId, body.jobId, revalidateBlogPost);
  while (!result.done && result.phase !== "PAUSED_ERROR" && Date.now() < deadline) {
    result = await processWpMigrationStep(body.templateId, body.jobId, revalidateBlogPost);
  }
  return NextResponse.json(result);
}
