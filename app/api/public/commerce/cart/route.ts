import { NextRequest, NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSite";
import { readCartToken, readCartSnapshot } from "@/lib/commerce/cart";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }

  const snapshot = await readCartSnapshot(siteResult.published.templateId, readCartToken(request));
  return NextResponse.json(snapshot);
}
