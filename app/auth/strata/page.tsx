"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Lock } from "lucide-react";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { Alert, Button, Divider, PageHead } from "@/app/auth/_kit/ui";
import { PasswordField, TextField } from "@/app/auth/_kit/fields";
import { GoogleButton } from "@/app/auth/GoogleAuthButton";
import { CharisolAuth, silentCharisolSignIn } from "@/lib/charisolAuth";
import { STRATA_CONNECTED_MESSAGE, STRATA_FAILED_MESSAGE, markStrataConnect } from "@/lib/strataConnect";

// The small window the editor opens for "Connect Strata".
//  - By default it quietly reuses the person's own Charisol sign-in (nothing to type, it closes by itself).
//  - If there's none to reuse — or they chose "Switch account" — it shows one clean Strata sign-in: email and password
//    (or Google), then closes and the editor shows who is connected.
function ConnectStrata() {
  const params = useSearchParams();
  const switching = params.get("switch") === "1";
  const askToSignIn = switching || params.get("signin") === "1";
  const [phase, setPhase] = useState<"connecting" | "form" | "done">(askToSignIn ? "form" : "connecting");
  const [plexoEmail, setPlexoEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch("/api/v1/strata/session")
      .then((r) => r.json().catch(() => null))
      .then((s: { plexoEmail?: string; error?: string } | null) => {
        if (s?.plexoEmail) {
          setPlexoEmail(s.plexoEmail);
          if (!switching) setEmail(s.plexoEmail);
        }
      })
      .catch(() => undefined);
    if (!askToSignIn) {
      markStrataConnect(window.sessionStorage);
      silentCharisolSignIn().catch(() => setPhase("form"));
    }
  }, [askToSignIn, switching]);

  function tell(type: typeof STRATA_CONNECTED_MESSAGE | typeof STRATA_FAILED_MESSAGE, message?: string) {
    window.opener?.postMessage({ type, message }, window.location.origin);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/strata/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
      const body = (await res.json().catch(() => null)) as { error?: string; user?: { email?: string } } | null;
      if (!res.ok) {
        setError(body?.error ?? "Your brand couldn't be connected. Please try again.");
        setBusy(false);
        return;
      }
      setWho(body?.user?.email ?? email.trim());
      setPhase("done");
      tell(STRATA_CONNECTED_MESSAGE);
      setTimeout(() => window.close(), 900);
    } catch {
      setError("Couldn't reach Plexo. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    setError(null);
    markStrataConnect(window.sessionStorage, Date.now(), switching);
    try {
      await CharisolAuth.signIn({ idp: "Google" });
    } catch {
      setBusy(false);
      setError("We couldn't open Google sign-in. Please try again.");
    }
  }

  return (
    <AuthShell layout="center">
      <div className="ax-pair" aria-hidden="true">
        <span className="ax-tile">P</span>
        <span>···</span>
        <span className="ax-tile">S</span>
      </div>

      {phase === "connecting" && (
        <div role="status" className="ax-center-text">
          <span className="ax-spinner" style={{ margin: "0 auto 16px", display: "block", width: 26, height: 26 }} aria-hidden="true" />
          <PageHead title="Connecting to your brand…">Using your Charisol account. This only takes a moment.</PageHead>
        </div>
      )}

      {phase === "done" && (
        <div role="status" className="ax-center-text">
          <div className="ax-badge-icon ax-lime"><CheckCircle2 size={30} aria-hidden="true" /></div>
          <PageHead title="Your brand is connected">{who ? `Signed in as ${who}. ` : ""}You can close this window.</PageHead>
        </div>
      )}

      {phase === "form" && (
        <>
          <PageHead title={switching ? "Use another brand account" : "Sign in to your brand"}>
            {switching ? "Sign in with the brand account you want to use in Plexo." : "We couldn't connect you automatically. Sign in to bring your brand in."}
          </PageHead>
          <form onSubmit={submit} className="ax-stack">
            {error && <Alert tone="error">{error}</Alert>}
            <TextField label="Email" type="email" autoComplete="username" inputMode="email" required autoFocus={!email} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={plexoEmail || "you@example.com"} />
            <PasswordField label="Password" autoComplete="current-password" required autoFocus={!!email} value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" loading={busy} disabled={!email || !password}>{busy ? "Connecting…" : "Connect your brand"}</Button>
          </form>
          <Divider />
          <GoogleButton onClick={google} disabled={busy} />
          <p className="ax-hint ax-center-text" style={{ marginTop: 20 }}><Lock size={12} style={{ display: "inline", verticalAlign: "-1px", marginRight: 6 }} aria-hidden="true" />Your password goes straight to your brand. Plexo never keeps it.</p>
        </>
      )}
    </AuthShell>
  );
}

export default function ConnectStrataPage() {
  return (
    <Suspense fallback={null}>
      <ConnectStrata />
    </Suspense>
  );
}
