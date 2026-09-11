"use client";

import { useEffect, useRef, useState } from "react";
import { X, Mail, CheckCircle2 } from "lucide-react";

const DISMISS_KEY = "plexo_newsletter_popup_dismissed_at";
const DISMISS_DAYS = 30;
const DELAY_MS = 5000;

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return false;
    return Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    // Private browsing / storage blocked — fail open (show it) rather than never showing.
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Nothing to do — worst case it shows again next visit.
  }
}

/**
 * Newsletter lead-capture popup for the marketing homepage only (app/page.tsx) — shows once
 * per visitor per 30 days, triggered by whichever comes first: a 5-second delay, or
 * exit-intent (the cursor leaving out the top of the viewport, the standard "about to close
 * the tab/switch away" signal). Submits to app/api/public/newsletter/route.ts, Plexo's own
 * marketing list — unrelated to a tenant site's own newsletter signup
 * (app/api/public/commerce/newsletter/route.ts).
 */
export function NewsletterPopup() {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const shownRef = useRef(false);

  useEffect(() => {
    if (wasRecentlyDismissed()) return;

    function show() {
      if (shownRef.current) return;
      shownRef.current = true;
      setVisible(true);
    }

    const timer = setTimeout(show, DELAY_MS);

    function onMouseLeave(e: MouseEvent) {
      if (e.clientY <= 0) show();
    }
    document.addEventListener("mouseleave", onMouseLeave);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  function close() {
    setVisible(false);
    markDismissed();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/public/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setStatus("success");
      markDismissed();
      setTimeout(() => setVisible(false), 2500);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 font-['Mulish',sans-serif]"
      onClick={close}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-[#0b0f19] border border-slate-800 shadow-2xl p-8 text-white"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Newsletter signup"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {status === "success" ? (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <h3 className="text-xl font-extrabold">You&apos;re in!</h3>
            <p className="text-sm text-slate-400">We&apos;ll keep you posted on what&apos;s new with Plexo.</p>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-[#6b3bf9]/15 flex items-center justify-center mb-5">
              <Mail className="w-6 h-6 text-[#a78bfa]" />
            </div>
            <h3 className="text-2xl font-extrabold tracking-tight mb-2">Stay in the loop</h3>
            <p className="text-sm text-slate-400 mb-6">
              Product updates, new templates, and tips for building faster with Plexo — straight to your inbox.
            </p>
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-slate-700 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#6b3bf9]"
              />
              {error && <p className="text-xs font-medium text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={status === "submitting"}
                className="w-full bg-[#6b3bf9] hover:bg-[#5b2be6] disabled:opacity-60 text-white py-3 rounded-xl font-extrabold text-sm transition-colors"
              >
                {status === "submitting" ? "Subscribing…" : "Subscribe"}
              </button>
            </form>
            <p className="mt-4 text-[11px] text-slate-500 text-center">No spam. Unsubscribe anytime.</p>
          </>
        )}
      </div>
    </div>
  );
}
