import { NextRequest, NextResponse } from "next/server";
import { loadApp, appError } from "@/lib/projects/appAccess";
import { PageView } from "@/lib/db/opsEntities";
import { AppDatabase, AppRuntimeError } from "@/lib/db/appEntities";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { appContextByTemplate } from "@/lib/appRuntime/context";
import { countUsersSince } from "@/lib/appAuth/store";

type Ctx = { params: Promise<{ id: string }> };

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * GET ?since=<ISO> — what happened to the app since the owner last opened it, for the editor's
 * "Since you were last here" strip. Counts stop at 30 days back.
 *   → { visits, problems }            (cheap: page views + the newest build + preview errors)
 *   ?part=signups → { signups | null } (asks the live app's database, only if it already exists —
 *                                       never creates one, so it may wake a paused database)
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  const loaded = await loadApp(request, id);
  if (loaded instanceof NextResponse) return loaded;
  const raw = Date.parse(request.nextUrl.searchParams.get("since") ?? "");
  const since = new Date(Number.isFinite(raw) ? Math.max(raw, Date.now() - MAX_WINDOW_MS) : Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    if (request.nextUrl.searchParams.get("part") === "signups") {
      const { data: db } = await AppDatabase.get({ templateId: id, env: "live" }).go();
      if (!db || db.status !== "READY") return NextResponse.json({ signups: null });
      const ctx = await appContextByTemplate(id, "live");
      return NextResponse.json({ signups: ctx ? await countUsersSince(ctx, since) : null });
    }
    const [views, latest, errors] = await Promise.all([
      PageView.query.primary({ templateId: id }).gt({ createdAt: since }).go({ pages: "all", attributes: ["createdAt"] }),
      ProjectBuild.query.byTemplate({ templateId: id }).go({ order: "desc", limit: 1 }),
      AppRuntimeError.query.primary({ templateId: id }).gt({ createdAt: since }).go({ limit: 200 }),
    ]);
    const distinctErrors = new Set(errors.data.map((e) => `${e.kind}:${e.message}`)).size;
    return NextResponse.json({ since, visits: views.data.length, problems: (latest.data[0]?.status === "FAILED" ? 1 : 0) + distinctErrors });
  } catch (err) {
    return appError(err);
  }
}
