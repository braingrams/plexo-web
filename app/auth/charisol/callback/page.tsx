"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CharisolAuth, POST_LOGIN_REDIRECT_KEY } from "@/lib/charisolAuth";
import { authClient } from "@/lib/auth-client";
import { DashboardSkeleton } from "./dashboard-skeleton";

// redirectUri target registered for Plexo's Charisol app client (Developer Portal) and
// passed to CharisolAuth.init() in lib/charisolAuth.ts. CharisolAuth.init() already saw
// this page's ?code=&state= on import (module scope, ahead of this component's own effect
// — see lib/charisolAuth.ts's comment) and kicked off the PKCE code exchange; getSession()
// here just awaits that in-flight exchange rather than starting a new one.
//
// No inline error/success state here — a failure routes back to /auth/login with the
// message as a query param (?error=...) rather than rendering an error on this page, and
// success routes straight into the real dashboard. The skeleton below is only ever shown
// mid-flight, so there's nothing for this page itself to render once the exchange settles
// either way.
export default function CharisolCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    function failAndReturnToLogin(message: string): void {
      if (cancelled) return;
      router.replace(`/auth/login?error=${encodeURIComponent(message)}`);
    }

    async function completeSignIn(): Promise<void> {
      const redirectTo = window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY) ?? "/dashboard";
      window.sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);

      let session;
      try {
        session = await CharisolAuth.getSession();
      } catch {
        failAndReturnToLogin("That sign-in link expired or was already used. Please try again.");
        return;
      }

      if (!session) {
        failAndReturnToLogin("Google sign-in didn't complete. Please try again.");
        return;
      }

      const result = await authClient.signIn.charisol({ idToken: session.idToken });
      if (cancelled) return;

      if (result.error) {
        failAndReturnToLogin(result.error.message ?? "Google sign-in didn't complete. Please try again.");
        return;
      }

      router.push(redirectTo);
    }

    void completeSignIn();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return <DashboardSkeleton />;
}
