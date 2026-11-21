"use client";

import { useEffect, useState } from "react";
import { Copy, Landmark, Mail } from "lucide-react";
import { Badge, Button, Input, Textarea } from "../../ui";
import type { InitialPaymentsSettings } from "@/app/dashboard/commerce/[templateId]/settings/payments/PaymentsSettingsClient";
import { PROVIDERS, bankProblem, cardSetupGaps, cardStatus, type BankFields, type PaymentFields, type Provider } from "@/lib/commerce/shopSettingsForm";
import { SUPPORTED_STORE_CURRENCIES } from "@/lib/commerce/currency";
import { Group, SaveBar, Switch, putSettings, useSettingsForm } from "./useSettingsForm";

type Access = "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "LOADING";
type V = PaymentFields & { bank: BankFields; currency: string; notificationEmail: string };

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <b style={{ fontSize: 14 }}>{label}</b>
      <div className="plx-copybox">
        <code>{value || "…"}</code>
        <Button size="sm" variant="secondary" leftIcon={<Copy size={14} aria-hidden />} onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}

/** Shop settings, Payments: how people pay by card, and whether they can pay into your bank account. */
export function PaymentsPanel({ templateId, initial }: { templateId: string; initial: InitialPaymentsSettings }) {
  const [access, setAccess] = useState<Access>("LOADING");
  const [rejection, setRejection] = useState<string | null>(null);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqNote, setReqNote] = useState("");
  const [reqError, setReqError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/commerce/stripe-access").then((r) => r.json()).then((d) => { setAccess(d.status ?? "NONE"); setRejection(d.rejectionReason ?? null); }).catch(() => setAccess("NONE"));
  }, []);

  const start: V = {
    provider: initial.paymentProvider,
    paystackMode: initial.paystackMode,
    paystackPublic: { TEST: initial.paystackTestPublicKey, LIVE: initial.paystackLivePublicKey },
    paystackSecretSet: { TEST: !!initial.paystackTestSecretKeyMasked, LIVE: !!initial.paystackLiveSecretKeyMasked },
    paystackSecretNew: { TEST: "", LIVE: "" },
    stripeMode: initial.stripeMode,
    stripePublic: { TEST: initial.stripeTestPublishableKey, LIVE: initial.stripeLivePublishableKey },
    stripeSecretSet: { TEST: !!initial.stripeTestSecretKeyMasked, LIVE: !!initial.stripeLiveSecretKeyMasked },
    stripeSecretNew: { TEST: "", LIVE: "" },
    bank: { enabled: initial.bankTransferEnabled, bankName: initial.bankTransferBankName, accountName: initial.bankTransferAccountName, accountNumber: initial.bankTransferAccountNumber, instructions: initial.bankTransferInstructions },
    currency: initial.currency ?? "USD",
    notificationEmail: initial.notificationEmail ?? "",
  };

  const form = useSettingsForm<V>(start, async (v) => {
    const gaps = cardSetupGaps(v, access);
    if (gaps.length && (v.provider === "BYO_PAYSTACK" || v.provider === "BYO_STRIPE")) return { error: `Before you save, add ${gaps.join(" and ")}. You'll find them in your ${v.provider === "BYO_PAYSTACK" ? "Paystack" : "Stripe"} dashboard under API keys.` };
    if (v.provider === "PLATFORM_STRIPE" && access !== "APPROVED") return { error: "Plexo's Stripe needs our approval first. Send your request below, or choose another way to be paid." };
    const bad = bankProblem(v.bank);
    if (bad) return { error: bad };
    const res = await putSettings(templateId, {
      paymentProvider: v.provider,
      currency: v.currency,
      notificationEmail: v.notificationEmail.trim() || undefined,
      paystackMode: v.paystackMode,
      paystackTestPublicKey: v.paystackPublic.TEST,
      paystackLivePublicKey: v.paystackPublic.LIVE,
      paystackTestSecretKey: v.paystackSecretNew.TEST || undefined,
      paystackLiveSecretKey: v.paystackSecretNew.LIVE || undefined,
      stripeMode: v.stripeMode,
      stripeTestPublishableKey: v.stripePublic.TEST,
      stripeLivePublishableKey: v.stripePublic.LIVE,
      stripeTestSecretKey: v.stripeSecretNew.TEST || undefined,
      stripeLiveSecretKey: v.stripeSecretNew.LIVE || undefined,
      bankTransferEnabled: v.bank.enabled,
      bankTransferBankName: v.bank.bankName,
      bankTransferAccountName: v.bank.accountName,
      bankTransferAccountNumber: v.bank.accountNumber,
      bankTransferInstructions: v.bank.instructions,
    });
    if (res.error) return { error: res.error };
    // A key that was typed is now saved: remember that, and clear the box.
    return { saved: { ...v, paystackSecretSet: { TEST: v.paystackSecretSet.TEST || !!v.paystackSecretNew.TEST, LIVE: v.paystackSecretSet.LIVE || !!v.paystackSecretNew.LIVE }, stripeSecretSet: { TEST: v.stripeSecretSet.TEST || !!v.stripeSecretNew.TEST, LIVE: v.stripeSecretSet.LIVE || !!v.stripeSecretNew.LIVE }, paystackSecretNew: { TEST: "", LIVE: "" }, stripeSecretNew: { TEST: "", LIVE: "" } } };
  });
  const v = form.values;
  const status = cardStatus(v, access);
  const byoPaystack = v.provider === "BYO_PAYSTACK";
  const byoStripe = v.provider === "BYO_STRIPE";
  const mode = byoPaystack ? v.paystackMode : v.stripeMode;
  // Read after the page loads so the server and the browser agree on what was drawn first.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  async function requestAccess() {
    setReqBusy(true);
    setReqError(null);
    try {
      const res = await fetch("/api/v1/commerce/stripe-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reqNote || undefined }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "We couldn't send your request. Please try again.");
      setAccess("PENDING");
    } catch (e) {
      setReqError(e instanceof Error ? e.message : "We couldn't send your request.");
    } finally {
      setReqBusy(false);
    }
  }

  const keyPatch = (kind: "paystack" | "stripe", field: "Public" | "SecretNew", value: string) => {
    const key = `${kind}${field}` as "paystackPublic" | "paystackSecretNew" | "stripePublic" | "stripeSecretNew";
    form.patch({ [key]: { ...v[key], [mode]: value } } as Partial<V>);
  };

  return (
    <div className="plx-hset" data-tour="shop-payments">
      <Group title="Paying by card" help="Pick who handles card payments. You can change this any time." status={<Badge tone={status.tone}>{status.text}</Badge>}>
        {(["Paystack", "Stripe"] as const).map((g) => (
          <div key={g}>
            <b>{g}</b>
            <span className="plx-small" style={{ display: "block", marginBottom: 8 }}>{g === "Paystack" ? "Great for Nigeria, Ghana, South Africa and Kenya." : "Great for customers paying from many countries."}</span>
            <div className="plx-hchoices" role="radiogroup" aria-label={`${g} options`}>
              {PROVIDERS.filter((p) => p.group === g).map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={v.provider === p.id} className="plx-hchoice" onClick={() => form.patch({ provider: p.id as Provider })}>
                  <b>{p.title}</b>
                  <span>{p.body}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </Group>

      {v.provider === "PLATFORM_STRIPE" && access !== "APPROVED" ? (
        <Group title="Ask to use Plexo's Stripe" help="Our team checks every request. You'll be able to switch once it's approved.">
          {access === "PENDING" ? <div className="plx-inlinemsg" role="status">Your request is with our team. We'll let you know when it's approved.</div> : access === "LOADING" ? <p className="plx-small">Checking your request…</p> : (
            <>
              {access === "REJECTED" ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">We couldn&apos;t approve your last request{rejection ? `: ${rejection}` : "."} You can ask again, or use your own Stripe account.</div> : null}
              <Textarea label="Tell us a bit about your shop" optional help="For example what you sell and where your customers are." value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
              {reqError ? <p className="plx-field__error" role="alert">{reqError}</p> : null}
              <div><Button loading={reqBusy} onClick={requestAccess}>Send my request</Button></div>
            </>
          )}
        </Group>
      ) : null}

      {byoPaystack || byoStripe ? (
        <Group title={`Your ${byoPaystack ? "Paystack" : "Stripe"} keys`} help={`Copy these from your ${byoPaystack ? "Paystack" : "Stripe"} dashboard, under API keys. They stay private and are never shown again in full.`}>
          <div className="plx-hchips" role="radiogroup" aria-label="Test or real payments">
            {(["TEST", "LIVE"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className="plx-hchip" onClick={() => form.patch(byoPaystack ? { paystackMode: m } : { stripeMode: m })}>{m === "TEST" ? "Practice (test) payments" : "Real payments"}</button>
            ))}
          </div>
          <p className="plx-small" style={{ margin: 0 }}>{mode === "TEST" ? "Practice payments let you try your shop without moving real money. Switch to real payments when you're ready." : "Real payments move real money. Make sure you've tried a practice order first."}</p>
          <Input label={byoPaystack ? "Public key" : "Publishable key"} value={(byoPaystack ? v.paystackPublic : v.stripePublic)[mode]} onChange={(e) => keyPatch(byoPaystack ? "paystack" : "stripe", "Public", e.target.value.trim())} placeholder={byoPaystack ? (mode === "TEST" ? "pk_test_…" : "pk_live_…") : (mode === "TEST" ? "pk_test_…" : "pk_live_…")} autoComplete="off" />
          <Input label="Secret key" type="password" help={(byoPaystack ? v.paystackSecretSet : v.stripeSecretSet)[mode] ? "A secret key is saved. Type a new one only to replace it." : "Not added yet."} value={(byoPaystack ? v.paystackSecretNew : v.stripeSecretNew)[mode]} onChange={(e) => keyPatch(byoPaystack ? "paystack" : "stripe", "SecretNew", e.target.value.trim())} placeholder={(byoPaystack ? v.paystackSecretSet : v.stripeSecretSet)[mode] ? "Leave empty to keep it" : "sk_…"} autoComplete="new-password" />
          <CopyBox label={`Paste this into ${byoPaystack ? "Paystack's" : "Stripe's"} webhook settings`} value={byoPaystack ? `${origin}/api/webhooks/paystack/${templateId}` : `${origin}/api/webhooks/stripe/commerce/${templateId}`} />
          <p className="plx-small" style={{ margin: 0 }}>That link is how {byoPaystack ? "Paystack" : "Stripe"} tells Plexo a customer has paid, so their order goes through.</p>
        </Group>
      ) : null}

      <Group title="Bank transfer" help="Let people pay straight into your bank account, alongside paying by card." status={<Landmark size={20} aria-hidden style={{ color: "var(--plx-deep)" }} />}>
        <Switch label="Accept bank transfers" help="Customers see your bank details at checkout, send the money, then place their order. We email you so you can confirm it arrived." checked={v.bank.enabled} onChange={(enabled) => form.patch({ bank: { ...v.bank, enabled } })} />
        {v.bank.enabled ? (
          <>
            <div className="plx-form__two">
              <Input label="Your bank" value={v.bank.bankName} onChange={(e) => form.patch({ bank: { ...v.bank, bankName: e.target.value } })} placeholder="GTBank" />
              <Input label="Name on the account" value={v.bank.accountName} onChange={(e) => form.patch({ bank: { ...v.bank, accountName: e.target.value } })} />
            </div>
            <Input label="Account number" inputMode="numeric" value={v.bank.accountNumber} onChange={(e) => form.patch({ bank: { ...v.bank, accountNumber: e.target.value } })} placeholder="0123456789" />
            <Textarea label="A note for customers" optional help="Shown under your bank details, like “Use your order number as the reference”." maxLength={500} value={v.bank.instructions} onChange={(e) => form.patch({ bank: { ...v.bank, instructions: e.target.value } })} />
          </>
        ) : null}
      </Group>
      <Group title="Currency" help="The currency people donate or pay in.">
        <div className="plx-hchips" role="radiogroup" aria-label="Currency options">
          {SUPPORTED_STORE_CURRENCIES.map((c) => (
            <button
              key={c.code}
              type="button"
              role="radio"
              aria-checked={v.currency === c.code}
              className="plx-hchip"
              onClick={() => form.patch({ currency: c.code })}
            >
              {c.symbol} {c.code} — {c.label}
            </button>
          ))}
        </div>
      </Group>

      <Group title="Who to tell about donations & payments" help="We email this address every time someone gives or makes a payment. Leave it empty to use your account email." status={<Mail size={20} aria-hidden style={{ color: "var(--plx-deep)" }} />}>
        <Input
          label="Email for payment alerts"
          type="email"
          inputMode="email"
          value={v.notificationEmail}
          onChange={(e) => form.patch({ notificationEmail: e.target.value })}
          placeholder="you@example.com"
          autoComplete="email"
          help="Leave empty to send payment notices to your Plexo account email."
        />
      </Group>

      <SaveBar form={form} />
    </div>
  );
}
