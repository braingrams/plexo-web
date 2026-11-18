import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";

/** GET /api/analytics/project-count → { count } of the signed-in organisation's top-level projects.
 * Used only to work out is_first_project for create_project, right after a project is saved. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: templates } = await Template.query
    .byOrg({ organizationId: resolved.organizationId })
    .go({ pages: "all", attributes: ["id", "parentId"] });
  const count = templates.filter((t) => !t.parentId).length;
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
