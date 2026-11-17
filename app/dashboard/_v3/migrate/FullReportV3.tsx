"use client";

import "./migrate.css";
import { useState } from "react";
import { Badge, Button, ButtonLink } from "../ui";
import type { Report } from "@/app/dashboard/migrate/wordpress/wizard/types";

const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const PLUGIN_WORDS = { NEEDS_ATTENTION: "Check after the move", NATIVE: "Plexo does this for you", PRESERVED: "Comes across as it is", NOT_NEEDED: "Not needed" } as const;

/** Every page and post, and what happened to each add-on, for anyone who wants the detail. */
export function FullReportV3({ report: r, templateId }: { report: Report; templateId: string }) {
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? r.pages : r.pages.filter((p) => p.kind !== "POST").slice(0, 10);
  return (
    <div className="plx-stack" style={{ gap: 20 }}>
      <p className="plx-small" style={{ margin: 0 }}>
        {r.summary.filesCopied} files ({mb(r.summary.bytesCopied)}) copied · {r.seo.titles} of {r.seo.pagesChecked} pages kept their search title
        {r.summary.formsReconnected > 0 ? ` · ${r.summary.formsReconnected} form${r.summary.formsReconnected === 1 ? "" : "s"} reconnected` : ""}
      </p>
      <div className="plx-stack" style={{ gap: 4 }}>
        <div className="plx-rowbetween"><b>Pages and posts</b><Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all ${r.pages.length}`}</Button></div>
        <div className="plx-facts">
          {rows.map((p) => {
            const seoOk = p.seo ? Object.values(p.seo).every(Boolean) : null;
            const bad = p.status === "FAILED";
            return (
              <div className="plx-fact" key={p.key} style={{ alignItems: "center" }}>
                <div className="plx-fact__text"><b style={{ overflowWrap: "anywhere" }}>{p.title}</b><span>{p.newPath ?? p.key}</span></div>
                <Badge tone={bad ? "danger" : seoOk === false ? "warning" : "success"}>{bad ? "Not copied" : p.kind === "POST" ? "In your blog" : seoOk === false ? "Check search title" : "Copied"}</Badge>
              </div>
            );
          })}
        </div>
      </div>
      {r.plugins.length > 0 ? (
        <div className="plx-stack" style={{ gap: 4 }}>
          <b>What happened to each add-on</b>
          <div className="plx-facts">
            {r.plugins.map((p) => (
              <div className="plx-fact" key={p.slug}><div className="plx-fact__text"><b>{p.name}</b><span>{p.explanation}</span></div><Badge tone={p.outcome === "NEEDS_ATTENTION" ? "warning" : p.outcome === "NATIVE" ? "success" : "neutral"}>{PLUGIN_WORDS[p.outcome]}</Badge></div>
            ))}
          </div>
        </div>
      ) : null}
      {r.missingOnSource.length > 0 ? <p className="plx-small" style={{ margin: 0 }}>{r.missingOnSource.length} file{r.missingOnSource.length === 1 ? " was" : "s were"} already missing on WordPress, so visitors see no change.</p> : null}
      <div className="plx-row">
        {r.summary.postsCopied > 0 ? <ButtonLink size="sm" variant="secondary" href={`/dashboard/templates/${templateId}/blog`}>Manage your blog</ButtonLink> : null}
        {r.summary.formsReconnected > 0 ? <ButtonLink size="sm" variant="secondary" href={`/dashboard/templates/${templateId}/form-submissions`}>Form replies</ButtonLink> : null}
      </div>
    </div>
  );
}
