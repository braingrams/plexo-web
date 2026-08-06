import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveBlogAdminSite } from "@/lib/blog/adminAuth";
import { FONT_PRESET_OPTIONS } from "@/lib/pub/blogTheme";

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const VALID_FONT_PRESETS = new Set(FONT_PRESET_OPTIONS.map((o) => o.value));

type PatchBody = {
  enabled?: boolean;
  title?: string;
  description?: string | null;
  postsPerPage?: number;
  showOnHomepage?: boolean;
  accentColor?: string | null;
  fontPreset?: string;
  logoUrl?: string | null;
  headerImageUrl?: string | null;
  commentsEnabled?: boolean;
};

const DEFAULT_SITE = {
  enabled: false,
  title: "Blog",
  description: null,
  postsPerPage: 10,
  showOnHomepage: false,
  accentColor: null,
  fontPreset: "sans",
  logoUrl: null,
  headerImageUrl: null,
  commentsEnabled: true,
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const site = await prisma.blogSite.findUnique({ where: { templateId: resolved.context.templateId } });
  return NextResponse.json({ site: site ?? { templateId: resolved.context.templateId, ...DEFAULT_SITE } });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveBlogAdminSite(request, templateId);
  if ("error" in resolved) return resolved.error;

  const permissionError = await requirePermission(request.headers, resolved.context.role, { blog: ["update"] });
  if (permissionError) return permissionError;

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const data: Record<string, unknown> = {};
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "Blog title can't be empty." }, { status: 400 });
    data.title = title;
  }
  if (body.description !== undefined) data.description = body.description?.trim() || null;
  if (body.postsPerPage !== undefined) {
    if (!Number.isInteger(body.postsPerPage) || body.postsPerPage < 1 || body.postsPerPage > 50) {
      return NextResponse.json({ error: "Posts per page must be between 1 and 50." }, { status: 400 });
    }
    data.postsPerPage = body.postsPerPage;
  }
  if (body.showOnHomepage !== undefined) data.showOnHomepage = Boolean(body.showOnHomepage);
  if (body.accentColor !== undefined) {
    if (body.accentColor && !HEX_COLOR_REGEX.test(body.accentColor)) {
      return NextResponse.json({ error: "Accent color must be a hex value like #6d28d9." }, { status: 400 });
    }
    data.accentColor = body.accentColor || null;
  }
  if (body.fontPreset !== undefined) {
    if (!VALID_FONT_PRESETS.has(body.fontPreset)) {
      return NextResponse.json({ error: "Unrecognized font choice." }, { status: 400 });
    }
    data.fontPreset = body.fontPreset;
  }
  if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl || null;
  if (body.headerImageUrl !== undefined) data.headerImageUrl = body.headerImageUrl || null;
  if (body.commentsEnabled !== undefined) data.commentsEnabled = Boolean(body.commentsEnabled);

  const site = await prisma.blogSite.upsert({
    where: { templateId: resolved.context.templateId },
    create: { templateId: resolved.context.templateId, ...data },
    update: data,
  });

  return NextResponse.json({ site });
}
