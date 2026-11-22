"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useState } from "react";
import { draftFrom, newDraft } from "@/lib/commerce/donationForm";
import { useDonations } from "./useDonations";
import Link from "next/link";
import { formatMoney } from "@/lib/commerce/formatMoney";
import type { DonationsOverview } from "@/lib/commerce/donations";
import { paginate } from "@/lib/pagination";
import { Pagination } from "../../../_components/Pagination";


const card: React.CSSProperties = { background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 8%, transparent)", borderRadius: 14, padding: "1.2rem 1.4rem" };
const inputStyle: React.CSSProperties = {
  width: "100%", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 4%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)",
  borderRadius: 9, color: "var(--cmx-text, #f0f2ff)", padding: "0.55rem 0.75rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit",
};
const muted: React.CSSProperties = { fontSize: "0.8rem", color: "var(--cmx-muted, rgba(240,242,255,0.5))", margin: 0, lineHeight: 1.6 };
const btn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "0.45rem 0.85rem", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 12%, transparent)",
  background: "transparent", color: "var(--cmx-text, #f0f2ff)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600, textDecoration: "none",
};
const btnPrimary: React.CSSProperties = { ...btn, border: "none", background: "linear-gradient(135deg,var(--brand),var(--cmx-brand-deep, var(--brand-deep)))", color: "var(--cmx-on-brand, #fff)" };

function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--cmx-text, #c5cbe8)", marginBottom: "0.35rem" }}>{label}</span>
      {children}
      {hint && <span style={{ ...muted, display: "block", fontSize: "0.72rem", marginTop: 4 }}>{hint}</span>}
    </label>
  );
}

