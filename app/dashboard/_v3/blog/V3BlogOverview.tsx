"use client";

import "../hub/hub.css";
import "../legacy.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, LayoutTemplate, PenLine, Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, StatusPill } from "../ui";
import { LegacyBridge } from "../LegacyBridge";
import { NewFromMarketplace } from "../../templates/NewFromMarketplace";
import { formatPublishedQuotaLabel } from "@/lib/blog/publishQuotaLabel";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";
import type { BlogSummary, EligibleTemplate } from "../../blog/BlogOverviewClient";

type Step = "closed" | "choose" | "blank" | "gallery" | "existing";

const dateOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The Blogs list for the new dashboard. Same data and calls as the old page; Manage goes to the site's Blog tab. */
export function V3BlogOverview({ blogs, eligibleTemplates }: { blogs: BlogSummary[]; eligibleTemplates: EligibleTemplate[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("closed");
  const [blogName, setBlogName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState(eligibleTemplates[0]?.id ?? "");

  function close() {
    setStep("closed");
    setBlogName("");
    setError(null);
  }

  async function enableAndGo(templateId: string) {
    await fetch(`/api/blog/${templateId}/site`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
    close();
    router.push(siteHubHref(templateId, "blog"));
  }

  async function enableExisting() {
    if (!existingId) return;
    setBusy(true);
    setError(null);
    try {
      await enableAndGo(existingId);
    } catch {
      setError("We couldn't turn on the blog just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createBlank() {
    if (!blogName.trim()) {
      setError("Give your blog a name first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: blogName, kind: "LANDING_PAGE" }) });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "We couldn't create your blog. Please try again.");
      }
      const payload = (await res.json()) as { template: { id: string } };
      await enableAndGo(payload.template.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't create your blog. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const start = (
    <Button leftIcon={<Plus size={18} aria-hidden />} onClick={() => setStep("choose")}>Start a blog</Button>
  );
  const back = <Button variant="ghost" size="sm" onClick={() => { setError(null); setStep("choose"); }}>Back</Button>;
  const choice = (icon: React.ReactNode, title: string, body: string, on: () => void, disabled?: boolean) => (
    <button type="button" className="plx-hub__choice" onClick={on} disabled={disabled}>
      <span aria-hidden className="plx-hub__choice-icon">{icon}</span>
      <span>
        <span className="plx-h3" style={{ display: "block" }}>{title}</span>
        <span className="plx-small">{body}</span>
      </span>
    </button>
  );

  return (
    <div className="plx-page plx-hub">
      <div className="plx-hub__bar">
        <div>
          <h1 className="plx-h1">My blogs</h1>
          <p className="plx-hub__sub">Every site that has a blog, in one place. Tap one to write posts.</p>
        </div>
        {blogs.length ? start : null}
      </div>

      {blogs.length === 0 ? (
        <EmptyState
          title="You don't have a blog yet"
          body="Start a fresh blog, begin from a ready-made design, or add a blog to a website you already have."
          action={start}
        />
      ) : (
        <div className="plx-hub__grid plx-hub__grid--wide">
          {blogs.map((b) => (
            <Card key={b.id} as="article" className="plx-sitecard">
              <div className="plx-sitecard__top">
                <Badge tone="brand">{formatPublishedQuotaLabel(b.publishedCount, b.publishedLimit)}</Badge>
                <StatusPill status={b.liveDomain ? "live" : "draft"} />
              </div>
              <h2 className="plx-sitecard__name">{b.blogTitle}</h2>
              <span className="plx-small">{b.name} · Updated {dateOf(b.updatedAt)}</span>
              <div className="plx-sitecard__foot">
                <Button size="sm" onClick={() => router.push(siteHubHref(b.id, "blog"))}>Write posts</Button>
                {b.liveDomain ? (
                  <a href={`https://${b.liveDomain}/blog`} target="_blank" rel="noreferrer" className="plx-btn plx-btn--ghost plx-btn--sm" aria-label={`Visit ${b.blogTitle}`}>
                    Visit <ExternalLink size={14} aria-hidden />
                  </a>
                ) : (
                  <span className="plx-small">Not online yet</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={step !== "closed"}
        onClose={close}
        width={step === "gallery" ? 880 : 520}
        title={step === "choose" ? "How do you want to start?" : step === "blank" ? "Name your blog" : step === "gallery" ? "Start from a design" : "Add a blog to a website"}
        footer={
          step === "blank" ? (
            <>
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button onClick={() => void createBlank()} loading={busy}>Create blog</Button>
            </>
          ) : step === "existing" ? (
            <>
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button onClick={() => void enableExisting()} loading={busy} disabled={!existingId}>Turn on blog</Button>
            </>
          ) : undefined
        }
      >
        {step === "choose" ? (
          <div className="plx-hub__choices">
            {choice(<PenLine size={20} />, "A fresh blog", "Start empty and write your first post.", () => setStep("blank"))}
            {choice(<LayoutTemplate size={20} />, "Start from a design", "Pick a ready-made look. The blog is switched on for you.", () => setStep("gallery"))}
            {choice(<FileText size={20} />, "Add to a website I have", eligibleTemplates.length === 0 ? "Every website you have already has a blog." : "Turn on a blog for a website you already built.", () => setStep("existing"), eligibleTemplates.length === 0)}
          </div>
        ) : null}
        {step === "blank" ? (
          <div className="plx-hub__stack">
            {back}
            <Input label="Blog name" value={blogName} onChange={(e) => setBlogName(e.target.value)} placeholder="My blog" error={error ?? undefined} onKeyDown={(e) => { if (e.key === "Enter") void createBlank(); }} />
          </div>
        ) : null}
        {step === "existing" ? (
          <div className="plx-hub__stack">
            {back}
            <Select label="Website" value={existingId} onChange={(e) => setExistingId(e.target.value)} options={eligibleTemplates.map((t) => ({ value: t.id, label: t.name }))} error={error ?? undefined} />
          </div>
        ) : null}
        {step === "gallery" ? (
          <div className="plx-hub__stack">
            {back}
            <LegacyBridge>
              <NewFromMarketplace onClose={close} onCreated={(id) => void enableAndGo(id)} />
            </LegacyBridge>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
