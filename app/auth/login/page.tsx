"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ShieldCheck, CheckCircle2 } from "lucide-react";
import { Mulish } from "next/font/google";
import { PlexoLogo } from "@/app/plexo-logo";
import { CharisolSignInButton } from "@/app/auth/CharisolSignInButton";
import { authClient } from "@/lib/auth-client";
import { isPrPreviewHost } from "@/lib/isPrPreviewHost";

const mulish = Mulish({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

/**
 * PR previews only. Charisol (like Google before it) only redirects back to callback URLs
 * registered for Plexo, and every preview has its own throwaway pr-<N>.plexo.aws.charisol.io
 * host that never is — so "Sign in with Charisol" can't complete there. Previews share
 * staging's Users table (see .github/workflows/pr-deploy-aws.yml), so testers sign in with
 * an existing staging account's password instead. Never rendered on a real host.
 */
function PreviewPasswordSignIn({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    try {
      const result = await authClient.signIn.email({ email, password, callbackURL: redirectTo });
      if (result?.error?.code === "google_account_only") {
        setError("This account signs in with Google, which isn't available on PR previews — use a test account that has a password.");
        return;
      }
      if (result?.error?.status === 403) {
        setError("This account is not verified yet. Check your email for the verification link.");
        return;
      }
      if (result?.error) {
        setError(result.error.message ?? "Invalid credentials.");
        return;
      }
      router.push(redirectTo);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Invalid credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-amber-700/50 bg-amber-950/30 p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-amber-300">PR preview — test sign-in</p>
      {error && <p className="text-xs font-semibold text-red-300">{error}</p>}
      <input
        type="email"
        autoComplete="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-purple-500"
      />
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-purple-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-slate-700 py-3 text-sm font-extrabold text-white hover:bg-slate-600 disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in with password"}
      </button>
    </form>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error] = useState<string | null>(() => params.get("error") ?? params.get("verifyError"));
  const verified = params.get("verified") === "1";
  // Read after mount (not during render) so server and client markup match.
  const [onPrPreview, setOnPrPreview] = useState(false);
  useEffect(() => setOnPrPreview(isPrPreviewHost(window.location.hostname)), []);

  // A failed Charisol/Google sign-in routes back here with ?error=... (see
  // app/auth/charisol/callback/page.tsx) rather than showing anything on that page
  // itself. Strip it from the URL once read so a refresh doesn't keep re-showing it.
  useEffect(() => {
    if (!params.get("error")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    router.replace(`${url.pathname}${url.search}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full max-w-md mx-auto space-y-8 py-12 px-4 sm:px-8">
      {/* Mobile Back Link & Logo */}
      <div className="lg:hidden flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Plexo</span>
        </Link>
        <PlexoLogo size={28} textStyle={{ color: "#ffffff" }} />
      </div>

      {/* Form Header */}
      <div className="space-y-2">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
          Welcome back
        </h1>
        <p className="text-sm font-medium text-slate-400">
          Sign in to your Plexo workspace to manage your sites &amp; pages.
        </p>
      </div>

      {verified && !error && (
        <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs font-semibold">
          Email verified. Sign in to continue.
        </div>
      )}
      {error && (
        <div className="p-4 rounded-2xl bg-red-950/80 border border-red-800 text-red-300 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Charisol hosts the actual sign-in page (Google or email + password). */}
      <div className="space-y-3">
        <CharisolSignInButton callbackURL={params.get("redirectTo") ?? "/dashboard"} />
        <p className="text-center text-[11px] font-semibold text-slate-500">
          One Charisol account works across Plexo, Maildrip and more.
        </p>
        {onPrPreview && <PreviewPasswordSignIn redirectTo={params.get("redirectTo") ?? "/dashboard"} />}
      </div>

      {/* Meta Link */}
      <p className="text-center text-xs font-semibold text-slate-400">
        Don&apos;t have an account?{" "}
        <Link href="/auth/register" className="text-purple-400 font-bold hover:underline">
          Create one free
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className={`${mulish.className} min-h-screen bg-[#0b0f19] text-white font-['Mulish',sans-serif] grid grid-cols-1 lg:grid-cols-12 antialiased`}>
      {/* LEFT 50%: Vibrant Branded Showcase Panel */}
      <div className="hidden lg:flex lg:col-span-6 bg-gradient-to-br from-[#120e24] via-[#1b1539] to-[#2b1c54] p-12 flex-col justify-between relative overflow-hidden border-r border-slate-800/80">
        {/* Glow Effects */}
        <div className="absolute top-10 left-10 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-72 h-72 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header */}
        <div className="relative z-10 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <PlexoLogo size={34} href={null} textStyle={{ color: "#ffffff" }} />
          </Link>

          <Link href="/" className="inline-flex items-center gap-2 text-xs font-extrabold text-slate-300 hover:text-white bg-white/10 border border-white/15 px-4 py-2 rounded-xl backdrop-blur-md transition-all">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
        </div>

        {/* Center Content */}
        <div className="relative z-10 space-y-8 max-w-lg my-auto">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-purple-500/10 text-purple-300 border border-purple-500/20">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>ENTERPRISE GRADE BUILDER</span>
            </div>

            <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.08]">
              Build, Publish, and Scale Landing Pages.
            </h2>

            <p className="text-base text-slate-300 leading-relaxed font-medium">
              Create multi-page sites, export clean HTML5 &amp; MJML code, and manage AI agent tools via MCP — with zero vendor lock-in.
            </p>
          </div>

          {/* Testimonial Quote Pill */}
          <div className="bg-slate-950/80 border border-white/15 rounded-3xl p-6 shadow-2xl backdrop-blur-md space-y-3">
            <p className="text-xs font-semibold text-slate-200 leading-relaxed italic">
              &ldquo;Plexo cut our landing page launch time from days to minutes. The MCP AI server integration is unbelievable.&rdquo;
            </p>
            <div className="flex items-center gap-3 pt-1 text-xs">
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center font-bold text-white">
                EO
              </div>
              <div>
                <p className="font-extrabold text-white">Ebuka Okoli</p>
                <p className="text-[11px] text-purple-300">Full Stack Engineer, Maildrip</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Badges */}
        <div className="relative z-10 flex items-center gap-6 text-xs font-bold text-slate-400 border-t border-white/10 pt-6">
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Custom Domains</span>
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> MCP Ready</span>
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> MJML Export</span>
        </div>
      </div>

      {/* RIGHT 50%: Clean Auth Form Container */}
      <div className="lg:col-span-6 flex items-center justify-center min-h-screen">
        <Suspense fallback={<div className="text-slate-400 text-xs font-mono">Loading form...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
