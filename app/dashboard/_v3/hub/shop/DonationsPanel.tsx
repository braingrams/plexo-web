"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, HeartHandshake, Pencil, Plus, Power, Wallet, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Input, Modal, Textarea } from "../../ui";
import { formatMoney } from "@/lib/commerce/formatMoney";
import type { DonationsOverview } from "@/lib/commerce/donations";
import { draftFrom, goalPercent, monthlyStatusWords, newDraft } from "@/lib/commerce/donationForm";
import { paginate } from "@/lib/dashboardV3/productList";
import { shopHref } from "@/lib/dashboardV3/shopSections";
import { useDonations } from "@/app/dashboard/commerce/[templateId]/donations/useDonations";

function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="plx-hub__bar" style={{ marginTop: 12 }}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Newer</Button>
      <span className="plx-small">Page {page} of {pages}</span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Older</Button>
    </div>
  );
}

/** Donations in the hub: your donation forms, how much they've raised, monthly donors and every gift. Same calls as the old page. */
export function DonationsPanel({ templateId, initial }: { templateId: string; initial: DonationsOverview }) {
  const d = useDonations(templateId, initial);
  const { data, draft, setDraft } = d;
  const [donorPage, setDonorPage] = useState(1);
  const [giftPage, setGiftPage] = useState(1);
  const money = (n: number) => formatMoney(n, data.currency);
  const donors = paginate(data.monthlyDonors, donorPage, 10);
  const gifts = paginate(data.recentGifts, giftPage, 10);
  const payments = shopHref(templateId, "settings", "payments");

  const start = (
    <Button leftIcon={<Plus size={18} aria-hidden />} onClick={() => { d.setError(null); setDraft(newDraft()); }}>New donation form</Button>
  );

  return (
    <div className="plx-don">
      {!data.paymentsReady ? (
        <Card tone="tint" padding="lg" className="plx-don__setup">
          <Wallet size={28} aria-hidden style={{ color: "var(--plx-deep)", flex: "none" }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <b>Connect a way to get paid first</b>
            <p className="plx-small" style={{ margin: "4px 0 0" }}>Link Stripe or Paystack to take cards and monthly gifts, or add your bank details for one-off transfers. Until then your donation forms say &ldquo;being set up&rdquo;.</p>
          </div>
          <Link className="plx-btn plx-btn--primary" href={payments}>Set up payments</Link>
        </Card>
      ) : null}
      {d.notice ? <div className="plx-inlinemsg" role="status">{d.notice}</div> : null}

      {data.campaigns.length === 0 ? (
        <EmptyState title="Start taking donations" body="A donation form lets people give once or every month. Make one, then add it to any page, or ask SOL to put it on your page for you." action={start} illustration={<HeartHandshake size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} />
      ) : (
        <>
          <div className="plx-hstats">
            <Card><div className="plx-hstat"><b>{money(data.totals.raisedMinor)}</b><span>Raised so far</span></div></Card>
            <Card><div className="plx-hstat"><b>{data.totals.gifts}</b><span>{data.totals.gifts === 1 ? "Gift" : "Gifts"} from {data.totals.donors} {data.totals.donors === 1 ? "person" : "people"}</span></div></Card>
            <Card><div className="plx-hstat"><b>{data.totals.monthlyDonors}</b><span>Monthly donors ({money(data.totals.monthlyRecurringMinor)} a month)</span></div></Card>
          </div>

          <Card padding="lg">
            <CardHeader title="Your donation forms" action={start} />
            <ul className="plx-don__list">
              {data.campaigns.map((c) => {
                const pct = goalPercent(c.raisedMinor, c.goalAmountMinor);
                return (
                  <li key={c.id} className="plx-don__item" data-off={!c.active || undefined}>
                    <div className="plx-don__top">
                      <b>{c.name}</b>
                      {!c.active ? <Badge>Paused</Badge> : <Badge tone="success">Taking gifts</Badge>}
                    </div>
                    <p className="plx-small" style={{ margin: 0 }}>
                      {c.presetAmounts.map((p) => `${p.label ? `${p.label} ` : ""}${money(p.amountMinor)}`).join(" · ")}
                      {c.allowCustomAmount ? " · any amount" : ""}
                      {c.allowMonthly ? " · monthly giving" : ""}
                    </p>
                    {pct !== null ? (
                      <div>
                        <div className="plx-goal" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} goal`}><span style={{ width: `${pct}%` }} /></div>
                        <span className="plx-small">{money(c.raisedMinor)} of {money(c.goalAmountMinor as number)} ({pct}%)</span>
                      </div>
                    ) : <span className="plx-small">{money(c.raisedMinor)} raised from {c.donationCount} {c.donationCount === 1 ? "gift" : "gifts"}</span>}
                    {c.paymentIssue ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert"><span><b>Gifts aren&apos;t going through:</b> {c.paymentIssue} <Link href={payments} style={{ color: "var(--plx-link)", fontWeight: 700 }}>Check payment settings</Link></span></div> : null}
                    <div className="plx-don__btns">
                      <Button size="sm" variant="secondary" leftIcon={<Pencil size={16} aria-hidden />} onClick={() => { d.setError(null); setDraft(draftFrom(c)); }}>Edit</Button>
                      <Button size="sm" variant="secondary" leftIcon={<Copy size={16} aria-hidden />} onClick={() => d.copyEmbed(c.id)}>{d.copied === c.id ? "Copied" : "Copy code for my page"}</Button>
                      <Button size="sm" variant="ghost" leftIcon={<Power size={16} aria-hidden />} loading={d.busy === c.id} onClick={() => void d.toggleActive(c)}>{c.active ? "Pause" : "Turn back on"}</Button>
                      {data.monthlyReady && c.allowMonthly ? <Button size="sm" variant="ghost" loading={d.busy === `adopt-${c.id}`} onClick={() => void d.adoptDonors(c)}>Bring over my existing monthly donors</Button> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card padding="lg">
            <CardHeader title="Monthly donors" description="Each person's gift is charged again every month until they or you stop it." />
            {data.monthlyDonors.length === 0 ? <p className="plx-small" style={{ marginTop: 12 }}>Nobody gives monthly yet.</p> : (
              <>
                <ul className="plx-money__list">
                  {donors.items.map((s) => (
                    <li key={s.id} className="plx-money__row">
                      <span className="plx-hrow__main"><span className="plx-hrow__title">{s.donorName ?? s.donorEmail}</span><span className="plx-hrow__sub">{s.donorName ? `${s.donorEmail} · ` : ""}{monthlyStatusWords(s.status ?? "", s.chargesCount ?? 0)}</span></span>
                      <b className="plx-hrow__price">{formatMoney(s.amountMinor, s.currency)}/mo</b>
                      {s.status === "ACTIVE" || s.status === "PAST_DUE" ? <Button size="sm" variant="ghost" loading={d.busy === s.id} onClick={() => { if (window.confirm("Stop this donor's monthly gift? They won't be charged again.")) void d.stopGift(s.id); }}>Stop</Button> : null}
                    </li>
                  ))}
                </ul>
                <Pager page={donors.page} pages={donors.pages} onChange={setDonorPage} />
              </>
            )}
          </Card>

          <Card padding="lg">
            <CardHeader title="Recent gifts" description="Gifts also show up in your Orders." />
            {data.recentGifts.length === 0 ? <p className="plx-small" style={{ marginTop: 12 }}>Your first gift will appear here.</p> : (
              <>
                <ul className="plx-money__list">
                  {gifts.items.map((g) => (
                    <li key={g.id} className="plx-money__row">
                      <span className="plx-hrow__main"><span className="plx-hrow__title">{g.donorName ?? g.donorEmail}</span><span className="plx-hrow__sub">{g.campaignName}{g.monthly ? " · monthly" : ""} · {g.status === "REFUNDED" ? "Refunded" : new Date(g.createdAt ?? "").toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</span></span>
                      <b className="plx-hrow__price">{formatMoney(g.amountMinor, g.currency)}</b>
                    </li>
                  ))}
                </ul>
                <Pager page={gifts.page} pages={gifts.pages} onChange={setGiftPage} />
              </>
            )}
          </Card>

          <Card padding="lg">
            <CardHeader title="Where the money goes" />
            <p className="plx-small" style={{ margin: "8px 0 12px" }}>{data.paymentsReady ? "Gifts go to the payment account you connected. Money in your Plexo balance can be taken out under Your money." : "No payment account is connected yet, so gifts can't come in."}</p>
            <div className="plx-don__btns">
              <Link className="plx-btn plx-btn--secondary plx-btn--sm" href={payments}>Payment settings</Link>
              <Link className="plx-btn plx-btn--secondary plx-btn--sm" href={shopHref(templateId, "money")}>Your money</Link>
            </div>
          </Card>
        </>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        width={600}
        closeOnBackdrop={false}
        title={draft?.id ? "Change donation form" : "New donation form"}
        footer={<><Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button><Button loading={d.saving} onClick={() => void d.save()}>{draft?.id ? "Save" : "Make my form"}</Button></>}
      >
        {draft ? (
          <div className="plx-form">
            <Input label="What is it called?" value={draft.name} placeholder="Support our work" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Input label="A line about it" optional value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <section className="plx-pt__sec" aria-label="Suggested amounts">
              <div><b>Suggested amounts ({data.currency})</b><span className="plx-small" style={{ display: "block" }}>People tap one to give. The round button marks the one that&apos;s chosen to start with. Names are optional, like &ldquo;Friend&rdquo;.</span></div>
              {draft.presets.map((p, i) => (
                <div key={i} className="plx-don__preset">
                  <input type="radio" name="plx-default-preset" className="plx-don__radio" checked={draft.defaultPresetIndex === i} onChange={() => setDraft({ ...draft, defaultPresetIndex: i })} aria-label={`Choose amount ${i + 1} to start with`} />
                  <Input label="Amount" hideLabel inputMode="decimal" value={p.amount} placeholder="50" onChange={(e) => setDraft({ ...draft, presets: draft.presets.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                  <Input label="Name" hideLabel placeholder="Name (optional)" value={p.label} onChange={(e) => setDraft({ ...draft, presets: draft.presets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Button variant="ghost" iconOnly aria-label="Remove this amount" onClick={() => setDraft({ ...draft, presets: draft.presets.filter((_, j) => j !== i), defaultPresetIndex: 0 })}><X size={18} aria-hidden /></Button>
                </div>
              ))}
              {draft.presets.length < 8 ? <div><Button size="sm" variant="secondary" leftIcon={<Plus size={16} aria-hidden />} onClick={() => setDraft({ ...draft, presets: [...draft.presets, { label: "", amount: "" }] })}>Add an amount</Button></div> : null}
            </section>
            <label className="plx-toggle"><span><b>Let people type their own amount</b></span><input type="checkbox" className="plx-switch" checked={draft.allowCustomAmount} onChange={(e) => setDraft({ ...draft, allowCustomAmount: e.target.checked })} /></label>
            {draft.allowCustomAmount ? <Input label="Smallest gift you'll take" inputMode="decimal" value={draft.minAmount} onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })} /> : null}
            <label className="plx-toggle"><span><b>Offer monthly giving</b><span className="plx-small" style={{ display: "block" }}>People can choose to give every month.</span></span><input type="checkbox" className="plx-switch" checked={draft.allowMonthly} onChange={(e) => setDraft({ ...draft, allowMonthly: e.target.checked })} /></label>
            {draft.allowMonthly ? <label className="plx-toggle"><span><b>Start on &ldquo;every month&rdquo;</b></span><input type="checkbox" className="plx-switch" checked={draft.defaultFrequency === "MONTHLY"} onChange={(e) => setDraft({ ...draft, defaultFrequency: e.target.checked ? "MONTHLY" : "ONCE" })} /></label> : null}
            <Input label="Your goal" optional help="Shows a progress bar on your form." inputMode="decimal" value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} placeholder="500000" />
            <Textarea label="Thank-you message" optional help="People see this after they give, and in their receipt email." value={draft.thankYouMessage} onChange={(e) => setDraft({ ...draft, thankYouMessage: e.target.value })} />
            <Input label="Button words" optional value={draft.buttonLabel} placeholder="Donate" onChange={(e) => setDraft({ ...draft, buttonLabel: e.target.value })} />
            {d.error ? <p className="plx-field__error" role="alert">{d.error}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
