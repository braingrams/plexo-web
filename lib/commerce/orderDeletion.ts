/**
 * Which orders an owner may permanently delete. Pure (no server imports) so the Orders
 * screen, the REST route and the MCP tool all give the same answer from one place.
 *
 * An order is the store's record of a sale, so deletion is for tidying up — test orders,
 * abandoned or declined transfers — not for rewriting history. Two cases stay on record:
 *  - an online order still waiting on the customer's card payment: the payment could land
 *    at any moment, and deleting the order would leave the customer charged with nothing
 *    to show for it (these close on their own shortly if they don't pay);
 *  - a sale processed through Plexo's own payment processing (PLATFORM_PAYSTACK /
 *    PLATFORM_STRIPE): it was credited to the store's Commerce wallet, whose balance and
 *    payouts have to keep reconciling with the orders behind them.
 * Bank-transfer orders and sales through the owner's own Paystack/Stripe account never
 * touch Plexo's wallet, so they're the owner's own record to keep or remove.
 */
export type DeletableOrderFacts = {
  status?: string | null;
  paymentMethod?: string | null;
  paymentProvider?: string | null;
};

export function orderDeleteBlocker(order: DeletableOrderFacts): string | null {
  const status = order.status ?? "PENDING";
  const isBankTransfer = order.paymentMethod === "BANK_TRANSFER";
  if (!isBankTransfer && status === "PENDING") {
    return "This order is still waiting for the customer's card payment, so it can't be deleted yet. It closes by itself shortly if they don't pay — you can delete it then.";
  }
  const throughPlexoWallet = order.paymentProvider === "PLATFORM_PAYSTACK" || order.paymentProvider === "PLATFORM_STRIPE";
  if (!isBankTransfer && throughPlexoWallet && (status === "PAID" || status === "REFUNDED")) {
    return "This sale went through Plexo's payment processing and is part of your Commerce wallet balance, so it has to stay on record. If it needs reversing, refund it instead.";
  }
  return null;
}
