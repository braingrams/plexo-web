import { NextRequest, NextResponse } from "next/server";
import { resolveSectionAdmin } from "@/lib/customSections/auth";
import { normalizeSectionTypeInput } from "@/lib/customSections/model";
import { createSectionType, listSectionTypes } from "@/lib/customSections/service";

/**
 * GET /api/v1/templates/:id/section-types — the site's custom section types (Testimonials and FAQ are set up the first
 * time). `:id` can be any page of the site. The editor loads this to fill its "add section" picker.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await resolveSectionAdmin(request, id, false);
  if ("error" in r) return r.error;
  const sectionTypes = await listSectionTypes(r.admin.siteId, r.admin.organizationId);
  return NextResponse.json({ sectionTypes });
}

/**
 * POST /api/v1/templates/:id/section-types — creates a section type.
 * { name, description?, fields: [{ label, type, item?: [...] }], html, defaults? }
 * `html` is the design with {{field}} and {{#list}}…{{/list}} placeholders.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await context.params;
  const r = await resolveSectionAdmin(request, id, true);
  if ("error" in r) return r.error;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = normalizeSectionTypeInput(body);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const sectionType = await createSectionType(r.admin.siteId, r.admin.organizationId, input.value);
  return NextResponse.json({ sectionType }, { status: 201 });
}
