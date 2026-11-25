"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { SolMascot } from "./SolMascot";
import { SOL_INTRO_BODY, SOL_INTRO_HEADING, SOL_INTRO_HIDE_LABEL, SOL_INTRO_KEY, SOL_INTRO_PROMPTS, shouldShowSolIntro, solIntroHref } from "@/lib/dashboardV3/solIntro";
import "./solIntro.css";

// The copy is shared with the dashboard tour (lib/dashboardV3/solIntro.ts); re-exported so either import path works.
export { SOL_INTRO_BODY, SOL_INTRO_CTA, SOL_INTRO_HEADING, SOL_INTRO_HIDE_LABEL, SOL_INTRO_KEY, SOL_INTRO_PROMPTS, solIntroHref } from "@/lib/dashboardV3/solIntro";

function readLocalSeen(): boolean {
  try {
    return window.localStorage.getItem(SOL_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Remember on the account (and in this browser) that the hello is done: they closed it, tapped an idea, or sent a first message.
 * Safe to call any number of times.
 */
export function markSolIntroSeen(): void {
  if (typeof window === "undefined" || readLocalSeen()) return;
  try {
    window.localStorage.setItem(SOL_INTRO_KEY, "1");
  } catch {
    /* private mode: the account still remembers it */
  }
  void fetch("/api/dashboard/sol-intro", { method: "POST", keepalive: true }).catch(() => undefined);
}

/**
 * Whether to show SOL's hello right now. The account is the truth (so it follows the owner between devices); this browser keeps a
 * copy so a returning owner never waits on the network. Stays false until we know, so a seen hello never flashes.
 */
export function useSolIntro(wanted = true): { visible: boolean; dismiss: () => void } {
  const [serverSeen, setServerSeen] = useState<boolean | null>(null);
  const [localSeen, setLocalSeen] = useState(true); // true until checked: nothing shows before we know
  useEffect(() => {
    if (!wanted) return;
    const local = readLocalSeen();
    setLocalSeen(local);
    if (local) return;
    let off = false;
    fetch("/api/dashboard/sol-intro")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { seen?: boolean } | null) => {
        if (off) return;
        if (d?.seen) {
          try {
            window.localStorage.setItem(SOL_INTRO_KEY, "1");
          } catch {
            /* ignore */
          }
        }
        setServerSeen(!!d?.seen);
      })
      .catch(() => {
        if (!off) setServerSeen(false); // can't reach the account: saying hello is never harmful
      });
    return () => {
      off = true;
    };
  }, [wanted]);
  const dismiss = useCallback(() => {
    setLocalSeen(true);
    markSolIntroSeen();
  }, []);
  return { visible: shouldShowSolIntro({ wanted, localSeen, serverSeen }), dismiss };
}

/** The hello itself: SOL's mascot, one line in the first person, and three ideas to tap. */
export function SolIntroView({ onPick, onDismiss }: { onPick: (prompt: string) => void; onDismiss: () => void }) {
  return (
    <section className="sol-intro" aria-label="A hello from SOL" data-tour="sol-intro">
      <span className="sol-intro__mark" aria-hidden>
        <SolMascot size={140} waving />
      </span>
      <div>
        <p className="sol-intro__title">{SOL_INTRO_HEADING}</p>
        <p className="sol-intro__body">{SOL_INTRO_BODY}</p>
      </div>
      <div className="sol-intro__prompts">
        {SOL_INTRO_PROMPTS.map((p) => (
          <button key={p} type="button" className="sol-intro__prompt" onClick={() => onPick(p)}>
            {p}
          </button>
        ))}
      </div>
      <button type="button" className="sol-intro__x" onClick={onDismiss} aria-label={SOL_INTRO_HIDE_LABEL} title={SOL_INTRO_HIDE_LABEL}>
        <X size={16} aria-hidden />
      </button>
    </section>
  );
}

/**
 * SOL says hello once per person. `onPick` starts the idea in the place the card sits (a chat sends it); without it, an idea opens
 * SOL with those words ready in the chat box. `show` is the caller's decision (for example "this is the owner's first site").
 */
export function SolIntroCard({ show = true, onPick }: { show?: boolean; onPick?: (prompt: string) => void }) {
  const router = useRouter();
  const { visible, dismiss } = useSolIntro(show);
  if (!visible) return null;
  return (
    <SolIntroView
      onDismiss={dismiss}
      onPick={(p) => {
        dismiss();
        if (onPick) onPick(p);
        else router.push(solIntroHref(p));
      }}
    />
  );
}
