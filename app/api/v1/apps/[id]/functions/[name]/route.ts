import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError } from "@/lib/projects/appAccess";
import { functionLogs, runFunctionNow } from "@/lib/appFunctions/invoke";

type Ctx = { params: Promise<{ id: string; name: string }> };

/** GET ?env&minutes&filter — the function's recent logs (console output, errors).
 *  POST ?env — run it now (as its schedule would), returning its response. */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id, name } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  try {
    const q = request.nextUrl.searchParams;
    const env = q.get("env") === "live" ? "live" : "dev";
    const logs = await functionLogs(id, env, name, { sinceMinutes: Math.min(Number(q.get("minutes")) || 60, 7 * 24 * 60), filter: q.get("filter") ?? undefined });
    return NextResponse.json({ logs });
  } catch (err) {
    return appError(err);
  }
}

export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id, name } = await params;
  const loaded = await loadApp(request, id, "update");
  if (loaded instanceof NextResponse) return loaded;
  try {
    const env = request.nextUrl.searchParams.get("env") === "live" ? "live" : "dev";
    return NextResponse.json(await runFunctionNow(id, env, name));
  } catch (err) {
    return appError(err);
  }
}
