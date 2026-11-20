"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageContainer } from "../../../_components/PageContainer";
import { CustomCodeCard } from "./CustomCodeCard";

const PANEL: React.CSSProperties = { border: "1px solid var(--ed-w-080)", borderRadius: 12, padding: "1.25rem", background: "var(--ed-w-020)" };
const BTN: React.CSSProperties = { padding: "0.45rem 0.95rem", borderRadius: 8, border: "1px solid var(--ed-w-120)", background: "transparent", color: "var(--ed-t-800)", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", textDecoration: "none" };
const PRIMARY: React.CSSProperties = { ...BTN, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)", fontWeight: 700 };

type Look = { variant: string; label: string; description: string };
type Info = {
  siteKind: "visual" | "classic" | "html" | "app";
  supported: boolean;
  message?: string;
  enabled?: boolean;
  headerBlank?: boolean;
  footerBlank?: boolean;
  headerTemplateId?: string | null;
  footerTemplateId?: string | null;
  looks?: { header: Look[]; footer: Look[]; source: { links: { label: string; href: string }[]; from: "menu" | "pages" } } | null;
  pagesWithOwnHeader?: { id: string; name: string }[];
  pagesWithOwnFooter?: { id: string; name: string }[];
};

const FRAME_W = 1280;
const FRAME_H: Record<"header" | "footer", number> = { header: 120, footer: 340 };

/** A small, inert picture of a header or footer as visitors will see it: the page drawn at full width, then scaled to fit. */
function FramePreview({ src, kind, label }: { src: string; kind: "header" | "footer"; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => setScale(el.clientWidth / FRAME_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} role="img" aria-label={label} style={{ position: "relative", overflow: "hidden", width: "100%", height: Math.round(FRAME_H[kind] * scale), borderRadius: 8, border: "1px solid var(--ed-w-120)", background: "#fff", pointerEvents: "none" }}>
      <iframe src={src} title={label} tabIndex={-1} loading="lazy" referrerPolicy="no-referrer" style={{ position: "absolute", top: 0, left: 0, width: FRAME_W, height: FRAME_H[kind], border: 0, transform: `scale(${scale})`, transformOrigin: "top left" }} />
    </div>
  );
}

type Kind = "header" | "footer";
const WORDS: Record<Kind, { title: string; noun: string; blank: string; add: string }> = {
  header: { title: "Site header", noun: "header", blank: "Your pages show nothing here yet. Add a header to give every page the same menu at the top.", add: "Add a header" },
  footer: { title: "Site footer", noun: "footer", blank: "Your pages show nothing here yet. Add a footer to give every page the same links and small print at the bottom.", add: "Add a footer" },
};

function LayoutPart({ templateId, kind, info, onChanged }: { templateId: string; kind: Kind; info: Info; onChanged: () => void }) {
  const router = useRouter();
  const w = WORDS[kind];
  const blank = kind === "header" ? info.headerBlank : info.footerBlank;
  const fragmentId = kind === "header" ? info.headerTemplateId : info.footerTemplateId;
  const looks = info.looks?.[kind] ?? [];
  const own = (kind === "header" ? info.pagesWithOwnHeader : info.pagesWithOwnFooter) ?? [];
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function adopt(variant: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/site-layout/${templateId}/looks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, variant }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d.error ?? `Couldn't add the ${w.noun}. Try again.`);
      setPicking(false);
      setDismissed(false);
      setDone(`Your ${w.noun} is on every page now.`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeOld() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/site-layout/${templateId}/looks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, removeOwn: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d.error ?? "Couldn't remove those. Try again.");
      setDone(`Done. ${d.changed} page${d.changed === 1 ? "" : "s"} now use the shared ${w.noun}.`);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function editInEditor() {
    if (fragmentId) return router.push(`/dashboard/templates/${fragmentId}`);
    setBusy(true);
    try {
      const res = await fetch(`/api/site-layout/${templateId}/${kind}`, { method: "POST" });
      if (res.ok) router.push(`/dashboard/templates/${(await res.json()).fragmentTemplateId}`);
      else setError(`Couldn't open the ${w.noun}. Try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove the ${w.noun} from every page? Your design stays saved.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/site-layout/${templateId}/${kind}`, { method: "DELETE" });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={PANEL}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--ed-text)", margin: 0 }}>{w.title}</h2>
          <p style={{ fontSize: "0.8rem", color: blank ? "var(--ed-t-500)" : "var(--ed-success)", margin: "0.3rem 0 0", lineHeight: 1.5 }}>
            {blank ? w.blank : `Shown on every page. Change it once and every page updates.`}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {blank ? (
            info.siteKind === "visual" ? (
              <button type="button" style={PRIMARY} onClick={() => setPicking((p) => !p)} disabled={busy}>{w.add}</button>
            ) : (
              <button type="button" style={PRIMARY} onClick={() => void editInEditor()} disabled={busy}>{busy ? "Opening…" : "Design in the editor"}</button>
            )
          ) : (
            <>
              <button type="button" style={BTN} onClick={() => void editInEditor()} disabled={busy}>Edit</button>
              {info.siteKind === "visual" && <button type="button" style={BTN} onClick={() => setPicking((p) => !p)} disabled={busy}>Try another look</button>}
              <button type="button" style={{ ...BTN, color: "var(--ed-danger)" }} onClick={() => void remove()} disabled={busy}>Remove</button>
            </>
          )}
        </div>
      </div>

      {!blank && info.siteKind === "visual" && (kind === "header" ? info.headerTemplateId : info.footerTemplateId) ? (
        <div style={{ marginTop: "0.9rem" }}>
          <p style={{ fontSize: "0.75rem", color: "var(--ed-t-500)", margin: "0 0 0.35rem" }}>This is how your {w.noun} looks to visitors:</p>
          <FramePreview kind={kind} label={`Preview of your ${w.noun}`} src={`/api/v1/templates/${kind === "header" ? info.headerTemplateId : info.footerTemplateId}/draft-preview?thumb=1`} />
        </div>
      ) : null}

      {blank && info.siteKind === "classic" && (
        <p style={{ fontSize: "0.78rem", color: "var(--ed-t-400)", margin: "0.7rem 0 0", lineHeight: 1.5 }}>
          This site uses the classic editor, so you design its {w.noun} there, like any other page. Until you do, nothing changes on your live site.
        </p>
      )}

      {picking && info.siteKind === "visual" && (
        <div style={{ marginTop: "1rem" }}>
          <p style={{ fontSize: "0.8rem", color: "var(--ed-t-500)", margin: "0 0 0.6rem", lineHeight: 1.5 }}>
            {info.looks?.source.from === "menu"
              ? `Pick a look. We'll use the menu already on your home page${kind === "header" ? " (" + (info.looks?.source.links ?? []).map((l) => l.label).join(", ") + ")" : ""}.`
              : "Pick a look. We'll start with your pages. You can change the words afterwards, in the editor."}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.6rem" }}>
            {looks.map((l) => (
              <button key={l.variant} type="button" onClick={() => void adopt(l.variant)} disabled={busy} style={{ textAlign: "left", padding: "0.8rem", borderRadius: 10, border: "1px solid var(--ed-w-120)", background: "var(--ed-w-030)", color: "inherit", cursor: "pointer" }}>
                <span style={{ display: "block", marginBottom: 8 }}><FramePreview kind={kind} label={`Preview: ${l.label}`} src={`/api/site-layout/${templateId}/looks/preview?kind=${kind}&variant=${encodeURIComponent(l.variant)}`} /></span>
                <span style={{ display: "block", fontSize: "0.82rem", fontWeight: 700 }}>{l.label}</span>
                <span style={{ display: "block", fontSize: "0.75rem", color: "var(--ed-t-500)", marginTop: 3 }}>{l.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!blank && own.length > 0 && !dismissed && (
        <div role="note" style={{ marginTop: "1rem", padding: "0.75rem 0.9rem", borderRadius: 10, background: "color-mix(in srgb, var(--ed-warning) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--ed-warning) 30%, transparent)", fontSize: "0.82rem", lineHeight: 1.5 }}>
          {own.length} page{own.length === 1 ? " has its" : "s have their"} own {w.noun} as well ({own.slice(0, 4).map((p) => p.name).join(", ")}{own.length > 4 ? "…" : ""}), so visitors may see two. Remove the old {w.noun}{own.length === 1 ? "" : "s"}?
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
            <button type="button" style={PRIMARY} onClick={() => void removeOld()} disabled={busy}>Remove the old {w.noun}{own.length === 1 ? "" : "s"}</button>
            <button type="button" style={BTN} onClick={() => setDismissed(true)} disabled={busy}>Keep them</button>
          </div>
        </div>
      )}

      {done && <p role="status" style={{ margin: "0.8rem 0 0", fontSize: "0.8rem", color: "var(--ed-success)" }}>{done}</p>}
      {error && <p role="alert" style={{ margin: "0.8rem 0 0", fontSize: "0.8rem", color: "var(--ed-danger)" }}>{error}</p>}
    </div>
  );
}

export function SiteLayoutClient({ templateId, siteName, initialEnabled }: { templateId: string; siteName: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/site-layout/${templateId}/looks`);
      if (!res.ok) return setLoadError(true);
      const d = (await res.json()) as Info;
      setInfo(d);
      if (typeof d.enabled === "boolean") setEnabled(d.enabled);
    } catch {
      setLoadError(true);
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(next: boolean) {
    setEnabled(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/site-layout/${templateId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next }) });
      if (res.ok) void load();
      else setEnabled(!next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--ed-text)", marginBottom: "0.4rem" }}>Header and footer</h1>
      <p style={{ fontSize: "0.85rem", color: "var(--ed-t-500)", marginBottom: "1.5rem", lineHeight: 1.5 }}>
        Design the header and footer once for &quot;{siteName}&quot; and every page shows them. Change a menu link or a phone number in one place instead of on every page. Any page can hide them for itself under Page settings, with the &quot;Show header&quot; and &quot;Show footer&quot; switches.
      </p>

      {loadError && <p role="alert" style={{ color: "var(--ed-danger)", fontSize: "0.85rem" }}>We couldn&apos;t load this just now. Refresh the page to try again.</p>}

      {info && !info.supported && (
        <div style={{ ...PANEL, marginBottom: "1.25rem" }}>
          <p style={{ fontSize: "0.9rem", lineHeight: 1.55, margin: 0 }}>{info.message}</p>
        </div>
      )}

      {info?.supported && (
        <>
          <div style={{ ...PANEL, marginBottom: "1.25rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.9rem", fontWeight: 600, color: "var(--ed-text)" }}>
              <input type="checkbox" checked={enabled} onChange={(e) => void handleToggle(e.target.checked)} disabled={saving} />
              Show the site header and footer on every page
            </label>
            {(info.headerBlank || info.footerBlank) && (
              <p style={{ fontSize: "0.78rem", color: "var(--ed-t-400)", margin: "0.5rem 0 0", lineHeight: 1.5 }}>
                Sites made before this existed start with an empty header and footer, so nothing on your live site changes until you add one below.
              </p>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "1.25rem", marginBottom: "1.25rem", alignItems: "start" }}>
            <LayoutPart templateId={templateId} kind="header" info={info} onChanged={() => void load()} />
            <LayoutPart templateId={templateId} kind="footer" info={info} onChanged={() => void load()} />
          </div>
        </>
      )}

      {info?.siteKind === "app" ? (
        <div style={PANEL}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--ed-text)", margin: "0 0 0.35rem" }}>Add your own code</h2>
          <p style={{ fontSize: "0.82rem", color: "var(--ed-t-500)", margin: 0, lineHeight: 1.55 }}>This site is an app built with code, so a tracking or verification snippet goes inside the app itself. Ask Plexo&apos;s assistant to add it for you.</p>
        </div>
      ) : (
        <CustomCodeCard templateId={templateId} />
      )}
      <p style={{ fontSize: "0.75rem", color: "var(--ed-t-400)", marginTop: "1rem" }}>
        <Link href={`/dashboard/templates/${templateId}`} style={{ fontWeight: 600 }}>Back to the editor</Link>
      </p>
    </PageContainer>
  );
}
