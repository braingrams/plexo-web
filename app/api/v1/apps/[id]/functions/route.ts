import { NextRequest, NextResponse } from "next/server";
import { loadApp } from "@/lib/projects/appAccess";
import { AppFunction } from "@/lib/db/appEntities";

/** GET — the app's deployed server functions, per environment. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const { data } = await AppFunction.query.primary({ templateId: id }).go({ pages: "all" });
  return NextResponse.json({
    functions: data.map((f) => ({ name: f.name, env: f.env, status: f.status, statusMessage: f.statusMessage ?? null, schedule: f.schedule ?? null, deployedAt: f.deployedAt ?? null, buildId: f.buildId ?? null })),
  });
}
