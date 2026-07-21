import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { sanitizePlexoPayload } from "@/server/sanitizer";

type UpdateTemplateBody = {
  designJson?: unknown;
  compiledHtml?: string;
};

async function getSessionUser(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
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

  let sanitizedPayload;
  try {
    sanitizedPayload = sanitizePlexoPayload({
      designJson: body.designJson,
      compiledHtml: body.compiledHtml,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Security validation failed." },
      { status: 400 }
    );
  }

  const compiledHtml = sanitizedPayload.compiledHtml;
  const designJson = sanitizedPayload.designJson as Prisma.InputJsonValue;


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
