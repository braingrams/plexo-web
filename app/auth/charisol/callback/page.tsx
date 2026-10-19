"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CharisolAuth, POST_LOGIN_REDIRECT_KEY, initialAuthError } from "@/lib/charisolAuth";
import { authClient } from "@/lib/auth-client";
import { clearStrataConnect, finishStrataConnect, isAnotherStrataAccount, takeStrataConnect } from "@/lib/strataConnect";
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
// Decided once per page load, not per effect run: React's dev-mode double effect would otherwise
// find the one-time marker already consumed and fall through to a normal Plexo sign-in.
let strataConnectRun: Promise<boolean> | undefined;

export default function CharisolCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    function failAndReturnToLogin(message: string): void {
      if (cancelled) return;
      router.replace(`/auth/login?error=${encodeURIComponent(message)}`);
    }

    // The same callback serves the "Connect Strata" popup (app/auth/strata/page.tsx): there the
    // ID token goes to /api/v1/strata/session and the person is NOT signed in to Plexo again.
    async function completeStrataConnect(): Promise<void> {
      // Charisol had no signed-in session to reuse (the silent attempt came back empty): ask for the Strata sign-in ourselves.
      if (initialAuthError && !strataConnectRun) {
        clearStrataConnect(window.sessionStorage);
        router.replace("/auth/strata?signin=1");
        return;
      }
      const anotherAccount = isAnotherStrataAccount(window.sessionStorage);
      clearStrataConnect(window.sessionStorage);
      const handedBack = await (strataConnectRun ??= finishStrataConnect({
        getIdToken: async () => (await CharisolAuth.getSession())?.idToken ?? null,
        fetchFn: (input, init) => fetch(input, init),
        opener: window.opener,
        origin: window.location.origin,
        close: () => window.close(),
        anotherAccount,
      }));
      // Opened directly rather than as a popup: nobody to tell, so just go back to the app.
      if (!handedBack && !cancelled) router.replace("/dashboard/apps");
    }

    async function completeSignIn(): Promise<void> {
      if (strataConnectRun || takeStrataConnect(window.sessionStorage)) return completeStrataConnect();
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

      // Keep this Charisol sign-in on the server so other Charisol products (Strata) can open as them without another login.
      if (session.refreshToken) {
        await fetch("/api/v1/charisol/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: session.refreshToken }) }).catch(() => undefined);
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
