import type { Metadata } from "next";
import { PlexoLogo } from "@/app/plexo-logo";
import { Template } from "@/lib/db/contentEntities";
import { CommerceOrder, CommerceOrderItem } from "@/lib/db/commerceEntities";
import { isValidBankTransferToken, orderDeliveryDetails } from "@/lib/commerce/bankTransfer";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { BankTransferConfirmClient } from "./BankTransferConfirmClient";

export const metadata: Metadata = { title: "Confirm bank transfer — Plexo", robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#0b0f19] text-white flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <PlexoLogo size={32} textStyle={{ color: "#ffffff" }} />
        </div>
        <div className="bg-[#0d0f1a] border border-white/10 rounded-2xl p-8">{children}</div>
      </div>
    </main>
  );
}

/**
 * Where the owner's "Confirm payment received" email button lands. Shows the order so
 * they can match it against their bank statement, then asks for an explicit click — the
 * actual change is a POST (app/api/commerce/bank-transfer), never this GET, so an email
 * link-scanner opening the URL can't confirm anything by itself.
 */
export default async function BankTransferConfirmPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const site = one(query.site);
  const orderId = one(query.order);
  const token = one(query.token);
  const { data: order } = site && orderId ? await CommerceOrder.get({ templateId: site, id: orderId }).go() : { data: null };

  if (!order || !isValidBankTransferToken(order, token)) {
    return (
      <Shell>
        <h1 className="text-lg font-bold mb-2 text-center">This link isn&apos;t valid</h1>
        <p className="text-sm text-slate-400 text-center">
          It may have been copied incompletely. You can always confirm bank transfers from Commerce → Orders in your dashboard.
        </p>
      </Shell>
    );
  }

  const [{ data: items }, { data: siteRow }] = await Promise.all([
    CommerceOrderItem.query.primary({ templateId: order.templateId, orderId: order.id }).go(),
    Template.get({ id: order.templateId }).go(),
  ]);
  const amount = formatMoney(order.amountMinor, order.currency ?? "NGN");
  const dashboardUrl = `/dashboard/commerce/${order.templateId}/orders`;

  return (
    <Shell>
      <p className="text-xs uppercase tracking-wider text-slate-500 text-center mb-1">{siteRow?.name ?? "Your store"} · {order.orderNumber}</p>
      <h1 className="text-xl font-bold text-center mb-1">Did {amount} arrive?</h1>
      <p className="text-sm text-slate-400 text-center mb-6">
        {order.customerName || order.customerEmail} says they sent this by bank transfer. Check your bank account before confirming.
      </p>

      <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 mb-6 text-sm">
        {items.map((i) => (
          <div key={i.id} className="flex justify-between py-1 text-slate-300">
            <span>{i.quantity ?? 1}× {i.nameSnapshot}</span>
            <span className="font-mono">{formatMoney(i.unitPriceMinor * (i.quantity ?? 1), order.currency ?? "NGN")}</span>
          </div>
        ))}
        <div className="flex justify-between pt-2 mt-2 border-t border-white/10 font-bold">
          <span>Total</span>
          <span className="font-mono">{amount}</span>
        </div>
        <div className="mt-3 pt-3 border-t border-white/10 space-y-1">
          {[["Customer", order.customerEmail] as [string, string], ...orderDeliveryDetails(order)].map(([k, v]) => (
            <div key={k} className="flex gap-3 text-xs">
              <span className="text-slate-500 w-24 shrink-0">{k}</span>
              <span className="text-slate-300 break-words min-w-0">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <BankTransferConfirmClient
        site={order.templateId}
        orderId={order.id}
        token={token!}
        amount={amount}
        initialStatus={order.status ?? "PENDING"}
        dashboardUrl={dashboardUrl}
      />
    </Shell>
  );
}
