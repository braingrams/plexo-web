"use client";

import { Card, OptimisticLoader, Skeleton } from "../../ui";
import { advancedKind, type AdvancedSection, type AdvancedSectionId } from "@/lib/dashboardV3/hubAdvanced";
import type { AdvancedData } from "@/lib/dashboardV3/hubAdvancedData";
import type { HubFeatures } from "@/lib/dashboardV3/hubTabs";
import { ContentTypesClient } from "@/app/dashboard/templates/[id]/content-types/ContentTypesClient";
import { RedirectsClient } from "@/app/dashboard/templates/[id]/redirects/RedirectsClient";
import { SiteLayoutClient } from "@/app/dashboard/templates/[id]/site-layout/SiteLayoutClient";
import { FormDestinationsClient } from "@/app/dashboard/templates/[id]/form-submissions/FormDestinationsClient";
import { FormSubmissionsClient } from "@/app/dashboard/templates/[id]/form-submissions/FormSubmissionsClient";
import { DeployPanel } from "@/app/dashboard/templates/[id]/detail/DeployPanel";
import { ServerSettingsPanel } from "@/app/dashboard/templates/[id]/detail/ServerSettingsPanel";
import { AppTab, type AppInfo } from "../AppTab";
import type { HubFrameSite } from "../HubFrame";
import { AdvancedFrame } from "./AdvancedTab";
import { AppSection } from "./AppSections";
import { CodeSection } from "./CodeSection";
import { CopySection } from "./CopySection";
import { DangerSection } from "./DangerSection";
import { Embed } from "./Embed";
import { FeaturesSection } from "./FeaturesSection";
import { ScriptsSection } from "./ScriptsSection";
import { SeoSection } from "./SeoSection";
import { VersionsSection } from "./VersionsSection";

export type AdvancedAreaProps = {
  site: HubFrameSite & { features: HubFeatures; app: AppInfo | null };
  sections: AdvancedSection[];
  current: AdvancedSectionId;
  data: AdvancedData;
};

/** The whole Advanced area for one site: the section list and the chosen section, with everything shown in place. */
export function AdvancedArea({ site, sections, current, data }: AdvancedAreaProps) {
  const kind = advancedKind(site.features);
  const id = site.id;
  return (
    <AdvancedFrame siteId={id} sections={sections} current={current} danger={sections.some((s) => s.id === "danger") ? <DangerSection siteId={id} siteName={site.name} app={kind === "app"} /> : null}>
      <Body kind={kind} section={current} site={site} data={data} />
    </AdvancedFrame>
  );
}

function Body({ kind, section, site, data }: { kind: ReturnType<typeof advancedKind>; section: AdvancedSectionId; site: AdvancedAreaProps["site"]; data: AdvancedData }) {
  const id = site.id;
  if (section === "danger") return null;
  if (kind === "app") return <AppSection section={section} appId={id} />;
  switch (section) {
    case "seo":
      return <SeoSection siteId={id} siteName={site.name} address={site.address} />;
    case "code":
      return <CodeSection siteId={id} />;
    case "features":
      return data.features ? <FeaturesSection siteId={id} features={site.features} data={data.features} /> : <Card><div style={{ padding: "32px 16px", display: "grid", placeItems: "center" }}><OptimisticLoader title="Loading features" subtitle="Reading site capabilities" steps={["Loading advanced feature switches…", "Checking permissions…", "Ready."]} /></div></Card>;
    case "layout":
      return data.layout ? <Embed><SiteLayoutClient templateId={id} siteName={site.name} initialEnabled={data.layout.enabled} /></Embed> : null;
    case "lists":
      return data.contentTypes ? <Embed><ContentTypesClient templateId={id} templateName={site.name} initialContentTypes={data.contentTypes} /></Embed> : null;
    case "forms":
      return <Embed><FormDestinationsClient templateId={id} /><FormSubmissionsClient templateId={id} /></Embed>;
    case "redirects":
      return data.redirects ? <Embed><RedirectsClient templateId={id} initialRedirects={data.redirects} /></Embed> : null;
    case "scripts":
      return <ScriptsSection siteId={id} ownCode={site.features.ownCode} />;
    case "versions":
      return <VersionsSection siteId={id} />;
    case "deploy":
      // A server app: its build, log and always-on, in the new look. Plain files, or a website: the full uploader.
      if (site.app?.kind === "server") return <AppTab siteId={id} siteName={site.name} info={site.app} only="deploy" experience="pro" />;
      return <Embed><DeployPanel templateId={id} initialDeployedApp={data.deploy?.app ?? null} liveDomain={data.deploy?.liveDomain ?? site.address} /></Embed>;
    case "variables":
      if (site.app?.kind === "server") return <AppTab siteId={id} siteName={site.name} info={site.app} only="variables" experience="pro" />;
      return <Embed><ServerSettingsPanel templateId={id} /></Embed>;
    case "github":
      return site.app?.kind === "server" ? <AppTab siteId={id} siteName={site.name} info={site.app} only="github" experience="pro" /> : null;
    case "copy":
      return <CopySection siteId={id} siteName={site.name} />;
    default:
      return null;
  }
}
