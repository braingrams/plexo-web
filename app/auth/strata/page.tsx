"use client";

import { FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { PlexoLogo } from "@/app/plexo-logo";
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
  const [showPw, setShowPw] = useState(false);
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
        setError(body?.error ?? "Strata couldn't be connected. Please try again.");
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

  const input = "w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)]";

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text-main)] flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-7" aria-hidden="true">
          <PlexoLogo size={36} showText={false} href={null} />
          <span className="text-[var(--text-faint)] tracking-widest">···</span>
          <div className="w-9 h-9 rounded-[10px] bg-[var(--brand)] text-white grid place-items-center font-extrabold text-sm">S</div>
        </div>

        {phase === "connecting" && (
          <div role="status" className="text-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-[var(--brand)]" />
            <h1 className="text-lg font-bold">Connecting to Strata…</h1>
            <p className="text-sm text-[var(--text-muted)]">Using your Charisol account. This only takes a moment.</p>
          </div>
        )}

        {phase === "done" && (
          <div role="status" className="text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
            <h1 className="text-lg font-bold">Strata is connected</h1>
            <p className="text-sm text-[var(--text-muted)]">{who ? `Signed in as ${who}.` : ""} You can close this window.</p>
          </div>
        )}

        {phase === "form" && (
          <form onSubmit={submit} className="space-y-4">
            <div className="text-center space-y-1">
              <h1 className="text-xl font-bold">{switching ? "Use another Strata account" : "Sign in to Strata"}</h1>
              <p className="text-sm text-[var(--text-muted)]">
                {switching ? "Sign in with the Strata account you want to use in Plexo." : "We couldn't connect you automatically. Sign in to bring your brand in."}
              </p>
            </div>
            {error && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300">{error}</div>}
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-muted)]">Email</span>
              <input type="email" autoComplete="username" required autoFocus={!email} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={plexoEmail || "you@example.com"} className={input} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-[var(--text-muted)]">Password</span>
              <div className="relative">
                <input type={showPw ? "text" : "password"} autoComplete="current-password" required autoFocus={!!email} value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} pr-10`} />
                <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>
            <button type="submit" disabled={busy || !email || !password} style={{ color: "#fff" }} className="w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
              {busy ? "Connecting…" : "Connect Strata"}
            </button>
            <div className="flex items-center gap-3 text-[11px] text-[var(--text-faint)]"><span className="h-px flex-1 bg-[var(--surface-border)]" />or<span className="h-px flex-1 bg-[var(--surface-border)]" /></div>
            <button type="button" onClick={google} disabled={busy} className="w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] py-2.5 text-sm font-semibold hover:border-[var(--brand-glow)] disabled:opacity-50 transition-colors">
              Continue with Google
            </button>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-faint)]"><Lock className="w-3 h-3" />Your password goes straight to Strata. Plexo never keeps it.</p>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ConnectStrataPage() {
  return (
    <Suspense fallback={null}>
      <ConnectStrata />
    </Suspense>
  );
}
