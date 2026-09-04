"use client";

import { useEffect, useState } from "react";
import { SettingsActionBar } from "../_components/SettingsActionBar";

type CommercePaymentProvider = "BYO_PAYSTACK" | "PLATFORM_PAYSTACK" | "PLATFORM_STRIPE" | "BYO_STRIPE";
type StripeAccessStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

type InitialPaymentsSettings = {
  paymentProvider: CommercePaymentProvider;
  paystackMode: "TEST" | "LIVE";
  paystackTestPublicKey: string;
  paystackLivePublicKey: string;
  paystackTestSecretKeyMasked: string | null;
  paystackLiveSecretKeyMasked: string | null;
  stripeMode: "TEST" | "LIVE";
  stripeTestPublishableKey: string;
  stripeLivePublishableKey: string;
  stripeTestSecretKeyMasked: string | null;
  stripeLiveSecretKeyMasked: string | null;
  stripeTestWebhookSecretMasked: string | null;
  stripeLiveWebhookSecretMasked: string | null;
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", marginTop: "0.3rem" }}>{hint}</span>}
    </label>
  );
}

function ProviderCard({
  label, hint, selected, onClick,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        cursor: "pointer",
        borderRadius: 11,
        padding: "0.85rem",
        border: selected ? "1.5px solid var(--brand)" : "1px solid rgba(255,255,255,0.1)",
        background: selected ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)",
      }}
    >
      {selected && (
        <span style={{ position: "absolute", top: "0.6rem", right: "0.6rem", width: 16, height: 16, borderRadius: "50%", background: "var(--brand)", display: "grid", placeItems: "center" }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
      <div style={{ fontSize: "0.83rem", fontWeight: 700, color: "#f0f2ff", marginBottom: 2, paddingRight: "1rem" }}>{label}</div>
      <div style={{ fontSize: "0.74rem", color: "rgba(240,242,255,0.45)", lineHeight: 1.4 }}>{hint}</div>
    </div>
  );
}

function ProcessorGroup({
  iconLabel, iconBg, name, currencyNote, children, stacked,
}: {
  iconLabel: string;
  iconBg: string;
  name: string;
  currencyNote: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    // flex-basis means something different on each axis: "280px" sizes WIDTH in a row
    // layout but HEIGHT in a column layout — reusing one value for both previously forced
    // every stacked card to a fixed ~280px tall box regardless of its actual content,
    // leaving a block of dead space under the two provider options. `stacked` picks the
    // axis-appropriate value instead of assuming row.
    <div style={{ flex: stacked ? "0 0 auto" : "1 1 280px", minWidth: stacked ? undefined : 260, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.75rem" }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: iconBg, display: "grid", placeItems: "center", fontSize: "0.72rem", fontWeight: 800, color: "#fff", flexShrink: 0 }}>
          {iconLabel}
        </div>
        <span style={{ fontSize: "0.86rem", fontWeight: 700, color: "#f0f2ff" }}>{name}</span>
      </div>
      <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", margin: "0 0 0.7rem" }}>{currencyNote}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "0.6rem" }}>{children}</div>
    </div>
  );
}

function ModeToggle({ mode, onChange, activeColor }: { mode: "TEST" | "LIVE"; onChange: (m: "TEST" | "LIVE") => void; activeColor: string }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", maxWidth: 320 }}>
      {(["TEST", "LIVE"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          style={{
            flex: 1, padding: "0.55rem", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
            border: mode === m ? `1.5px solid ${activeColor}` : "1px solid rgba(255,255,255,0.1)",
            background: mode === m ? `${activeColor}1a` : "rgba(255,255,255,0.03)",
            color: mode === m ? activeColor : "rgba(240,242,255,0.6)",
            fontWeight: 600, fontSize: "0.82rem",
          }}
        >
          {m === "TEST" ? "Test mode" : "Live mode"}
        </button>
      ))}
    </div>
  );
}

function KeyPairFields({
  label, activeColor, publicKey, onPublicKeyChange, publicFieldLabel, publicPlaceholder,
  secretKey, onSecretKeyChange, secretMasked, secretPlaceholder,
  webhookSecretKey, onWebhookSecretKeyChange, webhookSecretMasked,
}: {
  label: string;
  activeColor: string;
  publicKey: string;
  onPublicKeyChange: (v: string) => void;
  publicFieldLabel: string;
  publicPlaceholder: string;
  secretKey: string;
  onSecretKeyChange: (v: string) => void;
  secretMasked: string | null;
  secretPlaceholder: string;
  webhookSecretKey?: string;
  onWebhookSecretKeyChange?: (v: string) => void;
  webhookSecretMasked?: string | null;
}) {
  return (
    <div style={{ border: `1px solid ${activeColor}`, borderRadius: 10, padding: "0.9rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.7rem" }}>
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: activeColor }}>{label}</span>
        <span style={{ fontSize: "0.68rem", fontWeight: 700, color: activeColor, background: `${activeColor}1a`, borderRadius: 999, padding: "0.1rem 0.55rem" }}>
          ACTIVE
        </span>
      </div>
      <FieldLabel label={publicFieldLabel}>
        <input type="text" value={publicKey} onChange={(e) => onPublicKeyChange(e.target.value)} placeholder={publicPlaceholder} style={inputStyle} />
      </FieldLabel>
      <FieldLabel label="Secret key" hint={secretMasked ? `Currently set: ${secretMasked}` : "Not set yet."}>
        <input
          type="password"
          value={secretKey}
          onChange={(e) => onSecretKeyChange(e.target.value)}
          placeholder={secretMasked ? "Leave blank to keep the current key" : secretPlaceholder}
          style={inputStyle}
        />
      </FieldLabel>
      {onWebhookSecretKeyChange && (
        <FieldLabel label="Webhook signing secret" hint={webhookSecretMasked ? `Currently set: ${webhookSecretMasked}` : "Not set yet — see the webhook URL below."}>
          <input
            type="password"
            value={webhookSecretKey ?? ""}
            onChange={(e) => onWebhookSecretKeyChange(e.target.value)}
            placeholder={webhookSecretMasked ? "Leave blank to keep the current secret" : "whsec_..."}
            style={inputStyle}
          />
        </FieldLabel>
      )}
    </div>
  );
}

