import { prisma } from "@/server/prisma";

function formatNaira(minor: number): string {
  return `₦${(minor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatTile({ label, value, tint, icon }: { label: string; value: string; tint: string; icon: React.ReactNode }) {
  return (
    <div style={{
      flex: 1,
      minWidth: 150,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 14,
      padding: "1rem 1.1rem",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "0.75rem",
    }}>
      <div>
        <div style={{ fontSize: "1.5rem", fontWeight: 600, color: "#f0f2ff", fontVariantNumeric: "tabular-nums" }}>{value}</div>
        <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", marginTop: 2 }}>{label}</div>
      </div>
      <div style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        background: tint, display: "grid", placeItems: "center",
      }}>
        {icon}
      </div>
    </div>
  );
}

// Real Overview, scoped to this one site (see the layout for the ownership check) — stat
// tiles and the orders list are honest about being empty until checkout (step 2) exists;
// this page starts reading real data on day one rather than shipping fake numbers now.
export default async function CommerceOverviewPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;

  const [productCount, orderCount, salesTotal, upcomingBookingCount, lowStockCount, recentOrders] = await Promise.all([
    prisma.commerceProduct.count({ where: { templateId, active: true } }),
    prisma.commerceOrder.count({ where: { templateId, status: "PAID" } }),
    prisma.commerceOrder.aggregate({ where: { templateId, status: "PAID" }, _sum: { amountMinor: true } }),
    prisma.commerceBooking.count({
      where: { templateId, status: "CONFIRMED", scheduledStart: { gte: new Date() } },
    }),
    prisma.commerceProduct.count({
      where: { templateId, active: true, kind: "PHYSICAL", stockQuantity: { not: null, lte: 5 } },
    }),
    prisma.commerceOrder.findMany({
      where: { templateId, status: "PAID" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { orderNumber: true, customerName: true, customerEmail: true, amountMinor: true, fulfillmentStatus: true, createdAt: true },
    }),
  ]);

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>Commerce</h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginTop: 4 }}>
          Products, bookings, and orders for this site.
        </p>
      </div>

      {lowStockCount > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: "0.6rem",
          background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)",
          borderRadius: 12, padding: "0.7rem 1rem", marginBottom: "1.25rem",
          fontSize: "0.83rem", color: "#fbbf24",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>
          {lowStockCount} product{lowStockCount === 1 ? "" : "s"} running low on stock.
        </div>
      )}

      <div style={{ display: "flex", gap: "0.85rem", flexWrap: "wrap", marginBottom: "1.75rem" }}>
        <StatTile
          label="Products"
          value={String(productCount)}
          tint="rgba(139,92,246,0.16)"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.8"><path d="M3 9l2-5h14l2 5" /><path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" /></svg>}
        />
        <StatTile
          label="Orders"
          value={String(orderCount)}
          tint="rgba(96,165,250,0.16)"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /></svg>}
        />
        <StatTile
          label="Total sales"
          value={formatNaira(salesTotal._sum.amountMinor ?? 0)}
          tint="rgba(52,211,153,0.16)"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="1.8"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
        />
        <StatTile
          label="Upcoming bookings"
          value={String(upcomingBookingCount)}
          tint="rgba(251,191,36,0.16)"
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.8"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>}
        />
      </div>

      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        padding: "1.25rem 1.4rem",
      }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.9rem" }}>Recent orders</div>

        {recentOrders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "rgba(240,242,255,0.4)" }}>
            <p style={{ fontSize: "0.85rem", margin: 0 }}>
              No orders yet — they'll show up here once checkout is live and someone pays.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ color: "rgba(240,242,255,0.4)", textAlign: "left" }}>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Order</th>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Customer</th>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Total</th>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Fulfillment</th>
                  <th style={{ fontWeight: 500, paddingBottom: 8 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.orderNumber} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5" }}>
                    <td style={{ padding: "10px 0", fontFamily: "ui-monospace, monospace" }}>{order.orderNumber}</td>
                    <td style={{ padding: "10px 0" }}>{order.customerName ?? order.customerEmail}</td>
                    <td style={{ padding: "10px 0", fontFamily: "ui-monospace, monospace" }}>{formatNaira(order.amountMinor)}</td>
                    <td style={{ padding: "10px 0", color: "rgba(240,242,255,0.55)" }}>{order.fulfillmentStatus.replace(/_/g, " ").toLowerCase()}</td>
                    <td style={{ padding: "10px 0", color: "rgba(240,242,255,0.4)" }}>{order.createdAt.toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
