"use client";
import { PLAN } from "@/lib/plan/plans";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/app/dashboard/_v3/ui";
import { StrataBrandPicker, type StrataPickerClient } from "@/app/dashboard/_v3/brand/StrataBrandPicker";
import { StrataBrand } from "@/app/dashboard/_v3/hub/BrandTab";
import { NewSiteFlow } from "@/app/dashboard/_v3/newsite/NewSiteFlow";
import { NO_SELECTION, type PickerProject, type PickerSelection } from "@/lib/dashboardV3/strataPicker";
import type { BrandState } from "@/app/dashboard/templates/[id]/detail/SiteBrandPanel";
import type { ResolvedBrand } from "@/lib/brand/brandModel";

const PROJECTS: PickerProject[] = [
  { id: "p1", name: "Ama's Kitchen brand", description: "Colours, fonts and logo", color: "#E4572E", logo: null, updatedAt: "2026-11-14T10:00:00Z", role: "owner" },
  { id: "p2", name: "Cooking with Ama", description: "Course brand", color: "#1F6FEB", logo: null, updatedAt: "2026-11-02T10:00:00Z", role: "editor" },
  { id: "p3", name: "Kitchen notes (shared with me)", color: "#2F9E6F", logo: null, updatedAt: "2026-10-20T10:00:00Z", role: "viewer" },
];

const fake = (over: Partial<{ available: boolean; connected: boolean; projects: PickerProject[]; error: boolean; slow: boolean }>): StrataPickerClient => {
  const o = { available: true, connected: true, projects: PROJECTS, error: false, slow: false, ...over };
  let connected = o.connected;
  return {
    available: async () => { if (o.slow) await new Promise(() => undefined); return o.available; },
    status: async () => ({ connected }),
    connect: async () => { await new Promise((r) => setTimeout(r, 500)); connected = true; return { connected }; },
    listProjects: async () => { if (o.error) throw new Error("Strata isn't answering right now. Please try again in a moment."); return o.projects; },
    pull: async () => ({ tokens: [{ key: "--color-action-primary-bg", value: "#E4572E", type: "color", unit: null }] }),
  };
};

const RESOLVED: ResolvedBrand = {
  source: "strata", siteId: "s1", linked: true, project: { id: "p1", name: "Ama's Kitchen brand" }, syncOn: true, status: "active", name: "Ama's Kitchen",
  colours: [
    { role: "primary", label: "Main colour (buttons, links)", value: "#E4572E" },
    { role: "secondary", label: "Second colour", value: "#2B2D42" },
    { role: "accent", label: "Accent", value: "#F4A261" },
    { role: "text", label: "Text", value: "#1B1B1F" },
    { role: "background", label: "Page background", value: "#FFF8F0" },
  ],
  fonts: { heading: "Plus Jakarta Sans", body: "Inter" }, radius: "12px", stylesheet: "/__plexo/brand/s1.css",
  components: [{ name: "button", variants: ["primary", "secondary", "ghost"], slots: [{ role: "label", kind: "text" }], className: "plx-brand-button" }, { name: "card", variants: ["raised", "muted"], slots: [{ role: "title", kind: "text" }, { role: "body", kind: "text" }], className: "plx-brand-card" }],
};
const LINKED: BrandState = { linked: true, projectId: "p1", projectName: "Ama's Kitchen brand", autoSync: true, status: "active", updatedAt: new Date().toISOString(), lastCheckedAt: null, lastResult: null, lastResultKind: "updated", lastSource: "webhook", useOnSite: false, canUseOnSite: false, resolved: RESOLVED };

export function BrandPreview() {
  const q = useSearchParams();
  const state = q.get("state") ?? "list";
  const [sel, setSel] = useState<PickerSelection>(NO_SELECTION);
  const client = useMemo(() => fake({ connected: state !== "not-connected", projects: state === "empty" ? [] : PROJECTS, error: state === "error", slow: state === "loading" }), [state]);

  if (state === "newsite") {
    return <NewSiteFlow mode="page" preview={{ screen: "brand", goal: "store", mock: true, strata: client }} context={{ plan: PLAN.PRO, brand: { name: "Ama's Kitchen", colors: ["#E4572E"] }, siteNames: [], liveSiteNames: [] }} />;
  }
  if (state === "linked") {
    return <div className="plx-page" style={{ maxWidth: 760 }}><StrataBrand siteId="s1" siteName="Ama's Kitchen" isRaw={false} client={client} preview previewState={LINKED} /></div>;
  }
  if (state === "unlinked") {
    return <div className="plx-page" style={{ maxWidth: 760 }}><StrataBrand siteId="s1" siteName="Ama's Kitchen" isRaw={false} client={client} preview previewState={{ ...LINKED, linked: false, projectId: null, projectName: null, resolved: { ...RESOLVED, source: "site", linked: false, project: null, fonts: {} } }} /></div>;
  }
  return (
    <div className="plx-page" style={{ maxWidth: 640 }}>
      <Card>
        <CardHeader title="Your brand" description={`Preview state: ${state}`} />
        <StrataBrandPicker mode="draft" client={client} value={sel} onChange={(v) => setSel(v)} allowSkip canCreate={state !== "createoff"} />
      </Card>
    </div>
  );
}
