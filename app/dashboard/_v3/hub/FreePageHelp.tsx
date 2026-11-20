"use client";

import { HelpCircle } from "lucide-react";
import { Tooltip } from "../ui";

export const FREE_PAGE_TIP = "Visitors who open this page are sent to your homepage, so nobody sees a blank page. Upgrade to show all your pages.";
export const FREE_PAGE_LABEL = "Not shown to visitors because you're on the Free plan";

/** The (?) next to "Not shown to visitors…": what visitors get instead, and how to change it. */
export function FreePageHelp() {
  return (
    <Tooltip content={FREE_PAGE_TIP} side="top">
      <button type="button" aria-label={FREE_PAGE_TIP} style={{ display: "inline-grid", placeItems: "center", width: 24, height: 24, padding: 0, border: 0, borderRadius: 999, background: "transparent", color: "var(--plx-muted)", cursor: "help", flexShrink: 0 }}>
        <HelpCircle size={16} aria-hidden />
      </button>
    </Tooltip>
  );
}