export function DonationsClient({ templateId, initial }: { templateId: string; initial: DonationsOverview }) {
  const d = useDonations(templateId, initial);
  const { data, draft, setDraft, saving, error, setError, notice, copied, busy, save, toggleActive, adoptDonors, copyEmbed } = d;
  const [donorPaging, setDonorPaging] = useState({ page: 1, pageSize: 25 });
  const [giftPaging, setGiftPaging] = useState({ page: 1, pageSize: 25 });
  const donorsPage = paginate(data.monthlyDonors, donorPaging);
  const giftsPage = paginate(data.recentGifts, giftPaging);
  const money = (minor: number) => formatMoney(minor, data.currency);
  const stopGift = (id: string) => (confirm("Stop this donor's monthly gift? They won't be charged again.") ? d.stopGift(id) : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 750, margin: 0, color: "var(--cmx-text, #f0f2ff)" }}>Donations</h1>
          <p style={muted}>One-time and monthly giving. Donors get a thank-you receipt, and monthly donors can stop their own gift from it.</p>
        </div>
        <button type="button" style={btnPrimary} onClick={() => { setError(null); setDraft(newDraft()); }}>
          + New donation form
        </button>
      </div>

      {!data.paymentsReady && (
        <div style={{ ...card, borderColor: "color-mix(in srgb, var(--cmx-warning, rgb(245,183,74)) 40%, transparent)", background: "color-mix(in srgb, var(--cmx-warning, rgb(245,183,74)) 6%, transparent)" }}>
          <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", fontSize: "0.9rem" }}>Connect a payment account to start receiving donations</p>
          <p style={{ ...muted, marginBottom: 10 }}>Use Stripe or Paystack for card and monthly giving, or add bank details for one-time transfers. Your donate forms show &ldquo;being set up&rdquo; until then.</p>
          <Link href={`/dashboard/commerce/${templateId}/settings/payments`} style={btn}>Set up payments →</Link>
        </div>
      )}
      {notice && <div style={{ ...card, padding: "0.8rem 1rem" }}><p style={{ ...muted, color: "var(--cmx-text, #f0f2ff)" }}>{notice}</p></div>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          [money(data.totals.raisedMinor), "raised"],
          [String(data.totals.gifts), "gifts"],
          [String(data.totals.donors), "donors"],
          [`${data.totals.monthlyDonors} · ${money(data.totals.monthlyRecurringMinor)}/mo`, "monthly donors"],
        ].map(([v, l]) => (
          <div key={l} style={{ ...card, flex: "1 1 160px", padding: "1rem 1.1rem" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 750, color: "var(--cmx-text, #f0f2ff)" }}>{v}</div>
            <div style={muted}>{l}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", margin: "0 0 0.8rem" }}>Donation forms</h2>
        {data.campaigns.length === 0 ? (
          <p style={muted}>No donation forms yet. Create one, then paste its embed code into any page — or add it with the AI builder.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.campaigns.map((c) => (
              <div key={c.id} style={{ border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 7%, transparent)", borderRadius: 10, padding: "0.9rem 1rem", opacity: c.active ? 1 : 0.6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div>
                    <span style={{ fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", fontSize: "0.9rem" }}>{c.name}</span>
                    {!c.active && <span style={{ ...muted, marginLeft: 8 }}>(off)</span>}
                    {c.source?.startsWith("wp-") && <span style={{ ...muted, marginLeft: 8 }}>moved from WordPress</span>}
                  </div>
                  <span style={{ ...muted, color: "var(--cmx-text, #f0f2ff)" }}>
                    {money(c.raisedMinor)}{c.goalAmountMinor ? ` of ${money(c.goalAmountMinor)}` : ""} · {c.donationCount} gifts · {c.monthlyDonors} monthly
                  </span>
                </div>
                {c.paymentIssue && (
                  <div style={{ margin: "8px 0", padding: "8px 10px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--cmx-danger, rgb(248,113,113)) 40%, transparent)", background: "color-mix(in srgb, var(--cmx-danger, rgb(248,113,113)) 7%, transparent)" }}>
                    <p style={{ ...muted, color: "var(--cmx-text, #f0f2ff)" }}>
                      <strong>Donations are failing:</strong> {c.paymentIssue}{" "}
                      <Link href={`/dashboard/commerce/${templateId}/settings/payments`} style={{ color: "var(--cmx-accent, var(--brand))" }}>Payment settings →</Link>
                    </p>
                  </div>
                )}
                <p style={{ ...muted, margin: "4px 0 10px" }}>
                  {c.presetAmounts.map((p) => `${p.label ? `${p.label} ` : ""}${money(p.amountMinor)}`).join(" · ")}
                  {c.allowCustomAmount ? " · any amount" : ""}
                  {c.allowMonthly ? " · monthly giving on" : ""}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" style={btn} onClick={() => { setError(null); setDraft(draftFrom(c)); }}>Edit</button>
                  <button type="button" style={btn} onClick={() => copyEmbed(c.id)}>{copied === c.id ? "Copied ✓" : "Copy embed code"}</button>
                  {data.monthlyReady && c.allowMonthly && (
                    <button type="button" style={btn} disabled={busy === `adopt-${c.id}`} onClick={() => void adoptDonors(c)} title="Find monthly donors already giving through your connected Stripe/Paystack account (e.g. from your old website) and record their gifts here">
                      {busy === `adopt-${c.id}` ? "Checking…" : "Bring over existing monthly donors"}
                    </button>
                  )}
                  <button type="button" style={btn} disabled={busy === c.id} onClick={() => void toggleActive(c)}>{c.active ? "Turn off" : "Turn on"}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", margin: "0 0 0.8rem" }}>Monthly donors</h2>
        {data.monthlyDonors.length === 0 ? (
          <p style={muted}>Nobody gives monthly yet.</p>
        ) : (
          donorsPage.items.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "0.55rem 0", borderTop: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 200px", color: "var(--cmx-text, #f0f2ff)", fontSize: "0.82rem" }}>{s.donorName ?? s.donorEmail}<span style={{ ...muted, marginLeft: 6 }}>{s.donorName ? s.donorEmail : ""}</span></span>
              <span style={{ color: "var(--cmx-text, #f0f2ff)", fontSize: "0.82rem" }}>{formatMoney(s.amountMinor, s.currency)}/mo</span>
              <span style={{ ...muted, minWidth: 110 }}>{s.status === "ACTIVE" ? `${s.chargesCount} payment${s.chargesCount === 1 ? "" : "s"}` : s.status === "PAST_DUE" ? "card declined" : "stopped"}</span>
              {(s.status === "ACTIVE" || s.status === "PAST_DUE") && (
                <button type="button" style={btn} disabled={busy === s.id} onClick={() => void stopGift(s.id)}>{busy === s.id ? "Stopping…" : "Stop"}</button>
              )}
            </div>
          ))
        )}
        <Pagination page={donorsPage.page} pageSize={donorsPage.pageSize} total={donorsPage.total} noun="monthly donors" onChange={setDonorPaging} />
      </div>

      <div style={card}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", margin: "0 0 0.8rem" }}>Gifts</h2>
        {data.recentGifts.length === 0 ? (
          <p style={muted}>Gifts will appear here (and in Orders) as they come in.</p>
        ) : (
          giftsPage.items.map((g) => (
            <div key={g.id} style={{ display: "flex", gap: 12, padding: "0.5rem 0", borderTop: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)", fontSize: "0.82rem", color: "var(--cmx-text, #f0f2ff)", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 200px" }}>{g.donorName ?? g.donorEmail}</span>
              <span style={{ ...muted, flex: "1 1 160px" }}>{g.campaignName}{g.monthly ? " · monthly" : ""}</span>
              <span>{formatMoney(g.amountMinor, g.currency)}</span>
              <span style={{ ...muted, minWidth: 90 }}>{g.status === "REFUNDED" ? "refunded" : new Date(g.createdAt ?? "").toLocaleDateString()}</span>
            </div>
          ))
        )}
        <Pagination page={giftsPage.page} pageSize={giftsPage.pageSize} total={giftsPage.total} noun="gifts" onChange={setGiftPaging} />
      </div>

      {draft && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(5,6,12,0.7)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => { if (e.target === e.currentTarget) setDraft(null); }}>
          <div style={{ ...card, background: "var(--cmx-surface, #11131f)", width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", margin: 0 }}>{draft.id ? "Edit donation form" : "New donation form"}</h2>
            <FieldLabel label="Name"><input style={inputStyle} value={draft.name} placeholder="Support our mission" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></FieldLabel>
            <FieldLabel label="Short description (optional)"><input style={inputStyle} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></FieldLabel>
            <FieldLabel label={`Suggested amounts (${data.currency})`} hint="Optional names show under each amount, like “Gold Friends”. The selected one is pre-chosen for donors.">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {draft.presets.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="radio" name="default-preset" checked={draft.defaultPresetIndex === i} onChange={() => setDraft({ ...draft, defaultPresetIndex: i })} title="Pre-selected" />
                    <input style={{ ...inputStyle, width: 110 }} inputMode="decimal" value={p.amount} onChange={(e) => setDraft({ ...draft, presets: draft.presets.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                    <input style={inputStyle} placeholder="Name (optional)" value={p.label} onChange={(e) => setDraft({ ...draft, presets: draft.presets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <button type="button" style={btn} onClick={() => setDraft({ ...draft, presets: draft.presets.filter((_, j) => j !== i) })} aria-label="Remove amount">✕</button>
                  </div>
                ))}
                {draft.presets.length < 8 && (
                  <button type="button" style={{ ...btn, alignSelf: "flex-start" }} onClick={() => setDraft({ ...draft, presets: [...draft.presets, { label: "", amount: "" }] })}>+ Add amount</button>
                )}
              </div>
            </FieldLabel>
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--cmx-text, #f0f2ff)", fontSize: "0.82rem" }}>
              <input type="checkbox" checked={draft.allowCustomAmount} onChange={(e) => setDraft({ ...draft, allowCustomAmount: e.target.checked })} /> Let donors enter their own amount
            </label>
            {draft.allowCustomAmount && <FieldLabel label="Smallest amount allowed"><input style={{ ...inputStyle, width: 140 }} inputMode="decimal" value={draft.minAmount} onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })} /></FieldLabel>}
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--cmx-text, #f0f2ff)", fontSize: "0.82rem" }}>
              <input type="checkbox" checked={draft.allowMonthly} onChange={(e) => setDraft({ ...draft, allowMonthly: e.target.checked })} /> Offer monthly giving
            </label>
            {draft.allowMonthly && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--cmx-text, #f0f2ff)", fontSize: "0.82rem" }}>
                <input type="checkbox" checked={draft.defaultFrequency === "MONTHLY"} onChange={(e) => setDraft({ ...draft, defaultFrequency: e.target.checked ? "MONTHLY" : "ONCE" })} /> Pre-select monthly
              </label>
            )}
            <FieldLabel label="Fundraising goal (optional)" hint="Shows a progress bar on the form."><input style={{ ...inputStyle, width: 160 }} inputMode="decimal" value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} /></FieldLabel>
            <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--cmx-border, rgba(255,255,255,0.08))", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: "0.86rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)" }}>After payment &amp; receipt emails</div>
              <FieldLabel label="Message shown on page after payment (optional)" hint="Shown in the banner immediately after someone pays.">
                <textarea style={{ ...inputStyle, minHeight: 60 }} placeholder="e.g. Your payment has been received successfully." value={draft.thankYouMessage} onChange={(e) => setDraft({ ...draft, thankYouMessage: e.target.value })} />
              </FieldLabel>
              <FieldLabel label="Email receipt subject (optional)" hint="The subject line of their receipt email.">
                <input style={inputStyle} placeholder="e.g. Thank you for your payment" value={draft.emailSubject} onChange={(e) => setDraft({ ...draft, emailSubject: e.target.value })} />
              </FieldLabel>
              <FieldLabel label="Email receipt message / body (optional)" hint="The personal note or thank-you body inside their receipt email.">
                <textarea style={{ ...inputStyle, minHeight: 70 }} placeholder="e.g. Hi! We've received your payment successfully. Thank you for choosing Charisol. We appreciate your business and look forward to serving you! 😊" value={draft.emailBody} onChange={(e) => setDraft({ ...draft, emailBody: e.target.value })} />
              </FieldLabel>
            </div>
            <FieldLabel label="Button text (optional)"><input style={{ ...inputStyle, width: 200 }} placeholder="e.g. MAKE PAYMENT or Donate" value={draft.buttonLabel} onChange={(e) => setDraft({ ...draft, buttonLabel: e.target.value })} /></FieldLabel>
            {error && <GateOrError error={error}><p style={{ ...muted, color: "var(--cmx-danger, #f87171)" }}>{error}</p></GateOrError>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={btn} onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" style={btnPrimary} disabled={saving || !draft.name.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
