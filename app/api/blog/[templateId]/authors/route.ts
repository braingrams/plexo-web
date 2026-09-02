import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { BlogAuthor } from "@/lib/db/contentEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuthDynamo";
import { generateUniqueAuthorSlug } from "@/lib/blog/authorsDynamo";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const { data: authors } = await BlogAuthor.query.primary({ templateId: resolved.context.templateId }).go();
  authors.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ authors });
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

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    avatarUrl?: string;
    bio?: string;
    userId?: string | null;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Author name is required." }, { status: 400 });

  const slug = await generateUniqueAuthorSlug(resolved.context.templateId, name);

  const id = randomUUID();
  await BlogAuthor.create({
    id,
    templateId: resolved.context.templateId,
    name,
    slug,
    avatarUrl: body.avatarUrl?.trim() || undefined,
    bio: body.bio?.trim() || undefined,
    // A guest byline (no login) when omitted — WordPress supports attributing a post
    // to an author who never signs in, common for imported/ghost-written content.
    userId: body.userId || undefined,
  }).go();
  const { data: author } = await BlogAuthor.get({ templateId: resolved.context.templateId, slug }).go();
  return NextResponse.json({ author }, { status: 201 });
}
