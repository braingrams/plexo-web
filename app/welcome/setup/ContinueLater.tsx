"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button, useToast } from "@/app/dashboard/_v3/ui";

/** "Continue later →": remembers they skipped for now, then opens the dashboard (Home offers setup again). */
export function ContinueLaterButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      loading={busy}
      rightIcon={<ArrowRight size={18} aria-hidden />}
      onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deferOnboarding: true }) }).catch(() => null);
        if (!res?.ok) {
          setBusy(false);
          toast.show({ tone: "danger", title: "We couldn't save that", description: "Check your internet connection and try again." });
          return;
        }
        router.push("/dashboard");
      }}
    >
      Continue later
    </Button>
  );
}
