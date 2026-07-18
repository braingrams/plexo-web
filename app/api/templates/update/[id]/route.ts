import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

type UpdateTemplateBody = {
  designJson?: unknown;
  compiledHtml?: string;
};

async function getSessionUser(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function looksLikeTemplateJson(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }

  const body = value.body;
  if (!isObject(body)) {
    return false;
  }

  return Array.isArray(body.rows);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getSessionUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const body = (await request.json().catch(() => ({}))) as UpdateTemplateBody;

  if (!looksLikeTemplateJson(body.designJson)) {
    return NextResponse.json({ error: "Invalid design JSON payload." }, { status: 400 });
  }

  const compiledHtml = typeof body.compiledHtml === "string" ? body.compiledHtml : "";
  const designJson = body.designJson as Prisma.InputJsonValue;

  const existing = await prisma.template.findFirst({
    where: {
      id: params.id,
      userId: user.id,
    },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const updated = await prisma.template.update({
    where: { id: existing.id },
    data: {
      designJson,
      compiledHtml,
    },
    select: {
      id: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    template: {
      id: updated.id,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}
