"use client";

import { formatCountdown } from "./countdown";

/** "Send it again" link that is disabled, with a visible countdown, until the cooldown is over. */
export function ResendButton({ left, busy, onResend, label = "Send it again" }: { left: number; busy?: boolean; onResend: () => void; label?: string }) {
  const waiting = left > 0;
  return (
    <button type="button" className="ax-link" onClick={onResend} disabled={waiting || busy} aria-live="polite">
      {busy ? "Sending…" : waiting ? `${label} in ${formatCountdown(left)}` : label}
    </button>
  );
}
