import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  const callbackURL = "/dashboard/templates";

  if (token) {
    const target = `/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(callbackURL)}`;
    redirect(target);
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Confirm Your Email</h1>
        <p className="auth-subtitle">
          We sent a verification link to your inbox. Open it to activate your account.
        </p>

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
