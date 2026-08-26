"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageContainer } from "../../../_components/PageContainer";

const FIELD_LABEL: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "0.4rem" };
const PANEL: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1.25rem", marginBottom: "1.25rem", background: "rgba(255,255,255,0.02)" };

type FragmentInfo = { templateId: string; updatedAt: string } | null;
type FragmentCandidate = { fragmentTemplateId: string; fragmentName: string; siteName: string; updatedAt: string };

function FragmentDesignRow({
  templateId,
  kind,
  label,
  hint,
  fragment,
}: {
  templateId: string;
  kind: "header" | "footer";
  label: string;
  hint: string;
  fragment: FragmentInfo;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [candidates, setCandidates] = useState<FragmentCandidate[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  async function handleDesignNew() {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-layout/${templateId}/${kind}`, { method: "POST" });
      if (res.ok) {
        const { fragmentTemplateId } = await res.json();
        router.push(`/dashboard/templates/${fragmentTemplateId}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePicker() {
    const opening = !showPicker;
    setShowPicker(opening);
    if (opening && candidates === null) {
      setLoadingCandidates(true);
      try {
        const res = await fetch(`/api/site-layout/${templateId}/${kind}`);
        if (res.ok) {
          const { candidates: fetched } = await res.json();
          setCandidates(fetched);
        }
      } finally {
        setLoadingCandidates(false);
      }
    }
  }

  async function handleUseExisting(sourceFragmentTemplateId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-layout/${templateId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceFragmentTemplateId }),
      });
      if (res.ok) {
        const { fragmentTemplateId } = await res.json();
        router.push(`/dashboard/templates/${fragmentTemplateId}`);
      } else {
        const { error } = await res.json().catch(() => ({}));
        alert(error ?? "Couldn't use that one. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove the ${label.toLowerCase()} from every page? The design stays saved and can be re-attached later.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/site-layout/${templateId}/${kind}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "0.8rem 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff", marginBottom: "0.2rem" }}>{label}</p>
          <p style={{ fontSize: "0.75rem", color: fragment ? "#4ade80" : "rgba(240,242,255,0.4)" }}>
            {fragment ? `Designed — updated ${new Date(fragment.updatedAt).toLocaleDateString()}` : hint}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {fragment ? (
            <>
              <Link
                href={`/dashboard/templates/${fragment.templateId}`}
                style={{ padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.8)", fontSize: "0.78rem", fontWeight: 600, textDecoration: "none" }}
              >
                Edit
              </Link>
              <button type="button" onClick={handleRemove} disabled={busy} style={{ padding: "0.4rem 0.8rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>
                Remove
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={handleTogglePicker} disabled={busy} style={{ padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(240,242,255,0.8)", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>
                Use existing…
              </button>
              <button type="button" onClick={handleDesignNew} disabled={busy} style={{ padding: "0.4rem 0.9rem", borderRadius: 8, border: "none", background: "var(--brand)", color: "#fff", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>
                {busy ? "Working…" : "Design new"}
              </button>
            </>
          )}
        </div>
      </div>

      {showPicker && !fragment && (
        <div style={{ marginTop: "0.75rem", padding: "0.75rem", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {loadingCandidates ? (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)" }}>Loading…</p>
          ) : !candidates || candidates.length === 0 ? (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)" }}>
              No other {label.toLowerCase()}s yet — design one on another site first, or start new here.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {candidates.map((c) => (
                <div key={c.fragmentTemplateId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
                  <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.8)" }}>
                    {c.fragmentName} <span style={{ color: "rgba(240,242,255,0.4)" }}>— from {c.siteName} · updated {new Date(c.updatedAt).toLocaleDateString()}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => handleUseExisting(c.fragmentTemplateId)}
                    disabled={busy}
                    style={{ flexShrink: 0, padding: "0.35rem 0.7rem", borderRadius: 6, border: "none", background: "var(--brand)", color: "#fff", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
                  >
                    Use this
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SiteLayoutClient({
  templateId,
  siteName,
  initialEnabled,
  header,
  footer,
}: {
  templateId: string;
  siteName: string;
  initialEnabled: boolean;
  header: FragmentInfo;
  footer: FragmentInfo;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function handleToggle(next: boolean) {
    setEnabled(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/site-layout/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) setSavedAt(new Date());
      else setEnabled(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.4rem" }}>Site Layout</h1>
      <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.5rem" }}>
        Design a header and footer once for &quot;{siteName}&quot; and every page picks them up automatically — edit the
        nav or a phone number in one place instead of every page.
      </p>

      <div style={PANEL}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.9rem", fontWeight: 600, color: "#f0f2ff" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => handleToggle(e.target.checked)} disabled={saving} />
          Use this header and footer on every page
        </label>
        <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", marginTop: "0.5rem" }}>
          Off by default — every page compiles exactly as it did before. Turning this on (or editing the header/footer
          below) republishes every page on this site with the change.
        </p>
        {savedAt && <span style={{ display: "block", marginTop: "0.5rem", fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>Saved {savedAt.toLocaleTimeString()}</span>}
      </div>

      <div style={PANEL}>
        <label style={FIELD_LABEL}>Header &amp; Footer</label>
        <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", marginTop: "-0.2rem", marginBottom: "0.5rem" }}>
          Design each in the same drag-and-drop builder as any other page — your nav, logo, contact details, whatever
          you want repeated. They're spliced onto every page at the top and bottom automatically.
        </p>
        <FragmentDesignRow templateId={templateId} kind="header" label="Header" hint="No header designed yet" fragment={header} />
        <FragmentDesignRow templateId={templateId} kind="footer" label="Footer" hint="No footer designed yet" fragment={footer} />
      </div>
    </PageContainer>
  );
}
