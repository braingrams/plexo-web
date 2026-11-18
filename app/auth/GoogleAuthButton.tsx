"use client";

import { useState } from "react";
import { triggerGoogleSignIn } from "@/lib/charisolAuth";
import { Button } from "./_kit/ui";

function GoogleIcon() {
  // The Google "G" is Google's own artwork, kept as an image so no brand colours live in components.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/google.svg" width={18} height={18} alt="" aria-hidden="true" />;
}

/** The Google button itself, for screens that run their own Google sign-in. */
export function GoogleButton({ onClick, loading = false, disabled = false }: { onClick: () => void; loading?: boolean; disabled?: boolean }) {
  return (
    <Button type="button" variant="secondary" onClick={onClick} loading={loading} disabled={disabled}>
      {loading ? null : <GoogleIcon />}
      <span>{loading ? "Opening Google…" : "Continue with Google"}</span>
    </Button>
  );
}

export function GoogleAuthButton({ callbackURL }: { callbackURL: string }) {
  const [loading, setLoading] = useState(false);

  async function onClick(): Promise<void> {
    setLoading(true);
    try {
      await triggerGoogleSignIn(callbackURL);
    } catch {
      setLoading(false);
    }
  }

  return <GoogleButton onClick={onClick} loading={loading} />;
}
