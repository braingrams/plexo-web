import { CommerceProduct } from "@/lib/db/commerceEntities";

/** What decides which fixes are worth offering: today, whether the site sells products (so product markup applies). Never throws. */
export async function siteFacts(siteId: string): Promise<{ productCount: number }> {
  try {
    const { data } = await CommerceProduct.query.primary({ templateId: siteId }).go({ pages: "all" });
    return { productCount: data.filter((p) => p.active && p.kind === "PHYSICAL").length };
  } catch {
    return { productCount: 0 };
  }
}
