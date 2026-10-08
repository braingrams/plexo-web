import { randomUUID } from "node:crypto";

// Product options and variants — "a T-shirt in Size S/M/L × Colour Red/Blue", each
// combination with its own price, sale price, SKU, stock and photo. Stored inline on the
// product (CommerceProduct.options / .variants): a product and its variants are always read,
// edited and imported together, and a store's largest products stay far below DynamoDB's
// item size limit (MAX_VARIANTS). Stock for one variant is updated atomically in place —
// see lib/commerce/stock.ts.

export const MAX_OPTIONS = 3;
export const MAX_OPTION_VALUES = 30;
export const MAX_VARIANTS = 100;

export interface ProductOption {
  name: string;
  values: string[];
}

export interface ProductVariant {
  id: string;
  /** Option name → chosen value, e.g. { Size: "M", Colour: "Red" }. */
  options: Record<string, string>;
  priceMinor: number;
  /** The "was" price shown struck through when this variant is on sale. */
  compareAtPriceMinor?: number | null;
  sku?: string | null;
  /** null/undefined = not tracked (always available). */
  stockQuantity?: number | null;
  imageUrl?: string | null;
  active?: boolean;
}

/** The product fields this module reads — any CommerceProduct item satisfies it. */
export interface VariantProductLike {
  name: string;
  priceMinor: number;
  compareAtPriceMinor?: number | null;
  sku?: string | null;
  stockQuantity?: number | null;
  imageUrl?: string | null;
  options?: unknown;
  variants?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The product's options, defensively parsed (the column is schemaless). */
export function productOptions(product: VariantProductLike): ProductOption[] {
  if (!Array.isArray(product.options)) return [];
  return product.options
    .filter(isRecord)
    .map((o) => ({ name: String(o.name ?? "").trim(), values: Array.isArray(o.values) ? o.values.map((v) => String(v).trim()).filter(Boolean) : [] }))
    .filter((o) => o.name && o.values.length > 0);
}

/** The product's variants, defensively parsed. Empty for a simple product. */
export function productVariants(product: VariantProductLike): ProductVariant[] {
  if (!Array.isArray(product.variants)) return [];
  return product.variants
    .filter(isRecord)
    .map((v) => ({
      id: String(v.id ?? ""),
      options: isRecord(v.options) ? Object.fromEntries(Object.entries(v.options).map(([k, val]) => [k, String(val)])) : {},
      priceMinor: Number(v.priceMinor),
      compareAtPriceMinor: v.compareAtPriceMinor == null ? null : Number(v.compareAtPriceMinor),
      sku: v.sku == null ? null : String(v.sku),
      stockQuantity: v.stockQuantity == null ? null : Number(v.stockQuantity),
      imageUrl: v.imageUrl == null ? null : String(v.imageUrl),
      active: v.active !== false,
    }))
    .filter((v) => v.id && Number.isFinite(v.priceMinor));
}

export function hasVariants(product: VariantProductLike): boolean {
  return productVariants(product).length > 0;
}

/** "Size: M / Colour: Red", in the product's own option order. */
export function variantLabel(product: VariantProductLike, variant: ProductVariant): string {
  const order = productOptions(product).map((o) => o.name);
  const names = [...order, ...Object.keys(variant.options).filter((k) => !order.includes(k))];
  return names.filter((n) => variant.options[n]).map((n) => `${n}: ${variant.options[n]}`).join(" / ");
}

/** Cheapest and dearest active variant (or the product's own price). */
export function priceRange(product: VariantProductLike): { minMinor: number; maxMinor: number } {
  const active = productVariants(product).filter((v) => v.active !== false);
  if (active.length === 0) return { minMinor: product.priceMinor, maxMinor: product.priceMinor };
  const prices = active.map((v) => v.priceMinor);
  return { minMinor: Math.min(...prices), maxMinor: Math.max(...prices) };
}

export type Purchasable =
  | {
      ok: true;
      variant: ProductVariant | null;
      unitPriceMinor: number;
      /** null = stock isn't tracked. */
      stockQuantity: number | null;
      /** "Size: M / Colour: Red", or null for a simple product. */
      label: string | null;
      sku: string | null;
      imageUrl: string | null;
    }
  | { ok: false; error: string };

/** What exactly is being bought: the product itself, or one of its variants. */
export function resolvePurchasable(product: VariantProductLike, variantId?: string | null): Purchasable {
  const variants = productVariants(product);
  if (variants.length === 0) {
    return {
      ok: true,
      variant: null,
      unitPriceMinor: product.priceMinor,
      stockQuantity: product.stockQuantity ?? null,
      label: null,
      sku: product.sku ?? null,
      imageUrl: product.imageUrl ?? null,
    };
  }
  if (!variantId) {
    return { ok: false, error: `Please choose ${productOptions(product).map((o) => o.name.toLowerCase()).join(" and ") || "an option"} for ${product.name}.` };
  }
  const variant = variants.find((v) => v.id === variantId);
  if (!variant || variant.active === false) {
    return { ok: false, error: `That option of ${product.name} is no longer available — please choose another.` };
  }
  return {
    ok: true,
    variant,
    unitPriceMinor: variant.priceMinor,
    stockQuantity: variant.stockQuantity ?? null,
    label: variantLabel(product, variant),
    sku: variant.sku ?? product.sku ?? null,
    imageUrl: variant.imageUrl ?? product.imageUrl ?? null,
  };
}

/** Order-line / cart name: "Classic Tee — Size: M / Colour: Red". */
export function lineName(productName: string, label: string | null): string {
  return label ? `${productName} — ${label}` : productName;
}

// ── Admin input ─────────────────────────────────────────────────────────────

export class VariantInputError extends Error {}

function minor(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new VariantInputError(`${field} must be a whole number of the smallest currency unit (e.g. kobo or cents), 0 or more.`);
  return n;
}

/**
 * Validates and normalises options + variants from the dashboard, MCP or an importer.
 * Gives every variant a stable id (kept when the caller passes one back), so carts and
 * orders that point at a variant survive edits to the product.
 */
export function normalizeOptionsAndVariants(
  rawOptions: unknown,
  rawVariants: unknown,
): { options: ProductOption[]; variants: ProductVariant[] } {
  if (rawOptions == null && rawVariants == null) return { options: [], variants: [] };
  const options = productOptions({ name: "", priceMinor: 0, options: rawOptions });
  if (options.length > MAX_OPTIONS) throw new VariantInputError(`A product can have up to ${MAX_OPTIONS} options (e.g. Size, Colour, Material).`);
  const names = new Set<string>();
  for (const o of options) {
    if (names.has(o.name.toLowerCase())) throw new VariantInputError(`The option "${o.name}" is listed twice.`);
    names.add(o.name.toLowerCase());
    if (o.values.length > MAX_OPTION_VALUES) throw new VariantInputError(`"${o.name}" can have up to ${MAX_OPTION_VALUES} values.`);
    if (new Set(o.values.map((v) => v.toLowerCase())).size !== o.values.length) throw new VariantInputError(`"${o.name}" has the same value twice.`);
  }

  const list = Array.isArray(rawVariants) ? rawVariants : [];
  if (options.length === 0 && list.length > 0) throw new VariantInputError("Add at least one option (e.g. Size) before adding variants.");
  if (options.length > 0 && list.length === 0) throw new VariantInputError("Add at least one variant (a combination of options with its price).");
  if (list.length > MAX_VARIANTS) throw new VariantInputError(`A product can have up to ${MAX_VARIANTS} variants.`);

  const seen = new Set<string>();
  const variants: ProductVariant[] = list.map((raw, i) => {
    if (!isRecord(raw)) throw new VariantInputError(`Variant ${i + 1} is not valid.`);
    const chosen = isRecord(raw.options) ? raw.options : {};
    const picked: Record<string, string> = {};
    for (const o of options) {
      const value = String(chosen[o.name] ?? "").trim();
      const match = o.values.find((v) => v.toLowerCase() === value.toLowerCase());
      if (!match) throw new VariantInputError(`Variant ${i + 1} needs a ${o.name} — one of: ${o.values.join(", ")}.`);
      picked[o.name] = match;
    }
    const key = options.map((o) => picked[o.name].toLowerCase()).join("\u0000");
    if (seen.has(key)) throw new VariantInputError(`Two variants are both "${options.map((o) => picked[o.name]).join(" / ")}".`);
    seen.add(key);
    const priceMinor = minor(raw.priceMinor, `Variant ${i + 1} price`);
    const compareAt = raw.compareAtPriceMinor == null || raw.compareAtPriceMinor === "" ? null : minor(raw.compareAtPriceMinor, `Variant ${i + 1} sale "was" price`);
    const stock = raw.stockQuantity == null || raw.stockQuantity === "" ? null : minor(raw.stockQuantity, `Variant ${i + 1} stock`);
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : randomUUID(),
      options: picked,
      priceMinor,
      compareAtPriceMinor: compareAt !== null && compareAt > priceMinor ? compareAt : null,
      sku: typeof raw.sku === "string" && raw.sku.trim() ? raw.sku.trim().slice(0, 100) : null,
      stockQuantity: stock,
      imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.trim() ? raw.imageUrl.trim() : null,
      active: raw.active !== false,
    };
  });
  return { options, variants };
}

