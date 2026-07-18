import Link from "next/link";

export default function HomePage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1 className="auth-title">Plexo Identity Core</h1>
        <p className="auth-subtitle">
          Custom Better Auth and Maildrip-enabled lifecycle flows are ready.
        </p>
        <p className="auth-meta">
          <Link className="auth-link" href="/auth/register">
            Create an account
          </Link>
          {"  |  "}
          <Link className="auth-link" href="/auth/login">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
