import Link from "next/link";
import { Badge, ButtonLink, Card, CardHeader, EmptyState } from "../ui";
import { DesignsFrame } from "./DesignsFrame";
import { WithdrawalForm } from "./WithdrawalForm";
import { feeSplit, payoutStatus } from "@/lib/dashboardV3/designs";

export type WithdrawalRow = { id: string; amountCents: number; bankName: string; requestedAt: string; processedAt: string | null; status: string; rejectionReason: string | null };
export type LedgerRow = { id: string; description: string; netAmountCents: number };

const money = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

export function PayoutsView({
  balanceCents,
  feeBps,
  withdrawals,
  ledger,
  ledgerTotal,
  page,
  pageSize,
}: {
  balanceCents: number;
  feeBps: number;
  withdrawals: WithdrawalRow[];
  ledger: LedgerRow[];
  ledgerTotal: number;
  page: number;
  pageSize: number;
}) {
  const split = feeSplit(feeBps);
  const pageCount = Math.max(1, Math.ceil(ledgerTotal / pageSize));
  const href = (p: number) => `/dashboard/marketplace/payouts?page=${p}&pageSize=${pageSize}`;
  return (
    <DesignsFrame tab="earnings" title="Earnings" intro="What your designs have earned, and the money you have taken out.">
      <div className="plx-dzstats">
        <Card padding="lg">
          <p className="plx-eyebrow">Ready to take out</p>
          <p className="plx-dzbal">${(balanceCents / 100).toFixed(2)}</p>
          <p className="plx-small" style={{ marginTop: 10 }}>
            You keep {split.keep}% of every sale. Plexo keeps {split.fee}% to run the shop.
          </p>
          <p className="plx-small" style={{ marginTop: 10 }}>
            Selling from your online store? Those earnings are on your store&apos;s page, not here.{" "}
            <Link href="/dashboard/commerce">See store earnings</Link>
          </p>
        </Card>
        <WithdrawalForm availableCents={balanceCents} />
      </div>

      <section className="plx-dzsection" aria-labelledby="dz-wd">
        <h2 className="plx-h2" id="dz-wd">Money you have taken out</h2>
        {withdrawals.length === 0 ? (
          <EmptyState compact title="Nothing taken out yet" body="When you ask for a payment, it is listed here so you can follow it." />
        ) : (
          <div className="plx-dzlist">
            {withdrawals.map((w) => {
              const s = payoutStatus(w.status);
              return (
                <Card key={w.id}>
                  <div className="plx-dzrow">
                    <div className="plx-dzrow__main">
                      <h3 className="plx-dzrow__title">
                        {money(w.amountCents)} to {w.bankName}
                      </h3>
                      <p className="plx-dzrow__meta">
                        Asked on {new Date(w.requestedAt).toLocaleDateString()}
                        {w.processedAt ? ` · Paid on ${new Date(w.processedAt).toLocaleDateString()}` : ""}
                      </p>
                      {w.status === "REJECTED" && w.rejectionReason ? <p className="plx-dzrow__why">{w.rejectionReason}</p> : null}
                    </div>
                    <Badge tone={s.tone} dot>{s.label}</Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="plx-dzsection" aria-labelledby="dz-led">
        <h2 className="plx-h2" id="dz-led">Every sale and payment</h2>
        {ledgerTotal === 0 ? (
          <EmptyState
            compact
            title="No sales yet"
            body="Put a design up for sale and each time someone uses it, you will see it here."
            action={<ButtonLink href="/dashboard/marketplace/sell" variant="secondary">Sell a design</ButtonLink>}
          />
        ) : (
          <Card padding="lg">
            <div className="plx-dzledger">
              {ledger.map((e) => (
                <div key={e.id}>
                  <span>{e.description}</span>
                  <span className="plx-dzamt" data-sign={e.netAmountCents >= 0 ? "plus" : "minus"}>
                    {e.netAmountCents >= 0 ? "+" : "-"}{money(e.netAmountCents)}
                  </span>
                </div>
              ))}
            </div>
            {pageCount > 1 ? (
              <nav className="plx-dzpager" aria-label="More entries" style={{ marginTop: 16 }}>
                <span>Page {page} of {pageCount}</span>
                <div>
                  {page > 1 ? <ButtonLink variant="secondary" size="sm" href={href(page - 1)} scroll={false}>Previous</ButtonLink> : null}
                  {page < pageCount ? <ButtonLink variant="secondary" size="sm" href={href(page + 1)} scroll={false}>Next</ButtonLink> : null}
                </div>
              </nav>
            ) : null}
          </Card>
        )}
      </section>
    </DesignsFrame>
  );
}
