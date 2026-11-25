"use client";

import { useEffect, useState } from "react";
import { Notice } from "../ui";
import { NEW_SITE_NOTICE_KEY, readNotice } from "@/lib/dashboardV3/newSite";
import { wordsFlowHref } from "@/lib/dashboardV3/wordsFlow";

/**
 * The plain-words note the "Make a new website" flow leaves for Home: anything that could not be carried over to the new site on its own
 * (a few pieces of text, a logo with no place in the design...). It waits in the browser across the move to the dashboard and stays until
 * the owner closes it, so they see it even when the toast on the previous page went by too quickly. Only shown for the website Home is on.
 */
export function NewSiteNotice({ siteId }: { siteId: string }) {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    try {
      setMessages(readNotice(sessionStorage.getItem(NEW_SITE_NOTICE_KEY), siteId)?.messages ?? []);
    } catch {
      /* no note: nothing to say */
    }
  }, [siteId]);
  if (!messages.length) return null;
  const aboutText = messages.some((m) => /Review and edit your pages/.test(m));
  const close = () => {
    setMessages([]);
    try { sessionStorage.removeItem(NEW_SITE_NOTICE_KEY); } catch { /* fine */ }
  };
  return (
    <div style={{ minWidth: 0 }}>
      <Notice
        kind="info"
        title={messages.length === 1 ? "One thing to check on your new website" : "A few things to check on your new website"}
        action={aboutText ? { label: "Review my pages", href: wordsFlowHref(siteId, "words") } : undefined}
        onDismiss={close}
      >
        {messages.join(" ")}
      </Notice>
    </div>
  );
}
