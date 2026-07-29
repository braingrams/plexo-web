import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/app/api/v1/domains/route";
import { getPageTree } from "@/server/slug";

/**
 * GET /api/templates/:id/pages
 *
 * Returns the whole page tree that :id belongs to (root + every
 * descendant), regardless of whether :id itself is the root or a page
 * nested somewhere inside it. Powers the editor's Pages panel: it opens on
 * whichever page is currently being edited and needs the full tree to
 * render, not just that one page's direct siblings.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const tree = await getPageTree(resolved.userId, id);
  if (!tree) {
    return NextResponse.json({ error: "Page not found." }, { status: 404 });
  }

  return NextResponse.json({
    rootId: tree.rootId,
    currentId: id,
    pages: tree.pages.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })),
  });
}