function WebhookUrlField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <FieldLabel label="Webhook URL">
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input type="text" readOnly value={url} style={{ ...inputStyle, color: "rgba(240,242,255,0.6)" }} />
        <button
          type="button"
          onClick={() => { void navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{ padding: "0 0.9rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", whiteSpace: "nowrap" }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </FieldLabel>
  );
}

/** Request/approval status + request form for platform Stripe — same status-display idea as
 * ProductDetailLayoutSection, mirroring the request/admin-approve split (approval itself
 * happens in plexo-admin). Org-scoped, not site-scoped. */
function StripeAccessControl() {
  const [status, setStatus] = useState<StripeAccessStatus | "LOADING">("LOADING");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [expectedVolume, setExpectedVolume] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/commerce/stripe-access")
      .then((res) => res.json())
      .then((data) => {
        setStatus(data.status ?? "NONE");
        setRejectionReason(data.rejectionReason ?? null);
      })
      .catch(() => setStatus("NONE"));
  }, []);

  async function handleRequest() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/commerce/stripe-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined, expectedVolume: expectedVolume || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't submit the request.");
      setStatus("PENDING");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem", display: "grid", gap: "0.7rem" }}>
      {status === "LOADING" && <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", margin: 0 }}>Checking access…</p>}
      {status === "APPROVED" && (
        <p style={{ fontSize: "0.78rem", color: "#4ade80", margin: 0 }}>
          Plexo-hosted Stripe is approved for your organization — save to switch this site over.
        </p>
      )}
      {status === "PENDING" && (
        <p style={{ fontSize: "0.78rem", color: "#f59e0b", margin: 0 }}>
          Your request is pending review. You'll be able to switch this site to Plexo-hosted Stripe once it's approved.
        </p>
      )}
      {(status === "NONE" || status === "REJECTED") && (
        <>
          {status === "REJECTED" && (
            <p style={{ fontSize: "0.78rem", color: "#f87171", margin: 0 }}>
              Your previous request was rejected{rejectionReason ? `: ${rejectionReason}` : "."}
            </p>
          )}
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", margin: 0 }}>
            Plexo-hosted Stripe routes checkout through Plexo's own Stripe account — no keys to manage. Request access and our team will review it.
          </p>
          <FieldLabel label="Why do you need this? (optional)">
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. selling to customers across multiple countries" style={inputStyle} />
          </FieldLabel>
          <FieldLabel label="Expected monthly volume (optional)">
            <input type="text" value={expectedVolume} onChange={(e) => setExpectedVolume(e.target.value)} placeholder="e.g. $500-2000/mo" style={inputStyle} />
          </FieldLabel>
          {error && <p style={{ fontSize: "0.78rem", color: "#f87171", margin: 0 }}>{error}</p>}
          <button
            type="button"
            onClick={() => void handleRequest()}
            disabled={busy}
            style={{ padding: "0.55rem 0.9rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", justifySelf: "start" }}
          >
            {busy ? "Requesting…" : "Request access"}
          </button>
        </>
      )}
    </div>
  );
}

