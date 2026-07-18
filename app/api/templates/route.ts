import { createHash } from "node:crypto";

import { TemplateKind } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { getTierFeatures } from "@/lib/subscription";

type TemplateSummary = {
  id: string;
  name: string;
  kind: TemplateKind;
  createdAt: string;
  updatedAt: string;
};

type CreateTemplateBody = {
  name?: string;
  kind?: "EMAIL" | "LANDING_PAGE";
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
}): TemplateSummary {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
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

  const templates = await prisma.template.findMany({
    where: { userId: resolved.userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      kind: true,
      createdAt: true,
      updatedAt: true,
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

  // Enforce template limit based on subscription plan
  if (features.maxTemplates !== -1) {
    const count = await prisma.template.count({ where: { userId: resolved.userId } });
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

  const kind = body.kind === "LANDING_PAGE" ? TemplateKind.LANDING_PAGE : TemplateKind.EMAIL;

  // Enforce landing page access
  if (kind === TemplateKind.LANDING_PAGE && !features.landingPagesEnabled) {
    return NextResponse.json(
      { error: "Landing page templates require a PRO or ULTRA plan.", plan: resolved.subscriptionPlan },
      { status: 403 },
    );
  }

  const template = await prisma.template.create({
    data: {
      userId: resolved.userId,
      name,
      kind,
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
