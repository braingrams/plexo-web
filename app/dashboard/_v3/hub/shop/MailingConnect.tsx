"use client";

import { useState } from "react";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { Button, Input } from "../../ui";
import { CONNECT_STEPS, connectProblem, friendlyConnectError, stepFor, type ConnectTab } from "@/lib/commerce/mailingList";

type Result = { status: "connected" } | { status: "verify_required"; email: string } | { status: "sent" } | { error: string };

/** Connect MailDrip in three plain steps: sign in or make an account, confirm with a code, done. Same connect route as always. */
export function MailingConnect({ templateId, onConnected }: { templateId: string; onConnected: () => void }) {
  const [tab, setTab] = useState<ConnectTab>("login");
  const [verifying, setVerifying] = useState(false);
  const [f, setF] = useState({ email: "", password: "", name: "", phone: "" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const step = stepFor(false, verifying);

  async function call(body: Record<string, unknown>): Promise<Result> {
    try {
      const res = await fetch(`/api/v1/maildrip/${templateId}/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { error: friendlyConnectError(data.error) };
      return data;
    } catch {
      return { error: "We couldn't reach MailDrip. Check your internet and try again." };
    }
  }
  function handle(r: Result) {
    if ("error" in r) return setError(r.error);
    if (r.status === "connected") return onConnected();
    if (r.status === "verify_required") setVerifying(true);
  }
  async function submit() {
    const bad = connectProblem(tab, f);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    handle(await call(tab === "register" ? { action: "register", email: f.email.trim(), password: f.password, name: f.name.trim(), companyName: f.name.trim(), phone: f.phone.trim() } : { action: "login", email: f.email.trim(), password: f.password }));
    setBusy(false);
  }
  async function verify() {
    if (!code.trim()) return setError("Type the code from MailDrip's email.");
    setBusy(true);
    setError(null);
    handle(await call({ action: "verify", email: f.email.trim(), code: code.trim() }));
    setBusy(false);
  }
  async function resend() {
    setResent(false);
    const r = await call({ action: "resend", email: f.email.trim() });
    if ("error" in r) setError(r.error);
    else setResent(true);
  }
  const set = (p: Partial<typeof f>) => { setError(null); setF({ ...f, ...p }); };

  return (
    <div className="plx-form">
      <ol className="plx-cstep" aria-label="Steps to connect">
        {CONNECT_STEPS.map((s) => (
          <li key={s.step} aria-current={s.step === step ? "step" : undefined} data-done={s.step < step || undefined}>
            <b>{s.step}. {s.title}</b>
            <span>{s.body}</span>
          </li>
        ))}
      </ol>
      {!verifying ? (
        <>
          <div className="plx-hchips" role="radiogroup" aria-label="Do you have a MailDrip account?">
            <button type="button" role="radio" aria-checked={tab === "login"} className="plx-hchip" onClick={() => { setTab("login"); setError(null); }}>I have a MailDrip account</button>
            <button type="button" role="radio" aria-checked={tab === "register"} className="plx-hchip" onClick={() => { setTab("register"); setError(null); }}>Make me an account</button>
          </div>
          {tab === "register" ? (
            <div className="plx-form__two">
              <Input label="Your name" value={f.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" />
              <Input label="Phone number" type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="tel" />
            </div>
          ) : null}
          <Input label="Email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" />
          <Input label="Password" type="password" help="Goes straight to MailDrip to sign you in. We never keep it." value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete={tab === "login" ? "current-password" : "new-password"} />
          {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
          <div><Button loading={busy} onClick={submit}>{tab === "login" ? "Sign in to MailDrip" : "Make my account"}</Button></div>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>MailDrip sent a code to <b>{f.email}</b>. It can take a minute to arrive.</p>
          <Input label="The code" inputMode="numeric" value={code} onChange={(e) => { setError(null); setCode(e.target.value); }} autoComplete="one-time-code" />
          {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Button loading={busy} onClick={verify}>Confirm and connect</Button>
            <Button variant="ghost" onClick={resend}>{resent ? "New code sent" : "Send me a new code"}</Button>
            <Button variant="ghost" onClick={() => { setVerifying(false); setError(null); }}>Use a different email</Button>
          </div>
        </>
      )}
    </div>
  );
}
