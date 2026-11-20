"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { SiteLayoutClient } from "@/app/dashboard/templates/[id]/site-layout/SiteLayoutClient";
import { PageChrome } from "@/app/dashboard/templates/[id]/v2/PageChrome";
import { EditorFrame } from "@/app/dashboard/_components/EditorTheme";
import { installMock } from "../_mock/api";

const LOOKS = {
  header: [
    { variant: "simple", label: "Simple", description: "Your name on the left, your menu on the right." },
    { variant: "centered", label: "Centered", description: "Your name in the middle with the menu underneath." },
    { variant: "bold", label: "Bold bar", description: "A solid colour bar with a button on the end." },
  ],
  footer: [
    { variant: "simple", label: "Simple", description: "Your name, your pages and the small print." },
    { variant: "columns", label: "Columns", description: "Links in neat columns with contact details." },
    { variant: "minimal", label: "Minimal", description: "Just the small print, nothing else." },
  ],
  source: { from: "menu" as const, links: [{ label: "About", href: "/about" }, { label: "Classes", href: "/classes" }, { label: "Contact", href: "/contact" }] },
};

function setup(scenario: string) {
  const designed = scenario !== "old";
  const blocked =
    scenario === "nodomain" ? { blocked: "Your own code only runs on a website with your own web address, like amaskitchen.com. Right now this site uses a free Plexo address.", blockedFix: { label: "Connect your own address", href: "#", reason: "domain" } }
    : scenario === "plan" ? { blocked: "Adding your own code comes with the Starter plan and above. Your site is on Free.", blockedFix: { label: "See plans", href: "#", reason: "plan" } }
    : { blocked: null, blockedFix: null };
  const saved = { head: '<meta name="google-site-verification" content="x7Gq2LmN0pR4" />', footer: "", domain: "amaskitchen.com", onCheckout: false, updatedAt: "2026-11-15T10:00:00Z", updatedBy: "Ama Owusu", headSnippets: [{ index: 0, ok: true, summary: "Google Search Console verification tag" }], footerSnippets: [] };
  installMock([
    { test: /\/api\/site-layout\/[^/]+\/looks$/, method: "GET", res: () => ({ siteKind: "visual", supported: true, enabled: designed, headerBlank: !designed, footerBlank: !designed, headerTemplateId: designed ? "h1" : null, footerTemplateId: designed ? "f1" : null, looks: LOOKS, pagesWithOwnHeader: scenario === "designed" ? [{ id: "p2", name: "Press kit" }] : [], pagesWithOwnFooter: [] }) },
    { test: /custom-code\/check$/, method: "POST", res: ({ body }) => {
        const head = String(body?.head ?? "");
        const none = { ok: true, error: null, snippets: [] };
        if (/google-site-verification/.test(head)) return { head: { ok: true, error: null, snippets: [{ index: 0, ok: true, summary: "Google Search Console verification tag" }] }, footer: none };
        if (/fbq\(/.test(head)) return { head: { ok: true, error: null, snippets: [{ index: 0, ok: true, summary: "Meta (Facebook) pixel 1029384756 and its no-script fallback" }] }, footer: none };
        return { head: { ok: false, error: "Something is off", snippets: [{ index: 0, ok: false, summary: "", error: "This script is missing its closing </script>, so the rest of your page would be hidden. Copy the code again from the service, all the way to the end." }] }, footer: none };
      } },
    { test: /custom-code$/, method: "GET", res: () => ({ ...saved, ...blocked, head: blocked.blocked ? "" : saved.head, headSnippets: blocked.blocked ? [] : saved.headSnippets }) },
    { test: /page-chrome$/, method: "GET", res: () => ({ rootId: "p1", ready: true, headerTemplateId: "h1", footerTemplateId: "f1", showHeader: true, showFooter: false }) },
  ]);
}

export function SiteLayoutPreview() {
  const q = useSearchParams();
  const scenario = q.get("scenario") ?? "designed";
  useState(() => setup(scenario));
  if (scenario === "page") {
    return (
      <EditorFrame v3>
        
          <div style={{ maxWidth: 320, padding: 20, margin: "24px auto", border: "1px solid var(--color-border-default, #ddd)", borderRadius: 12, background: "var(--color-bg-surface, #fff)" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "0.95rem" }}>Page settings</h3>
            <PageChrome pageId="p2" />
          </div>
        
      </EditorFrame>
    );
  }
  return (
    <EditorFrame v3>
      
        <SiteLayoutClient templateId="p1" siteName="Ama's Kitchen" initialEnabled={scenario !== "old"} />
      
    </EditorFrame>
  );
}
