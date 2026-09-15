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
  autoDetectColumnMapping,
  buildProductRows,
  type ProductCsvField,
} from "@/lib/commerce/csvProductImporter";

// Mirrors lib/ai/generate.ts's own callProvider dispatch — that one isn't exported, and
// this call shape (plain text-in/JSON-out, no template/element schema) doesn't fit
// generateBuilderAction's AiActionMode contract, so it's kept small and local here instead.
async function callProvider(
  provider: AiProvider,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
) {
  const params = { model, apiKey, systemPrompt, userPrompt, maxTokens };
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

/** Step 1: given raw headers + a few sample rows, ask the system AI provider to suggest a
 * column mapping. Falls back to the cheap heuristic matcher (no error surfaced to the
 * caller) when no system AI provider is configured or the call/parse fails, so the dialog
 * always gets a usable starting mapping. */
async function suggestColumnMapping(
  headers: string[],
  sampleRows: string[][],
): Promise<Record<number, ProductCsvField | null>> {
  const fallback = autoDetectColumnMapping(headers);
  let systemProvider;
  try {
    systemProvider = resolveSystemProvider();
  } catch {
    return fallback;
  }

  const fieldList = PRODUCT_CSV_FIELDS.map(
    (f) => `"${f.key}" (${f.label}${f.required ? ", required" : ""})`,
  ).join(", ");
  const systemPrompt = `You map spreadsheet columns to a fixed product schema for a bulk import tool. The target fields are: ${fieldList}. Given the uploaded file's header row and a few sample data rows, respond with ONLY a JSON object of this exact shape, no markdown fences, no prose: { "mapping": { "<0-based column index>": "<one of the target field keys, or null if the column doesn't match any field>" } }. Every column index present in the input must appear as a key. Never map two different columns to the same field.`;
  const userPrompt = `Headers: ${JSON.stringify(headers)}\n\nSample rows:\n${sampleRows.map((r) => JSON.stringify(r)).join("\n")}`;

  try {
    const model = resolveModel(systemProvider.provider, "BASIC");
    const { text } = await callProvider(
      systemProvider.provider,
      model,
      systemProvider.apiKey,
      systemPrompt,
      userPrompt,
      1000,
    );
    const parsed = JSON.parse(cleanJsonString(text)) as {
      mapping?: Record<string, string | null>;
    };
    if (!parsed.mapping || typeof parsed.mapping !== "object") return fallback;

    const validKeys = new Set(PRODUCT_CSV_FIELDS.map((f) => f.key));
    const mapping: Record<number, ProductCsvField | null> = {};
    const used = new Set<string>();
    headers.forEach((_, index) => {
      const suggested = parsed.mapping?.[String(index)];
      if (
        suggested &&
        validKeys.has(suggested as ProductCsvField) &&
        !used.has(suggested)
      ) {
        mapping[index] = suggested as ProductCsvField;
        used.add(suggested);
      } else {
        mapping[index] =
          fallback[index] && !used.has(fallback[index] as string)
            ? fallback[index]
            : null;
        if (mapping[index]) used.add(mapping[index] as string);
      }
    });
    return mapping;
  } catch {
    return fallback;
  }
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

  if (intent === "suggest_mapping") {
    const headers = Array.isArray(body.headers)
      ? body.headers.map((h: unknown) => String(h ?? ""))
      : null;
    const sampleRows = Array.isArray(body.sampleRows)
      ? body.sampleRows.map((r: unknown) =>
          Array.isArray(r) ? r.map((c) => String(c ?? "")) : [],
        )
      : [];
    if (!headers || headers.length === 0) {
      return NextResponse.json(
        { error: "headers is required." },
        { status: 400 },
      );
    }
    const mapping = await suggestColumnMapping(headers, sampleRows.slice(0, 3));
    return NextResponse.json({ mapping });
  }

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
    { error: 'intent must be "suggest_mapping" or "commit".' },
    { status: 400 },
  );
}