/** A sale "was" price only means something above the current price. */
export function normalizeCompareAt(compareAt: unknown, priceMinor: number): number | null {
  if (compareAt == null || compareAt === "") return null;
  const n = minor(compareAt, "The sale \"was\" price");
  return n > priceMinor ? n : null;
}

/** What the public storefront sees — never raw stock counts for variants beyond what the product already exposes. */
export function publicVariantView(product: VariantProductLike) {
  const variants = productVariants(product);
  if (variants.length === 0) return { options: [], variants: [], priceRange: null };
  return {
    options: productOptions(product),
    variants: variants
      .filter((v) => v.active !== false)
      .map((v) => ({
        id: v.id,
        options: v.options,
        priceMinor: v.priceMinor,
        compareAtPriceMinor: v.compareAtPriceMinor ?? null,
        stockQuantity: v.stockQuantity ?? null,
        imageUrl: v.imageUrl ?? null,
        sku: v.sku ?? null,
      })),
    priceRange: priceRange(product),
  };
}

/**
 * Price/stock as a product card shows it: the lowest active variant price ("From ₦5,000"),
 * the matching sale "was" price, and stock summed across variants (null if any variant is
 * untracked) — so a product only reads "Out of stock" when every option is sold out.
 */
export function listingPriceAndStock(product: VariantProductLike): {
  priceMinor: number;
  compareAtPriceMinor: number | null;
  stockQuantity: number | null;
  hasVariants: boolean;
  priceRange: { minMinor: number; maxMinor: number } | null;
} {
  const active = productVariants(product).filter((v) => v.active !== false);
  if (active.length === 0) {
    return {
      priceMinor: product.priceMinor,
      compareAtPriceMinor: product.compareAtPriceMinor != null && product.compareAtPriceMinor > product.priceMinor ? product.compareAtPriceMinor : null,
      stockQuantity: product.stockQuantity ?? null,
      hasVariants: false,
      priceRange: null,
    };
  }
  const cheapest = active.reduce((a, b) => (b.priceMinor < a.priceMinor ? b : a));
  const untracked = active.some((v) => v.stockQuantity == null);
  return {
    priceMinor: cheapest.priceMinor,
    compareAtPriceMinor: cheapest.compareAtPriceMinor ?? null,
    stockQuantity: untracked ? null : active.reduce((sum, v) => sum + Math.max(0, v.stockQuantity ?? 0), 0),
    hasVariants: true,
    priceRange: priceRange(product),
  };
}

