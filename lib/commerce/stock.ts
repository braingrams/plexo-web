import { UpdateCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { EntityItem } from "electrodb";

import { docClient } from "@/lib/db/client";
import { CommerceProduct } from "@/lib/db/commerceEntities";
import { productVariants } from "@/lib/commerce/variants";

// Every stock movement in Commerce goes through here, for a simple product or one variant of
// it. A variant's stock lives inside the product item (CommerceProduct.variants[i]), so it's
// updated by list index — with the variant's id in the condition, so an owner reordering or
// removing variants mid-checkout can never move stock on the wrong one — and, when taking
// stock, a "still enough left" condition so two shoppers can't both buy the last one.

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
type Product = EntityItem<typeof CommerceProduct>;

/** The product item's table/key, exactly as ElectroDB addresses it. */
function productKey(templateId: string, productId: string): { TableName: string; Key: Record<string, unknown> } {
  const params = CommerceProduct.get({ templateId, id: productId }).params() as { TableName: string; Key: Record<string, unknown> };
  return { TableName: params.TableName, Key: params.Key };
}

function variantUpdate(product: Product, variantId: string, delta: number, requireAvailable: boolean) {
  // The raw list position (productVariants() skips malformed rows, so its index could differ).
  const rawIndex = Array.isArray(product.variants) ? (product.variants as Array<{ id?: unknown }>).findIndex((v) => v?.id === variantId) : -1;
  if (rawIndex < 0) return null;
  const path = `#v[${rawIndex}].#q`;
  return {
    ...productKey(product.templateId, product.id),
    UpdateExpression: `SET ${path} = ${path} + :delta`,
    ConditionExpression: requireAvailable
      ? `#v[${rawIndex}].#id = :vid AND ${path} >= :need`
      : `#v[${rawIndex}].#id = :vid AND attribute_exists(${path})`,
    ExpressionAttributeNames: { "#v": "variants", "#q": "stockQuantity", "#id": "id" },
    ExpressionAttributeValues: { ":delta": delta, ":vid": variantId, ...(requireAvailable ? { ":need": -delta } : {}) },
  };
}

function isTracked(product: Product, variantId: string | null | undefined): boolean {
  if (variantId) {
    const v = productVariants(product).find((x) => x.id === variantId);
    return v != null && v.stockQuantity != null;
  }
  return product.stockQuantity != null;
}

/**
 * The transaction step that takes `quantity` off the shelf (with an "enough left" check),
 * or null when this product/variant doesn't track stock.
 */
export function takeStockTransactItem(product: Product, variantId: string | null | undefined, quantity: number): TransactItem | null {
  if (!isTracked(product, variantId)) return null;
  if (variantId) {
    const update = variantUpdate(product, variantId, -quantity, true);
    return update ? { Update: update } : null;
  }
  return {
    Update: CommerceProduct.patch({ templateId: product.templateId, id: product.id })
      .add({ stockQuantity: -quantity })
      .where((attr, op) => op.gte(attr.stockQuantity, quantity))
      .params() as unknown as TransactItem["Update"],
  };
}

/**
 * Moves stock outside a checkout transaction: positive puts it back (cancelled/failed/
 * expired order), negative takes it again without an availability check (an expired order
 * that turned out to be paid — the owner is told if it oversold). Best-effort by design:
 * a product deleted since doesn't fail the caller.
 */
export async function adjustStock(templateId: string, productId: string, variantId: string | null | undefined, delta: number): Promise<void> {
  if (!delta || productId.startsWith("donation:")) return;
  const { data: product } = await CommerceProduct.get({ templateId, id: productId }).go();
  if (!product || !isTracked(product, variantId)) return;
  if (variantId) {
    const update = variantUpdate(product, variantId, delta, false);
    if (update) await docClient.send(new UpdateCommand(update)).catch(() => undefined);
    return;
  }
  await CommerceProduct.patch({ templateId, id: productId }).add({ stockQuantity: delta }).go().catch(() => undefined);
}

/** Puts back (delta > 0) or re-takes (delta < 0) the stock of every line of an order. */
export async function adjustStockForOrderItems(
  templateId: string,
  items: Array<{ productId: string; variantId?: string | null; quantity?: number | null }>,
  direction: 1 | -1,
): Promise<void> {
  await Promise.all(items.map((item) => adjustStock(templateId, item.productId, item.variantId, direction * (item.quantity ?? 1))));
}
