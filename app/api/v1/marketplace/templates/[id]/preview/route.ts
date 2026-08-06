import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";

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

  const template = await prisma.template.findUnique({
    where: { id },
    select: { marketplaceStatus: true, compiledHtml: true, name: true },
  });

  if (!template || template.marketplaceStatus !== "PUBLISHED") {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  return NextResponse.json({ html: template.compiledHtml ?? "", name: template.name });
}
