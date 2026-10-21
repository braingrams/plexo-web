import { NextRequest, NextResponse } from "next/server";
import { authorizeStrata, readJson, strataFail } from "@/lib/strata/server";
import { importStrataAssets } from "@/lib/strata/assets";

type Ctx = { params: Promise<{ id: string }> };

/** Adds Strata assets to the site's images by link. POST { ids: string[] } → { added } */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!id || id.length > 200) return NextResponse.json({ error: "That Strata project wasn't found.", kind: "not_found" }, { status: 404 });
  const caller = await authorizeStrata(request, "assets:import", 30);
  if (caller instanceof NextResponse) return caller;
  const body = await readJson(request);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is string => typeof v === "string").slice(0, 200) : [];
  if (!ids.length) return NextResponse.json({ error: "Pick at least one picture or video to add.", kind: "invalid" }, { status: 400 });
  try {
    return NextResponse.json(await importStrataAssets({ userId: caller.userId, organizationId: caller.organizationId, projectId: id, ids }));
  } catch (err) {
    return strataFail(err);
  }
}
