"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// "Where submissions go": besides this inbox and the owner's email, each form can add the
// person to a MailDrip list and/or send the submission to a webhook (Zapier, Make, a CRM).
// A migrated WordPress form arrives already set up the way it worked on WordPress.

type Form = {
  formName: string;
  maildripGroupId: string | null;
  maildripGroupTitle: string | null;
  webhookUrl: string | null;
  redirectUrl: string | null;
  source: string | null;
  note: string | null;
  lastDeliveredAt: string | null;
  lastDeliveryError: string | null;
};
type Overview = { forms: Form[]; maildrip: { connected: boolean; groups: { id: string; title: string; totalContacts: number }[]; error: string | null } };

const muted: React.CSSProperties = { fontSize: "0.8rem", color: "var(--ed-t-500)", margin: 0, lineHeight: 1.5 };
const input: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.65rem", borderRadius: 8, border: "1px solid var(--ed-w-120)",
  background: "var(--ed-w-030)", color: "var(--ed-text)", fontSize: "0.8rem", fontFamily: "inherit",
};

export function FormDestinationsClient({ templateId }: { templateId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    fetch(`/api/v1/templates/${templateId}/form-settings`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't load your forms.");
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your forms."));
  }
  useEffect(load, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p style={{ ...muted, color: "var(--ed-danger)", marginBottom: "1.5rem" }}>{error}</p>;
  if (!data || data.forms.length === 0) return null;

  return (
    <section style={{ marginBottom: "2rem", padding: "1.25rem", borderRadius: 14, border: "1px solid var(--ed-w-080)", background: "var(--ed-w-020)" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 800, color: "var(--ed-text)", margin: "0 0 0.3rem" }}>Where submissions go</h2>
      <p style={muted}>
        Every submission lands here and in your email. You can also add each form&rsquo;s sign-ups to a MailDrip list, or send them to a webhook (Zapier, Make, your CRM).
      </p>
      {!data.maildrip.connected && (
        <p style={{ ...muted, marginTop: "0.6rem" }}>
          <Link href={`/dashboard/commerce/${templateId}/settings/notifications`} style={{ color: "var(--ed-accent-text)", fontWeight: 700 }}>Connect MailDrip</Link>{" "}
          to add sign-ups straight to your lists.
        </p>
      )}
      {data.maildrip.error && <p style={{ ...muted, color: "var(--ed-amber)", marginTop: "0.6rem" }}>{data.maildrip.error}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", marginTop: "1rem" }}>
        {data.forms.map((form) => (
          <FormRow key={form.formName} templateId={templateId} form={form} overview={data} onSaved={load} />
        ))}
      </div>
    </section>
  );
}

function FormRow({ templateId, form, overview, onSaved }: { templateId: string; form: Form; overview: Overview; onSaved: () => void }) {
  const [groupId, setGroupId] = useState(form.maildripGroupId ?? "");
  const [webhook, setWebhook] = useState(form.webhookUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dirty = groupId !== (form.maildripGroupId ?? "") || webhook !== (form.webhookUrl ?? "");
  // A list chosen on WordPress (or before MailDrip was disconnected) that this account doesn't list.
  const unknownGroup = form.maildripGroupId && !overview.maildrip.groups.some((g) => g.id === form.maildripGroupId);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/form-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formName: form.formName, maildripGroupId: groupId || null, webhookUrl: webhook.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't save.");
      setMessage({ tone: "ok", text: "Saved — new submissions go here from now on." });
      onSaved();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Couldn't save." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "0.9rem", borderRadius: 10, border: "1px solid var(--ed-w-060)", background: "rgba(0,0,0,0.15)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <strong style={{ fontSize: "0.85rem", color: "var(--ed-text)" }}>{form.formName}</strong>
        {form.source === "wordpress" && (
          <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: 999, background: "color-mix(in srgb, var(--ed-lavender) 12%, transparent)", color: "var(--ed-lavender)" }}>Set up from WordPress</span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.6rem" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.72rem", color: "var(--ed-t-550)" }}>
          Add sign-ups to a MailDrip list
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!overview.maildrip.connected && !groupId} style={input}>
            <option value="">{overview.maildrip.connected ? "Don't add to a list" : "Connect MailDrip first"}</option>
            {unknownGroup && <option value={form.maildripGroupId!}>{form.maildripGroupTitle ?? "List from WordPress"} (not found — pick again)</option>}
            {overview.maildrip.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.title} ({g.totalContacts.toLocaleString()})</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.72rem", color: "var(--ed-t-550)" }}>
          Also send each submission to a webhook
          <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.zapier.com/…" style={input} />
        </label>
      </div>
      {form.redirectUrl && <p style={{ ...muted, marginTop: "0.6rem" }}>After submitting, visitors go to <code>{form.redirectUrl}</code>.</p>}
      {form.note && <p style={{ ...muted, marginTop: "0.6rem" }}>{form.note}</p>}
      {form.lastDeliveryError ? (
        <p style={{ ...muted, color: "var(--ed-amber)", marginTop: "0.5rem" }}>Last delivery problem: {form.lastDeliveryError}</p>
      ) : form.lastDeliveredAt ? (
        <p style={{ ...muted, marginTop: "0.5rem" }}>Last delivered {new Date(form.lastDeliveredAt).toLocaleString()}.</p>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.7rem" }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          style={{ padding: "0.45rem 0.9rem", borderRadius: 8, border: "none", fontSize: "0.78rem", fontWeight: 700, cursor: dirty && !saving ? "pointer" : "not-allowed", background: dirty ? "color-mix(in srgb, var(--brand) 20%, transparent)" : "var(--ed-w-050)", color: dirty ? "var(--ed-accent-text)" : "var(--ed-t-350)" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message && <span style={{ fontSize: "0.76rem", color: message.tone === "ok" ? "var(--ed-success)" : "var(--ed-danger)" }}>{message.text}</span>}
      </div>
    </div>
  );
}
