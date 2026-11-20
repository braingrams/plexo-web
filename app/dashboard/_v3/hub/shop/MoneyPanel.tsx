"use client";

import Link from "next/link";
import { ArrowDownToLine, CreditCard, Landmark, Wallet } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal } from "../../ui";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { LEDGER_WORDS, moneyState, moneySummary, timingWords, withdrawalWords } from "@/lib/commerce/walletView";
import { shopHref } from "@/lib/dashboardV3/shopSections";
import { useWallet } from "@/app/dashboard/commerce/[templateId]/wallet/useWallet";
import type { InitialWallet } from "@/app/dashboard/commerce/[templateId]/wallet/WalletClient";

/** "Your money" in the hub: what you've earned, taking it out, and where it came from. Same calls as the old wallet page. */
export function MoneyPanel({ templateId: siteId, initial }: { templateId: string; initial: InitialWallet }) {
  const state = moneyState(initial);
  const w = useWallet(siteId, initial);
  const pages = Math.max(1, Math.ceil(w.ledgerTotal / w.ledgerPaging.pageSize));

  if (state === "off") {
    return (
      <EmptyState
        title="Turn on your shop to get paid"
        body="Switch your shop on and choose how customers pay you. Their money shows up here."
        action={<Link className="plx-btn plx-btn--primary" href={shopHref(siteId, "settings", "general")}>Open shop settings</Link>}
        illustration={<Wallet size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />}
      />
    );
  }
  if (state === "own-keys") {
    return (
      <EmptyState
        title="Your sales go straight to you"
        body="You connected your own payment account, so customers pay you directly and there is nothing to take out here. Want us to hold the money and send it to your bank? Switch to Plexo payments."
        action={<Link className="plx-btn plx-btn--primary" href={shopHref(siteId, "settings", "payments")}>Change how I get paid</Link>}
        illustration={<CreditCard size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />}
      />
    );
  }

  const noMoney = w.balanceCents <= 0;
  const sum = moneySummary(w.balanceCents, w.withdrawals);
  return (
    <div className="plx-money">
      <Card padding="lg" className="plx-money__hero" data-tour="hub-money">
        <div>
          <span className="plx-small" style={{ fontWeight: 600 }}>Ready to take out</span>
          <div className="plx-money__amt">{formatMoney(w.balanceCents, initial.currency)}</div>
          <span className="plx-small">{w.pooled ? "One balance shared by all your sites." : "From this site's sales."}</span>
        </div>
        <Button leftIcon={<ArrowDownToLine size={18} aria-hidden />} disabled={noMoney} onClick={() => w.setShowWithdrawForm(true)}>
          Take money out
        </Button>
      </Card>
      <div className="plx-hstats" data-tour="hub-money-stats">
        <Card><div className="plx-hstat"><b>{formatMoney(sum.pendingCents, initial.currency)}</b><span>{sum.pendingCount ? `Being checked (${sum.pendingCount} ${sum.pendingCount === 1 ? "request" : "requests"})` : "Being checked"}</span></div></Card>
        <Card><div className="plx-hstat"><b>{formatMoney(sum.sentCents, initial.currency)}</b><span>{sum.lastSentAt ? `Sent to your bank. Last one ${new Date(sum.lastSentAt).toLocaleDateString("en", { month: "short", day: "numeric" })}` : "Sent to your bank so far"}</span></div></Card>
      </div>
      {sum.pendingCount ? <div className="plx-inlinemsg" role="status">{timingWords("PENDING")}</div> : null}
      {noMoney && w.ledgerTotal === 0 ? <div className="plx-inlinemsg">When someone buys from you, the money lands here. You can then send it to your bank.</div> : null}
      {w.message ? <div className={`plx-inlinemsg${w.message.kind === "error" ? " plx-inlinemsg--bad" : ""}`} role={w.message.kind === "error" ? "alert" : "status"}>{w.message.text}</div> : null}

      <Card padding="lg">
        <CardHeader title="Money you've taken out" description="Every time you ask for money, it shows here until it reaches your bank." />
        {w.withdrawals.length === 0 ? (
          <p className="plx-small" style={{ marginTop: 12 }}>You haven&apos;t taken any money out yet.</p>
        ) : (
          <ul className="plx-list plx-money__list">
            {w.withdrawals.map((x) => {
              const s = withdrawalWords(x.status);
              return (
                <li key={x.id} className="plx-money__row">
                  <span className="plx-hrow__main">
                    <span className="plx-hrow__title">{formatMoney(x.amountCents, initial.currency)}</span>
                    <span className="plx-hrow__sub">{x.bankName} · {new Date(x.requestedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</span>
                    {x.status !== "PENDING" ? <span className="plx-small">{x.status === "REJECTED" && x.rejectionReason ? `${x.rejectionReason} ` : ""}{timingWords(x.status)}</span> : null}
                  </span>
                  <Badge tone={s.tone}>{s.text}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card padding="lg">
        <CardHeader title="Money in and out" description="Every sale, and every time money left." />
        {w.ledger.length === 0 ? (
          <p className="plx-small" style={{ marginTop: 12 }}>Nothing yet. Your first sale will show up here.</p>
        ) : (
          <>
            <ul className="plx-list plx-money__list">
              {w.ledger.map((e) => (
                <li key={e.id} className="plx-money__row">
                  <span className="plx-hrow__main">
                    <span className="plx-hrow__title">{LEDGER_WORDS[e.type] ?? "Other"}</span>
                    <span className="plx-hrow__sub">{e.description ? `${e.description} · ` : ""}{new Date(e.createdAt).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  </span>
                  <b className="plx-money__delta" data-neg={e.netAmountCents < 0 || undefined}>{e.netAmountCents >= 0 ? "+" : "-"}{formatMoney(Math.abs(e.netAmountCents), initial.currency)}</b>
                </li>
              ))}
            </ul>
            {pages > 1 ? (
              <div className="plx-hub__bar" style={{ marginTop: 12 }}>
                <Button variant="secondary" size="sm" disabled={w.loadingLedger || w.ledgerPaging.page <= 1} onClick={() => void w.loadLedger({ ...w.ledgerPaging, page: w.ledgerPaging.page - 1 })}>Newer</Button>
                <span className="plx-small">Page {w.ledgerPaging.page} of {pages}</span>
                <Button variant="secondary" size="sm" disabled={w.loadingLedger || w.ledgerPaging.page >= pages} onClick={() => void w.loadLedger({ ...w.ledgerPaging, page: w.ledgerPaging.page + 1 })}>Older</Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card padding="lg">
        <label className="plx-toggle">
          <span>
            <b>Keep one balance for all my sites</b>
            <span className="plx-small" style={{ display: "block" }}>Turn on to add up the sales from every site you own, so you take money out once.</span>
          </span>
          <input type="checkbox" className="plx-switch" checked={w.pooled} disabled={w.togglingPooled} onChange={(e) => void w.handleTogglePooled(e.target.checked)} />
        </label>
      </Card>
      <p className="plx-small">
        <Landmark size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Selling templates too? <Link href="/dashboard/marketplace/payouts" style={{ color: "var(--plx-link)", fontWeight: 700 }}>See what you earned from them</Link>.
      </p>

      <Modal open={w.showWithdrawForm} onClose={() => w.setShowWithdrawForm(false)} title="Take money out" description="We'll send it to the bank account you give here. Once you ask, the money is set aside for you straight away." footer={<><Button variant="secondary" onClick={() => w.setShowWithdrawForm(false)}>Cancel</Button><Button loading={w.submitting} onClick={() => void w.handleWithdraw()}>Ask for this money</Button></>}>
        <div className="plx-form">
          <Input label={`How much? (${initial.currency})`} inputMode="decimal" value={w.amount} onChange={(e) => w.setAmount(e.target.value)} placeholder="5000" help={`You can take out up to ${formatMoney(sum.availableCents, initial.currency)}.`} />
          <div><Button size="sm" variant="ghost" onClick={() => w.setAmount(String(sum.takeAllCents / 100))}>Take all of it</Button></div>
          <Input label="Your bank" value={w.bankName} onChange={(e) => w.setBankName(e.target.value)} placeholder="GTBank" autoComplete="off" />
          <Input label="Account number" inputMode="numeric" value={w.accountNumber} onChange={(e) => w.setAccountNumber(e.target.value)} autoComplete="off" />
          <Input label="Name on the account" value={w.accountHolderName} onChange={(e) => w.setAccountHolderName(e.target.value)} autoComplete="off" />
          {w.message?.kind === "error" ? <p className="plx-field__error" role="alert">{w.message.text}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
