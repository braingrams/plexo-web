import { NextRequest, NextResponse } from "next/server";
import type { EntityItem } from "electrodb";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { resolveApiKey } from "../_lib/apiKeyAuthDynamo";

type TemplateKind = "EMAIL" | "LANDING_PAGE";

/**
 * Bounded scan for every isOfficial template — like Template's marketplaceStatus
 * (see lib/marketplace.ts / contentEntities.ts's own comment), there's no index for
 * "browse platform-wide by isOfficial" (both of Template's GSI slots are spent on the
 * org-scoped dashboard access patterns). Official/curated templates are expected to be a
 * small, admin-curated handful (see PATCH /api/admin/templates/[id]/official), so a
 * cursor-driven `.scan`, filtered in application code, is the same honest v1 answer as
 * app/api/internal/scan-domains/route.ts rather than a speculative new GSI.
 */
async function scanOfficialTemplates(): Promise<EntityItem<typeof Template>[]> {
  const all: EntityItem<typeof Template>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: EntityItem<typeof Template>[]; cursor: string | null } = await Template.scan
      .where(({ isOfficial }, { eq }) => eq(isOfficial, true))
      .go({ cursor });
    all.push(...page.data);
    cursor = page.cursor;
    if (!cursor) break;
  }
  return all;
}

/**
 * GET /api/v1/public-templates
 *
 * Genuinely public, platform-curated templates — Template.isOfficial rows, regardless of who
 * owns them. Still requires a valid API key (any active key works — this isn't scoped to that
 * key's own account, it's just used to authenticate the caller), which is what distinguishes
 * this from /api/v1/my-templates (that one *is* scoped to the calling key's own userId).
 *
 * This route used to return the calling key's own templates plus a handful of designs hardcoded
 * directly in this file (DEFAULT_PUBLIC_TEMPLATES) — neither of those is what "public" should
 * mean. The owner-scoped behavior moved to /api/v1/my-templates; the hardcoded samples were
 * migrated into real isOfficial-tagged Template rows (see prisma/seed.ts) so official templates
 * are a single consistent, curatable, DB-backed concept. Curation happens via
 * PATCH /api/admin/templates/[id]/official (email-allowlisted).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const resolved = await resolveApiKey(request);
    if (!resolved) {
      return NextResponse.json({ error: "A valid, active API key is required (x-api-key or Authorization: Bearer)." }, { status: 401 });
    }

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

    let templates: Array<{
      id: string;
      name: string;
      kind: TemplateKind;
      category: string;
      previewImage: null;
      designJson: unknown;
      compiledHtml: string;
      authorName: string;
      createdAt: string;
      updatedAt: string;
    }> = [];
    try {
      const official = await scanOfficialTemplates();
      let filtered = official.filter((t) => !t.parentId);
      if (targetKind) filtered = filtered.filter((t) => t.kind === targetKind);
      filtered.sort(
        (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      );
      const page = filtered.slice(skip, skip + limit);

      const authorNames = await Promise.all(
        page.map(async (t) => (await User.get({ id: t.userId }).go()).data?.name || "Plexo"),
      );

      templates = page.map((t, i) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        category: t.kind === "LANDING_PAGE" ? (category || "landing-page") : "email",
        previewImage: null,
        designJson: t.designJson,
        compiledHtml: t.compiledHtml,
        authorName: authorNames[i],
        createdAt: t.createdAt ?? new Date().toISOString(),
        updatedAt: t.updatedAt ?? new Date().toISOString(),
      }));
    } catch (dbErr) {
      console.warn("[Plexo Web] DB query for public-templates warning:", dbErr);
    }

    return NextResponse.json({
      success: true,
      templates,
      total: templates.length,
    });
  } catch (error: any) {
    console.error("[Plexo Web Public Templates Error]:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch public templates" }, { status: 500 });
  }
}
