import { NextRequest, NextResponse } from "next/server";
import { guardSsrSettings } from "@/lib/appFunctions/ssrGuard";
import { listSsrVariables, upsertSsrVariable, deleteSsrVariable, VariableError } from "@/lib/appFunctions/ssrVariableStore";
import { applySsrVariables } from "@/lib/appFunctions/deploy";
import { isValidScope, type VariableEnv } from "@/lib/appFunctions/ssrVariables";
import { resolveUser } from "@/lib/auth/resolveUser";

/**
 * /api/v1/templates/:id/ssr-variables — the app's variables. Visible settings: values are returned
 * and shown in the dashboard. Secrets are a different thing (/ssr-secrets).
 *
 *   GET                        → { variables: [{ name, scope, value, buildTime, updatedAt, updatedBy }] }
 *   PUT  { name, value, scope?, buildTime? }
 *   DELETE ?name=…&scope=…
 *
 * A change applies to the running functions straight away. A build-time change reaches the site
 * on the next build (the build reads it once).
 */

function envsFor(scope: string): VariableEnv[] {
  return scope === "dev" ? ["dev"] : scope === "live" ? ["live"] : ["dev", "live"];
}

async function applyAll(templateId: string, scope: string): Promise<string | null> {
  try {
    for (const env of envsFor(scope)) await applySsrVariables(templateId, env);
    return null;
  } catch (err) {
    console.error("applying SSR variables failed", err);
    return "Saved. The running server will pick the change up on its next deploy.";
  }
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;
  return NextResponse.json({ variables: await listSsrVariables(templateId) });
}

export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;
  const resolved = await resolveUser(request);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send a JSON object with name, value, and scope." }, { status: 400 });
  try {
    const saved = await upsertSsrVariable(templateId, body, resolved?.userId);
    const warning = await applyAll(templateId, saved.scope);
    return NextResponse.json({ saved, warning });
  } catch (err) {
    if (err instanceof VariableError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  const scopeParam = url.searchParams.get("scope") ?? "all";
  if (!name || !isValidScope(scopeParam)) return NextResponse.json({ error: "Send name and scope." }, { status: 400 });
  await deleteSsrVariable(templateId, name, scopeParam);
  const warning = await applyAll(templateId, scopeParam);
  return NextResponse.json({ deleted: { name, scope: scopeParam }, warning });
}
