import { NextRequest, NextResponse } from "next/server";
import { guardSsrSettings } from "@/lib/appFunctions/ssrGuard";
import { listSecrets, setSecret, deleteSecret, SecretError } from "@/lib/appFunctions/secrets";
import { isPublicName } from "@/lib/appFunctions/ssrVariables";
import { resolveUser } from "@/lib/auth/resolveUser";

/**
 * /api/v1/templates/:id/ssr-secrets — the app's secrets (API keys, passwords). Write-only: values
 * are never returned, only a short hint. A secret is fetched by the server when it starts, so a
 * change reaches the site on the server's next cold start. Secrets never go to the build.
 *
 *   GET                        → { secrets: [{ name, scope, hint, updatedAt }] }
 *   PUT  { name, value, scope? }
 *   DELETE ?name=…&scope=…
 */

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;
  return NextResponse.json({ secrets: await listSecrets(templateId) });
}

export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;
  const resolved = await resolveUser(request);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send a JSON object with name and value." }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  // A public-prefixed name ends up in browser JavaScript, so it can't be a secret.
  if (name && isPublicName(name)) {
    return NextResponse.json({ error: `${name} starts with a public prefix, so browsers can read it. Add it as a variable instead.` }, { status: 400 });
  }
  try {
    const saved = await setSecret(templateId, body, resolved?.userId);
    return NextResponse.json({ saved, note: "Takes effect on the server's next cold start." });
  } catch (err) {
    if (err instanceof SecretError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id: templateId } = await params;
  const guard = await guardSsrSettings(request, templateId);
  if ("error" in guard) return guard.error;
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  const scope = url.searchParams.get("scope") ?? "all";
  if (!name || (scope !== "all" && scope !== "dev" && scope !== "live")) return NextResponse.json({ error: "Send name and scope." }, { status: 400 });
  try {
    await deleteSecret(templateId, name, scope);
    return NextResponse.json({ deleted: { name, scope } });
  } catch (err) {
    if (err instanceof SecretError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
