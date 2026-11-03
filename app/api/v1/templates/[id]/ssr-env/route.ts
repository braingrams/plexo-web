import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { DeployedApp } from "@/lib/db/appEntities";
import { parseSsrEnvBody } from "@/lib/appFunctions/ssrEnv";
import { ssrEnvNames, updateSsrEnvironment, type SsrTarget } from "@/lib/appFunctions/deploy";
import { getTierFeatures } from "@/lib/subscription";

/**
 * /api/v1/templates/:id/ssr-env — environment variables for a server-rendered app.
 *
 * Write-only: POST sets and removes variables on the app's live function
 * (UpdateFunctionConfiguration), and every response carries variable names only. Values are never
 * returned, logged, or stored by Plexo.
 *
 *   GET   → { names: string[] }
 *   POST  body: { set?: { NAME: "value" }, unset?: ["NAME"] } → { names: string[] }
 */

/** `?target=preview` edits the preview function; the default is the live one. */
function targetOf(request: NextRequest): SsrTarget {
  return new URL(request.url).searchParams.get("target") === "preview" ? "preview" : "live";
}

async function authorize(request: NextRequest, templateId: string): Promise<{ error: NextResponse } | { ok: true; target: SsrTarget }> {
  const resolved = await resolveUser(request);
  if (!resolved) return { error: NextResponse.json({ error: "Unauthorized. Valid API key or session required." }, { status: 401 }) };
  if (!getTierFeatures(resolved.subscriptionPlan).ssrEnabled) {
    return { error: NextResponse.json({ error: "Server-rendered apps are available on the ULTRA plan." }, { status: 403 }) };
  }
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return { error: NextResponse.json({ error: `No template found with id "${templateId}" for this account.` }, { status: 404 }) };
  }
  const target = targetOf(request);
  const { data: app } = await DeployedApp.get({ templateId }).go();
  const exists = target === "preview" ? Boolean(app?.previewFunctionName) : app?.type === "SSR";
  if (!exists) {
    return { error: NextResponse.json({ error: `This app has no ${target} server function yet. Upload its server build first.` }, { status: 409 }) };
  }
  return { ok: true, target };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const auth = await authorize(request, templateId);
  if ("error" in auth) return auth.error;
  const result = await ssrEnvNames(templateId, auth.target);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ names: result });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const auth = await authorize(request, templateId);
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with `set` and/or `unset`." }, { status: 400 });
  }
  const change = parseSsrEnvBody(body);
  if (typeof change === "string") return NextResponse.json({ error: change }, { status: 400 });

  const result = await updateSsrEnvironment(templateId, change, auth.target);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ names: result.names });
}
