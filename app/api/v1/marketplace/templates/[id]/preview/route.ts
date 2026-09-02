import { NextRequest, NextResponse } from "next/server";

import { Template } from "@/lib/db/contentEntities";

/**
 * GET /api/v1/marketplace/templates/:id/preview
 * Public (no auth) — returns the compiled HTML for a published listing so the
 * marketplace can show a "Preview" before purchase, the same compiledHtml that's
 * rendered on a published domain (app/pub/[domain]/[[...slug]]/route.ts) and already
 * shown decoratively in the dashboard's own template thumbnails.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const { data: template } = await Template.get({ id }).go();

  if (!template || template.marketplaceStatus !== "PUBLISHED") {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  return NextResponse.json({ html: template.compiledHtml ?? "", name: template.name });
}
