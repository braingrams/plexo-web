import { NextResponse, type NextRequest } from "next/server";
import { appContextByTemplate, type AppContext } from "@/lib/appRuntime/context";
import type { AppEnv } from "@/lib/db/appEntities";

/** The app backend an owner-facing route works on: ?env=dev (preview, the default) or live. */
export async function ownerContext(request: NextRequest, templateId: string): Promise<AppContext | NextResponse> {
  const raw = request.nextUrl.searchParams.get("env") ?? "dev";
  if (raw !== "dev" && raw !== "live") return NextResponse.json({ error: 'env must be "dev" (preview) or "live".' }, { status: 400 });
  const ctx = await appContextByTemplate(templateId, raw as AppEnv);
  return ctx ?? NextResponse.json({ error: "App not found." }, { status: 404 });
}
