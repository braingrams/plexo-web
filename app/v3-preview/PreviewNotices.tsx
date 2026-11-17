"use client";

import { ArrowRightLeft, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { DashboardNotice } from "@/app/dashboard/_components/DashboardNotice";

/** DEV ONLY: the real banners (same component the shell mounts), with fake text. */
export function PreviewNotices() {
  return (
    <>
      <DashboardNotice tone="success" icon={CheckCircle2} title="Muzingo | Online Music Bingo Game has moved to Plexo" detail="Preview it, check the report, then connect your domain." actions={[{ label: "See your report", href: "#" }]} onDismiss={() => {}} />
      <DashboardNotice tone="warning" icon={Clock} title="Pro trial · 2 days left" detail="Everything's unlocked except custom domains and taking real payments. Nothing is ever deleted either way." progress={0.85} actions={[{ label: "Keep Pro", href: "#" }]} onDismiss={() => {}} />
      <DashboardNotice tone="brand" icon={ArrowRightLeft} title="Moving lineagecarefoundation.org to Plexo" detail="Copying pages and pictures · 3 minutes left · It keeps going if you leave." progress={0.4} actions={[{ label: "View progress", href: "#" }]} />
      <DashboardNotice tone="warning" icon={AlertTriangle} title="Moving your site has paused" detail="Something went wrong. Pick up exactly where it stopped — nothing already moved is lost." actions={[{ label: "Continue the move", href: "#" }]} />
    </>
  );
}
