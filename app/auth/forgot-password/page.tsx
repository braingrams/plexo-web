"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { MailCheck } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { Alert, Button, PageHead } from "@/app/auth/_kit/ui";
import { TextField } from "@/app/auth/_kit/fields";
import { InboxLinks } from "@/app/auth/_kit/InboxLinks";
import { ResendButton } from "@/app/auth/_kit/ResendButton";
import { useCountdown } from "@/app/auth/_kit/countdown";
import { emailProblem } from "@/app/auth/_kit/passwordRules";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [resending, setResending] = useState(false);
  const { left, restart } = useCountdown(60, false);

  // Asks for the recovery link; returns true when it was sent (or the person was sent on to enter a code).
  async function requestLink(): Promise<boolean> {
    const redirectTo = `${window.location.origin}/auth/reset-password`;
    const result = await authClient.forgetPassword({
      email,
      redirectTo,
    });

    if (result?.error) {
      setError(result.error.message ?? "Unable to request password reset.");
      return false;
    }

    // Accounts whose password is held by Charisol Auth get a 6-digit code instead of a link.
    if (result.data?.mode === "code") {
      router.push(`/auth/reset-password?mode=code&email=${encodeURIComponent(email.trim().toLowerCase())}`);
      return false;
    }
    return true;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const problem = emailProblem(email);
    if (problem) {
      setEmailTouched(true);
      return;
    }
    setLoading(true);

    try {
      if (await requestLink()) {
        setSuccess("If this email exists, a recovery link has been sent. Check your inbox.");
        restart();
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Unable to request password reset.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function resend(): Promise<void> {
    setError(null);
    setResending(true);
    try {
      if (await requestLink()) restart();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to request password reset.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell>
      {success ? (
        <div className="ax-center-text">
          <div className="ax-badge-icon ax-lime"><MailCheck size={30} aria-hidden="true" /></div>
          <PageHead title="Check your inbox">
            We sent a reset link to <strong>{email.trim()}</strong>.
          </PageHead>
          <InboxLinks />
          {error ? <div style={{ marginTop: 16, textAlign: "left" }}><Alert tone="error">{error}</Alert></div> : null}
          <p className="ax-tips">
            Nothing yet? Check your spam folder, or{" "}
            <ResendButton left={left} busy={resending} onResend={() => void resend()} label="send it again" />.
          </p>
          <p className="ax-foot"><Link href="/auth/login" className="ax-link">Back to sign in</Link></p>
        </div>
      ) : (
        <>
          <PageHead title="Reset your password">We’ll email you a link to reset it.</PageHead>
          <form onSubmit={onSubmit} noValidate className="ax-stack">
            {error ? <Alert tone="error">{error}</Alert> : null}
            <TextField
              id="forgot-email"
              label="Email address"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              error={emailTouched ? emailProblem(email) : null}
              placeholder="you@example.com"
            />
            <Button id="forgot-submit" type="submit" loading={loading}>{loading ? "Sending link…" : "Send reset link"}</Button>
          </form>
          <p className="ax-foot">
            Remembered it?{" "}
            <Link href="/auth/login" className="ax-link">Back to sign in</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
