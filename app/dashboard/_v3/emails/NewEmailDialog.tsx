"use client";

import "./emails.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Code2, FilePlus2, LayoutDashboard, LayoutTemplate, Mail, MessageCircle, Search } from "lucide-react";
import { Badge, Button, ButtonLink, Input, Modal, Skeleton } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { solEmailHref, type EmailUsage } from "@/lib/dashboardV3/emails";

export type ReadyMadeEmail = { id: string; name: string; category: string | null; priceCents: number; /** Only set for made-up preview data; real ones are fetched when they scroll into view. */ html?: string };
export type EmailStart = "choose" | "blank" | "design" | "canvas" | "html";

const FRAME_W = 640;

/** The design's real look, loaded only once it is on screen. Sandboxed: scripts in an email never run. */
function DesignThumb({ design, preview }: { design: ReadyMadeEmail; preview?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [html, setHtml] = useState<string | null>(design.html ?? null);
  const [scale, setScale] = useState(0.28);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / FRAME_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || html !== null || preview) return;
    let off = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fetch(`/api/v1/marketplace/templates/${design.id}/preview`)
        .then((r) => r.json())
        .then((d: { html?: string }) => !off && setHtml(d.html ?? ""))
        .catch(() => !off && setHtml(""));
    });
    io.observe(el);
    return () => {
      off = true;
      io.disconnect();
    };
  }, [design.id, html, preview]);
  return (
    <span ref={ref} className="plx-pick__art plx-pick__art--mail">
      {html ? <iframe className="plx-ecard__frame" title="" aria-hidden srcDoc={html} sandbox="" tabIndex={-1} style={{ transform: `scale(${scale})` }} /> : <Mail size={32} aria-hidden />}
    </span>
  );
}

/** Three big ways to begin. Shared by the New email dialog and the empty Emails page. */
export function EmailChoices({ onBlank, onDesign, onSol }: { onBlank: () => void; onDesign: () => void; onSol?: () => void }) {
  return (
    <div className="plx-echoices">
      <button type="button" className="plx-echoice" onClick={onDesign} data-testid="email-choice-design">
        <span className="plx-echoice__icon"><LayoutTemplate size={26} aria-hidden /></span>
        <b>Start from a ready-made design</b>
        <span>Pick a look that is already laid out. Change the words and pictures.</span>
      </button>
      <button type="button" className="plx-echoice" onClick={onBlank} data-testid="email-choice-blank">
        <span className="plx-echoice__icon"><FilePlus2 size={26} aria-hidden /></span>
        <b>Start blank</b>
        <span>An empty email. You decide what goes in it.</span>
      </button>
      <a className="plx-echoice" href={solEmailHref()} onClick={onSol} data-testid="email-choice-sol">
        <span className="plx-echoice__icon"><MessageCircle size={26} aria-hidden /></span>
        <b>Ask SOL to write it for me</b>
        <span>Tell SOL who it is for. SOL writes and designs it.</span>
      </a>
    </div>
  );
}

