import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { CommerceDeliveryMethod } from "@/lib/db/commerceEntities";

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().toUpperCase());
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["update"] });
  if (permissionError) return permissionError;

  const { data: existing } = await CommerceDeliveryMethod.get({ templateId, id }).go();
  if (!existing) return NextResponse.json({ error: "Delivery method not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const { name, type, feeMinor, description, countries, states, estimatedTimeLabel, status, sortOrder } = body;

  if (type !== undefined && type !== "PICKUP" && type !== "COURIER") {
    return NextResponse.json({ error: "type must be PICKUP or COURIER." }, { status: 400 });
  }
  if (feeMinor !== undefined && (typeof feeMinor !== "number" || !Number.isInteger(feeMinor) || feeMinor < 0)) {
    return NextResponse.json({ error: "feeMinor must be a non-negative integer." }, { status: 400 });
  }
  if (status !== undefined && status !== "ACTIVE" && status !== "INACTIVE") {
    return NextResponse.json({ error: "status must be ACTIVE or INACTIVE." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  const toRemove: string[] = [];
  if (typeof name === "string" && name.trim()) data.name = name.trim();
  if (type !== undefined) data.type = type;
  if (typeof feeMinor === "number") data.feeMinor = feeMinor;
  if (description !== undefined) {
    if (typeof description === "string" && description) data.description = description;
    else toRemove.push("description");
  }
  if (countries !== undefined) {
    const normalized = normalizeStringList(countries);
    if (normalized && normalized.length) data.countries = normalized;
    else toRemove.push("countries");
  }
  if (states !== undefined) {
    const normalized = normalizeStringList(states);
    if (normalized && normalized.length) data.states = normalized;
    else toRemove.push("states");
  }
  if (estimatedTimeLabel !== undefined) {
    if (typeof estimatedTimeLabel === "string" && estimatedTimeLabel) data.estimatedTimeLabel = estimatedTimeLabel;
    else toRemove.push("estimatedTimeLabel");
  }
  if (status !== undefined) data.status = status;
  if (typeof sortOrder === "number") data.sortOrder = Math.trunc(sortOrder);

  let patch = CommerceDeliveryMethod.patch({ templateId, id }).set(data);
  if (toRemove.length) patch = patch.remove(toRemove as any);
  await patch.go();
  const { data: method } = await CommerceDeliveryMethod.get({ templateId, id }).go();

  return NextResponse.json({ method });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ templateId: string; id: string }> },
): Promise<NextResponse> {
  const { templateId, id } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["delete"] });
  if (permissionError) return permissionError;

  const { data: existing } = await CommerceDeliveryMethod.get({ templateId, id }).go();
  if (!existing) return NextResponse.json({ error: "Delivery method not found." }, { status: 404 });

  await CommerceDeliveryMethod.remove({ templateId, id }).go();
  return NextResponse.json({ deleted: true });
}
