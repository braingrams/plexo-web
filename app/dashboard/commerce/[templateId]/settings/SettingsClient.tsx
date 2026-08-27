"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type LayoutInfo = { templateId: string; ready: boolean } | null;
type LayoutCandidate = { layoutTemplateId: string; layoutName: string; siteName: string; updatedAt: string };

type InitialSettings = {
  enabled: boolean;
  paystackMode: "TEST" | "LIVE";
  paystackTestPublicKey: string;
  paystackLivePublicKey: string;
  paystackTestSecretKeyMasked: string | null;
  paystackLiveSecretKeyMasked: string | null;
  maildripApiKeyMasked: string | null;
  maildripPaidGroupId: string;
  maildripNewsletterGroupId: string;
  notificationEmail: string;
  productDetailLayout: LayoutInfo;
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem", marginBottom: "1.25rem" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>{title}</h2>
      {description && <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0.3rem 0 1rem" }}>{description}</p>}
      <div style={{ display: "grid", gap: "0.9rem", marginTop: description ? 0 : "1rem" }}>{children}</div>
    </div>
  );
}

function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", marginTop: "0.3rem" }}>{hint}</span>}
    </label>
  );
}

function ProductDetailLayoutSection({ templateId, layout }: { templateId: string; layout: LayoutInfo }) {
  const router = useRouter();
  const [showPicker, setShowPicker] = useState(false);
  const [candidates, setCandidates] = useState<LayoutCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDesignNew() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/product-detail-layout`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't create a layout. Try again.");
      router.push(`/dashboard/templates/${data.layoutTemplateId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create a layout. Try again.");
      setBusy(false);
    }
  }

  async function handleShowPicker() {
    setShowPicker(true);
    if (candidates === null) {
      const res = await fetch(`/api/v1/commerce/${templateId}/product-detail-layout`);
      const data = await res.json();
      setCandidates(res.ok ? data.candidates : []);
    }
  }

  async function handleUseExisting(sourceLayoutTemplateId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/product-detail-layout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLayoutTemplateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't use that layout. Try again.");
      router.push(`/dashboard/templates/${data.layoutTemplateId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't use that layout. Try again.");
      setBusy(false);
    }
  }

  async function handleDetach() {
    if (!confirm("Turn off product pages? Products will 404 until you attach a layout again. Your design stays saved and can be re-attached later.")) return;
    setBusy(true);
    try {
      await fetch(`/api/v1/commerce/${templateId}/product-detail-layout`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Product page"
      description="One reusable page design serves every product's own URL (e.g. /shop/your-product) — add a product in the catalog and it gets a working page immediately, nothing to create per product."
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div>
          <p style={{ fontSize: "0.75rem", color: layout ? (layout.ready ? "#4ade80" : "#f59e0b") : "rgba(240,242,255,0.4)", margin: 0 }}>
            {!layout ? "No product page yet — products will 404 until one is designed." : layout.ready ? "Product page is live." : "Draft — the required block was removed, re-add it to go live."}
          </p>
        </div>
        {layout ? (
          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
            <a
              href={`/dashboard/templates/${layout.templateId}`}
              style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", fontSize: "0.8rem", fontWeight: 600, textDecoration: "none" }}
            >
              Edit design
            </a>
            <button type="button" onClick={() => void handleDetach()} disabled={busy} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.5)", fontSize: "0.8rem", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              Turn off
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
            <button type="button" onClick={() => void handleDesignNew()} disabled={busy} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              Design product page
            </button>
            <button type="button" onClick={() => void handleShowPicker()} disabled={busy} style={{ padding: "0.5rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.8rem", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              Use existing
            </button>
          </div>
        )}
      </div>

      {error && <p style={{ fontSize: "0.78rem", color: "#f87171", margin: 0 }}>{error}</p>}

      {showPicker && !layout && (
        <div style={{ marginTop: "0.25rem" }}>
          {candidates === null ? (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)" }}>Loading…</p>
          ) : candidates.length === 0 ? (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)" }}>No other product pages yet — design one on another site first, or start new here.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {candidates.map((c) => (
                <div key={c.layoutTemplateId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                  <span style={{ fontSize: "0.8rem", color: "#f0f2ff" }}>
                    {c.layoutName} <span style={{ color: "rgba(240,242,255,0.4)" }}>— from {c.siteName} · updated {new Date(c.updatedAt).toLocaleDateString()}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleUseExisting(c.layoutTemplateId)}
                    disabled={busy}
                    style={{ padding: "0.35rem 0.7rem", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", fontSize: "0.75rem", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", flexShrink: 0 }}
                  >
                    Use this
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function PaystackKeyPairFields({
  label, active, publicKey, onPublicKeyChange, secretKey, onSecretKeyChange, secretMasked, publicPlaceholder, secretPlaceholder,
}: {
  label: string;
  active: boolean;
  publicKey: string;
  onPublicKeyChange: (v: string) => void;
  secretKey: string;
  onSecretKeyChange: (v: string) => void;
  secretMasked: string | null;
  publicPlaceholder: string;
  secretPlaceholder: string;
}) {
  return (
    <div style={{ border: active ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "0.9rem", display: "grid", gap: "0.7rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: active ? "var(--brand)" : "#c5cbe8" }}>{label}</span>
        {active && (
          <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--brand)", background: "var(--brand-subtle)", borderRadius: 999, padding: "0.1rem 0.55rem" }}>
            ACTIVE
          </span>
        )}
      </div>
      <FieldLabel label="Public key">
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
    </div>
  );
}

export function SettingsClient({ templateId, initial }: { templateId: string; initial: InitialSettings }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [paystackMode, setPaystackMode] = useState(initial.paystackMode);
  const [paystackTestPublicKey, setPaystackTestPublicKey] = useState(initial.paystackTestPublicKey);
  const [paystackLivePublicKey, setPaystackLivePublicKey] = useState(initial.paystackLivePublicKey);
  const [paystackTestSecretKey, setPaystackTestSecretKey] = useState("");
  const [paystackLiveSecretKey, setPaystackLiveSecretKey] = useState("");
  const [maildripApiKey, setMaildripApiKey] = useState("");
  const [maildripPaidGroupId, setMaildripPaidGroupId] = useState(initial.maildripPaidGroupId);
  const [maildripNewsletterGroupId, setMaildripNewsletterGroupId] = useState(initial.maildripNewsletterGroupId);
  const [notificationEmail, setNotificationEmail] = useState(initial.notificationEmail);
  const [paystackTestSecretMasked, setPaystackTestSecretMasked] = useState(initial.paystackTestSecretKeyMasked);
  const [paystackLiveSecretMasked, setPaystackLiveSecretMasked] = useState(initial.paystackLiveSecretKeyMasked);
  const [maildripMasked, setMaildripMasked] = useState(initial.maildripApiKeyMasked);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/paystack/${templateId}` : "";

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          paystackMode,
          paystackTestPublicKey,
          paystackLivePublicKey,
          paystackTestSecretKey: paystackTestSecretKey || undefined,
          paystackLiveSecretKey: paystackLiveSecretKey || undefined,
          maildripApiKey: maildripApiKey || undefined,
          maildripPaidGroupId,
          maildripNewsletterGroupId,
          notificationEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save settings.");

      setPaystackTestSecretMasked(data.settings.paystackTestSecretKeyMasked);
      setPaystackLiveSecretMasked(data.settings.paystackLiveSecretKeyMasked);
      setMaildripMasked(data.settings.maildripApiKeyMasked);
      setPaystackTestSecretKey("");
      setPaystackLiveSecretKey("");
      setMaildripApiKey("");
      setMessage({ kind: "success", text: "Settings saved." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>Commerce settings</h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginTop: 4 }}>Paystack, MailDrip, and the master on/off switch for this site.</p>
      </div>

      <Section title="Enable Commerce">
        <label style={{ display: "flex", alignItems: "center", gap: "0.7rem", cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          <span style={{ fontSize: "0.85rem", color: "#f0f2ff" }}>
            {enabled ? "Commerce is live on this site." : "Commerce is off — the storefront script won't load."}
          </span>
        </label>
      </Section>

      <ProductDetailLayoutSection templateId={templateId} layout={initial.productDetailLayout} />

      <Section
        title="Paystack"
        description="Each site brings its own Paystack account. Test and live keys are stored separately — the toggle below picks which pair actually gets charged at checkout, so switching it is a real, deliberate action, not just a label."
      >
        <FieldLabel label="Active mode" hint={paystackMode === "LIVE" ? "Checkout charges real cards using the Live keys below." : "Checkout runs against the Test keys below — no real money moves."}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(["TEST", "LIVE"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPaystackMode(mode)}
                style={{
                  flex: 1, padding: "0.55rem", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                  border: paystackMode === mode ? "1.5px solid var(--brand)" : "1px solid rgba(255,255,255,0.1)",
                  background: paystackMode === mode ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)",
                  color: paystackMode === mode ? "var(--brand)" : "rgba(240,242,255,0.6)",
                  fontWeight: 600, fontSize: "0.82rem",
                }}
              >
                {mode === "TEST" ? "Test mode" : "Live mode"}
              </button>
            ))}
          </div>
        </FieldLabel>

        <FieldLabel label="Webhook URL" hint="Paste this into both your Test and Live Paystack dashboards' webhook settings — one URL covers both.">
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input type="text" readOnly value={webhookUrl} style={{ ...inputStyle, color: "rgba(240,242,255,0.6)" }} />
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              style={{ padding: "0 0.9rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", whiteSpace: "nowrap" }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </FieldLabel>

        <PaystackKeyPairFields
          label="Test keys"
          active={paystackMode === "TEST"}
          publicKey={paystackTestPublicKey}
          onPublicKeyChange={setPaystackTestPublicKey}
          secretKey={paystackTestSecretKey}
          onSecretKeyChange={setPaystackTestSecretKey}
          secretMasked={paystackTestSecretMasked}
          publicPlaceholder="pk_test_..."
          secretPlaceholder="sk_test_..."
        />
        <PaystackKeyPairFields
          label="Live keys"
          active={paystackMode === "LIVE"}
          publicKey={paystackLivePublicKey}
          onPublicKeyChange={setPaystackLivePublicKey}
          secretKey={paystackLiveSecretKey}
          onSecretKeyChange={setPaystackLiveSecretKey}
          secretMasked={paystackLiveSecretMasked}
          publicPlaceholder="pk_live_..."
          secretPlaceholder="sk_live_..."
        />
      </Section>

      <Section title="MailDrip" description="Optional — tags paying customers into a group and sends receipts through your own MailDrip account.">
        <FieldLabel label="API key" hint={maildripMasked ? `Currently set: ${maildripMasked}` : "Falls back to Plexo's shared account until set."}>
          <input
            type="password"
            value={maildripApiKey}
            onChange={(e) => setMaildripApiKey(e.target.value)}
            placeholder={maildripMasked ? "Leave blank to keep the current key" : "Your MailDrip API key"}
            style={inputStyle}
          />
        </FieldLabel>
        <FieldLabel label="Group to tag paid customers into">
          <input type="text" value={maildripPaidGroupId} onChange={(e) => setMaildripPaidGroupId(e.target.value)} placeholder="Group ID" style={inputStyle} />
        </FieldLabel>
        <FieldLabel label="Group to tag newsletter subscribers into" hint="Powers the site's newsletter signup block (e.g. in the footer) — separate from paying customers above, since a visitor can subscribe without ever buying anything.">
          <input type="text" value={maildripNewsletterGroupId} onChange={(e) => setMaildripNewsletterGroupId(e.target.value)} placeholder="Group ID" style={inputStyle} />
        </FieldLabel>
      </Section>

      <Section title="Notifications">
        <FieldLabel label="Order notification email">
          <input type="email" value={notificationEmail} onChange={(e) => setNotificationEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} />
        </FieldLabel>
      </Section>

      {message && (
        <p style={{ fontSize: "0.85rem", marginBottom: "1rem", color: message.kind === "success" ? "#34d399" : "#f87171" }}>
          {message.text}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
        style={{
          padding: "0.7rem 1.5rem", borderRadius: 10, border: "none",
          background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
          cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
          fontFamily: "inherit", fontSize: "0.88rem", fontWeight: 700,
        }}
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
