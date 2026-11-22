"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { Button, Modal, Textarea } from "../ui";
import { SolGlyph } from "./SolGlyph";
import { SolOutOfCredits } from "../../_components/sol/SolTopUp";
import { useCredits } from "../../apps/_components/Credits";
import { checkAiCredits, generateWithProgress, type AiRequestBody } from "@/lib/ai/clientGenerate";
import { costNote, creditsSpent, wordsSoFar, type CostCheck } from "@/lib/dashboardV3/solWrite";

/**
 * SOL's own panel for "write this for me": a side drawer on desktop, a bottom sheet on phones.
 * A prompt box, the cost and balance, live progress while SOL writes, then Use / Regenerate / Ignore on
 * the result. Nothing touches the page until the person picks Use.
 */
export function SolWriteDrawer<T>({
  open,
  onClose,
  title,
  intro,
  placeholder,
  buildRequest,
  parseResult,
  renderResult,
  onUse,
  useLabel = "Use this",
  initialPrompt,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  intro: string;
  placeholder: string;
  buildRequest: (prompt: string) => AiRequestBody;
  parseResult: (raw: unknown) => T;
  renderResult: (result: T) => React.ReactNode;
  onUse: (result: T) => Promise<void>;
  useLabel?: string;
  /** Fills the box when the drawer opens (the owner can change it). */
  initialPrompt?: string;
}) {
  const { credits, refresh } = useCredits();
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<"ask" | "writing" | "result">("ask");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broke, setBroke] = useState(false);
  const [check, setCheck] = useState<CostCheck>(null);
  const [spent, setSpent] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const running = useRef(false);

  useEffect(() => {
    if (!open) return;
    setPhase("ask");
    setResult(null);
    setError(null);
    setBroke(false);
    setSpent(null);
    if (initialPrompt) setPrompt((p) => p || initialPrompt);
    void refresh();
  }, [open, refresh, initialPrompt]);

  async function run() {
    const text = prompt.trim();
    if (!text) return void setError("Tell SOL what to write about first.");
    if (running.current) return;
    running.current = true;
    setError(null);
    setBroke(false);
    setProgress(0);
    setPhase("writing");
    const body = buildRequest(text);
    const before = credits;
    try {
      const est = await checkAiCredits(body);
      setCheck(est);
      if (est && !est.enough) {
        setBroke(true);
        setPhase("ask");
        return;
      }
      const answer = await generateWithProgress(body, (p) => setProgress(p.characters));
      setResult(parseResult(answer.result));
      setPhase("result");
      const after = await refresh();
      setSpent(creditsSpent(before, after));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/out of (ai )?credits|not enough credits|top up/i.test(msg)) setBroke(true);
      else setError(msg || "SOL couldn't finish that. Please try again.");
      setPhase(result ? "result" : "ask");
    } finally {
      running.current = false;
    }
  }

  async function use() {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      await onUse(result);
      setPrompt("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't use that. Please try again.");
    } finally {
      setApplying(false);
    }
  }

  const footer =
    phase === "result" ? (
      <>
        <Button variant="ghost" leftIcon={<X size={17} aria-hidden />} onClick={() => { setResult(null); setPhase("ask"); }} disabled={applying}>Ignore</Button>
        <Button variant="secondary" leftIcon={<RefreshCw size={17} aria-hidden />} onClick={() => void run()} disabled={applying}>Regenerate</Button>
        <Button leftIcon={<Check size={17} aria-hidden />} onClick={() => void use()} loading={applying}>{useLabel}</Button>
      </>
    ) : (
      <Button leftIcon={<SolGlyph size={17} />} onClick={() => void run()} loading={phase === "writing"} loadingLabel="SOL is writing…" disabled={!prompt.trim() && phase === "ask"}>
        Write it
      </Button>
    );

  return (
    <Modal open={open} onClose={onClose} side="right" width={520} title={<span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><SolGlyph size={22} />{title}</span>} description={intro} footer={footer} initialFocusRef={input} closeOnBackdrop={phase !== "writing"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {phase !== "result" ? (
          <>
            <Textarea ref={input} label="What should it be about?" value={prompt} rows={4} placeholder={placeholder} disabled={phase === "writing"} onChange={(e) => setPrompt(e.target.value)} />
            <p className="plx-small" data-testid="sol-cost">{costNote(check, credits)}</p>
          </>
        ) : null}
        {phase === "writing" ? (
          <div className="plx-inlinemsg" role="status" aria-live="polite">SOL is writing… {wordsSoFar(progress)}.</div>
        ) : null}
        {phase === "result" && result !== null ? (
          <>
            {renderResult(result)}
            <p className="plx-small" data-testid="sol-cost">
              {spent !== null ? `That used ${spent.toLocaleString("en-US")} credits. ` : ""}
              {credits !== null ? `You have ${credits.toLocaleString("en-US")} left.` : ""}
            </p>
          </>
        ) : null}
        {broke ? (
          <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SolOutOfCredits onDismiss={() => setBroke(false)} onToppedUp={() => void run()} />
            <p className="plx-small">
              Prefer to use your own AI account instead? <Link href="/dashboard/settings/ai">Add your own key</Link> and writing won&apos;t use credits.
            </p>
          </div>
        ) : null}
        {error ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div> : null}
      </div>
    </Modal>
  );
}
