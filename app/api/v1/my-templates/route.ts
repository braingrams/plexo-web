import { TemplateKind } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { resolveApiKey } from "../_lib/apiKeyAuth";

/**
 * GET /api/v1/my-templates
 *
 * Returns the templates owned by whichever account's API key made this request — this is the
 * exact behavior /api/v1/public-templates used to have before it was split. Used by any caller
 * (a host app's own shared key, or an individual end-user's own linked key) that wants "give me
 * the templates belonging to whoever this key is," as opposed to /api/v1/public-templates, which
 * now means genuinely public/official content regardless of who owns it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveApiKey(request);
    if (!resolved) {
      return NextResponse.json({ error: "A valid, active API key is required (x-api-key or Authorization: Bearer)." }, { status: 401 });
    }
    const { userId: ownerUserId } = resolved;

    // Every template returned below belongs to this same owner, so the real account name only
    // needs fetching once.
    const ownerUser = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { name: true } });
    const ownerName = ownerUser?.name || null;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category"); // "landing-page" | "opt-in-page" | "email"
    const kindParam = searchParams.get("kind"); // "LANDING_PAGE" | "EMAIL"
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const skip = parseInt(searchParams.get("skip") || "0", 10);

    let targetKind: TemplateKind | null = null;
    if (kindParam === "LANDING_PAGE" || kindParam === "EMAIL") {
      targetKind = kindParam as TemplateKind;
    } else if (category === "landing-page" || category === "opt-in-page") {
      targetKind = TemplateKind.LANDING_PAGE;
    } else if (category === "email") {
      targetKind = TemplateKind.EMAIL;
    }

    const dbWhere: any = { parentId: null, userId: ownerUserId };
    if (targetKind) {
      dbWhere.kind = targetKind;
    }

    let dbTemplates: Array<any> = [];
    try {
      dbTemplates = await prisma.template.findMany({
        where: dbWhere,
        orderBy: { updatedAt: "desc" },
        take: limit,
        skip: skip,
        select: {
          id: true,
          name: true,
          kind: true,
          designJson: true,
          compiledHtml: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (dbErr) {
      console.warn("[Plexo Web] DB query for my-templates warning:", dbErr);
    }

    const templates = dbTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      category: t.kind === TemplateKind.LANDING_PAGE ? (category || "landing-page") : "email",
      previewImage: null,
      designJson: t.designJson,
      compiledHtml: t.compiledHtml,
      authorName: ownerName,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      templates,
      total: templates.length,
    });
  } catch (error: any) {
    console.error("[Plexo Web My Templates Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch your templates" }, { status: 500 });
  }
}
