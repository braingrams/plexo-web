import { NextRequest, NextResponse } from "next/server";
import { authorizeStrata, readJson, strataFail } from "@/lib/strata/server";
import { sendMediaToStrata } from "@/lib/strata/assets";

type Ctx = { params: Promise<{ id: string }> };

/** Sends images from the site's library to a Strata project. POST { mediaIds: string[] } → { sent, skipped } */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const { id } = await params;
  if (!id || id.length > 200) return NextResponse.json({ error: "That Strata project wasn't found.", kind: "not_found" }, { status: 404 });
  const caller = await authorizeStrata(request, "assets:send", 10);
  if (caller instanceof NextResponse) return caller;
  const body = await readJson(request);
  const mediaIds = Array.isArray(body?.mediaIds) ? body.mediaIds.filter((v): v is string => typeof v === "string") : [];
  if (!mediaIds.length) return NextResponse.json({ error: "Pick at least one image to send.", kind: "invalid" }, { status: 400 });
  try {
    return NextResponse.json(await sendMediaToStrata({ userId: caller.userId, projectId: id, mediaIds }));
  } catch (err) {
    return strataFail(err);
  }
}
