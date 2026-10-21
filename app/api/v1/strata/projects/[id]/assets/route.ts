import { NextRequest, NextResponse } from "next/server";
import { authorizeStrata, strataFail } from "@/lib/strata/server";
import { listStrataAssets } from "@/lib/strata/assets";

type Ctx = { params: Promise<{ id: string }> };

/** The pictures and videos in one Strata project. GET → { assets: [{ id, name, kind, url, type?, role?, mimeType? }] } */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!id || id.length > 200) return NextResponse.json({ error: "That Strata project wasn't found.", kind: "not_found" }, { status: 404 });
  const caller = await authorizeStrata(request, "assets", 120);
  if (caller instanceof NextResponse) return caller;
  try {
    return NextResponse.json({ assets: await listStrataAssets(caller.userId, id) });
  } catch (err) {
    return strataFail(err);
  }
}
