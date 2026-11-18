import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const params = await searchParams;
  const token = params.token;
  const email = params.email;

  if (token) {
    // Links sent before the change still carry email; the verify route accepts both shapes.
    const query = new URLSearchParams({ token });
    if (email) query.set("email", email);
    redirect(`/api/auth/verify-email?${query.toString()}`);
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
