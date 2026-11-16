"use client";

import { useState } from "react";
import { Button, Card, CardHeader, Input } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { Notice, SectionHead, ToggleRow } from "./bits";

type Key = "payments" | "formSubmissions" | "blogComments" | "commentMentions";
export type NotificationPrefs = Record<Key, boolean> & { notificationEmail: string | null };

const ROWS: { key: Key; title: string; body: string }[] = [
  { key: "payments", title: "Someone pays you", body: "An email each time a customer completes an order." },
  { key: "formSubmissions", title: "Someone fills in a form", body: "A message from your contact form or sign-up form." },
  { key: "blogComments", title: "A comment is waiting", body: "Someone commented on your blog and it needs your OK." },
  { key: "commentMentions", title: "A teammate mentions you", body: "Someone on your team tagged you in a note." },
];

export function NotificationsSection({ initial, accountEmail, mock = false }: { initial: NotificationPrefs; accountEmail: string; mock?: boolean }) {
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState(initial.notificationEmail ?? "");
  const [busy, setBusy] = useState<string | null>(null);

  const patch = (json: Record<string, unknown>) => (mock ? Promise.resolve({}) : hubApi("/api/v1/notification-preferences", { method: "PATCH", json }, "We couldn't save that. Please try again."));

  async function toggle(key: Key, next: boolean) {
    setPrefs((p) => ({ ...p, [key]: next }));
    setError(null);
    try {
      await patch({ [key]: next });
    } catch (e) {
      setPrefs((p) => ({ ...p, [key]: !next }));
      setError(errMsg(e));
    }
  }

  async function saveEmail() {
    const v = email.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setError("That doesn't look like an email address. Please check it and try again.");
    setBusy("email");
    setError(null);
    try {
      await patch({ notificationEmail: v || null });
      setPrefs((p) => ({ ...p, notificationEmail: v || null }));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SectionHead title="Notifications">Choose which emails Plexo sends you about your sites.</SectionHead>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="plx-set__grid">
        <Card data-tour="notif-list">
          <CardHeader title="Email me when…" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ROWS.map((r) => (
              <ToggleRow key={r.key} title={r.title} description={r.body} checked={prefs[r.key]} onChange={(v) => toggle(r.key, v)} />
            ))}
          </div>
          <p className="plx-small" style={{ margin: "16px 0 0" }}>Important emails, like signing in or someone sending you a site, always arrive.</p>
        </Card>
        <Card>
          <CardHeader title="Where should they go?" description={`We use ${accountEmail} unless you pick another.`} />
          <div className="plx-form">
            <Input label="Send them to" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={accountEmail} />
            <div>
              <Button loading={busy === "email"} disabled={email.trim() === (prefs.notificationEmail ?? "")} onClick={saveEmail}>Save</Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
