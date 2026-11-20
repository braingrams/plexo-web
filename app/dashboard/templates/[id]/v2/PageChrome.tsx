"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Chrome = { rootId: string; ready: boolean; headerBlank?: boolean; footerBlank?: boolean; unsupported?: string | null; headerTemplateId: string | null; footerTemplateId: string | null; showHeader: boolean; showFooter: boolean };

const row = { display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem" } as const;
const small = { margin: "4px 0 0", fontSize: "0.7rem", color: "var(--ed-t-450)", lineHeight: 1.4 } as const;

/**
 * "Header and footer" in the editor's Page settings: whether THIS page shows the site's shared header and footer
 * (both on by default), and a way into editing them. Renders nothing for pages that can't have them.
 */
export function PageChrome({ pageId, readOnly }: { pageId: string; readOnly?: boolean }) {
  const [c, setC] = useState<Chrome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/templates/${pageId}/page-chrome`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Chrome | null) => !cancelled && setC(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (!c) return null;
  if (c.unsupported) {
    return (
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 6 }}>Header and footer</legend>
        <p style={{ ...small, margin: 0 }}>{c.unsupported}</p>
      </fieldset>
    );
  }

  const turnOnForSite = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/site-layout/${c.rootId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d.error ?? "Couldn't add the header and footer. Try again.");
      const next = await fetch(`/api/v1/templates/${pageId}/page-chrome`).then((r) => r.json());
      setC(next);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (key: "showHeader" | "showFooter", value: boolean) => {
    setError(null);
    const before = c;
    setC({ ...c, [key]: value });
    const res = await fetch(`/api/v1/templates/${pageId}/page-chrome`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: value }) });
    if (!res.ok) {
      setC(before);
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't change that. Try again.");
    }
  };

  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }} disabled={readOnly || busy}>
      <legend style={{ fontSize: "0.78rem", fontWeight: 600, marginBottom: 6 }}>Header and footer</legend>
      {!c.ready ? (
        <>
          <p style={{ ...small, margin: 0 }}>Your site can share one header and one footer across every page, designed once.</p>
          <button type="button" onClick={() => void turnOnForSite()} style={{ alignSelf: "flex-start", padding: "0.4rem 0.8rem", borderRadius: 8, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>
            {busy ? "Adding…" : "Add a header and footer to my site"}
          </button>
        </>
      ) : (
        <>
          <label style={row}>
            <input type="checkbox" checked={c.showHeader} onChange={(e) => void toggle("showHeader", e.target.checked)} /> Show header
          </label>
          <label style={row}>
            <input type="checkbox" checked={c.showFooter} onChange={(e) => void toggle("showFooter", e.target.checked)} /> Show footer
          </label>
          {(c.headerBlank || c.footerBlank) && (
            <p style={small}>
              {c.headerBlank && c.footerBlank ? "Your site doesn't have a shared header or footer yet, so these switches don't change anything for now." : c.headerBlank ? "Your site doesn't have a shared header yet." : "Your site doesn't have a shared footer yet."}{" "}
              <Link href={`/dashboard/templates/${c.rootId}/site-layout`} style={{ fontWeight: 700 }}>{c.headerBlank ? "Add a header" : "Add a footer"}</Link>
            </p>
          )}
          {!c.headerBlank && !c.footerBlank && <p style={small}>The header and footer are shared by every page. Change them once and every page updates.</p>}
          <div style={{ display: "flex", gap: 12 }}>
            {c.headerTemplateId && !c.headerBlank && <Link href={`/dashboard/templates/${c.headerTemplateId}`} style={{ fontSize: "0.78rem", fontWeight: 600 }}>Edit site header</Link>}
            {c.footerTemplateId && !c.footerBlank && <Link href={`/dashboard/templates/${c.footerTemplateId}`} style={{ fontSize: "0.78rem", fontWeight: 600 }}>Edit site footer</Link>}
          </div>
        </>
      )}
      {error && <p role="alert" style={{ margin: 0, fontSize: "0.75rem", color: "var(--ed-danger)" }}>{error}</p>}
    </fieldset>
  );
}
