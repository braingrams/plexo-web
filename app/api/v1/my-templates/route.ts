import { NextRequest, NextResponse } from "next/server";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { resolveApiKey } from "../_lib/apiKeyAuthDynamo";

type TemplateKind = "EMAIL" | "LANDING_PAGE";

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
    const { userId: ownerUserId, organizationId } = resolved;

    // Every template returned below belongs to this same owner, so the real account name only
    // needs fetching once.
    const { data: ownerUser } = await User.get({ id: ownerUserId }).go();
    const ownerName = ownerUser?.name || null;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category"); // "landing-page" | "opt-in-page" | "email"
    const kindParam = searchParams.get("kind"); // "LANDING_PAGE" | "EMAIL"
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
    const skip = parseInt(searchParams.get("skip") || "0", 10);

    let targetKind: TemplateKind | null = null;
    if (kindParam === "LANDING_PAGE" || kindParam === "EMAIL") {
      targetKind = kindParam;
    } else if (category === "landing-page" || category === "opt-in-page") {
      targetKind = "LANDING_PAGE";
    } else if (category === "email") {
      targetKind = "EMAIL";
    }

    let dbTemplates: Array<{
      id: string;
      name: string;
      kind: TemplateKind;
      designJson: unknown;
      compiledHtml: string;
      createdAt: string;
      updatedAt: string;
    }> = [];
    try {
      // byOrg (GSI1) is the real index here — "this org's templates," newest first
      // (contentEntities.ts). The parentId/isBlogLayout/isSiteLayoutFragment/
      // isCommerceLayout/kind narrowing is filtered in memory over that same
      // partition, same as every other "org's root templates" call site in this
      // migration (e.g. app/api/templates/[id]/convert-type/route.ts).
      const { data: orgTemplates } = await Template.query.byOrg({ organizationId }).go();
      let filtered = orgTemplates.filter(
        (t) => !t.parentId && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout,
      );
      if (targetKind) filtered = filtered.filter((t) => t.kind === targetKind);
      filtered.sort(
        (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
      dbTemplates = filtered.slice(skip, skip + limit).map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        designJson: t.designJson,
        compiledHtml: t.compiledHtml,
        createdAt: t.createdAt ?? new Date().toISOString(),
        updatedAt: t.updatedAt ?? new Date().toISOString(),
      }));
    } catch (dbErr) {
      console.warn("[Plexo Web] DB query for my-templates warning:", dbErr);
    }

    const templates = dbTemplates.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      category: t.kind === "LANDING_PAGE" ? (category || "landing-page") : "email",
      previewImage: null,
      designJson: t.designJson,
      compiledHtml: t.compiledHtml,
      authorName: ownerName,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
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
