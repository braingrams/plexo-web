import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { generateUniqueAuthorSlug } from "@/lib/blog/authors";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const authors = await prisma.blogAuthor.findMany({
    where: { templateId: resolved.context.templateId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ authors });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
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

  const author = await prisma.blogAuthor.create({
    data: {
      templateId: resolved.context.templateId,
      name,
      slug,
      avatarUrl: body.avatarUrl?.trim() || null,
      bio: body.bio?.trim() || null,
      // A guest byline (no login) when omitted — WordPress supports attributing a post
      // to an author who never signs in, common for imported/ghost-written content.
      userId: body.userId || null,
    },
  });
  return NextResponse.json({ author }, { status: 201 });
}
