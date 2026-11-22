"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Rocket } from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, Notice, OptimisticLoader, Skeleton } from "../../ui";
import { appsApi, pollBuild, type AppSummary } from "@/app/dashboard/apps/_components/api";
import { CodePane } from "@/app/dashboard/apps/_components/CodePane";
import { DatabasePane } from "@/app/dashboard/apps/_components/DatabasePane";
import { FunctionsPane } from "@/app/dashboard/apps/_components/FunctionsPane";
import { GitHubPane } from "@/app/dashboard/apps/_components/GitHubPane";
import { HistoryPane } from "@/app/dashboard/apps/_components/HistoryPane";
import { PublishDialog } from "@/app/dashboard/apps/_components/PublishDialog";
import { SecretsPane } from "@/app/dashboard/apps/_components/SecretsPane";
import { SettingsPane } from "@/app/dashboard/apps/_components/SettingsPane";
import { UsersPane } from "@/app/dashboard/apps/_components/UsersPane";
import type { AdvancedSectionId } from "@/lib/dashboardV3/hubAdvanced";
import { Stage, Embed } from "./Embed";

function useSummary(appId: string) {
  const [summary, setSummary] = useState<AppSummary | null>(null);
  const refresh = useCallback(async () => {
    try { setSummary(await appsApi.summary(appId)); } catch { /* the panes show their own errors */ }
  }, [appId]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { summary, setSummary, refresh };
}

/** After a change to the app's code, rebuild the preview shortly after the typing stops, like the app builder does. */
function useRebuildSoon(appId: string, refresh: () => void) {
  const [state, setState] = useState<"idle" | "waiting" | "building" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); abort.current?.abort(); }, []);
  const soon = useCallback((message: string) => {
    if (timer.current) clearTimeout(timer.current);
    setState("waiting");
    timer.current = setTimeout(async () => {
      abort.current?.abort();
      const c = new AbortController();
      abort.current = c;
      setState("building");
      try {
        const { buildId } = await appsApi.build(appId, message);
        const r = await pollBuild(appId, buildId, undefined, c.signal);
        if (!c.signal.aborted) { setState(r.status === "SUCCEEDED" ? "done" : "failed"); refresh(); }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") setState("failed");
      }
    }, 1200);
  }, [appId, refresh]);
  return { state, soon };
}

/** The app builder's own tools (code, data, server code, sign-ups, history, GitHub, settings), shown in place. */
export function AppSection({ section, appId }: { section: AdvancedSectionId; appId: string }) {
  const { summary, setSummary, refresh } = useSummary(appId);
  const rebuild = useRebuildSoon(appId, refresh);
  const [refreshKey, setRefreshKey] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);

  switch (section) {
    case "appsettings":
    case "appseo":
    case "appsignin":
    case "appfiles": {
      const only = section === "appsettings" ? "general" : section === "appseo" ? "seo" : section === "appsignin" ? "signin" : "files";
      return <Stage><div style={{ position: "absolute", inset: 0 }}><SettingsPane only={only} appId={appId} summary={summary} onRenamed={(name) => setSummary((s) => (s ? { ...s, name } : s))} /></div></Stage>;
    }
    case "appcode":
      return (
        <div className="plx-adv__stack">
          {rebuild.state !== "idle" ? <Notice kind={rebuild.state === "failed" ? "warning" : "info"} title={rebuild.state === "failed" ? "Your preview couldn't update" : rebuild.state === "done" ? "Your preview is up to date" : "Updating your preview"}>{rebuild.state === "failed" ? "Something in the code needs fixing. Your changes are saved." : rebuild.state === "done" ? "Your latest changes are in the preview. Publish to put them online." : "Saved. Updating the preview now."}</Notice> : null}
          <Stage tall scroll={false}><CodePane appId={appId} refreshKey={refreshKey} onSaved={() => rebuild.soon("Edited in code")} previewUpdating={rebuild.state === "building"} /></Stage>
        </div>
      );
    case "data":
      return <Stage><DatabasePane appId={appId} refreshKey={refreshKey} /></Stage>;
    case "functions":
      return <Stage><FunctionsPane appId={appId} refreshKey={refreshKey} /></Stage>;
    case "secrets":
      return <Stage><SecretsPane appId={appId} /></Stage>;
    case "users":
      return <Stage><UsersPane appId={appId} /></Stage>;
    case "history":
      return <Stage><HistoryPane appId={appId} refreshKey={refreshKey} onRestored={() => { setRefreshKey((k) => k + 1); rebuild.soon("Restored a version"); }} /></Stage>;
    case "appgithub":
      return <Stage><GitHubPane appId={appId} onLinked={() => { setRefreshKey((k) => k + 1); void refresh(); rebuild.soon("Linked to GitHub"); }} /></Stage>;
    case "publish":
      return (
        <div className="plx-adv__stack">
          <Card>
            <CardHeader title={summary?.published ? "Your app is online" : "Your app is not online yet"} description={summary ? (summary.published ? "Publish again whenever you want the latest changes to go live." : "Publishing puts your app on a web address anyone can open.") : undefined} action={<Button leftIcon={<Rocket size={18} aria-hidden />} onClick={() => setPublishOpen(true)} disabled={!summary}>{summary?.published ? "Publish an update" : "Publish"}</Button>} />
            {!summary ? <div style={{ padding: "28px 16px", display: "grid", placeItems: "center" }}><OptimisticLoader title="Loading deployment summary" subtitle="Retrieving live environment addresses" steps={["Connecting to deployment cluster…", "Checking build state…", "Ready."]} /></div> : (
              <div>
                <div className="plx-adv__row"><div className="plx-adv__grow"><b>Live address</b><span>{summary.liveUrl ?? "None yet"}</span></div>{summary.liveUrl ? <ButtonLink href={summary.liveUrl} target="_blank" rel="noreferrer" variant="secondary" rightIcon={<ExternalLink size={16} aria-hidden />}>Open</ButtonLink> : null}</div>
                <div className="plx-adv__row"><div className="plx-adv__grow"><b>Preview address</b><span>{summary.previewUrl ?? "Made when the app first builds"}</span></div>{summary.previewUrl ? <ButtonLink href={summary.previewUrl} target="_blank" rel="noreferrer" variant="secondary" rightIcon={<ExternalLink size={16} aria-hidden />}>Open</ButtonLink> : null}</div>
                <div className="plx-adv__row"><div className="plx-adv__grow"><b>Latest build</b><span>{summary.latestBuild ? (summary.latestBuild.summary ?? "Built") : "Not built yet"}</span></div>{summary.latestBuild ? <Badge tone={summary.latestBuild.finishedAt ? "success" : "info"}>{summary.latestBuild.finishedAt ? "Done" : "Building"}</Badge> : null}</div>
              </div>
            )}
          </Card>
          {publishOpen ? <Embed><PublishDialog appId={appId} summary={summary} onClose={() => setPublishOpen(false)} onPublished={() => { void refresh(); setRefreshKey((k) => k + 1); }} /></Embed> : null}
        </div>
      );
    default:
      return null;
  }
}

