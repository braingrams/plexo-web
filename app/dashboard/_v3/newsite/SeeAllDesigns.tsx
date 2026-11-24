"use client";

import { useEffect } from "react";
import { DesignPicker, type PickerDesign } from "../designs/DesignPicker";
import { MARKET_RETURN_PATH, PENDING_KEY, profileFor, type NewSiteGoal } from "@/lib/dashboardV3/newSite";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";

/**
 * "See all designs" on the "Pick a look" step: the real marketplace designs for this goal (free, owned or paid),
 * inline, with the flow's own Back. Choosing one makes the site from it (onUse) once it is the owner's to use.
 * Before anyone can leave to pay, what they typed is kept, so coming back from the card window still makes the
 * site with their name and goal (/dashboard/sites/new?paidDesign=...).
 */
export type SeeAllDesignsProps = {
  goal: NewSiteGoal;
  name: string;
  brand?: SolBuildProfile["brand"];
  busy?: boolean;
  mock?: boolean;
  onUse: (design: PickerDesign) => Promise<void> | void;
  /** What the owner described (and what SOL understood from it), so the designs fit them. */
  extra?: { about?: string; industry?: string; tone?: string; businessType?: string };
};

export function SeeAllDesigns({ goal, name, brand, extra, busy, mock, onUse }: SeeAllDesignsProps) {
  useEffect(() => {
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ goal, name })); } catch { /* the return still works with the defaults */ }
  }, [goal, name]);
  const profile = profileFor(goal, name, brand, extra);
  return <DesignPicker goal={goal} profile={profile} mock={mock} busy={busy} returnTo={MARKET_RETURN_PATH} onUse={onUse} />;
}
