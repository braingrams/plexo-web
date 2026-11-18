"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button, Card, CardHeader, useToast } from "../../ui";
import { TransferSiteClient } from "@/app/dashboard/templates/[id]/transfer/TransferSiteClient";
import { SiteImportPageClient } from "@/app/dashboard/templates/[id]/site-import/SiteImportPageClient";
import { errMsg, hubApi } from "../hubApi";
import { Embed } from "./Embed";

/** Make a copy of the site, give it to another account, or bring in pages from another site. */
export function CopySection({ siteId, siteName }: { siteId: string; siteName: string }) {
  const router = useRouter();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  async function duplicate() {
    setBusy(true);
    try {
      const d = await hubApi<{ template: { id: string } }>(`/api/templates/${siteId}/duplicate-site`, { method: "POST" }, "We couldn't make a copy. Please try again.");
      show({ title: "Your copy is ready", tone: "success" });
      router.push(`/dashboard/sites/${d.template.id}`);
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
      setBusy(false);
    }
  }
  return (
    <div className="plx-adv__stack">
      <Card>
        <CardHeader title="Make a copy" description="Every page, ready to change, without touching this site. The copy is not online until you give it a web address." action={<Button variant="secondary" leftIcon={<Copy size={18} aria-hidden />} loading={busy} onClick={duplicate}>Make a copy</Button>} />
      </Card>
      <Card>
        <CardHeader title="Give this site to someone else" description="Move the whole site to another Plexo account. They have to accept before anything moves." titleAs="h3" />
        <Embed><TransferSiteClient templateId={siteId} siteName={siteName} /></Embed>
      </Card>
      <Card>
        <CardHeader title="Bring in pages from another site" description="Copy pages over from Wix, Squarespace, Webflow, WordPress and more." titleAs="h3" />
        <Embed><SiteImportPageClient templateId={siteId} siteName={siteName} /></Embed>
      </Card>
    </div>
  );
}
