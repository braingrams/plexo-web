"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { ArrowLeft, Sparkles, ShieldCheck, CheckCircle2, Lock, Eye, EyeOff } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Mulish } from "next/font/google";
import { PlexoLogo } from "@/app/plexo-logo";

const mulish = Mulish({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const redirectTo = params.get("redirectTo") ?? "/dashboard";

    try {
      const result = await (authClient as any).signIn.email({
        email,
        password,
        callbackURL: redirectTo,
      });

      const status = result?.error?.status;
      if (status === 403) {
        setError("This account is not verified yet. Check your email for the verification link.");
        return;
      }

      if (result?.error) {
        setError(result.error.message ?? "Invalid credentials.");
        return;
      }

      router.push(redirectTo);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Invalid credentials.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

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

      {/* Form */}
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && (
          <div className="p-4 rounded-2xl bg-red-950/80 border border-red-800 text-red-300 text-xs font-semibold">
            {error}
          </div>
        )}

        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-xs font-extrabold uppercase tracking-wider text-slate-300 block">
            Email address
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full bg-[#090d16] border border-slate-800 focus:border-purple-500 rounded-2xl px-4 py-3.5 text-sm text-white placeholder-slate-600 focus:outline-none transition-all"
          />
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-extrabold uppercase tracking-wider text-slate-300 block">
              Password
            </label>
            <Link href="/auth/forgot-password" className="text-xs font-bold text-purple-400 hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="login-password"
              type={showPw ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-[#090d16] border border-slate-800 focus:border-purple-500 rounded-2xl px-4 py-3.5 pr-12 text-sm text-white placeholder-slate-600 focus:outline-none transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Submit */}
        <div className="pt-2">
          <button
            id="login-submit"
            type="submit"
            disabled={loading}
            className="w-full bg-[#6b3bf9] hover:bg-[#5b2be6] text-white font-extrabold text-base py-4 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <span>Signing in...</span> : <span>Sign In</span>}
          </button>
        </div>
      </form>

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
