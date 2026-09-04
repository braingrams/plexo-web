"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsActionBar } from "../_components/SettingsActionBar";

type MaildripGroup = { id: string; title: string; description: string | null; totalContacts: number };

type InitialNotificationsSettings = {
  maildripConnected: boolean;
  maildripPaidGroupId: string;
  maildripNewsletterGroupId: string;
  notificationEmail: string;
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

// Deliberately `backgroundColor` (longhand), not `background` — the `background` shorthand
// resets background-image too, which would blank out globals.css's native <select> dropdown
// arrow (the reason the picker below rendered with no visible arrow, looking like a plain
// disabled box instead of a real dropdown).
const selectStyle: React.CSSProperties = {
  width: "100%", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "0.55rem 1rem", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit",
  fontSize: "0.8rem", fontWeight: 700, background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
  justifySelf: "start",
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

// --- Connect flow — mirrors plexo-sdk's MaildripConnectPanel (the same flow behind a form
// block's "Connect MailDrip" provider option), reimplemented here as a plain dashboard
// component talking to the same /api/v1/maildrip/[templateId]/connect route. Real login/
// create-account against MailDrip's own account API, never a redirect off-site. ---------

type ConnectResult = { status: "connected" } | { status: "verify_required"; email: string } | { status: "sent" } | { error: string };

function isConnectError(result: ConnectResult): result is { error: string } {
  return "error" in result;
}

function MaildripConnect({ templateId, onConnected }: { templateId: string; onConnected: () => void }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [step, setStep] = useState<"credentials" | "verify">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  async function callConnect(body: Record<string, unknown>): Promise<ConnectResult> {
    const res = await fetch(`/api/v1/maildrip/${templateId}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? "Something went wrong. Try again." };
    return data;
  }

  function handleResult(result: ConnectResult) {
    if (isConnectError(result)) {
      setError(result.error);
      return;
    }
    if (result.status === "connected") {
      onConnected();
      return;
    }
    if (result.status === "verify_required") setStep("verify");
  }

  async function submitCredentials() {
    if (!email.trim() || !password || (tab === "register" && (!name.trim() || !phone.trim()))) return;
    setBusy(true);
    setError(null);
    try {
      handleResult(
        await callConnect(
          tab === "register"
            ? { action: "register", email: email.trim(), password, name: name.trim(), companyName: name.trim(), phone: phone.trim() }
            : { action: "login", email: email.trim(), password },
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      handleResult(await callConnect({ action: "verify", email: email.trim(), code: code.trim() }));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResendState("sending");
    const result = await callConnect({ action: "resend", email: email.trim() });
    setResendState(isConnectError(result) ? "idle" : "sent");
    if (isConnectError(result)) setError(result.error);
  }

  if (step === "verify") {
    return (
      <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "1rem", display: "grid", gap: "0.7rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#f0f2ff" }}>Check your email</span>
        <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", margin: 0 }}>
          MailDrip sent a verification code to <strong style={{ color: "#f0f2ff" }}>{email}</strong>. Enter it below to finish connecting.
        </p>
        <FieldLabel label="Verification code">
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} style={inputStyle} />
        </FieldLabel>
        <button type="button" onClick={() => void submitVerify()} disabled={busy || !code.trim()} style={primaryBtnStyle}>
          {busy ? "Verifying…" : "Verify & connect"}
        </button>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resendState === "sending"}
          style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", fontSize: "0.75rem", cursor: "pointer", textDecoration: "underline", justifySelf: "start", fontFamily: "inherit", padding: 0 }}
        >
          {resendState === "sent" ? "Code resent" : resendState === "sending" ? "Sending…" : "Didn't get it? Resend code"}
        </button>
        {error && <p style={{ fontSize: "0.75rem", color: "#f87171", margin: 0 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "1rem", display: "grid", gap: "0.7rem" }}>
      <div style={{ display: "flex", gap: "0.4rem" }}>
        {(["login", "register"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setError(null);
            }}
            style={{
              flex: 1, padding: "0.45rem", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 700,
              background: tab === t ? "linear-gradient(135deg,var(--brand),var(--brand-deep))" : "rgba(255,255,255,0.04)",
              color: tab === t ? "#fff" : "rgba(240,242,255,0.55)",
            }}
          >
            {t === "login" ? "Log in" : "Create account"}
          </button>
        ))}
      </div>
      {tab === "register" && (
        <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 160px" }}>
            <FieldLabel label="Name">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </FieldLabel>
          </div>
          <div style={{ flex: "1 1 160px" }}>
            <FieldLabel label="Phone number">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </FieldLabel>
          </div>
        </div>
      )}
      <FieldLabel label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
      </FieldLabel>
      <FieldLabel label="Password">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
      </FieldLabel>
      <button
        type="button"
        onClick={() => void submitCredentials()}
        disabled={busy || !email.trim() || !password || (tab === "register" && (!name.trim() || !phone.trim()))}
        style={{ ...primaryBtnStyle, opacity: busy ? 0.7 : 1 }}
      >
        {busy ? "Connecting…" : tab === "login" ? "Log in" : "Create account"}
      </button>
      {error && <p style={{ fontSize: "0.75rem", color: "#f87171", margin: 0 }}>{error}</p>}
      <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)", margin: 0 }}>
        Your password goes straight to MailDrip's own login — it's never stored here.
      </p>
    </div>
  );
}

// --- Group picker — a real dropdown of the connected account's groups (GET/POST
// /api/v1/maildrip/[templateId]/groups), with inline "create a new group" instead of the
// old free-text Group ID field. -----------------------------------------------------------

function GroupSelect({
  label, hint, templateId, groups, groupsError, value, onChange, onGroupCreated,
}: {
  label: string;
  hint?: string;
  templateId: string;
  groups: MaildripGroup[] | null;
  groupsError: string | null;
  value: string;
  onChange: (id: string) => void;
  onGroupCreated: (group: MaildripGroup) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/maildrip/${templateId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't create that group.");
      onGroupCreated(data.group);
      onChange(data.group.id);
      setCreating(false);
      setNewTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FieldLabel label={label} hint={hint}>
      {groupsError ? (
        <p style={{ fontSize: "0.75rem", color: "#f87171", margin: 0 }}>{groupsError}</p>
      ) : creating ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New group name" style={inputStyle} autoFocus />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy || !newTitle.trim()}
            style={{ ...primaryBtnStyle, padding: "0 1rem", flexShrink: 0, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => { setCreating(false); setError(null); setNewTitle(""); }}
            style={{ padding: "0 0.9rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <select
          value={value}
          disabled={groups === null}
          onChange={(e) => {
            if (e.target.value === "__create__") setCreating(true);
            else onChange(e.target.value);
          }}
          style={selectStyle}
        >
          <option value="" style={{ background: "#0d0f1a" }}>
            {groups === null ? "Loading groups…" : groups.length === 0 ? "No groups yet" : "— none —"}
          </option>
          {groups?.map((g) => (
            <option key={g.id} value={g.id} style={{ background: "#0d0f1a" }}>
              {g.title} ({g.totalContacts})
            </option>
          ))}
          <option value="__create__" style={{ background: "#0d0f1a" }}>+ Create new group…</option>
        </select>
      )}
      {error && <p style={{ fontSize: "0.72rem", color: "#f87171", margin: "0.3rem 0 0" }}>{error}</p>}
    </FieldLabel>
  );
}

export function NotificationsSettingsClient({ templateId, initial }: { templateId: string; initial: InitialNotificationsSettings }) {
  const router = useRouter();
  const [connected, setConnected] = useState(initial.maildripConnected);
  const [showConnectFlow, setShowConnectFlow] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [groups, setGroups] = useState<MaildripGroup[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [maildripPaidGroupId, setMaildripPaidGroupId] = useState(initial.maildripPaidGroupId);
  const [maildripNewsletterGroupId, setMaildripNewsletterGroupId] = useState(initial.maildripNewsletterGroupId);
  const [notificationEmail, setNotificationEmail] = useState(initial.notificationEmail);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setGroups(null);
    setGroupsError(null);
    fetch(`/api/v1/maildrip/${templateId}/groups`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) throw new Error(data.error ?? "Couldn't load your MailDrip groups.");
        setGroups(data.groups);
      })
      .catch((err) => {
        if (!cancelled) setGroupsError(err instanceof Error ? err.message : "Couldn't load your MailDrip groups.");
      });
    return () => {
      cancelled = true;
    };
  }, [connected, templateId]);

  async function handleDisconnect() {
    if (!confirm("Disconnect MailDrip? Your saved group selections will be cleared.")) return;
    setDisconnecting(true);
    try {
      await fetch(`/api/v1/maildrip/${templateId}/connect`, { method: "DELETE" });
      setConnected(false);
      setShowConnectFlow(false);
      setGroups(null);
      setMaildripPaidGroupId("");
      setMaildripNewsletterGroupId("");
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maildripPaidGroupId, maildripNewsletterGroupId, notificationEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save settings.");
      setMessage({ kind: "success", text: "Settings saved." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Section title="Order notifications" description="Who gets emailed when a new order comes in.">
        <FieldLabel label="Notification email">
          <input type="email" value={notificationEmail} onChange={(e) => setNotificationEmail(e.target.value)} placeholder="you@example.com" style={{ ...inputStyle, maxWidth: 420 }} />
        </FieldLabel>
      </Section>

      <Section title="MailDrip" description="Tags paying customers and newsletter subscribers into real MailDrip groups, and sends receipts. You can also connect an account directly from a form block's Provider panel in the page editor.">
        {!connected ? (
          showConnectFlow ? (
            <MaildripConnect templateId={templateId} onConnected={() => { setConnected(true); setShowConnectFlow(false); router.refresh(); }} />
          ) : (
            <div style={{ border: "1px dashed rgba(255,255,255,0.12)", borderRadius: 10, padding: "1.1rem", textAlign: "center" }}>
              <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.55)", margin: "0 0 0.9rem", lineHeight: 1.6 }}>
                Connect MailDrip to automatically tag paying customers and newsletter subscribers into real groups, and send order receipts — no keys to find or paste in.
              </p>
              <button type="button" onClick={() => setShowConnectFlow(true)} style={{ ...primaryBtnStyle, justifySelf: "center" }}>
                Connect MailDrip
              </button>
            </div>
          )
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 10, padding: "0.7rem 1rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", color: "#4ade80", fontWeight: 600 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9 12l2 2 4-4" /></svg>
                MailDrip connected
              </span>
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                disabled={disconnecting}
                style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", fontSize: "0.75rem", cursor: disconnecting ? "not-allowed" : "pointer", fontFamily: "inherit", textDecoration: "underline" }}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>

            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                <GroupSelect
                  label="Group for paid customers"
                  hint="Automatically tags a customer into this group after a paid order."
                  templateId={templateId}
                  groups={groups}
                  groupsError={groupsError}
                  value={maildripPaidGroupId}
                  onChange={setMaildripPaidGroupId}
                  onGroupCreated={(g) => setGroups((prev) => (prev ? [...prev, g] : [g]))}
                />
              </div>
              <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                <GroupSelect
                  label="Group for newsletter subscribers"
                  hint="Powers the site's newsletter signup block — separate from paying customers, since a visitor can subscribe without buying anything."
                  templateId={templateId}
                  groups={groups}
                  groupsError={groupsError}
                  value={maildripNewsletterGroupId}
                  onChange={setMaildripNewsletterGroupId}
                  onGroupCreated={(g) => setGroups((prev) => (prev ? [...prev, g] : [g]))}
                />
              </div>
            </div>
          </>
        )}
      </Section>

      <SettingsActionBar saving={saving} message={message} onSave={() => void handleSave()} />
    </div>
  );
}
