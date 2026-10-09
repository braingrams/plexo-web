import { NextRequest, NextResponse } from "next/server";
import { loadApp } from "@/lib/projects/appAccess";
import { AppRuntimeError } from "@/lib/db/appEntities";

/** GET ?minutes=60 — errors the app's preview reported recently (crashes, failed backend
 *  calls, console errors), newest first and de-duplicated, for the error banner and SOL. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const since = new Date(Date.now() - Math.min(Number(request.nextUrl.searchParams.get("minutes")) || 60, 24 * 60) * 60_000).toISOString();
  const { data } = await AppRuntimeError.query.primary({ templateId: id }).gte({ createdAt: since }).go({ order: "desc", limit: 200 });
  const seen = new Map<string, { kind: string; message: string; stack: string | null; url: string | null; lastAt: string; count: number }>();
  for (const e of data) {
    const key = `${e.kind}:${e.message}`;
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { kind: e.kind, message: e.message, stack: e.stack ?? null, url: e.url ?? null, lastAt: e.createdAt!, count: 1 });
  }
  return NextResponse.json({ errors: [...seen.values()] });
}
