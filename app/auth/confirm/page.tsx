import Link from "next/link";
import { redirect } from "next/navigation";
import { CharisolSignInButton } from "@/app/auth/CharisolSignInButton";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  const email = params.email;

  if (token && email) {
    const target = `/api/auth/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
    redirect(target);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Confirm Your Email</h1>
        <p className="auth-subtitle">
          We sent a verification link to your inbox. Open it to activate your account.
        </p>

        {/* Sign-in now goes through Charisol. Verify the email first (a Charisol token for an
            unverified address is refused), then continue here or from the verified-email link. */}
        <div className="mt-6">
          <CharisolSignInButton callbackURL="/dashboard" label="I've verified — continue to sign in" />
        </div>

        <p className="auth-meta">
          Need a fresh attempt?{" "}
          <Link href="/auth/login" className="auth-link">
            Return to login
          </Link>
        </p>
      </section>
    </main>
  );
}
