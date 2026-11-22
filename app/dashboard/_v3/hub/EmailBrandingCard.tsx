"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ImagePlus,
  Layers,
  Mail,
  Palette as PaletteIcon,
  Send,
  Shield,
  Smartphone,
  Trash2,
  Unlink,
  Upload,
} from "lucide-react";
import { Button, Card, CardHeader, Input, Modal, OptimisticLoader, Textarea, useToast } from "../ui";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { friendlyConnectError } from "@/lib/commerce/mailingList";
import { PALETTE } from "@/lib/onboarding/flow";

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
  savedColors,
}: {
  siteId: string;
  siteName: string;
  defaultLogo?: string;
  defaultColor?: string;
  savedColors?: string[];
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

  // Unconnected state preview toggle: "default" vs "branded"
  const [previewTab, setPreviewTab] = useState<"default" | "branded">("default");

  // Swatch color popover
  const [colorMenuOpen, setColorMenuOpen] = useState(false);

  // Edit mode toggle for compact view
  const [editing, setEditing] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

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
      setEditing(false);
      show({ title: "Email branding saved", tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save email settings");
    } finally {
      setSaving(false);
    }
  };

  const sendTestEmail = async () => {
    setSendingTest(true);
    try {
      const res = await fetch(`/api/v1/templates/${siteId}/email-settings/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to send test email");
      show({
        title: `Test email sent to ${json.to}!`,
        description: "Check your inbox to inspect your live branded receipt.",
        tone: "success",
      });
    } catch (err) {
      show({ title: err instanceof Error ? err.message : "Failed to send test email", tone: "danger" });
    } finally {
      setSendingTest(false);
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
          title="Site Custom Email Branding"
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
  const effectiveColor = data.emailBrandColor || defaultColor || data.siteBrandColor || PALETTE[0].hex;
  const effectiveSenderName = data.emailSenderName.trim() || siteName;
  const effectiveFooterText = data.emailFooterText.trim() || "Please keep this email as your payment receipt.";

  // Distinct brand saved colors
  const brandColors = Array.from(
    new Set([defaultColor, data.siteBrandColor, ...(savedColors ?? [])].filter((c): c is string => Boolean(c))),
  );

  return (
    <>
      <Card data-tour="hub-brand-email">
        <CardHeader
          title="Site Custom Email Branding"
          description="Connect your MailDrip account so customer receipts, orders, and confirmations send directly through your own verified identity and custom branding."
        />

        <div className="plx-emailbrand__layout" style={{ marginTop: 16 }}>
          {/* Left Column: Interactive Workflow & Customization */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
            {/* Step 1: MailDrip Connection State */}
            {!data.maildripConnected ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Visual Animated Pipeline: Plexo -> MailDrip -> Customer */}
                <div className="plx-mailflow" aria-label="MailDrip sending workflow">
                  <div className="plx-mailflow__node">
                    <span className="plx-mailflow__icon" title="Plexo system">
                      <Layers size={18} aria-hidden />
                    </span>
                    <b style={{ fontSize: 12, color: "var(--plx-heading)" }}>Plexo</b>
                    <span className="plx-small" style={{ fontSize: 11, color: "var(--plx-muted)" }}>
                      Triggers receipt
                    </span>
                  </div>

                  <div className="plx-mailflow__track" aria-hidden>
                    <div className="plx-mailflow__packet" />
                  </div>

                  <div className="plx-mailflow__node">
                    <span
                      className="plx-mailflow__icon"
                      style={{
                        borderColor: "var(--plx-focus)",
                        background: "var(--plx-surface)",
                        color: "var(--plx-deep)",
                      }}
                      title="Your MailDrip Account"
                    >
                      <Mail size={18} aria-hidden />
                    </span>
                    <b style={{ fontSize: 12, color: "var(--plx-heading)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {siteName}
                    </b>
                    <span className="plx-small" style={{ fontSize: 11, color: "var(--plx-muted)" }}>
                      MailDrip sender
                    </span>
                  </div>

                  <div className="plx-mailflow__track" aria-hidden>
                    <div className="plx-mailflow__packet" style={{ animationDelay: "1.1s" }} />
                  </div>

                  <div className="plx-mailflow__node">
                    <span className="plx-mailflow__icon" title="Customer inbox">
                      <Smartphone size={18} aria-hidden />
                    </span>
                    <b style={{ fontSize: 12, color: "var(--plx-heading)" }}>Customer</b>
                    <span className="plx-small" style={{ fontSize: 11, color: "var(--plx-muted)" }}>
                      From {siteName}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "16px 18px",
                    borderRadius: "var(--plx-radius-md, 12px)",
                    background: "var(--plx-elevated)",
                    border: "1px solid var(--plx-border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <b style={{ fontSize: 14, color: "var(--plx-heading)" }}>Step 1: Connect your MailDrip account</b>
                      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--plx-muted)", lineHeight: 1.45 }}>
                        Plexo sends outbound payment receipts and confirmations through your MailDrip account. Connect MailDrip first so your emails carry your own verified domain and sender name.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      leftIcon={<Mail size={15} aria-hidden />}
                      onClick={() => {
                        setConnectModal(true);
                        setVerifying(false);
                        setConnectError(null);
                      }}
                    >
                      Connect MailDrip
                    </Button>
                  </div>
                </div>

                {/* Before vs After comparison cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: "var(--plx-radius-sm, 8px)",
                      background: "var(--plx-tint)",
                      border: "1px solid var(--plx-border)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: "var(--plx-surface)",
                          color: "var(--plx-muted)",
                          border: "1px solid var(--plx-border)",
                        }}
                      >
                        Before (Default)
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--plx-muted)" }}>
                      <div><b>Sender:</b> Plexo</div>
                      <div><b>Address:</b> plexopages@gmail.com</div>
                      <div><b>Branding:</b> Default system templates</div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: "var(--plx-radius-sm, 8px)",
                      background: "var(--plx-surface)",
                      border: "1px solid var(--plx-border)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 999,
                          background: "var(--plx-tint)",
                          color: "var(--plx-deep)",
                          border: "1px solid var(--plx-border)",
                        }}
                      >
                        After (Connected)
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--plx-text)" }}>
                      <div><b>Sender:</b> {siteName}</div>
                      <div><b>Address:</b> Your verified sending domain</div>
                      <div><b>Branding:</b> Your logo, accent colors &amp; footer</div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 14px",
                    borderRadius: "var(--plx-radius-sm, 8px)",
                    background: "var(--plx-tint)",
                    color: "var(--plx-muted)",
                    fontSize: 12,
                  }}
                >
                  <AlertCircle size={15} style={{ flexShrink: 0 }} aria-hidden />
                  <span>Connect MailDrip above to unlock custom display name, logo, accent colors, and custom receipt notes.</span>
                </div>
              </div>
            ) : !editing && (data.emailSenderName || data.emailBrandColor || data.emailLogoUrl || data.emailFooterText) ? (
              /* Compact Summary View */
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                    padding: "16px 18px",
                    borderRadius: "var(--plx-radius-sm, 8px)",
                    background: "var(--plx-surface)",
                    border: "1px solid var(--plx-border)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "var(--plx-radius-sm, 8px)",
                        border: "1px solid var(--plx-border)",
                        background: "var(--plx-tint)",
                        display: "grid",
                        placeItems: "center",
                        overflow: "hidden",
                        flexShrink: 0,
                      }}
                    >
                      {effectiveLogo ? (
                        <img src={effectiveLogo} alt="" style={{ maxWidth: 36, maxHeight: 36, objectFit: "contain" }} />
                      ) : (
                        <span style={{ width: 20, height: 20, borderRadius: "50%", background: effectiveColor }} />
                      )}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <b style={{ color: "var(--plx-heading)", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {effectiveSenderName}
                        </b>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 999,
                            background: "var(--plx-tint)",
                            color: "var(--plx-deep)",
                            border: "1px solid var(--plx-border)",
                          }}
                        >
                          MailDrip Active
                        </span>
                      </div>
                      <span className="plx-small" style={{ color: "var(--plx-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Sending from {data.maildripConnectedEmail || "your MailDrip account"}
                        {data.emailFooterText ? ` · "${data.emailFooterText}"` : ""}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Button variant="secondary" size="sm" loading={sendingTest} onClick={() => void sendTestEmail()}>
                      Send test email
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                      Edit email branding
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* Connected State: MailDrip Status & Full Customization Form */
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Connected status badge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 16px",
                    borderRadius: "var(--plx-radius-sm, 8px)",
                    background: "var(--plx-tint)",
                    border: "1px solid var(--plx-border)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: "var(--plx-surface)",
                        border: "1px solid var(--plx-border)",
                        color: "var(--plx-deep)",
                      }}
                    >
                      <Check size={16} aria-hidden />
                    </span>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <b style={{ color: "var(--plx-heading)", fontSize: 13 }}>MailDrip Connected &amp; Active</b>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: "var(--plx-surface)",
                            color: "var(--plx-deep)",
                            border: "1px solid var(--plx-border)",
                          }}
                        >
                          Verified Identity
                        </span>
                      </div>
                      <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
                        Sending from {data.maildripConnectedEmail || "your MailDrip account"}
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    loading={disconnecting}
                    leftIcon={<Unlink size={13} aria-hidden />}
                    style={{ color: "var(--plx-danger)" }}
                    onClick={() => void disconnectMaildrip()}
                  >
                    Disconnect
                  </Button>
                </div>

                {/* Custom Branding Controls */}
                <div className="plx-form">
                  <div className="plx-form__two">
                    <Input
                      label="Sender display name ('From Name')"
                      placeholder={siteName}
                      value={data.emailSenderName}
                      onChange={(e) => setData({ ...data, emailSenderName: e.target.value })}
                      help="Appears as the sender in customer inboxes (e.g. Charisol)."
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
                          {data.maildripConnectedEmail || "Connected account"}
                        </span>
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: 999,
                            background: "var(--plx-surface)",
                            color: "var(--plx-deep)",
                            border: "1px solid var(--plx-border)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          MailDrip
                        </span>
                      </div>
                      <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
                        Powered by your connected MailDrip account&apos;s verified sending domain.
                      </span>
                    </div>
                  </div>

                  {/* Logo Row */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label className="plx-field__label">Email header logo</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 64,
                          height: 44,
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
                            style={{ maxHeight: 34, maxWidth: 54, objectFit: "contain" }}
                          />
                        ) : (
                          <ImagePlus size={18} style={{ color: "var(--plx-muted)" }} aria-hidden />
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

                  {/* Brand Accent Color (Swatch Popover, No raw hex input) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label className="plx-field__label">Brand accent color</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <button
                          type="button"
                          onClick={() => setColorMenuOpen((o) => !o)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "6px 14px",
                            borderRadius: "var(--plx-radius-sm, 8px)",
                            border: "1px solid var(--plx-border)",
                            background: "var(--plx-surface)",
                            cursor: "pointer",
                            fontSize: 13,
                            color: "var(--plx-heading)",
                          }}
                          aria-expanded={colorMenuOpen}
                        >
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: "50%",
                              background: effectiveColor,
                              border: "1px solid var(--plx-border)",
                            }}
                            aria-hidden
                          />
                          <span>{data.emailBrandColor || "Select accent color"}</span>
                          <ChevronDown size={14} style={{ color: "var(--plx-muted)" }} aria-hidden />
                        </button>

                        {effectiveColor && defaultColor && data.emailBrandColor !== defaultColor && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setData({ ...data, emailBrandColor: defaultColor })}
                          >
                            Use site color
                          </Button>
                        )}
                      </div>

                      {/* Swatch Popover */}
                      {colorMenuOpen && (
                        <div
                          style={{
                            padding: 14,
                            borderRadius: "var(--plx-radius-md, 12px)",
                            background: "var(--plx-surface)",
                            border: "1px solid var(--plx-border)",
                            boxShadow: "var(--plx-shadow-elevated)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            maxWidth: 360,
                          }}
                        >
                          {/* Saved brand colors */}
                          {brandColors.length > 0 && (
                            <div>
                              <span className="plx-small" style={{ display: "block", marginBottom: 6, fontWeight: 700, color: "var(--plx-muted)" }}>
                                Brand saved colors
                              </span>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                {brandColors.map((hex) => {
                                  const selected = effectiveColor.toLowerCase() === hex.toLowerCase();
                                  return (
                                    <button
                                      key={hex}
                                      type="button"
                                      aria-label={`Select color ${hex}`}
                                      onClick={() => {
                                        setData({ ...data, emailBrandColor: hex });
                                        setColorMenuOpen(false);
                                      }}
                                      style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: "50%",
                                        background: hex,
                                        border: selected ? "2px solid var(--plx-focus)" : "1px solid var(--plx-border)",
                                        cursor: "pointer",
                                        display: "grid",
                                        placeItems: "center",
                                        color: "var(--plx-surface)",
                                        padding: 0,
                                      }}
                                    >
                                      {selected ? <Check size={14} aria-hidden /> : null}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Curated Swatches from PALETTE */}
                          <div>
                            <span className="plx-small" style={{ display: "block", marginBottom: 6, fontWeight: 700, color: "var(--plx-muted)" }}>
                              Preset palette swatches
                            </span>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              {PALETTE.map((p) => {
                                const selected = effectiveColor.toLowerCase() === p.hex.toLowerCase();
                                return (
                                  <button
                                    key={p.name}
                                    type="button"
                                    title={p.name}
                                    aria-label={`Select ${p.name}`}
                                    onClick={() => {
                                      setData({ ...data, emailBrandColor: p.hex });
                                      setColorMenuOpen(false);
                                    }}
                                    style={{
                                      width: 32,
                                      height: 32,
                                      borderRadius: "50%",
                                      background: p.hex,
                                      border: selected ? "2px solid var(--plx-focus)" : "1px solid var(--plx-border)",
                                      cursor: "pointer",
                                      display: "grid",
                                      placeItems: "center",
                                      color: "var(--plx-surface)",
                                      padding: 0,
                                    }}
                                  >
                                    {selected ? <Check size={14} aria-hidden /> : null}
                                  </button>
                                );
                              })}

                              {/* Native Color Picker Swatch */}
                              <label
                                title="Pick custom color"
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "50%",
                                  background: "var(--plx-tint)",
                                  border: "1px dashed var(--plx-border)",
                                  display: "grid",
                                  placeItems: "center",
                                  cursor: "pointer",
                                  position: "relative",
                                  color: "var(--plx-heading)",
                                }}
                              >
                                <PaletteIcon size={16} aria-hidden />
                                <input
                                  type="color"
                                  value={effectiveColor}
                                  onChange={(e) => setData({ ...data, emailBrandColor: e.target.value.toUpperCase() })}
                                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                                />
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <Textarea
                    label="Custom receipt footer text"
                    placeholder="e.g. Please keep this email as your payment receipt. Thank you for your support!"
                    value={data.emailFooterText}
                    onChange={(e) => setData({ ...data, emailFooterText: e.target.value })}
                    help="Appears at the bottom of customer receipts and notification emails."
                    style={{ minHeight: 76 }}
                  />

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <Button loading={saving} onClick={() => void saveSettings()}>
                      Save email branding
                    </Button>
                    <Button variant="secondary" loading={sendingTest} onClick={() => void sendTestEmail()}>
                      Send test email
                    </Button>
                    {(data.emailSenderName || data.emailBrandColor || data.emailLogoUrl || data.emailFooterText) && (
                      <Button variant="secondary" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Live Mobile Phone Mockup */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Mockup Header Toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span className="plx-small" style={{ fontWeight: 700, color: "var(--plx-heading)" }}>
                Mobile inbox preview
              </span>
              {!data.maildripConnected ? (
                <div style={{ display: "inline-flex", padding: 2, borderRadius: 999, background: "var(--plx-tint)", border: "1px solid var(--plx-border)" }}>
                  <button
                    type="button"
                    onClick={() => setPreviewTab("default")}
                    style={{
                      border: 0,
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: previewTab === "default" ? "var(--plx-surface)" : "transparent",
                      color: previewTab === "default" ? "var(--plx-heading)" : "var(--plx-muted)",
                      cursor: "pointer",
                    }}
                  >
                    Default Plexo
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTab("branded")}
                    style={{
                      border: 0,
                      borderRadius: 999,
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: previewTab === "branded" ? "var(--plx-surface)" : "transparent",
                      color: previewTab === "branded" ? "var(--plx-heading)" : "var(--plx-muted)",
                      cursor: "pointer",
                    }}
                  >
                    With MailDrip
                  </button>
                </div>
              ) : (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--plx-tint)",
                    color: "var(--plx-deep)",
                    border: "1px solid var(--plx-border)",
                  }}
                >
                  Live Updates
                </span>
              )}
            </div>

            {/* Smartphone Chassis */}
            <div className="plx-phone" aria-hidden>
              {/* Top Notch */}
              <div className="plx-phone__notch" />

              <div className="plx-phone__screen">
                {/* Mobile Status Bar */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "var(--plx-muted)", padding: "0 4px" }}>
                  <span>9:41</span>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span>5G</span>
                    <span style={{ display: "inline-block", width: 14, height: 8, borderRadius: 2, border: "1px solid currentColor" }} />
                  </div>
                </div>

                {/* Email Client App Navigation */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--plx-border)", paddingBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--plx-link)", fontSize: 12, fontWeight: 600 }}>
                    <ChevronLeft size={16} />
                    <span>Inbox</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--plx-muted)" }}>
                    <Archive size={14} />
                    <Trash2 size={14} />
                  </div>
                </div>

                {/* Email Message Header */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <b style={{ fontSize: 13, lineHeight: 1.35, color: "var(--plx-heading)" }}>
                    Thank you for your payment — {siteName}
                  </b>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: (data.maildripConnected || previewTab === "branded") ? effectiveColor : "var(--plx-elevated)",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--plx-surface)",
                        fontWeight: 800,
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      {(data.maildripConnected || previewTab === "branded") ? effectiveSenderName.charAt(0).toUpperCase() : "P"}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 4 }}>
                        <b style={{ fontSize: 12, color: "var(--plx-heading)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(data.maildripConnected || previewTab === "branded") ? effectiveSenderName : "Plexo"}
                        </b>
                        <span style={{ fontSize: 10, color: "var(--plx-muted)" }}>9:41 AM</span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--plx-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {(data.maildripConnected || previewTab === "branded")
                          ? `<${data.maildripConnectedEmail || `notifications@${siteName.toLowerCase().replace(/[^a-z0-9]/g, "") || "brand"}.com`}>`
                          : "<plexopages@gmail.com>"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Email Body Card */}
                <div
                  style={{
                    borderRadius: 14,
                    background: "var(--plx-elevated)",
                    border: "1px solid var(--plx-border)",
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {/* Brand Header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--plx-border)", paddingBottom: 8 }}>
                    {(data.maildripConnected || previewTab === "branded") && effectiveLogo ? (
                      <img src={effectiveLogo} alt="" style={{ maxHeight: 24, maxWidth: 90, objectFit: "contain" }} />
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: (data.maildripConnected || previewTab === "branded") ? effectiveColor : "var(--plx-brand)",
                          }}
                        />
                        <b style={{ fontSize: 12, color: "var(--plx-heading)" }}>
                          {(data.maildripConnected || previewTab === "branded") ? effectiveSenderName : "Plexo"}
                        </b>
                      </div>
                    )}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: "var(--plx-surface)",
                        color: (data.maildripConnected || previewTab === "branded") ? effectiveColor : "var(--plx-muted)",
                        border: "1px solid var(--plx-border)",
                      }}
                    >
                      Receipt
                    </span>
                  </div>

                  <p style={{ margin: 0, fontSize: 11, lineHeight: 1.45, color: "var(--plx-text)" }}>
                    Hi! We&apos;ve received your payment successfully. Thank you for choosing {siteName}. We appreciate your business and look forward to serving you! 😊
                  </p>

                  {/* Big Receipt Amount */}
                  <div style={{ padding: "4px 0" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: (data.maildripConnected || previewTab === "branded") ? effectiveColor : "var(--plx-heading)", lineHeight: 1 }}>
                      $1.00
                    </div>
                  </div>

                  {/* Receipt Meta Table */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 11, borderTop: "1px solid var(--plx-border)", paddingTop: 8 }}>
                    <div style={{ color: "var(--plx-muted)" }}>AMOUNT</div>
                    <div style={{ fontWeight: 600, color: "var(--plx-heading)", textAlign: "right" }}>$1.00</div>

                    <div style={{ color: "var(--plx-muted)" }}>FOR</div>
                    <div style={{ fontWeight: 600, color: "var(--plx-heading)", textAlign: "right" }}>Payment Order</div>

                    <div style={{ color: "var(--plx-muted)" }}>DATE</div>
                    <div style={{ fontWeight: 600, color: "var(--plx-heading)", textAlign: "right" }}>Nov 22, 2026</div>

                    <div style={{ color: "var(--plx-muted)" }}>RECEIPT</div>
                    <div style={{ fontWeight: 600, color: "var(--plx-heading)", textAlign: "right" }}>DON-88A81BD5</div>
                  </div>

                  {/* Receipt Footer Note */}
                  <div style={{ borderTop: "1px solid var(--plx-border)", paddingTop: 8, fontSize: 10, color: "var(--plx-muted)", lineHeight: 1.4 }}>
                    {(data.maildripConnected || previewTab === "branded")
                      ? effectiveFooterText
                      : "Please keep this email as your payment receipt."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <GateOrError error={error}>
            <p className="plx-field__error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </p>
          </GateOrError>
        ) : null}
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
                  Verify &amp; Connect
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
