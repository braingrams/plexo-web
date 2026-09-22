import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { slugify } from "@/server/slugDynamo";
import { CommerceProduct, CommerceCategory } from "@/lib/db/commerceEntities";
import {
  PRODUCT_CSV_FIELDS,
  buildProductRows,
  type ProductCsvField,
} from "@/lib/commerce/csvProductImporter";

async function ensureUniqueProductSlug(
  templateId: string,
  baseInput: string,
  taken: Set<string>,
): Promise<string> {
  const base = slugify(baseInput) || "product";
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

async function resolveCategoryId(
  templateId: string,
  organizationId: string,
  categoryName: string | null,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!categoryName || !categoryName.trim()) return null;
  const name = categoryName.trim();
  const slug = slugify(name) || "category";
  if (cache.has(slug)) return cache.get(slug)!;
  const { data: categories } = await CommerceCategory.query
    .primary({ templateId })
    .go();
  const existing = categories.find((c) => c.slug === slug);
  if (existing) {
    cache.set(slug, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  await CommerceCategory.create({
    id,
    templateId,
    organizationId,
    name,
    slug,
  }).go();
  cache.set(slug, id);
  return id;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
): Promise<NextResponse> {
  const { templateId } = await context.params;
  const resolved = await resolveCommerceAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId, role } = resolved.context;

  const permissionError = requirePermission(role, { commerce: ["create"] });
  if (permissionError) return permissionError;

  const body = await request.json().catch(() => ({}));
  const intent = body?.intent;

  if (intent === "commit") {
    const dataRows = Array.isArray(body.rows)
      ? body.rows.map((r: unknown) =>
          Array.isArray(r) ? r.map((c) => String(c ?? "")) : [],
        )
      : null;
    const rawMapping = body.columnMapping;
    if (!dataRows || !rawMapping || typeof rawMapping !== "object") {
      return NextResponse.json(
        { error: "rows and columnMapping are required." },
        { status: 400 },
      );
    }
    const validKeys = new Set(PRODUCT_CSV_FIELDS.map((f) => f.key));
    const columnMapping: Record<number, ProductCsvField | null> = {};
    for (const [key, value] of Object.entries(
      rawMapping as Record<string, unknown>,
    )) {
      columnMapping[Number(key)] =
        typeof value === "string" && validKeys.has(value as ProductCsvField)
          ? (value as ProductCsvField)
          : null;
    }

    const { data: existingProducts } = await CommerceProduct.query
      .primary({ templateId })
      .go();
    const existingSlugs = new Set(existingProducts.map((p) => p.slug));
    // Best-effort "SKU already in catalog" check: since CommerceProduct has no dedicated
    // SKU attribute, an existing product's slug is treated as its SKU basis (same
    // convention used when minting a fresh slug from a row's SKU below).
    const existingSkus = new Set(
      existingProducts.map((p) => p.slug.toLowerCase()),
    );

    const parsedRows = buildProductRows(dataRows, columnMapping, existingSkus);
    const validRows = parsedRows.filter((r) => r.errors.length === 0);

    const categoryCache = new Map<string, string>();
    const created: string[] = [];
    for (const row of validRows) {
      const productId = randomUUID();
      const slug = await ensureUniqueProductSlug(
        templateId,
        row.sku || row.name,
        existingSlugs,
      );
      const categoryId = await resolveCategoryId(
        templateId,
        organizationId,
        row.category,
        categoryCache,
      );
      await CommerceProduct.create({
        id: productId,
        templateId,
        organizationId,
        categoryId: categoryId ?? undefined,
        name: row.name,
        slug,
        description: row.description ?? undefined,
        kind: row.kind,
        priceMinor: row.priceMinor,
        stockQuantity:
          row.kind === "PHYSICAL" ? (row.stockQuantity ?? 0) : undefined,
        durationMinutes:
          row.kind === "SERVICE" ? (row.durationMinutes ?? 60) : undefined,
        imageUrl: row.imageUrl ?? undefined,
        active: row.active,
      }).go();
      created.push(productId);
    }

    return NextResponse.json({
      importedCount: created.length,
      skippedCount: parsedRows.length - validRows.length,
      rows: parsedRows,
    });
  }

  return NextResponse.json(
    { error: 'intent must be "commit".' },
    { status: 400 },
  );
}
