"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Notice } from "@/app/dashboard/_v3/ui";
import { CustomCodeCard } from "./CustomCodeCard";

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
    <div ref={box} role="img" aria-label={label} style={{ position: "relative", overflow: "hidden", width: "100%", height: Math.round(FRAME_H[kind] * scale), borderRadius: 8, border: "1px solid var(--plx-border)", background: "#fff", pointerEvents: "none" }}>
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
    <Card>
      <div className="plx-layoutpart__head">
        <div style={{ minWidth: 0, flex: "1 1 240px" }}>
          <h2 className="plx-card__title">{w.title}</h2>
          <p className="plx-card__desc" style={blank ? undefined : { color: "var(--plx-success)" }}>
            {blank ? w.blank : "Shown on every page. Change it once and every page updates."}
          </p>
        </div>
        <div className="plx-layoutpart__act">
          {blank ? (
            info.siteKind === "visual" ? (
              <Button onClick={() => setPicking((p) => !p)} disabled={busy}>{w.add}</Button>
            ) : (
              <Button onClick={() => void editInEditor()} loading={busy}>Design in the editor</Button>
            )
          ) : (
            <>
              <Button variant="secondary" onClick={() => void editInEditor()} disabled={busy}>Edit</Button>
              {info.siteKind === "visual" && <Button variant="secondary" onClick={() => setPicking((p) => !p)} disabled={busy}>Try another look</Button>}
              <Button variant="secondary" onClick={() => void remove()} disabled={busy}>Remove</Button>
            </>
          )}
        </div>
      </div>

      {!blank && info.siteKind === "visual" && (kind === "header" ? info.headerTemplateId : info.footerTemplateId) ? (
        <div style={{ marginTop: 16 }}>
          <p className="plx-small" style={{ margin: "0 0 6px" }}>This is how your {w.noun} looks to visitors:</p>
          <FramePreview kind={kind} label={`Preview of your ${w.noun}`} src={`/api/v1/templates/${kind === "header" ? info.headerTemplateId : info.footerTemplateId}/draft-preview?thumb=1`} />
        </div>
      ) : null}

      {blank && info.siteKind === "classic" && (
        <p className="plx-small" style={{ margin: "12px 0 0" }}>
          This site uses the classic editor, so you design its {w.noun} there, like any other page. Until you do, nothing changes on your live site.
        </p>
      )}

      {picking && info.siteKind === "visual" && (
        <div style={{ marginTop: 16 }}>
          <p className="plx-small" style={{ margin: "0 0 10px" }}>
            {info.looks?.source.from === "menu"
              ? `Pick a look. We'll use the menu already on your home page${kind === "header" ? " (" + (info.looks?.source.links ?? []).map((l) => l.label).join(", ") + ")" : ""}.`
              : "Pick a look. We'll start with your pages. You can change the words afterwards, in the editor."}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))", gap: 12 }}>
            {looks.map((l) => (
              <button key={l.variant} type="button" className="plx-layoutpart__look" onClick={() => void adopt(l.variant)} disabled={busy}>
                <span style={{ display: "block", marginBottom: 8 }}><FramePreview kind={kind} label={`Preview: ${l.label}`} src={`/api/site-layout/${templateId}/looks/preview?kind=${kind}&variant=${encodeURIComponent(l.variant)}`} /></span>
                <b style={{ display: "block", fontSize: 14 }}>{l.label}</b>
                <span className="plx-small" style={{ display: "block", marginTop: 3 }}>{l.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!blank && own.length > 0 && !dismissed && (
        <div style={{ marginTop: 16 }}>
          <Notice kind="warning" title="Visitors may see two">
            {own.length} page{own.length === 1 ? " has its" : "s have their"} own {w.noun} as well ({own.slice(0, 4).map((p) => p.name).join(", ")}{own.length > 4 ? "…" : ""}). Remove the old {w.noun}{own.length === 1 ? "" : "s"}?
            <div className="plx-layoutpart__act" style={{ marginTop: 10 }}>
              <Button size="sm" onClick={() => void removeOld()} disabled={busy}>Remove the old {w.noun}{own.length === 1 ? "" : "s"}</Button>
              <Button size="sm" variant="secondary" onClick={() => setDismissed(true)} disabled={busy}>Keep them</Button>
            </div>
          </Notice>
        </div>
      )}

      {done && <div style={{ marginTop: 12 }}><Notice kind="success" title={done} /></div>}
      {error && <div style={{ marginTop: 12 }}><Notice kind="error" title="That didn't work">{error}</Notice></div>}
    </Card>
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

  const layoutHandled = info?.supported;
  return (
    <div data-plexo-v3 className="plx-page" data-testid="site-layout">
      <div>
        <h1 className="plx-h1">Header, footer and code</h1>
        <p className="plx-body" style={{ marginTop: 6 }}>
          Design the header and footer once for &quot;{siteName}&quot; and every page shows them. Change a menu link or a phone number in one place. Further down, add tracking or verification code from a service like Google or Meta.
        </p>
      </div>

      {loadError && <Notice kind="error" title="We couldn't load this just now">Refresh the page to try again.</Notice>}

      {info && !info.supported && (
        <Card><p className="plx-body" style={{ margin: 0 }}>{info.message}</p></Card>
      )}

      {layoutHandled && info && (
        <>
          <Card>
            <label className="plx-layoutpart__check">
              <input type="checkbox" checked={enabled} onChange={(e) => void handleToggle(e.target.checked)} disabled={saving} />
              <span>
                <b>Show the site header and footer on every page</b>
                {(info.headerBlank || info.footerBlank) && (
                  <span className="plx-small" style={{ display: "block", marginTop: 4 }}>
                    Sites made before this existed start with an empty header and footer, so nothing on your live site changes until you add one below.
                  </span>
                )}
              </span>
            </label>
          </Card>
          <div className="plx-layoutpart__grid">
            <LayoutPart templateId={templateId} kind="header" info={info} onChanged={() => void load()} />
            <LayoutPart templateId={templateId} kind="footer" info={info} onChanged={() => void load()} />
          </div>
        </>
      )}

      <CustomCodeCard templateId={templateId} />

      <p className="plx-small" style={{ margin: 0 }}>
        <Link href={`/dashboard/templates/${templateId}`} style={{ fontWeight: 700 }}>Back to the editor</Link>
      </p>
    </div>
  );
}
