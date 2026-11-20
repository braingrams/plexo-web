"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useState } from "react";
import { Check, Mail } from "lucide-react";
import { Input, useToast } from "../ui";
import { isDirty } from "@/lib/dashboardV3/settingsSaveBar";
import { errMsg, hubApi } from "../hub/hubApi";
import { AsideCard, AsideStats, Notice, Panel, SaveBar, SettingsPageShell, ToggleRow } from "./bits";

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
  const { show } = useToast();

  const patch = (json: Record<string, unknown>) => (mock ? Promise.resolve({}) : hubApi("/api/v1/notification-preferences", { method: "PATCH", json }, "We couldn't save that. Please try again."));

  async function toggle(key: Key, next: boolean) {
    setPrefs((p) => ({ ...p, [key]: next }));
    setError(null);
    try {
      await patch({ [key]: next });
      show({ title: next ? "Turned on" : "Turned off", tone: "success" });
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
      show({ title: "Saved", description: v ? `Emails will go to ${v}.` : "Emails will go to your sign-in email.", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const GROUPS: { title: string; blurb: string; keys: Key[] }[] = [
    { title: "Money", blurb: "Know the moment a customer pays.", keys: ["payments"] },
    { title: "Your visitors", blurb: "When someone writes to you or joins in.", keys: ["formSubmissions", "blogComments"] },
    { title: "Your team", blurb: "When a teammate needs you.", keys: ["commentMentions"] },
  ];
  const dirty = isDirty({ email: prefs.notificationEmail ?? "" }, { email: email.trim() });
  const bad = email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <SettingsPageShell
      title="Notifications"
      purpose="Choose which emails Plexo sends you about your sites."
      bar={<SaveBar dirty={dirty} saving={busy === "email"} valid={!bad} onSave={saveEmail} onDiscard={() => { setEmail(prefs.notificationEmail ?? ""); setError(null); }} />}
      aside={
        <>
        <AsideCard title="Where emails go" icon={Mail}>
          <AsideStats items={[{ label: `of ${ROWS.length} kinds of email are on`, value: ROWS.filter((r) => prefs[r.key]).length, tone: "ok" }]} />
          <p>They arrive at <b>{prefs.notificationEmail || accountEmail}</b>.</p>
        </AsideCard>
        <AsideCard title="Good to know">
          <ul>
            <li><Check size={16} aria-hidden /> <span>Switches save the moment you tap them.</span></li>
            <li><Check size={16} aria-hidden /> <span>Important emails, like signing in or someone sending you a site, always arrive.</span></li>
            <li><Check size={16} aria-hidden /> <span>Emails go to {prefs.notificationEmail || accountEmail}.</span></li>
          </ul>
        </AsideCard>
        </>
      }
    >
      {error ? <GateOrError error={error}><Notice tone="bad">{error}</Notice></GateOrError> : null}
      <div data-tour="notif-list" className="plx-sp__main">
        {GROUPS.map((g) => (
          <Panel key={g.title} title={g.title} description={g.blurb}>
            {g.keys.map((k) => {
              const r = ROWS.find((x) => x.key === k)!;
              return <ToggleRow key={k} title={r.title} description={r.body} checked={prefs[k]} onChange={(v) => toggle(k, v)} />;
            })}
          </Panel>
        ))}
      </div>
      <Panel title="Where should they go?" description={`We use ${accountEmail} unless you pick another.`}>
        <div className="plx-sform">
          <Input label="Send them to" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={accountEmail} help="Leave it empty to use your sign-in email." error={bad ? "That doesn't look like an email address. Please check it." : undefined} />
        </div>
      </Panel>
    </SettingsPageShell>
  );
}
