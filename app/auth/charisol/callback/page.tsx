"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CharisolAuth, POST_LOGIN_REDIRECT_KEY } from "@/lib/charisolAuth";
import { authClient } from "@/lib/auth-client";

// redirectUri target registered for Plexo's Charisol app client (Developer Portal) and
// passed to CharisolAuth.init() in lib/charisolAuth.ts. CharisolAuth.init() already saw
// this page's ?code=&state= on import (module scope, ahead of this component's own effect
// — see lib/charisolAuth.ts's comment) and kicked off the PKCE code exchange; getSession()
// here just awaits that in-flight exchange rather than starting a new one.
export default function CharisolCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function completeSignIn(): Promise<void> {
      const redirectTo = window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY) ?? "/dashboard";
      window.sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);

      let session;
      try {
        session = await CharisolAuth.getSession();
      } catch {
        if (!cancelled) setError("That sign-in link expired or was already used. Please try again.");
        return;
      }

      if (!session) {
        if (!cancelled) setError("Google sign-in didn't complete. Please try again.");
        return;
      }

      const result = await authClient.signIn.charisol({ idToken: session.idToken });
      if (cancelled) return;

      if (result.error) {
        setError(result.error.message);
        return;
      }

      router.push(redirectTo);
    }

    void completeSignIn();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-screen bg-[#0b0f19] text-white flex items-center justify-center px-4">
      {error ? (
        <div className="max-w-sm text-center space-y-4">
          <p className="text-sm font-semibold text-red-300">{error}</p>
          <a href="/auth/login" className="inline-block text-sm font-bold text-purple-400 hover:underline">
            Back to sign in
          </a>
        </div>
      ) : (
        <p className="text-sm font-mono text-slate-400">Finishing sign-in…</p>
      )}
    </main>
  );
}
