"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, ImagePlus, Mail, Shield, Unlink, Upload } from "lucide-react";
import { Button, Card, CardHeader, Input, Modal, OptimisticLoader, Textarea, useToast } from "../ui";
import { friendlyConnectError } from "@/lib/commerce/mailingList";

export type EmailSettingsData = {
  enterprise: boolean;
  plan: string;
  emailBrandEnabled: boolean;
  emailSenderName: string;
  emailSenderEmail: string;
  emailLogoUrl: string;
  emailBrandColor: string;
  emailFooterText: string;
  siteName: string;
  siteLogoUrl: string;
  siteBrandColor: string;
  maildripConnected: boolean;
  maildripConnectedEmail: string | null;
};

type ConnectMode = "login" | "register" | "direct_key";

export function EmailBrandingCard({
  siteId,
  siteName,
  defaultLogo,
  defaultColor,
}: {
  siteId: string;
  siteName: string;
  defaultLogo?: string;
  defaultColor?: string;
}) {
  const { show } = useToast();
  const [data, setData] = useState<EmailSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connect modal state
  const [connectModal, setConnectModal] = useState(false);
  const [connectMode, setConnectMode] = useState<ConnectMode>("login");
  const [verifying, setVerifying] = useState(false);
  const [connectEmail, setConnectEmail] = useState("");
  const [connectPassword, setConnectPassword] = useState("");
  const [connectName, setConnectName] = useState("");
  const [connectPhone, setConnectPhone] = useState("");
  const [connectApiKey, setConnectApiKey] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Uploading logo state
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/v1/templates/${siteId}/email-settings`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load email settings");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load email settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSettings();
  }, [siteId]);

  const saveSettings = async (overrides?: Partial<EmailSettingsData>) => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        emailBrandEnabled: overrides?.emailBrandEnabled ?? data.emailBrandEnabled,
        emailSenderName: overrides?.emailSenderName ?? data.emailSenderName,
        emailSenderEmail: overrides?.emailSenderEmail ?? data.emailSenderEmail,
        emailLogoUrl: overrides?.emailLogoUrl ?? data.emailLogoUrl,
        emailBrandColor: overrides?.emailBrandColor ?? data.emailBrandColor,
        emailFooterText: overrides?.emailFooterText ?? data.emailFooterText,
      };

      const res = await fetch(`/api/v1/templates/${siteId}/email-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save email settings");

      setData((prev) => (prev ? { ...prev, ...payload } : prev));
      show({ title: "Email branding saved", tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save email settings");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/v1/media/upload", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Logo upload failed");
      setData((prev) => (prev ? { ...prev, emailLogoUrl: json.url } : prev));
      show({ title: "Logo uploaded", tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  const submitConnect = async () => {
    if (!connectEmail.trim()) {
      setConnectError("Email is required.");
      return;
    }
    setConnectBusy(true);
    setConnectError(null);
    try {
      let body: Record<string, unknown> = {};
      if (connectMode === "direct_key") {
        if (!connectApiKey.trim()) throw new Error("API key is required.");
        body = { action: "direct_key", email: connectEmail.trim(), apiKey: connectApiKey.trim() };
      } else if (connectMode === "register") {
        if (!connectPassword || !connectName.trim() || !connectPhone.trim()) {
          throw new Error("Name, phone, and password are required.");
        }
        body = {
          action: "register",
          email: connectEmail.trim(),
          password: connectPassword,
          name: connectName.trim(),
          companyName: connectName.trim(),
          phone: connectPhone.trim(),
        };
      } else {
        if (!connectPassword) throw new Error("Password is required.");
        body = { action: "login", email: connectEmail.trim(), password: connectPassword };
      }

      const res = await fetch(`/api/v1/maildrip/${siteId}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(friendlyConnectError(json.error));

      if (json.status === "verify_required") {
        setVerifying(true);
        return;
      }

      if (json.status === "connected") {
        setConnectModal(false);
        setVerifying(false);
        setData((prev) => (prev ? { ...prev, maildripConnected: true, maildripConnectedEmail: connectEmail.trim() } : prev));
        show({ title: "MailDrip connected", tone: "success" });
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setConnectBusy(false);
    }
  };

  const submitVerify = async () => {
    if (!verifyCode.trim()) {
      setConnectError("Verification code is required.");
      return;
    }
    setConnectBusy(true);
    setConnectError(null);
    try {
      const res = await fetch(`/api/v1/maildrip/${siteId}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", email: connectEmail.trim(), code: verifyCode.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(friendlyConnectError(json.error));

      setConnectModal(false);
      setVerifying(false);
      setData((prev) => (prev ? { ...prev, maildripConnected: true, maildripConnectedEmail: connectEmail.trim() } : prev));
      show({ title: "MailDrip connected and verified", tone: "success" });
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setConnectBusy(false);
    }
  };

  const disconnectMaildrip = async () => {
    if (!window.confirm("Disconnect MailDrip from this site? Outbound emails will fall back to default delivery.")) return;
    setDisconnecting(true);
    try {
      await fetch(`/api/v1/maildrip/${siteId}/connect`, { method: "DELETE" });
      setData((prev) => (prev ? { ...prev, maildripConnected: false, maildripConnectedEmail: null } : prev));
      show({ title: "MailDrip disconnected", tone: "info" });
    } catch {
      show({ title: "Failed to disconnect MailDrip", tone: "info" });
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <Card padding="lg" style={{ minHeight: 180, display: "grid", placeItems: "center" }}>
        <OptimisticLoader steps={["Loading email configuration…", "Checking enterprise delivery features…"]} subtitle="Loading email settings" />
      </Card>
    );
  }

  if (!data) return null;

  // Enterprise Gate Card
  if (!data.enterprise) {
    return (
      <Card data-tour="hub-brand-email-gate">
        <CardHeader
          title="Site email branding & MailDrip"
          description="Deliver clean, branded transactional emails (payment receipts, donations, orders) carrying this site's custom logo, sender name, and verified sending domain."
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 16px",
              borderRadius: "var(--plx-radius-md, 12px)",
              background: "var(--plx-tint)",
              border: "1px solid var(--plx-border)",
            }}
          >
            <Shield size={22} style={{ color: "var(--plx-deep)", flexShrink: 0 }} aria-hidden />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <b style={{ color: "var(--plx-heading)", fontSize: 14 }}>Enterprise Feature</b>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--plx-surface)",
                    color: "var(--plx-deep)",
                    border: "1px solid var(--plx-border)",
                  }}
                >
                  Enterprise
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--plx-muted)", lineHeight: 1.5 }}>
                Each site can have its own independent email branding and sender setup. Upgrade your workspace to configure custom logos, sender names, and send through your own MailDrip account.
              </p>
            </div>
            <a
              href="/dashboard/settings/subscription"
              className="plx-btn plx-btn--primary plx-btn--sm"
              style={{ whiteSpace: "nowrap" }}
            >
              Upgrade to Enterprise
            </a>
          </div>
        </div>
      </Card>
    );
  }

  const effectiveLogo = data.emailLogoUrl || defaultLogo || data.siteLogoUrl;
  const effectiveColor = data.emailBrandColor || defaultColor || data.siteBrandColor;

  return (
    <>
      <Card data-tour="hub-brand-email">
        <CardHeader
          title="Site email branding & MailDrip"
          description="Configure custom email branding and MailDrip sending specifically for this site. Overrides account-level branding on outgoing emails."
        />

        <div className="plx-settings" style={{ marginTop: 8 }}>
          <label className="plx-toggle">
            <span>
              <b>Use custom email branding for this site</b>
              <span className="plx-small" style={{ display: "block" }}>
                When enabled, customer receipts, donation confirmations, and order updates will carry this site&apos;s custom logo, sender name, and colors.
              </span>
            </span>
            <input
              type="checkbox"
              className="plx-switch"
              checked={data.emailBrandEnabled}
              disabled={saving}
              onChange={(e) => {
                const next = e.target.checked;
                setData({ ...data, emailBrandEnabled: next });
                void saveSettings({ emailBrandEnabled: next });
              }}
            />
          </label>
        </div>

        {data.emailBrandEnabled && (
          <div className="plx-form" style={{ marginTop: 20 }}>
            <div className="plx-form__two">
              <Input
                label="Sender display name ('From Name')"
                placeholder={siteName}
                value={data.emailSenderName}
                onChange={(e) => setData({ ...data, emailSenderName: e.target.value })}
                help="Appears as the sender name in customer inboxes and receipt headers (e.g. Charisol)."
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="plx-field__label">Sending email address</label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    height: 42,
                    padding: "0 12px",
                    borderRadius: "var(--plx-radius-sm, 8px)",
                    background: "var(--plx-tint)",
                    border: "1px solid var(--plx-border)",
                    color: "var(--plx-heading)",
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                >
                  <Mail size={16} style={{ color: "var(--plx-muted)", flexShrink: 0 }} aria-hidden />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {data.maildripConnected && data.maildripConnectedEmail
                      ? data.maildripConnectedEmail
                      : "notifications@plexopages.com"}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: 999,
                      background: "var(--plx-surface)",
                      color: data.maildripConnected ? "var(--plx-deep)" : "var(--plx-muted)",
                      border: "1px solid var(--plx-border)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {data.maildripConnected ? "MailDrip" : "Default"}
                  </span>
                </div>
                <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
                  {data.maildripConnected
                    ? "Powered by your connected MailDrip account's verified sending domain."
                    : "Connect MailDrip below to send from your own domain."}
                </span>
              </div>
            </div>

            {/* Logo and Accent Color Row */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label className="plx-field__label">Email header logo</label>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 64,
                    height: 48,
                    borderRadius: "var(--plx-radius-sm, 8px)",
                    background: "var(--plx-tint)",
                    border: "1px solid var(--plx-border)",
                    overflow: "hidden",
                  }}
                >
                  {effectiveLogo ? (
                    <img
                      src={effectiveLogo}
                      alt="Email logo preview"
                      style={{ maxHeight: 36, maxWidth: 56, objectFit: "contain" }}
                    />
                  ) : (
                    <ImagePlus size={20} style={{ color: "var(--plx-muted)" }} aria-hidden />
                  )}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  loading={uploadingLogo}
                  leftIcon={<Upload size={14} aria-hidden />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {data.emailLogoUrl ? "Change logo" : "Upload email logo"}
                </Button>
                {defaultLogo && data.emailLogoUrl !== defaultLogo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setData({ ...data, emailLogoUrl: defaultLogo })}
                  >
                    Use site logo
                  </Button>
                )}
                {data.emailLogoUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    style={{ color: "var(--plx-danger)" }}
                    onClick={() => setData({ ...data, emailLogoUrl: "" })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <div className="plx-form__two" style={{ alignItems: "flex-end" }}>
              <Input
                label="Brand accent color"
                placeholder="var(--plx-brand)"
                value={data.emailBrandColor}
                onChange={(e) => setData({ ...data, emailBrandColor: e.target.value })}
                help="Used for header accents, badge highlights, and email buttons."
              />
              {effectiveColor && data.emailBrandColor !== effectiveColor && (
                <div style={{ paddingBottom: 10 }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setData({ ...data, emailBrandColor: effectiveColor })}
                  >
                    Use site color
                  </Button>
                </div>
              )}
            </div>

            <Textarea
              label="Custom footer text (optional)"
              placeholder="e.g. Thank you for your support. All contributions are tax-deductible."
              value={data.emailFooterText}
              onChange={(e) => setData({ ...data, emailFooterText: e.target.value })}
              help="Appears at the bottom of customer receipts and notification emails."
              style={{ minHeight: 76 }}
            />

            <div>
              <Button loading={saving} onClick={() => void saveSettings()}>
                Save email branding
              </Button>
            </div>
          </div>
        )}

        {/* MailDrip Delivery Section */}
        <div
          style={{
            marginTop: 20,
            padding: "16px 18px",
            borderRadius: "var(--plx-radius-md, 12px)",
            background: "var(--plx-tint)",
            border: "1px solid var(--plx-border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "var(--plx-surface)",
                  border: "1px solid var(--plx-border)",
                  color: "var(--plx-deep)",
                }}
              >
                <Mail size={18} aria-hidden />
              </span>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ color: "var(--plx-heading)", fontSize: 14 }}>MailDrip Sending</b>
                  {data.maildripConnected ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--plx-surface)",
                        color: "var(--plx-deep)",
                        border: "1px solid var(--plx-border)",
                      }}
                    >
                      <Check size={12} aria-hidden /> Connected
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "var(--plx-surface)",
                        color: "var(--plx-muted)",
                        border: "1px solid var(--plx-border)",
                      }}
                    >
                      Default Delivery
                    </span>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--plx-muted)", lineHeight: 1.45 }}>
                  {data.maildripConnected
                    ? `Connected as ${data.maildripConnectedEmail || "your MailDrip account"}. Transactional emails for this site send through your MailDrip sending configuration.`
                    : "Connect your MailDrip account so outbound receipts and store notifications send directly through your own verified identity."}
                </p>
              </div>
            </div>

            <div>
              {data.maildripConnected ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={disconnecting}
                  leftIcon={<Unlink size={14} aria-hidden />}
                  style={{ color: "var(--plx-danger)" }}
                  onClick={() => void disconnectMaildrip()}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  leftIcon={<Mail size={14} aria-hidden />}
                  onClick={() => {
                    setConnectModal(true);
                    setVerifying(false);
                    setConnectError(null);
                  }}
                >
                  Connect MailDrip
                </Button>
              )}
            </div>
          </div>
        </div>

        {error && <p className="plx-field__error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </Card>

      {/* Seamless MailDrip Connect Modal */}
      <Modal
        open={connectModal}
        onClose={() => setConnectModal(false)}
        title={verifying ? "Confirm MailDrip code" : "Connect MailDrip"}
        description={
          verifying
            ? `Type the code sent to ${connectEmail} to complete the connection.`
            : "Connect your MailDrip account seamlessly. We fetch and secure your API key to send emails for this site."
        }
      >
        <div className="plx-form">
          {!verifying ? (
            <>
              <div className="plx-hchips" role="radiogroup" aria-label="MailDrip connection option">
                <button
                  type="button"
                  role="radio"
                  aria-checked={connectMode === "login"}
                  className="plx-hchip"
                  onClick={() => { setConnectMode("login"); setConnectError(null); }}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={connectMode === "register"}
                  className="plx-hchip"
                  onClick={() => { setConnectMode("register"); setConnectError(null); }}
                >
                  Create account
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={connectMode === "direct_key"}
                  className="plx-hchip"
                  onClick={() => { setConnectMode("direct_key"); setConnectError(null); }}
                >
                  Enter API key
                </button>
              </div>

              {connectMode === "register" && (
                <div className="plx-form__two">
                  <Input
                    label="Full name"
                    value={connectName}
                    onChange={(e) => setConnectName(e.target.value)}
                    autoComplete="name"
                  />
                  <Input
                    label="Phone number"
                    type="tel"
                    value={connectPhone}
                    onChange={(e) => setConnectPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </div>
              )}

              <Input
                label="Email address"
                type="email"
                value={connectEmail}
                onChange={(e) => setConnectEmail(e.target.value)}
                autoComplete="email"
                placeholder="name@example.com"
              />

              {connectMode !== "direct_key" ? (
                <Input
                  label="Password"
                  type="password"
                  value={connectPassword}
                  onChange={(e) => setConnectPassword(e.target.value)}
                  help="Transferred securely to MailDrip to authenticate your account. Never stored."
                  autoComplete={connectMode === "login" ? "current-password" : "new-password"}
                />
              ) : (
                <Input
                  label="MailDrip API key"
                  type="password"
                  value={connectApiKey}
                  onChange={(e) => setConnectApiKey(e.target.value)}
                  help="Your private API key from MailDrip settings. Encrypted upon storage."
                  placeholder="md_..."
                />
              )}

              {connectError && <p className="plx-field__error" role="alert">{connectError}</p>}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <Button variant="secondary" onClick={() => setConnectModal(false)}>Cancel</Button>
                <Button loading={connectBusy} onClick={() => void submitConnect()}>
                  {connectMode === "register" ? "Create MailDrip Account" : connectMode === "direct_key" ? "Connect with API key" : "Sign in & Connect"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 14 }}>
                MailDrip sent a 6-digit confirmation code to <b>{connectEmail}</b>.
              </p>
              <Input
                label="Verification code"
                inputMode="numeric"
                value={verifyCode}
                onChange={(e) => { setConnectError(null); setVerifyCode(e.target.value); }}
                autoComplete="one-time-code"
                placeholder="123456"
              />
              {connectError && <p className="plx-field__error" role="alert">{connectError}</p>}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <Button variant="ghost" onClick={() => setVerifying(false)}>Back</Button>
                <Button loading={connectBusy} onClick={() => void submitVerify()}>
                  Verify & Connect
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
