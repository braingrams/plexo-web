"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Rocket } from "lucide-react";
import { Button, ButtonLink } from "../ui";
import { EditWebsiteButton } from "./EditWebsiteButton";
import { SolIntroCard } from "../sol/SolIntroCard";
import { callApi } from "../home/api";
import { computeStartSteps, START_INTRO, START_TITLE, type StartFacts, type StartStep } from "@/lib/dashboardV3/startSteps";

export type StartPanelFacts = StartFacts;

/**
 * "The owner opened the editor from the steps": remembered on the site, on the server (POST /api/templates/:id/start-review), so this
 * panel and Home's "Review and edit your pages" agree on every device. Fire and forget: opening the editor never waits for it.
 */
export function markStartReviewed(siteId: string) {
  void fetch(`/api/templates/${siteId}/start-review`, { method: "POST", keepalive: true }).catch(() => undefined);
}

/** The next-steps panel at the top of a brand-new site's hub. Renders nothing for a live site. */
export function StartPanel({ siteId, facts, fallbackHref, canEdit, showSolIntro }: { siteId: string; siteName: string; facts: StartPanelFacts; fallbackHref: string; canEdit: boolean; showSolIntro: boolean }) {
  const router = useRouter();
  // Shown at once when they tap the button; the server flag (facts.openedEditor) is what survives a reload or another device.
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; plan: boolean } | null>(null);

  const view = computeStartSteps(siteId, { ...facts, openedEditor: facts.openedEditor || opened });
  if (!view.show) return null;

  async function publish() {
    setBusy(true);
    setError(null);
    const r = await callApi(`/api/templates/${siteId}/publish`, "POST");
    setBusy(false);
    if (r.ok) return router.refresh();
    setError({ message: r.error, plan: /plan|upgrade/i.test(r.error) });
  }

  function action(s: StartStep) {
    const variant = s.primary ? "primary" : "secondary";
    if (s.state === "later") return null;
    if (s.action === "edit") {
      return canEdit ? (
        <EditWebsiteButton
          siteId={siteId}
          fallbackHref={fallbackHref}
          label={s.cta}
          variant={variant}
          onStart={() => {
            markStartReviewed(siteId);
            setOpened(true);
          }}
        />
      ) : null;
    }
    if (s.action === "publish") {
      return canEdit ? (
        <Button variant={variant} loading={busy} onClick={() => void publish()} leftIcon={<Rocket size={16} aria-hidden />}>
          {s.cta}
        </Button>
      ) : null;
    }
    return s.href ? (
      <ButtonLink href={s.href} variant={variant}>
        {s.cta}
      </ButtonLink>
    ) : null;
  }

  return (
    <section className="plx-start" aria-labelledby="plx-start-title" data-tour="hub-start">
      <div className="plx-start__head">
        <h2 id="plx-start-title" className="plx-h2">{START_TITLE}</h2>
        <p className="plx-hub__sub">{START_INTRO}</p>
      </div>
      <SolIntroCard show={showSolIntro && canEdit} />
      <ol className="plx-start__list">
        {view.steps.map((s, i) => (
          <li key={s.id} className="plx-start__step" data-state={s.state} data-primary={s.primary ? "true" : undefined}>
            <span className="plx-start__num" aria-hidden>{s.state === "done" ? <Check size={16} /> : i + 1}</span>
            <div className="plx-start__copy">
              <p className="plx-start__title">
                {s.title}
                {s.state === "done" ? <span className="plx-start__done"> Done</span> : null}
              </p>
              <p className="plx-start__body">{s.body}</p>
              {s.action === "publish" && error ? (
                <p className="plx-field__error" role="alert" style={{ margin: "8px 0 0" }}>
                  {error.message}{" "}
                  {error.plan ? <a href="/dashboard/settings/plan" style={{ fontWeight: 700 }}>See plans</a> : null}
                </p>
              ) : null}
            </div>
            <div className="plx-start__cta">{action(s)}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
