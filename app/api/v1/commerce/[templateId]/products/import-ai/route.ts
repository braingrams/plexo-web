import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { resolveCommerceAdmin } from "@/lib/commerce/adminAuthDynamo";
import { slugify } from "@/server/slugDynamo";
import { resolveSystemProvider } from "@/lib/ai/systemProvider";
import { resolveModel } from "@/lib/ai/modelRegistry";
import * as anthropicProvider from "@/lib/ai/providers/anthropic";
import * as bedrockProvider from "@/lib/ai/providers/bedrockClaude";
import * as geminiProvider from "@/lib/ai/providers/gemini";
import * as openaiProvider from "@/lib/ai/providers/openai";
import type { AiProvider } from "@/lib/ai/types";
import { CommerceProduct, CommerceCategory } from "@/lib/db/commerceEntities";
import {
  PRODUCT_CSV_FIELDS,
  buildProductRows,
  parseCsvText,
  type ProductCsvField,
} from "@/lib/commerce/csvProductImporter";

// Same small local dispatcher as the (now AI-free) standard import route used to have —
// kept local here rather than shared since this is the only remaining AI-import call site.
async function callProvider(
  provider: AiProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  attachments?: Array<{ mediaType: string; data: string; name?: string }>,
) {
  const params = {
    model,
    apiKey,
    systemPrompt,
    userPrompt,
    maxTokens,
    attachments,
  };
  switch (provider) {
    case "anthropic_claude":
      return anthropicProvider.generate(params);
    case "openai":
      return openaiProvider.generate(params);
    case "google_gemini":
      return geminiProvider.generate(params);
    case "bedrock_claude":
      return bedrockProvider.generate(params);
    default:
      throw new Error(`Unsupported AI provider: ${provider satisfies never}`);
  }
}

function cleanJsonString(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    if (lines[0].startsWith("```")) lines.shift();
    if (lines[lines.length - 1]?.startsWith("```")) lines.pop();
    cleaned = lines.join("\n").trim();
  }
  return cleaned;
}

/** Asks the system AI provider to read a raw source (a CSV dump as text, or a PDF/other
 * file forwarded as a base64 attachment) and align it into the fixed product schema,
 * returning rows already in PRODUCT_CSV_FIELDS order. There is no non-AI fallback here —
 * unlike the standard import's heuristic column matcher, an arbitrary file has no columns
 * to heuristically match, so a configured system AI provider is required for this
 * endpoint. */
async function suggestProductRowsFromSource(
  sourceKind: "csv" | "pdf",
  sourceText: string | null,
  attachment: { mediaType: string; data: string; name?: string } | null,
): Promise<string[][]> {
  const systemProvider = resolveSystemProvider();
  const fieldList = PRODUCT_CSV_FIELDS.map(
    (f) => `"${f.key}" (${f.label}${f.required ? ", required" : ""})`,
  ).join(", ");
  const systemPrompt = `You align raw ${sourceKind === "pdf" ? "product catalog file (read its contents directly)" : "CSV product data"} into a fixed product schema for a bulk import tool. The target fields, in order, are: ${fieldList}. Respond with ONLY a JSON object of this exact shape, no markdown fences, no prose: { "rows": [ ["<sku>", "<name>", "<description>", "<kind: PHYSICAL, SERVICE, or DIGITAL>", "<price, plain number>", "<stockQuantity, plain number or empty>", "<durationMinutes, plain number or empty>", "<category>", "<imageUrl>", "<active: true or false>"] ] }. Each inner array must have exactly ${PRODUCT_CSV_FIELDS.length} string elements in that exact field order (use an empty string "" for unknown/inapplicable fields). One inner array per distinct product found in the source. If a SKU isn't present, derive a short one from the product name.`;
  const userPrompt = attachment
    ? "The product catalog is in the attached file."
    : (sourceText ?? "").slice(0, 20000);

  const model = resolveModel(systemProvider.provider, "MEDIUM");
  // ADD HERE:
  console.log(`[AI Route] Provider: ${systemProvider.provider}, Model: ${model}`);
  const { text, truncated } = await callProvider(
    systemProvider.provider,
    model,
    systemProvider.apiKey,
    systemPrompt,
    userPrompt,
    8000,
    attachment ? [attachment] : undefined,
  );
  if (truncated) {
    throw new Error(
      "The catalog produced too many products for the AI to finish reading in one pass — try splitting the file into smaller batches.",
    );
  }
  let parsed: { rows?: unknown };
  try {
    parsed = JSON.parse(cleanJsonString(text)) as { rows?: unknown };
  } catch {
    throw new Error(
      "The AI's response couldn't be read — try again, or split the file into smaller batches.",
    );
  }
  if (!Array.isArray(parsed.rows)) return [];
  return parsed.rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) =>
      PRODUCT_CSV_FIELDS.map((_, index) => String(row[index] ?? "")),
    );
}

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

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    if (formData.get("intent") !== "suggest_mapping") {
      return NextResponse.json(
        { error: 'intent must be "suggest_mapping" for file uploads.' },
        { status: 400 },
      );
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required." }, { status: 400 });
    }
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    const buffer = Buffer.from(await file.arrayBuffer());

    let sourceText: string | null = null;
    let attachment: { mediaType: string; data: string; name?: string } | null =
      null;
    if (isPdf) {
      attachment = {
        mediaType: "application/pdf",
        data: buffer.toString("base64"),
        name: file.name,
      };
    } else {
      const rows = parseCsvText(buffer.toString("utf-8"));
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "The file appears to be empty." },
          { status: 400 },
        );
      }
      sourceText = rows.map((r) => r.join(",")).join("\n");
    }

    let dataRows: string[][];
    try {
      dataRows = await suggestProductRowsFromSource(
        isPdf ? "pdf" : "csv",
        sourceText,
        attachment,
      );
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "AI import requires a configured system AI provider.",
        },
        { status: 400 },
      );
    }
    if (dataRows.length === 0) {
      return NextResponse.json(
        { error: "The AI couldn't find any products in that file." },
        { status: 400 },
      );
    }

    const headers = PRODUCT_CSV_FIELDS.map((f) => f.label);
    const columnMapping: Record<number, ProductCsvField | null> = {};
    PRODUCT_CSV_FIELDS.forEach((f, index) => {
      columnMapping[index] = f.key;
    });

    return NextResponse.json({ headers, dataRows, columnMapping });
  }

  const body = await request.json().catch(() => ({}));
  if (body?.intent !== "commit") {
    return NextResponse.json(
      { error: 'intent must be "commit".' },
      { status: 400 },
    );
  }

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
