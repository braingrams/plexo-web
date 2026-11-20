"use client";

import "@charisol/plexo-sdk/dist/plexo-sdk.css";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MultiPageSolDialog } from "@/app/dashboard/_components/MultiPageSolDialog";
import { PublishBlockedPanel } from "@/app/dashboard/templates/[id]/PublishBlockedPanel";
import { useAutosavePreference } from "@/lib/editor/useAutosavePreference";

type SdkV2 = typeof import("@charisol/plexo-sdk/v2");
type Compile = typeof import("@charisol/plexo-sdk/v2/compile");

const PAGES = [
  { id: "t1", name: "Home", slug: null, parentId: null, order: 0 },
  { id: "t2", name: "About", slug: "about", parentId: "t1", order: 1 },
  { id: "t3", name: "Menu", slug: "menu", parentId: "t1", order: 2 },
];

/** Made-up answers for the screens that call Plexo's own routes, so the dialog renders with no server behind it. */
function mockRoutes() {
  const real = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.includes("/pages")) return json({ rootId: "t1", pages: PAGES });
    if (url.includes("/api/v1/ai/multi-page")) return json({ paidBy: "your credits", total: 12, balance: 180, perPage: [4, 4, 4], enough: true });
    if (url.startsWith("/api/")) return json({});
    return real(input, init);
  }) as typeof fetch;
  return () => { window.fetch = real; };
}

export default function EditorPreview() {
  const params = useSearchParams();
  const shot = params.get("s") ?? "editor";
  const [sdk, setSdk] = useState<SdkV2 | null>(null);
  const [compile, setCompile] = useState<Compile | null>(null);
  const autosavePreference = useAutosavePreference();
  useEffect(() => {
    void Promise.all([import("@charisol/plexo-sdk/v2"), import("@charisol/plexo-sdk/v2/compile")]).then(([a, b]) => { setSdk(a); setCompile(b); });
  }, []);
  useEffect(() => mockRoutes(), []);

  const initial = useMemo(() => {
    if (!compile) return null;
    const designSystem = compile.createDefaultDesignSystem();
    const page = compile.buildPageFromTemplate("home", { name: "Home", slug: "home", designSystem, seed: "preview" });
    return { designSystem, pages: page ? [page] : undefined };
  }, [compile]);

  if (shot === "blocked") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#14161c", ["--ed-text" as string]: "#f4f5fb", ["--ed-t-550" as string]: "#9aa0b4", ["--ed-panel" as string]: "#1c1f28" }}>
        <div style={{ width: 460, background: "#1c1f28", color: "#f4f5fb", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: "1.5rem", fontFamily: "system-ui" }}>
          <h2 style={{ margin: "0 0 1rem", fontSize: "1.2rem" }}>Publish your site</h2>
          <PublishBlockedPanel
            gate={{ code: "PLAN_SITE_LIMIT_EXCEEDED", message: "The Free plan keeps one site live, and Ama's Kitchen is already using it.", requiredPlan: "PRO" as never, liveSiteNames: ["Ama's Kitchen"], canReplace: true }}
            returnTo="/dashboard/templates/t1" busy={false} onBeforeUpgrade={() => undefined} onReplace={() => undefined} onUseFreeAddress={() => undefined} onSkip={() => undefined}
          />
        </div>
      </div>
    );
  }
  if (!sdk || !initial) return <div style={{ padding: 24 }}>Opening the editor…</div>;
  const V2Editor = sdk.V2Editor;
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <V2Editor
        pages={initial.pages}
        designSystem={initial.designSystem}
        projectName="Ama's Kitchen"
        onSave={async () => { await new Promise((r) => setTimeout(r, 300)); }}
        onSaveDraft={async () => { await new Promise((r) => setTimeout(r, 300)); }}
        onPublish={async () => { await new Promise((r) => setTimeout(r, 600)); }}
        hasAddress={false}
        autosavePreference={autosavePreference}
        onAskSolManyPages={() => window.dispatchEvent(new Event("preview-many-pages"))}
        onAskSol={async () => "Done."}
        shell={{ onExit: () => undefined, exitLabel: "Back to site" }}
        features={{ headerSol: false }}
      />
      <ManyPagesHost />
    </div>
  );
}

function ManyPagesHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("preview-many-pages", on);
    return () => window.removeEventListener("preview-many-pages", on);
  }, []);
  return open ? <MultiPageSolDialog siteId="t1" currentPageId="t1" onClose={() => setOpen(false)} /> : null;
}
