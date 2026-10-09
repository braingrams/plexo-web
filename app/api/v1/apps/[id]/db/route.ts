import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError } from "@/lib/projects/appAccess";
import { ownerContext } from "@/lib/projects/appEnvContext";
import { databaseOverview } from "@/lib/appData/overview";

/** GET ?env=dev|live — tables (columns, keys, relations, policies, row estimates), applied
 * migrations, and security findings with plain-language fixes. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const ctx = await ownerContext(request, id);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json({ env: ctx.env, ...(await databaseOverview(ctx)) });
  } catch (err) {
    return appError(err);
  }
}
