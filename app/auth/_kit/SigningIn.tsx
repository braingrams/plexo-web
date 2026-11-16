"use client";

import { AlertCircle } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { Button, PageHead } from "./ui";

/** Calm "one moment" screen shown while sign-in finishes. With `error`, shows a plain-words retry instead. */
export function SigningIn({ error, onRetry, line = "Signing you in…" }: { error?: string | null; onRetry?: () => void; line?: string }) {
  return (
    <AuthShell layout="center">
      {error ? (
        <div className="ax-center-text">
          <div className="ax-badge-icon ax-warn"><AlertCircle size={30} aria-hidden="true" /></div>
          <PageHead title="That didn’t work">{error}</PageHead>
          <Button type="button" onClick={onRetry}>Try again</Button>
        </div>
      ) : (
        <div className="ax-center-text" role="status" aria-live="polite">
          <div className="ax-progress" aria-hidden="true"><span /></div>
          <p className="ax-wait-line">{line}</p>
        </div>
      )}
    </AuthShell>
  );
}
