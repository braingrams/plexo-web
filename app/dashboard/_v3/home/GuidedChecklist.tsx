"use client";

import { useEffect, useState } from "react";
import { ArrowRight, MessageCircle } from "lucide-react";
import type { TaskId, TaskProgress, TaskView } from "@/lib/dashboardV3/tasks";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import { ButtonLink, Checklist, HelpMedia, TaskCard } from "../ui";
import { AddressForm, LiveForm, PayForm, ProductForm } from "./TaskForms";

type Props = { site: SiteSummary; progress: TaskProgress; commerceEnabled: boolean; baseDomain: string; demo?: boolean; onLive: () => void };

/** The step list. The current step is open; tapping another step opens it too. Each step finishes right here when it can. */
export function GuidedChecklist({ site, progress, commerceEnabled, baseDomain, demo, onLive }: Props) {
  const [open, setOpen] = useState<TaskId | null>(progress.currentId);
  useEffect(() => setOpen(progress.currentId), [progress.currentId]);

  function body(t: TaskView) {
    const common = { siteId: site.id, demo };
    switch (t.kind) {
      case "product":
        return <ProductForm {...common} commerceEnabled={commerceEnabled} />;
      case "pay":
        return <PayForm {...common} />;
      case "address":
        return <AddressForm {...common} siteName={site.name} baseDomain={baseDomain} />;
      case "live":
        return <LiveForm {...common} onLive={onLive} />;
      case "link":
        return (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <ButtonLink href={`/dashboard/sites/${site.id}`} size="lg" rightIcon={<ArrowRight size={18} aria-hidden />}>
              Open my site
            </ButtonLink>
            <ButtonLink href="/dashboard/sol" variant="secondary" size="lg" leftIcon={<MessageCircle size={18} aria-hidden />}>
              Ask SOL to do it
            </ButtonLink>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div data-tour="home-checklist">
      <Checklist done={progress.done} total={progress.total}>
        {progress.tasks.map((t, i) => {
          const form = t.state === "done" || t.kind === "auto" ? null : body(t);
          return (
            <TaskCard
              key={t.id}
              number={i + 1}
              title={t.title}
              description={t.description}
              state={t.state}
              expanded={open === t.id}
              onToggle={form ? () => setOpen((o) => (o === t.id ? null : t.id)) : undefined}
              tour={t.state === "current" ? "home-current-task" : undefined}
            >
              {form ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {form}
                  <HelpMedia title={t.help} caption="A short clip of exactly this step. It plays on repeat." />
                </div>
              ) : null}
            </TaskCard>
          );
        })}
      </Checklist>
    </div>
  );
}