/** Start a new email: one screen with three clear ways in (emails only: the picker asks for EMAIL kind). */
export function NewEmailDialog({ open, onClose, usage, designs, preview, start = "choose" }: { open: boolean; onClose: () => void; usage: EmailUsage; designs?: ReadyMadeEmail[]; preview?: boolean; start?: EmailStart }) {
  const router = useRouter();
  const [mode, setMode] = useState<EmailStart>(start);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ReadyMadeEmail[] | null>(designs ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(start);
      setError(null);
      setPicked(null);
    }
  }, [open, start]);

  useEffect(() => {
    if (!open || designs || mode !== "design") return;
    let off = false;
    const t = window.setTimeout(() => {
      const p = new URLSearchParams({ kind: "EMAIL", sort: "popular", ...(q.trim() ? { q: q.trim() } : {}) });
      fetch(`/api/v1/marketplace/templates?${p}`)
        .then((r) => r.json())
        .then((d) => !off && setItems(((d.templates ?? []) as (ReadyMadeEmail & { kind?: string })[]).filter((x) => !x.kind || x.kind === "EMAIL")))
        .catch(() => !off && setItems([]));
    }, q ? 250 : 0);
    return () => {
      off = true;
      window.clearTimeout(t);
    };
  }, [open, q, designs, mode]);

  const shown = designs ? designs.filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase())) : items;
  const chosen = shown?.find((d) => d.id === picked) ?? null;

  async function create() {
    setError(null);
    setBusy(true);
    try {
      if (preview) return onClose();
      if (mode === "canvas" || mode === "html") {
        if (!name.trim()) throw new Error("Give your email a name first, like “Welcome email”.");
        const r = await hubApi<{ template: { id: string } }>("/api/templates", { method: "POST", json: { name: name.trim(), kind: "EMAIL", ...(mode === "html" ? { htmlContent: "" } : {}) } });
        router.push(`/dashboard/templates/${r.template.id}`);
      } else if (chosen) {
        if (chosen.priceCents > 0) return void router.push(`/dashboard/marketplace/${chosen.id}`);
        const r = await hubApi<{ template: { id: string } }>(`/api/v1/marketplace/templates/${chosen.id}/use`, { method: "POST" });
        router.push(`/dashboard/templates/${r.template.id}`);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const choosing = mode === "choose";
  const footer = usage.atLimit ? (
    <>
      <Button variant="secondary" onClick={onClose}>Not now</Button>
      <ButtonLink href="/dashboard/settings/plan">See plans</ButtonLink>
    </>
  ) : choosing || mode === "blank" ? (
    <Button variant="secondary" onClick={onClose}>Cancel</Button>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={busy} disabled={mode === "design" && !chosen} onClick={create}>{mode === "design" && chosen && chosen.priceCents > 0 ? "See this design" : "Create email"}</Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} width={choosing ? 760 : 720} title="Make an email" description={usage.atLimit ? undefined : choosing ? "How would you like to start?" : undefined} footer={footer}>
      {usage.atLimit ? (
        <div className="plx-inlinemsg plx-inlinemsg--warn">You have used all {usage.limit} email{usage.limit === 1 ? "" : "s"} your plan includes. Delete one you don&apos;t need, or move to a bigger plan to make more.</div>
      ) : (
        <div className="plx-newem">
          {choosing ? (
            <EmailChoices onBlank={() => setMode("blank")} onDesign={() => setMode("design")} />
          ) : (
            <Button variant="ghost" size="sm" leftIcon={<ArrowLeft size={16} aria-hidden />} onClick={() => setMode(mode === "canvas" || mode === "html" ? "blank" : "choose")} style={{ alignSelf: "flex-start" }}>{mode === "canvas" || mode === "html" ? "Back" : "Other ways to start"}</Button>
          )}
          {mode === "blank" ? (
            <div className="plx-echoices plx-echoices--two">
              <button type="button" className="plx-echoice" onClick={() => setMode("canvas")} data-testid="email-kind-canvas">
                <span className="plx-echoice__icon"><LayoutDashboard size={26} aria-hidden /></span>
                <b>Visual canvas</b>
                <span>Build it by clicking and dragging. No code needed.</span>
              </button>
              <button type="button" className="plx-echoice" onClick={() => setMode("html")} data-testid="email-kind-html">
                <span className="plx-echoice__icon"><Code2 size={26} aria-hidden /></span>
                <b>Paste or write HTML</b>
                <span>Already have the HTML? Paste it into a full-size editor and see it straight away.</span>
              </button>
            </div>
          ) : null}
          {mode === "canvas" || mode === "html" ? (
            <Input autoFocus label="What is this email for?" value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome email" onKeyDown={(e) => e.key === "Enter" && create()} help="Only you see this name." />
          ) : null}
          {mode === "html" ? <p className="plx-small">Next you'll see a full-size editor: paste your HTML on the left and your email shows on the right as you type.</p> : null}
          {mode === "design" ? (
            <>
              <div className="plx-emsearch" style={{ maxWidth: "none" }}>
                <Search size={18} aria-hidden />
                <Input hideLabel label="Search designs" placeholder="Search email designs" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {shown === null ? (
                <div className="plx-picker">{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 200, borderRadius: 16 }} />)}</div>
              ) : shown.length === 0 ? (
                <p className="plx-small">No email designs match that.</p>
              ) : (
                <div className="plx-picker" role="radiogroup" aria-label="Email designs" style={{ maxHeight: 400, overflowY: "auto", paddingRight: 2 }}>
                  {shown.map((d) => (
                    <button key={d.id} type="button" role="radio" aria-checked={picked === d.id} className="plx-pick" onClick={() => setPicked(d.id)}>
                      <DesignThumb design={d} preview={preview} />
                      <span className="plx-pick__t">
                        <b>{d.name}</b>
                        <span>{d.category ?? "Email"}</span>
                        {d.priceCents > 0 ? <Badge tone="brand">Paid</Badge> : <Badge tone="success">Free</Badge>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}
          {error ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div> : null}
        </div>
      )}
    </Modal>
  );
}
