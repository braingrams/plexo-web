export type StockFilter = "all" | "in" | "out";

type Filterable = { name: string; kind: string; stockQuantity?: number | null; category?: string | null };

/**
 * The shop's product search: name or category contains the words typed; "Sold out" means a product you
 * ship with zero left, "In stock" is everything else (downloads, services and products with no count never sell out).
 */
export function filterProducts<T extends Filterable>(products: T[], search: string, stock: StockFilter): T[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return products.filter((p) => {
    const hay = `${p.name} ${p.category ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
    if (stock === "all") return true;
    const soldOut = p.kind === "PHYSICAL" && p.stockQuantity != null && p.stockQuantity <= 0;
    return stock === "out" ? soldOut : !soldOut;
  });
}
