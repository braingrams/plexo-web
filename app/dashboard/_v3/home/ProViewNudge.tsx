"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button, Card, useToast } from "../ui";
import type { Experience } from "@/lib/dashboardV3/nav";
import { NUDGE_KEY, readNudgeState, shouldShowProNudge } from "@/lib/dashboardV3/proNudge";

/** On the simple dashboard, now and then: "want every tool?" with a one-click switch. Everything else about the site stays as it is. */
export function ProViewNudge({ experience, demo }: { experience: Experience; demo?: boolean }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (experience !== "beginner" || demo) return;
    try {
      const state = readNudgeState(localStorage.getItem(NUDGE_KEY));
      const next = { ...state, visits: state.visits + 1 }; // counts this visit
      localStorage.setItem(NUDGE_KEY, JSON.stringify(next));
      setShow(shouldShowProNudge({ experience, state: next, now: Date.now() }));
    } catch {
      /* private mode: no card, nothing breaks */
    }
  }, [experience, demo]);

  if (!show) return null;

  const later = () => {
    try { localStorage.setItem(NUDGE_KEY, JSON.stringify({ ...readNudgeState(localStorage.getItem(NUDGE_KEY)), dismissedAt: Date.now() })); } catch { /* fine */ }
    setShow(false);
  };
  const tryIt = async () => {
    setBusy(true);
    const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ experience: "pro" }) }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      toast.show({ tone: "danger", title: "We couldn't switch just now", description: "Check your connection and try again." });
      return;
    }
    // They took the offer, so the card never returns, even after they come back to the simple view.
    try { localStorage.setItem(NUDGE_KEY, JSON.stringify({ ...readNudgeState(localStorage.getItem(NUDGE_KEY)), tried: true })); } catch { /* fine */ }
    toast.show({ tone: "success", title: "You're on the full view", description: "Switch back any time from your profile picture." });
    router.refresh();
  };

  return (
    <Card tone="tint" padding="lg" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "space-between" }} data-tour="pro-view-nudge">
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", minWidth: 0, flex: "1 1 340px" }}>
        <SlidersHorizontal size={24} aria-hidden style={{ color: "var(--plx-deep)", flexShrink: 0, marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <span className="plx-h3" style={{ display: "block" }}>Ready for more control?</span>
          <span className="plx-body" style={{ display: "block", marginTop: 4 }}>The full view shows every tool and all your sites together. Your site stays exactly as it is, and you can come back to this simple view any time from your profile picture.</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={later} disabled={busy}>Not now</Button>
        <Button loading={busy} onClick={() => void tryIt()}>Try the full view</Button>
      </div>
    </Card>
  );
}
