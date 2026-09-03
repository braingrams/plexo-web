import { NextRequest, NextResponse } from "next/server";

import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { getTierFeatures } from "@/lib/subscription";
import { ensureUniqueSlug } from "@/server/slugDynamo";
import { resolveUser } from "@/lib/auth/resolveUser";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { validateRawHtmlContent, RawUploadValidationError, RAW_UPLOAD_DAILY_LIMIT } from "@/server/rawUpload";
import { isTemplateNameTaken } from "@/server/templateNameDynamo";

type TemplateKind = "EMAIL" | "LANDING_PAGE";

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
  kind?: TemplateKind;
  parentId?: string;
  slug?: string;
  htmlContent?: string;
  acceptAup?: boolean;
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
  createdAt?: string;
  updatedAt?: string;
}, pageCount: number): TemplateSummary {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    createdAt: record.createdAt ?? new Date().toISOString(),
    updatedAt: record.updatedAt ?? new Date().toISOString(),
    pageCount,
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
  const { data: all } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
  const roots = all.filter(
    (t) => !t.parentId && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout,
  );
  // Tie-break on createdAt — see app/dashboard/templates/page.tsx's identical comment:
  // the org-backfill migration bumped every template's updatedAt to the same instant, so
  // ties need a secondary sort to avoid arbitrary ordering.
  roots.sort((a, b) => {
    const byUpdated = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    if (byUpdated !== 0) return byUpdated;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  const templates = await Promise.all(
    roots.map(async (t) => {
      const { data: children } = await Template.query.byParent({ parentId: t.id }).go();
      return serializeTemplate(t as { id: string; name: string; kind: TemplateKind; createdAt?: string; updatedAt?: string }, children.length);
    }),
  );

  return NextResponse.json({
    templates,
    plan: resolved.subscriptionPlan,
    tier: getTierFeatures(resolved.subscriptionPlan),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermission(resolved.role, { template: ["create"] });
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
    const { data: parentRecord } = await Template.get({ id: parentId }).go();
    if (!parentRecord || parentRecord.organizationId !== resolved.organizationId) {
      return NextResponse.json({ error: "Parent page not found." }, { status: 404 });
    }
    if (parentRecord.kind !== "LANDING_PAGE") {
      return NextResponse.json({ error: "Only landing pages can have sub-pages." }, { status: 400 });
    }
    parent = { id: parentRecord.id, kind: parentRecord.kind as TemplateKind };
  }

  // A sub-page always belongs to the same landing-page tree as its parent.
  const kind: TemplateKind = parent ? "LANDING_PAGE" : body.kind === "LANDING_PAGE" ? "LANDING_PAGE" : "EMAIL";

  if (await isTemplateNameTaken({ organizationId: resolved.organizationId, parentId, kind, name })) {
    return NextResponse.json(
      { error: parentId ? `This page already has a sub-page named "${name}".` : `You already have a ${kind === "LANDING_PAGE" ? "site" : "email template"} named "${name}".` },
      { status: 409 },
    );
  }

  if (!parentId) {
    // The plan's template limit counts root/home pages only, per kind — a page with
    // five sub-pages still counts as one landing page against this limit, not six.
    const limit = kind === "LANDING_PAGE" ? features.maxLandingPages : features.maxEmailTemplates;
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const count = orgTemplates.filter(
      (t) => !t.parentId && t.kind === kind && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout,
    ).length;
    if (count >= limit) {
      const label = kind === "LANDING_PAGE" ? "landing pages" : "email templates";
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
    const { data: siblings } = await Template.query.byParent({ parentId }).go();
    const lastOrder = siblings.reduce((max, s) => Math.max(max, s.order ?? 0), -1);
    order = lastOrder + 1;
  }

  const rawHtmlContent = typeof body.htmlContent === "string" ? body.htmlContent : null;
  if (rawHtmlContent !== null) {
    if (kind !== "LANDING_PAGE") {
      return NextResponse.json({ error: "htmlContent is only supported for landing pages, not email templates." }, { status: 400 });
    }
    try {
      validateRawHtmlContent(rawHtmlContent);
    } catch (err) {
      if (err instanceof RawUploadValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const { data: user } = await User.get({ id: resolved.userId }).go();
    if (!user?.aupAcceptedAt) {
      if (body.acceptAup !== true) {
        return NextResponse.json({
          error: "You must accept the Acceptable Use Policy before publishing unsanitized HTML.",
          requiresAupAcceptance: true,
          aupUrl: "/legal/acceptable-use",
        }, { status: 403 });
      }
      await User.patch({ id: resolved.userId }).set({ aupAcceptedAt: new Date().toISOString() }).go();
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: orgTemplates } = await Template.query.byOrg({ organizationId: resolved.organizationId }).go({ pages: "all" });
    const recentUploadCount = orgTemplates.filter(
      (t) => t.userId === resolved.userId && t.sourceType === "RAW_UPLOAD" && (t.createdAt ?? "") >= since,
    ).length;
    if (recentUploadCount >= RAW_UPLOAD_DAILY_LIMIT) {
      return NextResponse.json({
        error: `You've reached the raw-upload limit of ${RAW_UPLOAD_DAILY_LIMIT} per 24 hours. Try again later.`,
      }, { status: 429 });
    }
  }

  const id = crypto.randomUUID();
  await Template.create({
    id,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    name,
    kind,
    parentId: parentId ?? undefined,
    slug: slug ?? undefined,
    order,
    ...(rawHtmlContent !== null
      ? { sourceType: "RAW_UPLOAD" as const, designJson: {}, compiledHtml: rawHtmlContent }
      : { designJson: BLANK_TEMPLATE_SHELL, compiledHtml: "" }),
  }).go();

  const { data: template } = await Template.get({ id }).go();
  if (!template) throw new Error(`Template ${id} vanished immediately after being created`);

  return NextResponse.json({ template: serializeTemplate(template as { id: string; name: string; kind: TemplateKind; createdAt?: string; updatedAt?: string }, 0) }, { status: 201 });
}
