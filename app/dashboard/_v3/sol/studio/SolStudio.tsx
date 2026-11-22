"use client";

import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { Button, ButtonLink } from "../../ui/Button";
import { AskCard } from "../AskCard";
import { CreditModal } from "../CreditModal";
import { SolMark } from "../Message";
import { Messages } from "../Messages";
import "../sol.css";
import "./studio.css";
import type { StudioEngine } from "./types";

const STATUS: Record<StudioEngine["state"], string> = {
  working: "Working on it…",
  asking: "Waiting for your answer",
  done: "All done",
  error: "Needs a quick look",
};

export type SolStudioProps = {
  engine: StudioEngine;
  /** What SOL is doing, in a few words ("Personalizing your design"). */
  title?: string;
  /** Shown when SOL has finished (e.g. a "See your design" button). */
  doneActions?: React.ReactNode;
  /** A button in the header to leave (while SOL works it stops SOL first). */
  onClose?: () => void;
  closeLabel?: string;
  /** Where the credit top-up returns to (default: this page). */
  returnTo?: string;
  /** Lets the owner ask for something else once SOL is done (real SOL conversations only). */
  allowFollowUp?: boolean;
};

/**
 * SOL Studio: SOL working right where you are, instead of sending you off to Ask SOL. Shows its
 * steps as they happen, stops to ask its questions (with the same tappable answers as Ask SOL),
 * and finishes with whatever the screen needs next. Give it an engine: useStudioChat for a real
 * SOL conversation from a prompt, or useStudioScript for real steps narrated one by one.
 */
export function SolStudio({ engine, title = "SOL", doneActions, onClose, closeLabel = "Close", returnTo, allowFollowUp }: SolStudioProps) {
  const [follow, setFollow] = useState("");
  const working = engine.state === "working";
  const sendFollowUp = () => {
    const text = follow.trim();
    if (!text || !engine.followUp) return;
    setFollow("");
    engine.followUp(text);
  };
  const showFollow = allowFollowUp && engine.state === "done" && !!engine.followUp;
  const footerEmpty = !(engine.state === "error" || engine.state === "done");

  return (
    <section className="sol3-studio" data-plexo-v3 aria-label="SOL Studio">
      <header className="sol3-studio__head">
        <div className="sol3-studio__who">
          <SolMark size={18} />
          <div>
            <h3 className="sol3-studio__title">{title}</h3>
            <p className="sol3-studio__status" role="status">
              <span className="sol3-studio__dot" data-state={engine.state} aria-hidden />
              {STATUS[engine.state]}
            </p>
          </div>
        </div>
        {onClose ? (
          <Button
            size="sm"
            variant="secondary"
            rightIcon={<X size={16} aria-hidden />}
            onClick={() => {
              if (working || engine.state === "asking") engine.stop();
              onClose();
            }}
          >
            {working || engine.state === "asking" ? "Stop" : closeLabel}
          </Button>
        ) : null}
      </header>

      <Messages
        messages={engine.messages}
        conversationId={engine.conversationId ?? "studio"}
        pendingBlocks={engine.pendingBlocks}
        streaming={working}
        onConfirmToolCall={engine.confirm}
        confirmBusy={engine.confirmBusy}
        below={engine.question ? <AskCard key={engine.question.id} block={engine.question} onSubmit={engine.answer} /> : null}
      />

      <div className="sol3-studio__foot" data-empty={footerEmpty}>
        {engine.state === "error" ? (
          <>
            <p className="sol3-studio__err" role="alert">{engine.error}</p>
            <div className="sol3-studio__row">
              <Button onClick={engine.retry}>Try again</Button>
            </div>
          </>
        ) : null}
        {engine.state === "done" ? (
          <>
            {showFollow ? (
              <form className="sol3-studio__follow" onSubmit={(e) => { e.preventDefault(); sendFollowUp(); }}>
                <input className="plx-input" aria-label="Ask SOL for something else" placeholder="Want something else changed? Tell SOL…" value={follow} maxLength={2000} onChange={(e) => setFollow(e.target.value)} />
                <Button type="submit" disabled={!follow.trim()}>Send</Button>
              </form>
            ) : null}
            <div className="sol3-studio__row">
              {doneActions}
              {engine.conversationId ? (
                <ButtonLink variant="secondary" href={`/dashboard/sol/${engine.conversationId}`} rightIcon={<ArrowRight size={16} aria-hidden />}>
                  Continue in Ask SOL
                </ButtonLink>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {engine.creditInfo ? <CreditModal creditInfo={engine.creditInfo} returnTo={returnTo ?? (typeof window !== "undefined" ? window.location.href : "/dashboard")} onClose={engine.dismissCredit} /> : null}
    </section>
  );
}
