import { createHash } from "node:crypto";

import { TemplateKind } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { getTierFeatures } from "@/lib/subscription";
import { ensureUniqueSlug } from "@/server/slug";

type TemplateSummary = {
  id: string;
  name: string;
  kind: TemplateKind;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
};

type CreateTemplateBody = {
  name?: string;
  kind?: "EMAIL" | "LANDING_PAGE";
  // Present when creating a sub-page from the editor's Pages panel — the
  // new template is nested under this existing LANDING_PAGE template
  // instead of appearing as its own top-level dashboard entry.
  parentId?: string;
  slug?: string;
};

const BLANK_TEMPLATE_SHELL = {
  body: {
    style: {
      background: "#0b0f19",
      padding: "24px",
    },
    rows: [],
  },
};

function serializeTemplate(record: {
  id: string;
  name: string;
  kind: TemplateKind;
  createdAt: Date;
  updatedAt: Date;
  _count?: { pages: number };
}): TemplateSummary {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    pageCount: record._count?.pages ?? 0,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  const trimmed = token.trim();
  return trimmed || null;
}

/**
 * Resolves a user from either:
 *  1. A valid session cookie (browser/internal usage)
 *  2. A Bearer API key in the Authorization header (external API usage)
 *
 * Returns { userId, subscriptionPlan } or null if unauthenticated.
 */
async function resolveUser(
  request: NextRequest,
): Promise<{ userId: string; subscriptionPlan: string } | null> {
  // 1. Try session-based auth first
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, subscriptionPlan: true },
    });
    if (user) return { userId: user.id, subscriptionPlan: user.subscriptionPlan };
  }

  // 2. Fall back to API key Bearer token
  const bearerToken = parseBearerToken(request.headers.get("authorization"));
  if (!bearerToken) return null;

  const hashedKey = sha256(bearerToken);
  const apiKey = await prisma.apiKey.findFirst({
    where: { hashedKey, isActive: true },
    select: {
      userId: true,
      user: { select: { subscriptionPlan: true } },
    },
  });

  if (!apiKey) return null;
  return { userId: apiKey.userId, subscriptionPlan: apiKey.user.subscriptionPlan };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sub-pages (parentId set) are managed inside their parent's editor via
  // the Pages panel, not listed as their own top-level dashboard entries.
  const templates = await prisma.template.findMany({
    where: { userId: resolved.userId, parentId: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      kind: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { pages: true } },
    },
  });

  return NextResponse.json({
    templates: templates.map(serializeTemplate),
    plan: resolved.subscriptionPlan,
    tier: getTierFeatures(resolved.subscriptionPlan),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const features = getTierFeatures(resolved.subscriptionPlan);

  const body = (await request.json().catch(() => ({}))) as CreateTemplateBody;

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "Template name is required." }, { status: 400 });
  }

  const parentId = body.parentId?.trim() || null;
  let parent: { id: string; kind: TemplateKind } | null = null;
  if (parentId) {
    // Multi-page sites are an Ultra feature. A page's sub-pages are unlimited
    // once enabled (see the template-limit check below, which only counts
    // root/home pages) — Ultra-gating is the actual scarcity control here.
    if (!features.multiPageSitesEnabled) {
      return NextResponse.json(
        { error: "Multi-page sites require an Ultra subscription plan.", plan: resolved.subscriptionPlan },
        { status: 403 },
      );
    }
    parent = await prisma.template.findFirst({
      where: { id: parentId, userId: resolved.userId },
      select: { id: true, kind: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Parent page not found." }, { status: 404 });
    }
    if (parent.kind !== TemplateKind.LANDING_PAGE) {
      return NextResponse.json({ error: "Only landing pages can have sub-pages." }, { status: 400 });
    }
  } else if (features.maxTemplates !== -1) {
    // The plan's template limit counts root/home pages only — a page with
    // five sub-pages still counts as one template against this limit, not six.
    const count = await prisma.template.count({ where: { userId: resolved.userId, parentId: null } });
    if (count >= features.maxTemplates) {
      return NextResponse.json(
        {
          error: `Your plan allows a maximum of ${features.maxTemplates} templates. Upgrade to create more.`,
          plan: resolved.subscriptionPlan,
        },
        { status: 403 },
      );
    }
  }

  // A sub-page always belongs to the same landing-page tree as its parent.
  const kind = parent ? TemplateKind.LANDING_PAGE : (body.kind === "LANDING_PAGE" ? TemplateKind.LANDING_PAGE : TemplateKind.EMAIL);

  // Enforce landing page access
  if (kind === TemplateKind.LANDING_PAGE && !features.landingPagesEnabled) {
    return NextResponse.json(
      { error: "Landing page templates require a PRO or ULTRA plan.", plan: resolved.subscriptionPlan },
      { status: 403 },
    );
  }

  let slug: string | null = null;
  let order = 0;
  if (parentId) {
    slug = await ensureUniqueSlug(parentId, body.slug?.trim() || name);
    const lastSibling = await prisma.template.findFirst({
      where: { parentId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    order = (lastSibling?.order ?? -1) + 1;
  }

  const template = await prisma.template.create({
    data: {
      userId: resolved.userId,
      name,
      kind,
      parentId,
      slug,
      order,
      designJson: BLANK_TEMPLATE_SHELL,
      compiledHtml: "",
    },
    select: {
      id: true,
      name: true,
      kind: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ template: serializeTemplate(template) }, { status: 201 });
}
