import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { BlogTag } from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { slugify, avoidPageReservedSlug } from "@/server/slugDynamo";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { data: tags } = await BlogTag.query.primary({ templateId: resolved.context.templateId }).go();
  tags.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ tags });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = requirePermission(resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Tag name is required." }, { status: 400 });

  const baseSlug = avoidPageReservedSlug(slugify(name) || "tag", "tag");
  let slug = baseSlug;
  let suffix = 2;
  while ((await BlogTag.get({ templateId: resolved.context.templateId, slug }).go()).data) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const id = randomUUID();
  await BlogTag.create({ id, templateId: resolved.context.templateId, name, slug }).go();
  const { data: tag } = await BlogTag.get({ templateId: resolved.context.templateId, slug }).go();
  return NextResponse.json({ tag }, { status: 201 });
}
