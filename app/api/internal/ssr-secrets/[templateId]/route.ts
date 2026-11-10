import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppSettings, DeployedApp, type AppEnv } from "@/lib/db/appEntities";
import { resolveSecrets } from "@/lib/appFunctions/secrets";

/**
 * GET /api/internal/ssr-secrets/:templateId?env=dev|live
 * Header: x-plexo-service-key — the environment's service key, which the server function was deployed with.
 *
 * A server-rendered app's function calls this once per cold start to load its secrets into its
 * environment (cdk/lib … lambda/project-build/src/ssrWorker.ts writes the loader). The key must match
 * the stored hash for that environment, so one app's key can't read another app's secrets.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const env: AppEnv = new URL(request.url).searchParams.get("env") === "dev" ? "dev" : "live";
  const provided = request.headers.get("x-plexo-service-key");
  if (!provided) return NextResponse.json({ error: "Missing service key." }, { status: 401 });

  const { data: settings } = await AppSettings.get({ templateId }).go();
  const stored = env === "dev" ? settings?.serviceKeyHashDev : settings?.serviceKeyHashLive;
  const providedHash = createHash("sha256").update(provided).digest("hex");
  const matches = Boolean(stored) && stored!.length === providedHash.length
    && timingSafeEqual(Buffer.from(stored!), Buffer.from(providedHash));
  if (!matches) return NextResponse.json({ error: "That service key isn't valid for this app." }, { status: 401 });

  const { data: app } = await DeployedApp.get({ templateId }).go();
  if (app?.type !== "SSR") return NextResponse.json({ error: "Not a server-rendered app." }, { status: 404 });

  return NextResponse.json({ data: await resolveSecrets(templateId, env) });
}
