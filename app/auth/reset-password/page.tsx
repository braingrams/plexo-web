"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

import { Link2 as LinkIcon, ShieldCheck } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { Alert, Button, PageHead } from "@/app/auth/_kit/ui";
import { PasswordField, TextField } from "@/app/auth/_kit/fields";
import { ResendButton } from "@/app/auth/_kit/ResendButton";
import { useCountdown } from "@/app/auth/_kit/countdown";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/passwordPolicy";

// Two ways in:
//  - ?token=…&email=…  — the emailed reset LINK (accounts whose password Plexo still holds);
//  - ?mode=code&email=… — a 6-digit CODE emailed by Charisol Auth (accounts whose password now
//    lives in Charisol), optionally with reason=security when sign-in itself required a new
//    password (a moved-over password that doesn't meet the password rules).
function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const token = params.get("token");
  const codeMode = params.get("mode") === "code";
  const securityReset = params.get("reason") === "security";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A code was just emailed, so "send a new one" waits a minute.
  const { left, restart } = useCountdown(60);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!email || (!codeMode && !token)) {
      setError("This reset link is incomplete. Request a new one from the Forgot password page.");
      return;
    }
    if (codeMode && !/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from the email we sent you.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const problem = passwordProblem(password, email);
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    try {
      const result = await authClient.resetPassword(
        codeMode ? { email, code: code.trim(), newPassword: password } : { token: token!, email, newPassword: password },
      );
      if (result?.error) {
        setError(result.error.message ?? "Unable to reset password.");
        return;
      }
      router.push(`/auth/login?passwordReset=1&email=${encodeURIComponent(email)}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to reset password.");
    } finally {
      setLoading(false);
    }
  }

  async function resendCode(): Promise<void> {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const result = await authClient.forgetPassword({ email });
      if (result?.error) setError(result.error.message ?? "Couldn't send a new code.");
      else {
        restart();
        setNotice("We've sent a new code. It can take a minute to arrive — check your spam folder too.");
      }
    } finally {
      setResending(false);
    }
  }

  // A link missing its token or email can't work. Say so up front instead of after they've typed a password.
  if (!email || (!codeMode && !token)) {
    return (
      <div className="ax-center-text">
        <div className="ax-badge-icon ax-warn"><LinkIcon size={30} aria-hidden="true" /></div>
        <PageHead title="This link doesn’t look right">
          It may be cut off or already used.
        </PageHead>
        <Link href="/auth/forgot-password" className="ax-btn ax-btn-primary">Get a new link</Link>
        <p className="ax-foot"><Link href="/auth/login" className="ax-link">Back to sign in</Link></p>
      </div>
    );
  }

  const confirmMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  return (
    <>
      {securityReset ? (
        <div className="ax-badge-icon ax-warn"><ShieldCheck size={30} aria-hidden="true" /></div>
      ) : null}
      <PageHead title={securityReset ? "Choose a new password" : codeMode ? "Enter your code" : "Choose a new password"}>
        {securityReset
          ? "For your security, set a new password. We emailed you a 6-digit code."
          : codeMode
            ? <>We emailed a code to <strong>{email || "you"}</strong>.</>
            : "Choose something strong."}
      </PageHead>

      <form onSubmit={onSubmit} noValidate className="ax-stack">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}

        {codeMode ? (
          <TextField
            label="6-digit code"
            className="ax-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            autoFocus
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
        ) : null}

        <PasswordField
          label="New password"
          required
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          showRules
        />
        <PasswordField
          label="Confirm new password"
          required
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={confirmMismatch ? "Passwords don’t match yet." : null}
          okNote={confirmPassword && !confirmMismatch ? "Passwords match" : null}
        />

        <Button type="submit" loading={loading}>{loading ? "Saving…" : "Save new password"}</Button>
      </form>

      <p className="ax-foot">
        {codeMode && email ? (
          <>
            Didn’t get it?{" "}
            <ResendButton left={left} busy={resending} onResend={() => void resendCode()} label="Send a new code" />
            <br />
          </>
        ) : null}
        <Link href="/auth/login" className="ax-link">Back to sign in</Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
