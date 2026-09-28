"use client";

import { useState } from "react";
import { triggerCharisolSignIn } from "@/lib/charisolAuth";

// The one way into Plexo: starts the Charisol Auth redirect (PKCE). The page Charisol hosts
// offers Google and email+password; app/auth/charisol/callback/page.tsx finishes the round
// trip and hands the ID token to the backend, which verifies it before creating a session.
export function CharisolSignInButton({ callbackURL, label = "Sign in with Charisol" }: { callbackURL: string; label?: string }) {
  const [loading, setLoading] = useState(false);

  async function onClick(): Promise<void> {
    setLoading(true);
    try {
      await triggerCharisolSignIn(callbackURL);
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      id="charisol-signin"
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full bg-[#6b3bf9] hover:bg-[#5b2be6] text-white font-extrabold text-base py-4 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
    >
      <span>{loading ? "Redirecting…" : label}</span>
    </button>
  );
}
