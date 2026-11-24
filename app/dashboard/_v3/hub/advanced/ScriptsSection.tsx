"use client";

import { useState } from "react";
import { Code2, ShieldCheck } from "lucide-react";
import { Button, Card, CardHeader, OptimisticLoader, Skeleton } from "../../ui";
import { EmbedCodeModal } from "@/app/dashboard/templates/[id]/EmbedCodeModal";
import { ScriptAccessControl } from "@/app/dashboard/templates/[id]/ScriptAccessControl";
import { Embed } from "./Embed";
import { PageCodeCard } from "./PageCodeCard";
import { PagePicker, usePages } from "./PagePicker";

/** Ready-made blocks to paste into your own code, and the permission to run scripts while you preview your own pages. */
export function ScriptsSection({ siteId, ownCode }: { siteId: string; ownCode: boolean }) {
  const { pages } = usePages(siteId);
  const [pageId, setPageId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const raw = pages?.filter((p) => p.sourceType === "RAW_UPLOAD") ?? [];
  const scriptPages = raw.length ? raw : [];
  const scriptPage = scriptPages.find((p) => p.id === pageId) ?? scriptPages[0] ?? null;

  return (
    <div className="plx-adv__stack">
      <Card>
        <CardHeader title="Embed blocks" description="Shop grids, buy buttons, form connectors and lists as ready-to-paste code for pages you wrote yourself." action={<Button leftIcon={<Code2 size={18} aria-hidden />} onClick={() => setOpen(true)} disabled={!pages}>Get embed code</Button>} />
        <p className="plx-body">Pick a block, set it up, and copy the code. Pages made with the visual editor have these as buttons in the editor, so this is for your own code.</p>
      </Card>
      {!pages ? (
        <Card><div style={{ padding: "28px 16px", display: "grid", placeItems: "center" }}><OptimisticLoader title="Loading script settings" subtitle="Reading embed controls" steps={["Loading pages…", "Preparing script configuration…", "Ready."]} /></div></Card>
      ) : (
        <Card>
          <CardHeader title="Scripts in your preview" description="Pages you wrote yourself preview without scripts, for safety. Ask for full script preview and our team can allow it for a short time." />
          {ownCode && scriptPage ? (
            <div className="plx-adv__stack">
              {scriptPages.length > 1 ? <div className="plx-adv__pick"><PagePicker pages={scriptPages} value={scriptPage.id} onChange={setPageId} label="Your own page" /></div> : null}
              <Embed><ScriptAccessControl key={scriptPage.id} templateId={scriptPage.id} onModeChange={() => undefined} /></Embed>
            </div>
          ) : (
            <p className="plx-body" style={{ display: "flex", gap: 8, alignItems: "center" }}><ShieldCheck size={18} aria-hidden style={{ flex: "none" }} /><span>This only matters for pages you wrote yourself. Your site has none.</span></p>
          )}
        </Card>
      )}
      {pages?.length ? <PageCodeCard siteId={siteId} pages={pages} /> : null}
      {open && pages?.length ? <Embed><EmbedCodeModal siteId={siteId} pageId={(pageId ?? pages[0].id)} canAddForMe={false} onClose={() => setOpen(false)} /></Embed> : null}
    </div>
  );
}
