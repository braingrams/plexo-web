"use client";

import { useState } from "react";
import Link from "next/link";
import { PageContainer, useEmbeddedScreen } from "../../../_components/PageContainer";
import { SiteBackLink } from "../../../_components/EditorTheme";
import { Card } from "../../../_components/Card";

export type SectionTypeSummary = {
  id: string;
  name: string;
  description?: string;
  starter?: string;
  fieldCount: number;
  /** What the repeating part is called ("testimonial", "question"), if the section has one. */
  repeats?: string;
};

const button: React.CSSProperties = { padding: "0.6rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit", background: "var(--ed-cta)", color: "var(--ed-on-brand)", textDecoration: "none", display: "inline-block" };
const ghost: React.CSSProperties = { padding: "0.45rem 0.85rem", borderRadius: 9, border: "1px solid var(--ed-w-100)", background: "transparent", color: "var(--ed-text)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, fontFamily: "inherit", textDecoration: "none", display: "inline-block" };

/** "Your sections": the section types this site can drop on any page, with a way to make a new one, change one or remove one. */
export function SectionsClient({ templateId, templateName, initial }: { templateId: string; templateName: string; initial: SectionTypeSummary[] }) {
  const embedded = useEmbeddedScreen();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const base = `/dashboard/templates/${templateId}/sections`;

  async function remove(s: SectionTypeSummary) {
    if (!window.confirm(`Remove "${s.name}"? Pages that already use it keep what they show, but you won't be able to add it to new pages.`)) return;
    setError(null);
    const res = await fetch(`/api/v1/templates/${templateId}/section-types/${s.id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== s.id));
    else setError("We couldn't remove that section. Please try again.");
  }

  return (
    <PageContainer>
      {!embedded && (
        <SiteBackLink siteId={templateId} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--ed-t-500)", textDecoration: "none", marginBottom: "1.5rem" }}>
          ← {templateName}
        </SiteBackLink>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1.75rem" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800, color: "var(--ed-text)", letterSpacing: "-0.02em" }}>Your sections</h1>
          <p style={{ fontSize: "0.85rem", color: "var(--ed-t-450)", marginTop: "0.4rem", maxWidth: 640 }}>
            Design a section once, like testimonials or team members, then add it to any page from the editor&rsquo;s <b>Add section</b> panel. Each page keeps its own words; change the design here and every page follows.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <Link href={`${base}/entries`} style={ghost}>Where they&rsquo;re used</Link>
          <Link href={`${base}/new`} style={button}>+ Make a new section</Link>
        </div>
      </div>

      {error && <p role="alert" style={{ fontSize: "0.8rem", color: "var(--ed-danger)", marginBottom: "1rem" }}>{error}</p>}

      {items.length === 0 ? (
        <Card style={{ padding: "3rem 2rem", textAlign: "center" }}>
          <p style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--ed-t-700)" }}>You haven&rsquo;t made any sections yet</p>
          <p style={{ fontSize: "0.82rem", color: "var(--ed-t-400)", margin: "0.4rem 0 1.2rem" }}>Tell us what you&rsquo;re creating and pick how it should look. It takes about a minute.</p>
          <Link href={`${base}/new`} style={button}>Make your first section</Link>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {items.map((s) => (
            <Card key={s.id} style={{ padding: "1.25rem 1.4rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <p style={{ fontSize: "1rem", fontWeight: 800, color: "var(--ed-text)" }}>{s.name}</p>
                {s.description && <p style={{ fontSize: "0.8rem", color: "var(--ed-t-450)", marginTop: 4 }}>{s.description}</p>}
                <p style={{ fontSize: "0.75rem", color: "var(--ed-t-400)", marginTop: 8 }}>
                  {s.repeats ? `Repeats: add as many ${s.repeats}s as you like` : `${s.fieldCount} ${s.fieldCount === 1 ? "thing" : "things"} to fill in`}
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "auto", flexWrap: "wrap" }}>
                <Link href={`${base}/entries?type=${s.id}`} style={ghost}>See where it&rsquo;s used</Link>
                <Link href={`${base}/${s.id}`} style={ghost}>Change design</Link>
                <button type="button" onClick={() => remove(s)} style={{ ...ghost, color: "var(--ed-danger)" }}>Remove</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p style={{ fontSize: "0.78rem", color: "var(--ed-t-400)", marginTop: "1.5rem" }}>
        To use one: open a page in the editor, choose <b>Add section</b>, then <b>Yours</b>. You can choose how many times it repeats and fill in each one.
      </p>
    </PageContainer>
  );
}
