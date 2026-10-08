import { NextRequest, NextResponse } from "next/server";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { isValidUuid } from "@/lib/slugUtils";
import { assertOwnSite, resolveMigrationAccess } from "@/lib/wpMigration/access";
import { checkConnector, createConnector, revealConnectorCode, type ConnectorState } from "@/lib/wpMigration/connector";

export const maxDuration = 60;

async function load(request: NextRequest, context: { params: Promise<{ templateId: string; jobId: string }> }) {
  const { templateId, jobId } = await context.params;
  const resolved = await resolveMigrationAccess(request, { permission: "update" });
  if ("error" in resolved) return { error: resolved.error };
  const notOwn = await assertOwnSite(resolved.access, templateId);
  if (notOwn) return { error: notOwn };
  if (!isValidUuid(jobId)) return { error: NextResponse.json({ error: "Migration not found." }, { status: 404 }) };
  const { data: job } = await WpMigrationJob.get({ templateId, id: jobId }).go();
  if (!job) return { error: NextResponse.json({ error: "Migration not found." }, { status: 404 }) };
  return { job };
}

function publicState(state: ConnectorState | undefined, code: string | null) {
  if (!state) return null;
  return { status: state.status, summary: state.summary ?? null, error: state.error ?? null, checkedAt: state.checkedAt ?? null, code };
}

/** POST — create (or replace) the connection code the owner pastes into the WordPress plugin. */
export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string; jobId: string }> }): Promise<NextResponse> {
  const loaded = await load(request, context);
  if ("error" in loaded) return loaded.error!;
  const code = await createConnector(loaded.job);
  return NextResponse.json({ connector: { status: "WAITING", summary: null, error: null, checkedAt: null, code } }, { status: 201 });
}

/** GET ?check=1 — check the plugin is installed and connected (without ?check, just returns the current state). */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string; jobId: string }> }): Promise<NextResponse> {
  const loaded = await load(request, context);
  if ("error" in loaded) return loaded.error!;
  const job = loaded.job;
  const state = request.nextUrl.searchParams.get("check") ? await checkConnector(job).catch((err: Error) => ({ ...(job.connector as ConnectorState), status: "ERROR" as const, error: err.message })) : (job.connector as ConnectorState | undefined);
  return NextResponse.json({ connector: publicState(state, revealConnectorCode(job)), extras: job.extras ?? null });
}