/**
 * The catalog fields from a create/update request (dashboard, MCP, importers): sale "was"
 * price, SKU, options/variants. Only fields present in `input` are touched. With variants,
 * the product's own price follows its cheapest variant (so sorting and "From" prices stay
 * right) and its own stock count is dropped (each variant has its own). Throws
 * VariantInputError with an owner-readable message.
 */
export function catalogFieldsFromInput(
  input: { compareAtPriceMinor?: unknown; sku?: unknown; options?: unknown; variants?: unknown },
  ctx: { kind: string; priceMinor: number },
): { set: Record<string, unknown>; remove: string[] } {
  const set: Record<string, unknown> = {};
  const remove: string[] = [];
  if ("sku" in input && input.sku !== undefined) {
    if (typeof input.sku === "string" && input.sku.trim()) set.sku = input.sku.trim().slice(0, 100);
    else remove.push("sku");
  }
  if ("options" in input || "variants" in input) {
    if (ctx.kind === "SERVICE" && Array.isArray(input.variants) && input.variants.length > 0) {
      throw new VariantInputError("Bookable services can't have options — create a separate service for each length or type instead.");
    }
    const { options, variants } = normalizeOptionsAndVariants(input.options ?? null, input.variants ?? null);
    if (variants.length > 0) {
      set.options = options;
      set.variants = variants;
      const priced = variants.filter((v) => v.active !== false);
      set.priceMinor = Math.min(...(priced.length > 0 ? priced : variants).map((v) => v.priceMinor));
      remove.push("stockQuantity");
    } else {
      remove.push("options", "variants");
    }
  }
  if ("compareAtPriceMinor" in input && input.compareAtPriceMinor !== undefined) {
    const price = typeof set.priceMinor === "number" ? set.priceMinor : ctx.priceMinor;
    const compareAt = normalizeCompareAt(input.compareAtPriceMinor, price);
    if (compareAt !== null) set.compareAtPriceMinor = compareAt;
    else remove.push("compareAtPriceMinor");
  }
  return { set, remove };
}
