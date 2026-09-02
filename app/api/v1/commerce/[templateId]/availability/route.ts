import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceProduct, CommerceAvailabilityRule, CommerceAvailabilityException } from "@/lib/db/commerceEntities";

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId) return NextResponse.json({ error: "productId is required." }, { status: 400 });

  const { data: product } = await CommerceProduct.get({ templateId, id: productId }).go();
  if (!product) return NextResponse.json({ error: "Product not found." }, { status: 404 });

  const [{ data: rules }, { data: exceptions }] = await Promise.all([
    CommerceAvailabilityRule.query.byProduct({ productId }).go(),
    CommerceAvailabilityException.query.byProduct({ productId }).go(),
  ]);
  rules.sort((a, b) => (a.dayOfWeek - b.dayOfWeek) || (a.startMinute - b.startMinute));
  exceptions.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ rules, exceptions });
}

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["create"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const { type, productId } = body;

  if (typeof productId !== "string") {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  const { data: product } = await CommerceProduct.get({ templateId, id: productId }).go();
  if (!product || product.kind !== "SERVICE") return NextResponse.json({ error: "Service not found." }, { status: 404 });

  if (type === "rule") {
    const { dayOfWeek, startMinute, endMinute, timezone } = body;
    if (
      typeof dayOfWeek !== "number" || dayOfWeek < 0 || dayOfWeek > 6 ||
      typeof startMinute !== "number" || typeof endMinute !== "number" ||
      startMinute < 0 || endMinute > 24 * 60 || startMinute >= endMinute
    ) {
      return NextResponse.json({ error: "Invalid rule: check day and start/end times." }, { status: 400 });
    }
    const id = randomUUID();
    await CommerceAvailabilityRule.create({
      id,
      templateId,
      organizationId,
      productId,
      dayOfWeek,
      startMinute,
      endMinute,
      timezone: typeof timezone === "string" && timezone ? timezone : "Africa/Lagos",
    }).go();
    const { data: rule } = await CommerceAvailabilityRule.get({ templateId, id }).go();
    return NextResponse.json({ rule }, { status: 201 });
  }

  if (type === "exception") {
    const { date } = body;
    const parsed = typeof date === "string" ? new Date(date) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
    }
    const dateIso = parsed.toISOString();

    // No direct (productId, date) key — CommerceAvailabilityException's primary key is
    // (templateId, id); byProduct's GSI sort key is (date, id), so a partial-composite
    // query on just date resolves to this exact upsert target.
    const { data: existingMatches } = await CommerceAvailabilityException.query.byProduct({ productId, date: dateIso }).go();
    const existing = existingMatches[0];
    if (existing) {
      await CommerceAvailabilityException.patch({ templateId, id: existing.id }).set({ closed: true }).go();
      const { data: exception } = await CommerceAvailabilityException.get({ templateId, id: existing.id }).go();
      return NextResponse.json({ exception }, { status: 201 });
    }

    const id = randomUUID();
    await CommerceAvailabilityException.create({ id, templateId, organizationId, productId, date: dateIso, closed: true }).go();
    const { data: exception } = await CommerceAvailabilityException.get({ templateId, id }).go();
    return NextResponse.json({ exception }, { status: 201 });
  }

  return NextResponse.json({ error: "type must be 'rule' or 'exception'." }, { status: 400 });
}
