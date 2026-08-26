"use client";

import { useState } from "react";

type InitialSettings = {
  enabled: boolean;
  paystackMode: "TEST" | "LIVE";
  paystackPublicKey: string;
  paystackSecretKeyMasked: string | null;
  maildripApiKeyMasked: string | null;
  maildripPaidGroupId: string;
  maildripNewsletterGroupId: string;
  notificationEmail: string;
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

export function SettingsClient({ templateId, initial }: { templateId: string; initial: InitialSettings }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [paystackMode, setPaystackMode] = useState(initial.paystackMode);
  const [paystackPublicKey, setPaystackPublicKey] = useState(initial.paystackPublicKey);
  const [paystackSecretKey, setPaystackSecretKey] = useState("");
  const [maildripApiKey, setMaildripApiKey] = useState("");
  const [maildripPaidGroupId, setMaildripPaidGroupId] = useState(initial.maildripPaidGroupId);
  const [maildripNewsletterGroupId, setMaildripNewsletterGroupId] = useState(initial.maildripNewsletterGroupId);
  const [notificationEmail, setNotificationEmail] = useState(initial.notificationEmail);
  const [paystackSecretMasked, setPaystackSecretMasked] = useState(initial.paystackSecretKeyMasked);
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
          paystackPublicKey,
          paystackSecretKey: paystackSecretKey || undefined,
          maildripApiKey: maildripApiKey || undefined,
          maildripPaidGroupId,
          maildripNewsletterGroupId,
          notificationEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save settings.");

      setPaystackSecretMasked(data.settings.paystackSecretKeyMasked);
      setMaildripMasked(data.settings.maildripApiKeyMasked);
      setPaystackSecretKey("");
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

      <Section title="Paystack" description="Each site brings its own Paystack account.">
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

        <FieldLabel label="Public key">
          <input type="text" value={paystackPublicKey} onChange={(e) => setPaystackPublicKey(e.target.value)} placeholder="pk_test_..." style={inputStyle} />
        </FieldLabel>

        <FieldLabel label="Secret key" hint={paystackSecretMasked ? `Currently set: ${paystackSecretMasked}` : "Not set yet."}>
          <input
            type="password"
            value={paystackSecretKey}
            onChange={(e) => setPaystackSecretKey(e.target.value)}
            placeholder={paystackSecretMasked ? "Leave blank to keep the current key" : "sk_test_..."}
            style={inputStyle}
          />
        </FieldLabel>

        <FieldLabel label="Webhook URL" hint="Paste this into your Paystack dashboard's webhook settings.">
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