export function PaymentsSettingsClient({ templateId, initial }: { templateId: string; initial: InitialPaymentsSettings }) {
  const [provider, setProvider] = useState<CommercePaymentProvider>(initial.paymentProvider);
  const [paystackMode, setPaystackMode] = useState(initial.paystackMode);
  const [paystackTestPublicKey, setPaystackTestPublicKey] = useState(initial.paystackTestPublicKey);
  const [paystackLivePublicKey, setPaystackLivePublicKey] = useState(initial.paystackLivePublicKey);
  const [paystackTestSecretKey, setPaystackTestSecretKey] = useState("");
  const [paystackLiveSecretKey, setPaystackLiveSecretKey] = useState("");
  const [stripeMode, setStripeMode] = useState(initial.stripeMode);
  const [stripeTestPublishableKey, setStripeTestPublishableKey] = useState(initial.stripeTestPublishableKey);
  const [stripeLivePublishableKey, setStripeLivePublishableKey] = useState(initial.stripeLivePublishableKey);
  const [stripeTestSecretKey, setStripeTestSecretKey] = useState("");
  const [stripeLiveSecretKey, setStripeLiveSecretKey] = useState("");
  const [stripeTestWebhookSecret, setStripeTestWebhookSecret] = useState("");
  const [stripeLiveWebhookSecret, setStripeLiveWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/paystack/${templateId}` : "";
  const stripeWebhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/stripe/commerce/${templateId}` : "";

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentProvider: provider,
          paystackMode,
          paystackTestPublicKey,
          paystackLivePublicKey,
          paystackTestSecretKey: paystackTestSecretKey || undefined,
          paystackLiveSecretKey: paystackLiveSecretKey || undefined,
          stripeMode,
          stripeTestPublishableKey,
          stripeLivePublishableKey,
          stripeTestSecretKey: stripeTestSecretKey || undefined,
          stripeLiveSecretKey: stripeLiveSecretKey || undefined,
          stripeTestWebhookSecret: stripeTestWebhookSecret || undefined,
          stripeLiveWebhookSecret: stripeLiveWebhookSecret || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save settings.");
      setPaystackTestSecretKey("");
      setPaystackLiveSecretKey("");
      setStripeTestSecretKey("");
      setStripeLiveSecretKey("");
      setStripeTestWebhookSecret("");
      setStripeLiveWebhookSecret("");
      setMessage({ kind: "success", text: "Settings saved." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }

  const isPlatform = provider === "PLATFORM_PAYSTACK" || provider === "PLATFORM_STRIPE";

  const providerCard = (
    <div style={{ flex: isPlatform ? undefined : "1 1 320px", minWidth: isPlatform ? undefined : 300, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>Payment provider</h2>
      <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0.3rem 0 1.1rem" }}>
        Pick a processor, then whether it runs on your own account or Plexo's.
      </p>

      <div style={{ display: "flex", flexDirection: isPlatform ? "row" : "column", gap: "1rem", flexWrap: "wrap" }}>
        <ProcessorGroup stacked={!isPlatform} iconLabel="P" iconBg="linear-gradient(135deg,#12b3a8,#0c8a82)" name="Paystack" currencyNote="Supports NGN, GHS, ZAR, KES and USD, depending on your account.">
          <ProviderCard
            label="Use your own keys"
            hint="Money lands directly in your Paystack account."
            selected={provider === "BYO_PAYSTACK"}
            onClick={() => setProvider("BYO_PAYSTACK")}
          />
          <ProviderCard
            label="Hosted by Plexo"
            hint="No keys needed — settles to your Commerce wallet."
            selected={provider === "PLATFORM_PAYSTACK"}
            onClick={() => setProvider("PLATFORM_PAYSTACK")}
          />
        </ProcessorGroup>

        <ProcessorGroup stacked={!isPlatform} iconLabel="S" iconBg="#635bff" name="Stripe" currencyNote="Supports most major currencies worldwide.">
          <ProviderCard
            label="Use your own keys"
            hint="Money lands directly in your Stripe account."
            selected={provider === "BYO_STRIPE"}
            onClick={() => setProvider("BYO_STRIPE")}
          />
          <ProviderCard
            label="Hosted by Plexo"
            hint="Requires approval from Plexo first."
            selected={provider === "PLATFORM_STRIPE"}
            onClick={() => setProvider("PLATFORM_STRIPE")}
          />
        </ProcessorGroup>
      </div>
    </div>
  );

  return (
    <div>
      {isPlatform ? (
        <>
          <div style={{ marginBottom: "1.25rem" }}>{providerCard}</div>
          <div style={{ marginBottom: "1.25rem" }}>
            {provider === "PLATFORM_PAYSTACK" ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 12, padding: "0.9rem 1.1rem", fontSize: "0.83rem", color: "#4ade80" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></svg>
                No keys to manage — proceeds settle straight to your Commerce wallet, withdrawable any time.
              </div>
            ) : (
              <StripeAccessControl />
            )}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: "1.25rem", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "1.25rem" }}>
          {providerCard}
          <div style={{ flex: "1.3 1 380px", minWidth: 320 }}>
            {provider === "BYO_PAYSTACK" && (
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem" }}>
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>Paystack keys</h2>
                <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0.3rem 0 1rem" }}>
                  Test and live keys are stored separately — the toggle below picks which pair actually gets charged at checkout.
                </p>
                <ModeToggle mode={paystackMode} onChange={setPaystackMode} activeColor="#12b3a8" />
                <div style={{ marginBottom: "1rem" }}>
                  <WebhookUrlField url={webhookUrl} />
                </div>
                {paystackMode === "TEST" ? (
                  <KeyPairFields
                    label="Test keys"
                    activeColor="#12b3a8"
                    publicKey={paystackTestPublicKey}
                    onPublicKeyChange={setPaystackTestPublicKey}
                    publicFieldLabel="Public key"
                    publicPlaceholder="pk_test_..."
                    secretKey={paystackTestSecretKey}
                    onSecretKeyChange={setPaystackTestSecretKey}
                    secretMasked={initial.paystackTestSecretKeyMasked}
                    secretPlaceholder="sk_test_..."
                  />
                ) : (
                  <KeyPairFields
                    label="Live keys"
                    activeColor="#12b3a8"
                    publicKey={paystackLivePublicKey}
                    onPublicKeyChange={setPaystackLivePublicKey}
                    publicFieldLabel="Public key"
                    publicPlaceholder="pk_live_..."
                    secretKey={paystackLiveSecretKey}
                    onSecretKeyChange={setPaystackLiveSecretKey}
                    secretMasked={initial.paystackLiveSecretKeyMasked}
                    secretPlaceholder="sk_live_..."
                  />
                )}
              </div>
            )}

            {provider === "BYO_STRIPE" && (
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem" }}>
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>Stripe keys</h2>
                <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0.3rem 0 1rem" }}>
                  Create a webhook endpoint in your own Stripe Dashboard → Developers → Webhooks, pointing at the URL below,
                  subscribed to <code>checkout.session.completed</code>. Do this once for Test mode and once for Live mode —
                  Stripe shows a signing secret starting with <code>whsec_</code> for each; paste it into the matching field below.
                </p>
                <ModeToggle mode={stripeMode} onChange={setStripeMode} activeColor="#8f89ff" />
                <div style={{ marginBottom: "1rem" }}>
                  <WebhookUrlField url={stripeWebhookUrl} />
                </div>
                {stripeMode === "TEST" ? (
                  <KeyPairFields
                    label="Test keys"
                    activeColor="#8f89ff"
                    publicKey={stripeTestPublishableKey}
                    onPublicKeyChange={setStripeTestPublishableKey}
                    publicFieldLabel="Publishable key"
                    publicPlaceholder="pk_test_..."
                    secretKey={stripeTestSecretKey}
                    onSecretKeyChange={setStripeTestSecretKey}
                    secretMasked={initial.stripeTestSecretKeyMasked}
                    secretPlaceholder="sk_test_..."
                    webhookSecretKey={stripeTestWebhookSecret}
                    onWebhookSecretKeyChange={setStripeTestWebhookSecret}
                    webhookSecretMasked={initial.stripeTestWebhookSecretMasked}
                  />
                ) : (
                  <KeyPairFields
                    label="Live keys"
                    activeColor="#8f89ff"
                    publicKey={stripeLivePublishableKey}
                    onPublicKeyChange={setStripeLivePublishableKey}
                    publicFieldLabel="Publishable key"
                    publicPlaceholder="pk_live_..."
                    secretKey={stripeLiveSecretKey}
                    onSecretKeyChange={setStripeLiveSecretKey}
                    secretMasked={initial.stripeLiveSecretKeyMasked}
                    secretPlaceholder="sk_live_..."
                    webhookSecretKey={stripeLiveWebhookSecret}
                    onWebhookSecretKeyChange={setStripeLiveWebhookSecret}
                    webhookSecretMasked={initial.stripeLiveWebhookSecretMasked}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <SettingsActionBar saving={saving} message={message} onSave={() => void handleSave()} />
    </div>
  );
}
