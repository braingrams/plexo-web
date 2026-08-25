import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requirePermission } from "@/server/requirePermission";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuth";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "productId is required." }, { status: 400 });

  const product = await prisma.commerceProduct.findFirst({ where: { id: productId, templateId }, select: { id: true } });
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });

  const [rules, exceptions] = await Promise.all([
    prisma.commerceAvailabilityRule.findMany({ where: { productId }, orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] }),
    prisma.commerceAvailabilityException.findMany({ where: { productId }, orderBy: { date: "asc" } }),
  ]);

  return NextResponse.json({ rules, exceptions });
}

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = await requirePermission(request.headers, role, { commerce: ["create"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const { type, productId } = body;

  if (typeof productId !== "string") {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  const product = await prisma.commerceProduct.findFirst({ where: { id: productId, templateId, kind: "SERVICE" }, select: { id: true } });
  if (!product) return NextResponse.json({ error: "Service not found." }, { status: 404 });

  if (type === "rule") {
    const { dayOfWeek, startMinute, endMinute, timezone } = body;
    if (
      typeof dayOfWeek !== "number" || dayOfWeek < 0 || dayOfWeek > 6 ||
      typeof startMinute !== "number" || typeof endMinute !== "number" ||
      startMinute < 0 || endMinute > 24 * 60 || startMinute >= endMinute
    ) {
      return NextResponse.json({ error: "Invalid rule: check day and start/end times." }, { status: 400 });
    }
    const rule = await prisma.commerceAvailabilityRule.create({
      data: {
        templateId,
        organizationId,
        productId,
        dayOfWeek,
        startMinute,
        endMinute,
        timezone: typeof timezone === "string" && timezone ? timezone : "Africa/Lagos",
      },
    });
    return NextResponse.json({ rule }, { status: 201 });
  }

  if (type === "exception") {
    const { date } = body;
    const parsed = typeof date === "string" ? new Date(date) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
    }
    const exception = await prisma.commerceAvailabilityException.upsert({
      where: { productId_date: { productId, date: parsed } },
      create: { templateId, organizationId, productId, date: parsed, closed: true },
      update: { closed: true },
    });
    return NextResponse.json({ exception }, { status: 201 });
  }

  return NextResponse.json({ error: "type must be 'rule' or 'exception'." }, { status: 400 });
}
