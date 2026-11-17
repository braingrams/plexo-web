"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink, Card, CardHeader, Input, useToast } from "../ui";
import { builderLabel } from "./HubFrame";
import type { HubFrameSite } from "./HubFrame";
import type { HubFeatures } from "@/lib/dashboardV3/hubTabs";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

export function SettingsTab({ site, features, experience }: { site: HubFrameSite; features: HubFeatures; experience: string }) {
  const router = useRouter();
  const { show } = useToast();
  const [name, setName] = useState(site.name);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rename() {
    if (!name.trim()) return setError("Please type a name for your site.");
    setBusy("save");
    setError(null);
    try {
      await hubApi(`/api/templates/${site.id}`, { method: "PATCH", json: { name: name.trim() } }, "We couldn't rename your site. Please try again.");
      show({ title: "Name saved", tone: "success" });
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete "${site.name}" for good? Its pages, and anything on it, will be gone. This can't be undone.`)) return;
    setBusy("delete");
    try {
      await hubApi(`/api/templates/${site.id}`, { method: "DELETE" }, "We couldn't delete this site. Please try again.");
      router.push("/dashboard/sites");
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  }

  return (
    <>
      <TabBar title="Settings" sub="The basics for this site." />
      <div className="plx-hub__grid plx-hub__grid--wide" style={{ alignItems: "start" }} data-tour="hub-settings">
        <Card>
          <CardHeader title="Site name" description="Only you see this. Visitors see what's on your pages." />
          <div className="plx-form">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={error ?? undefined} />
            <div><Button loading={busy === "save"} onClick={rename}>Save name</Button></div>
          </div>
        </Card>
        {features.store || features.blog || features.course ? (
          <Card>
            <CardHeader title="More settings" />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
              {features.store ? <ButtonLink href={`/dashboard/commerce/${site.id}/settings`} variant="link">Payments, delivery and shop settings</ButtonLink> : null}
              {features.blog ? <ButtonLink href={`/dashboard/templates/${site.id}/blog/settings`} variant="link">Blog settings</ButtonLink> : null}
              {features.course ? <ButtonLink href={`/dashboard/funnels/${site.id}/settings`} variant="link">Course price and settings</ButtonLink> : null}
            </div>
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Visitors and your site's pages" description="Everything that happens around your pages, in one place." />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
            <ButtonLink href={`/dashboard/templates/${site.id}/form-submissions`} variant="link">Form replies and where they go</ButtonLink>
            <ButtonLink href={`/dashboard/templates/${site.id}/redirects`} variant="link">Send an old link to a new page</ButtonLink>
            <ButtonLink href={`/dashboard/templates/${site.id}/site-layout`} variant="link">Shared top and bottom of every page</ButtonLink>
            <ButtonLink href={`/dashboard/templates/${site.id}/site-import`} variant="link">Bring in pages from another site</ButtonLink>
            {experience === "pro" ? <ButtonLink href={`/dashboard/templates/${site.id}/content-types`} variant="link">Your own lists of content</ButtonLink> : null}
          </div>
        </Card>
        {experience === "pro" ? (
          <Card tone="elevated">
            <CardHeader title="How this site is built" description={`This site uses: ${builderLabel(site)}.`} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
              <ButtonLink href={`/dashboard/templates/${site.id}/detail?classic=1`} variant="link">Open advanced site settings</ButtonLink>
              <ButtonLink href="/dashboard/apps" variant="link">See my apps</ButtonLink>
            </div>
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Delete this site" description="Removes the site and all its pages. You can't get it back." />
          <Button variant="danger" loading={busy === "delete"} onClick={remove}>Delete site</Button>
        </Card>
      </div>
    </>
  );
}
