import { TemplateKind } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { getTierFeatures } from "@/lib/subscription";
import { ensureUniqueSlug } from "@/server/slug";
import { resolveUser } from "@/app/api/v1/domains/route";
import { requirePermission } from "@/server/requirePermission";

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Sub-pages (parentId set) are managed inside their parent's editor via the Pages panel,
  // not listed as their own top-level dashboard entries. Marketplace listing clones
  // (marketplaceStatus set) are a separate concept from the seller's own working
  // templates — they live in /dashboard/marketplace/listings instead of cluttering this
  // list with a second, non-editable-in-the-same-way copy of the same content.
  const templates = await prisma.template.findMany({
    where: { organizationId: resolved.organizationId, parentId: null, marketplaceStatus: null, isBlogLayout: false },
    // Tie-break on createdAt — see app/dashboard/templates/page.tsx's identical comment:
    // the org-backfill migration's updateMany bumped every template's updatedAt to the
    // same instant via Prisma's @updatedAt, so ties need a secondary sort to avoid
    // arbitrary ordering.
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
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

  const permissionError = await requirePermission(request.headers, resolved.role, { template: ["create"] });
  if (permissionError) return permissionError;

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
      where: { id: parentId, organizationId: resolved.organizationId },
      select: { id: true, kind: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Parent page not found." }, { status: 404 });
    }
    if (parent.kind !== TemplateKind.LANDING_PAGE) {
      return NextResponse.json({ error: "Only landing pages can have sub-pages." }, { status: 400 });
    }
  }

  // A sub-page always belongs to the same landing-page tree as its parent.
  const kind = parent ? TemplateKind.LANDING_PAGE : (body.kind === "LANDING_PAGE" ? TemplateKind.LANDING_PAGE : TemplateKind.EMAIL);

  if (!parentId) {
    // The plan's template limit counts root/home pages only, per kind — a page with
    // five sub-pages still counts as one landing page against this limit, not six.
    const limit = kind === TemplateKind.LANDING_PAGE ? features.maxLandingPages : features.maxEmailTemplates;
    const count = await prisma.template.count({ where: { organizationId: resolved.organizationId, parentId: null, kind, isBlogLayout: false } });
    if (count >= limit) {
      const label = kind === TemplateKind.LANDING_PAGE ? "landing pages" : "email templates";
      return NextResponse.json(
        {
          error: `Your plan allows a maximum of ${limit} ${label}. Upgrade to create more.`,
          plan: resolved.subscriptionPlan,
        },
        { status: 403 },
      );
    }
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
      organizationId: resolved.organizationId,
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
