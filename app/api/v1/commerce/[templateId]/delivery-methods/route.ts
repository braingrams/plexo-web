import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceDeliveryMethod } from "@/lib/db/commerceEntities";

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().toUpperCase());
  return cleaned;
}

export async function GET(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;

  const { data: methods } = await CommerceDeliveryMethod.query.primary({ templateId }).go();
  methods.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return NextResponse.json({ methods });
}

export async function POST(request: NextRequest, context: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["create"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const { name, type, feeMinor, description, countries, states, estimatedTimeLabel, sortOrder } = body;

  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }
  if (type !== "PICKUP" && type !== "COURIER") {
    return NextResponse.json({ error: "type must be PICKUP or COURIER." }, { status: 400 });
  }
  if (feeMinor !== undefined && (typeof feeMinor !== "number" || !Number.isInteger(feeMinor) || feeMinor < 0)) {
    return NextResponse.json({ error: "feeMinor must be a non-negative integer." }, { status: 400 });
  }

  const id = randomUUID();
  await CommerceDeliveryMethod.create({
    id,
    templateId,
    organizationId,
    name: trimmedName,
    type,
    feeMinor: typeof feeMinor === "number" ? feeMinor : 0,
    description: typeof description === "string" && description ? description : undefined,
    countries: normalizeStringList(countries),
    states: normalizeStringList(states),
    estimatedTimeLabel: typeof estimatedTimeLabel === "string" && estimatedTimeLabel ? estimatedTimeLabel : undefined,
    sortOrder: typeof sortOrder === "number" ? Math.trunc(sortOrder) : undefined,
  }).go();
  const { data: method } = await CommerceDeliveryMethod.get({ templateId, id }).go();

  return NextResponse.json({ method }, { status: 201 });
}
