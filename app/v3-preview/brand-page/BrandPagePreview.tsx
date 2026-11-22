"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { BrandTab } from "@/app/dashboard/_v3/hub/BrandTab";
import type { StrataPickerClient } from "@/app/dashboard/_v3/brand/StrataBrandPicker";
import type { BrandState } from "@/app/dashboard/templates/[id]/detail/SiteBrandPanel";
import type { ResolvedBrand } from "@/lib/brand/brandModel";
import type { BrandVoice } from "@/lib/brand/brandVoice";

const WORDS: BrandVoice = {
  tagline: "Fresh bread, baked slow.",
  aboutLine: "A family bakery in Lagos making sourdough and pastries every morning for neighbours and offices.",
  tones: ["warm", "friendly", "confident"],
  formality: "casual",
  audience: "busy neighbours who want something honest for breakfast",
  wordsLike: ["handmade", "fresh", "neighbourhood"],
  wordsAvoid: ["cheap", "synergy"],
};

const RESOLVED: ResolvedBrand = {
  source: "strata", siteId: "s1", linked: true, project: { id: "p1", name: "Ama's Kitchen brand" }, syncOn: true, status: "active", name: "Ama's Kitchen",
  tagline: WORDS.tagline, about: WORDS.aboutLine, words: WORDS, voice: "warm, friendly, confident; casual",
  colours: [
    { role: "primary", label: "Main colour (buttons, links)", value: "#E4572E" },
    { role: "secondary", label: "Second colour", value: "#2B2D42" },
    { role: "accent", label: "Accent", value: "#F4A261" },
    { role: "text", label: "Text", value: "#1B1B1F" },
    { role: "background", label: "Page background", value: "#FFF8F0" },
  ],
  fonts: { heading: "Fraunces", body: "Work Sans" }, fontWeights: { heading: 700, body: 400 }, radius: "12px", tokenCount: 64, stylesheet: "/__plexo/brand/s1.css",
  components: [{ name: "button", variants: ["primary", "secondary"], slots: [{ role: "label", kind: "text" }], className: "plx-brand-button" }, { name: "card", variants: ["raised"], slots: [{ role: "title", kind: "text" }], className: "plx-brand-card" }],
};
const STATE: BrandState = { linked: true, projectId: "p1", projectName: "Ama's Kitchen brand", autoSync: true, status: "active", updatedAt: new Date().toISOString(), lastCheckedAt: null, lastResult: null, lastResultKind: "updated", lastSource: "webhook", useOnSite: false, canUseOnSite: false, resolved: RESOLVED };
const client: StrataPickerClient = { available: async () => true, status: async () => ({ connected: true }), connect: async () => ({ connected: true }), listProjects: async () => [], pull: async () => ({ tokens: [] }) } as never;

/** The routes the Brand page calls, answered with made-up data (this route only exists in `next dev`). */
function stubFetch() {
  if (typeof window === "undefined" || (window as { __brandStub?: boolean }).__brandStub) return;
  (window as { __brandStub?: boolean }).__brandStub = true;
  const real = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.includes("/site-meta")) return new Response(JSON.stringify({ htmlTitle: "Ama's Kitchen", favicon: "", metaDescription: "", ogImageUrl: "" }), { status: 200 });
    if (url.includes("/api/v1/profile")) return new Response(JSON.stringify({ user: { totalCredits: 1840 } }), { status: 200 });
    if (url.includes("/api/v1/ai/estimate")) return new Response(JSON.stringify({ paidBy: "plexo", enough: true, estimatedCredits: 12, balance: 1840 }), { status: 200 });
    return real(input, init);
  }) as typeof window.fetch;
}

export function BrandPagePreview() {
  const q = useSearchParams();
  const [ready] = useState(() => { stubFetch(); return true; });
  const view = q.get("view");
  const empty = view === "empty";
  const first = view === "first";
  if (!ready) return null;
  return (
    <div className="plx-page">
      <BrandTab siteId="s1" siteName="Ama's Kitchen" brand={{ colors: ["#E4572E", "#2B2D42"], noLogo: true }} strataClient={client} strataPreviewState={first ? ({ ...STATE, linked: false, projectId: null, projectName: null, resolved: { ...RESOLVED, linked: false, project: null, source: "default", colours: [], fonts: {}, tagline: undefined, words: undefined, about: undefined, voice: undefined, components: [], tokenCount: undefined } } as BrandState) : empty ? ({ ...STATE, resolved: { ...RESOLVED, tagline: undefined, words: undefined, about: undefined, voice: undefined } } as BrandState) : STATE} strataPreviewVoice={empty || first ? null : WORDS} />
    </div>
  );
}
