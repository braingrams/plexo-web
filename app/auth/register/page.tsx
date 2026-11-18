"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { trackEvent, trackUserIdentifiedOnce } from "@/lib/analytics";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/passwordPolicy";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { Alert, Button, Divider, PageHead } from "@/app/auth/_kit/ui";
import { PasswordField, TextField } from "@/app/auth/_kit/fields";
import { emailProblem } from "@/app/auth/_kit/passwordRules";
import { GoogleAuthButton } from "@/app/auth/GoogleAuthButton";
import { CountrySelect } from "@/app/_components/country/CountrySelect";
import { usePricing } from "@/app/dashboard/_components/usePricing";

import { PLAN_LABELS, type PlanId } from "@/lib/plan/plans";

type Plan = PlanId;

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPlan = searchParams.get("plan")?.toUpperCase();
  // ?plan= from the pricing page. ULTRA: a link from before the plan rename (today's Pro).
  const plan: Plan =
    requestedPlan === "ULTRA" ? "PRO" : requestedPlan === "STARTER" || requestedPlan === "PRO" || requestedPlan === "ENTERPRISE" ? requestedPlan : "FREE";

  // Their country decides the currency prices show in. We guess it from where they are (only
  // as a starting point) and they confirm it.
  const { pricing } = usePricing();
  const [country, setCountry] = useState<string | null>(null);
  const [countryTouched, setCountryTouched] = useState(false);
  const [countryError, setCountryError] = useState(false);
  useEffect(() => {
    if (pricing?.country && !countryTouched) setCountry((c) => c ?? pricing.country);
  }, [pricing, countryTouched]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const passwordsMatch = password === confirmPassword;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    const problem = passwordProblem(password, email);
    if (problem) {
      setError(problem);
      return;
    }
    if (!country) {
      setCountryError(true);
      setError("Please pick your country to continue.");
      return;
    }

    setLoading(true);

    try {
      const result = await authClient.signUp.email({
        name: name.trim() || email.split("@")[0] || "Plexo User",
        email,
        password,
        country,
        callbackURL: "/dashboard",
        ...(plan !== "FREE" ? { pendingPlan: plan } : {}),
      });

      if (result?.error) {
        setError(result.error.message ?? "Registration failed.");
        return;
      }

      // Account was created (server returned 201). Fired here, not on button click.
      // The id is the internal account id from the register response; it's only sent when the response has it.
      const newUserId = (result as { data?: { id?: string } } | undefined)?.data?.id;
      trackEvent({ event: "sign_up", method: "email", ...(newUserId ? { user_id: newUserId } : {}) });
      if (newUserId) trackUserIdentifiedOnce({ user_id: newUserId, plan_name: "free", plan_status: "free" });
      router.push(`/auth/confirm?email=${encodeURIComponent(email)}`);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Registration failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHead title="Create your account">Free to start. No card needed.</PageHead>

      {plan !== "FREE" && (
        <p className="ax-center-text" style={{ marginTop: -12, marginBottom: 20 }}>
          <span className="ax-chip">
            <span className="ax-chip-dot" aria-hidden="true" />
            Starting on the {PLAN_LABELS[plan]} trial
          </span>
        </p>
      )}

      {/* Google — note: a paid plan picked above isn't carried through this path today.
          better-auth's social sign-in has no request body to attach pendingPlan to the way
          signUp.email's additionalFields does, so a Google signup always lands on the free
          plan; the user can upgrade from the dashboard afterward. */}
      <GoogleAuthButton callbackURL="/dashboard" />
      <Divider>or</Divider>

      <form onSubmit={onSubmit} noValidate className="ax-stack">
        {error && <Alert tone="error">{error}</Alert>}

        <TextField id="register-name" label="Your name" optional type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Morgan" />
        <TextField
          id="register-email"
          label="Email address"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          error={emailTouched ? emailProblem(email) : null}
          placeholder="you@example.com"
        />
        <PasswordField
          id="register-password"
          label="Password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          showRules
          placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
        />
        <PasswordField
          id="register-confirm-password"
          label="Confirm password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={confirmPassword && !passwordsMatch && confirmTouched ? "Passwords don’t match yet." : null}
          okNote={confirmPassword && passwordsMatch ? "Passwords match" : null}
          onBlur={() => setConfirmTouched(true)}
          placeholder="Repeat password"
        />

        <div className="ax-field">
          <div className="ax-label-row">
            <label htmlFor="register-country" className="ax-label">Which country are you in?</label>
          </div>
          <CountrySelect
            id="register-country"
            value={country}
            invalid={countryError}
            onChange={(c) => {
              setCountry(c);
              setCountryTouched(true);
              setCountryError(false);
            }}
          />
          <p className="ax-hint">So prices show in your own currency.</p>
        </div>

        <Button id="register-submit" type="submit" loading={loading}>{loading ? "Creating your account…" : "Create account"}</Button>
      </form>

      <p className="ax-foot">
        Already have an account?{" "}
        <Link href="/auth/login" className="ax-link">Sign in</Link>
      </p>
    </>
  );
}

export default function RegisterPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
