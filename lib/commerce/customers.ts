import { CommerceOrder } from "@/lib/db/commerceEntities";

export type CommerceCustomer = {
  email: string;
  name: string | null;
  phone: string | null;
  /** Earliest PAID order's createdAt — when they first became a customer. */
  customerSince: string;
  /** Most recent PAID order's createdAt — for sorting the list by recent activity. */
  lastOrderAt: string;
  orderCount: number;
  totalSpentMinor: number;
  currency: string;
};

export type CommerceCustomerPage = {
  customers: CommerceCustomer[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * Derives "who's paid us" from this site's own CommerceOrder rows — provider-agnostic,
 * unlike the previous implementation (still in lib/paystack.ts's listPaystackCustomers),
 * which called Paystack's own /customer endpoint directly and simply errored out for any
 * site on Stripe (BYO_STRIPE/PLATFORM_STRIPE), since Paystack was never configured for
 * them at all. Every order already carries customerEmail/customerName/customerPhone
 * regardless of which provider processed the payment (see checkoutDynamo.ts — these are
 * captured once at checkout, never re-derived from a provider's own customer object), so
 * aggregating here works identically for every payment provider and, as a real bonus over
 * the old Paystack-only list, surfaces order count and lifetime spend per customer too.
 *
 * Fetches every PAID order for the site and aggregates in memory rather than paginating
 * at the DynamoDB level — the same "occasional admin query, not latency-sensitive" bound
 * CommerceOrder's own byOrderNumber GSI comment already accepts for customer-email search;
 * a storefront's real customer count is small enough for this to stay fast in practice.
 */
export async function resolveCommerceCustomers(
  templateId: string,
  opts: { page?: number; perPage?: number } = {},
): Promise<CommerceCustomerPage> {
  const page = opts.page ?? 1;
  const perPage = opts.perPage ?? 25;

  const { data: orders } = await CommerceOrder.query.primary({ templateId }).go({ pages: "all" });

  const byEmail = new Map<string, CommerceCustomer>();
  for (const order of orders) {
    if (order.status !== "PAID") continue;
    // createdAt/currency are ElectroDB "default"-only attributes (not required:true), so
    // their inferred item type is optional even though checkoutDynamo.ts always sets them
    // — the fallbacks below just satisfy that, they don't reflect real missing data.
    const createdAt = order.createdAt ?? "";
    const currency = order.currency ?? "NGN";
    const existing = byEmail.get(order.customerEmail);
    if (!existing) {
      byEmail.set(order.customerEmail, {
        email: order.customerEmail,
        name: order.customerName ?? null,
        phone: order.customerPhone ?? null,
        customerSince: createdAt,
        lastOrderAt: createdAt,
        orderCount: 1,
        totalSpentMinor: order.amountMinor,
        currency,
      });
      continue;
    }
    existing.orderCount += 1;
    existing.totalSpentMinor += order.amountMinor;
    if (createdAt < existing.customerSince) existing.customerSince = createdAt;
    if (createdAt > existing.lastOrderAt) {
      existing.lastOrderAt = createdAt;
      // Freshest contact info wins — a customer who orders again with an updated
      // name/phone shouldn't be stuck showing whatever they typed the first time.
      if (order.customerName) existing.name = order.customerName;
      if (order.customerPhone) existing.phone = order.customerPhone;
    }
  }

  const all = Array.from(byEmail.values()).sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const start = (page - 1) * perPage;
  const customers = all.slice(start, start + perPage);

  return { customers, total, page, pageCount };
}
