"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import type { SolMessage } from "../../sol/_components/types";
import { Button } from "../ui/Button";
import { alreadyPrompted, messageToRate, rememberPrompted } from "./ratingRules";

/** A small card above the chat box when SOL finishes a piece of work: how did it go? */
export function RatePrompt({ messages, conversationId, streaming, waiting }: { messages: SolMessage[]; conversationId: string; streaming: boolean; waiting: boolean }) {
  const [forced, setForced] = useState<string | null>(null);
  const found = messageToRate(messages, { streaming, waiting });
  // A thumbs-down typed as an emoji opens the "what did you expect?" box on that answer.
  const target = forced ? (messages.find((m) => m.id === forced) ?? null) : found;
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [step, setStep] = useState<"ask" | "expect" | "thanks">("ask");
  const [comment, setComment] = useState("");
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ messageId?: string }>).detail?.messageId;
      if (!id) return;
      setForced(id);
      setShownFor(id);
      setStep("expect");
      setComment("");
    };
    window.addEventListener("sol:expect", open);
    return () => window.removeEventListener("sol:expect", open);
  }, []);

  // Wait a moment after the answer lands so it doesn't jump in while they are still reading.
  useEffect(() => {
    if (!target || forced || alreadyPrompted(conversationId) || shownFor === target.id) return;
    const timer = setTimeout(() => {
      setShownFor(target.id);
      setStep("ask");
      setComment("");
      rememberPrompted(conversationId);
    }, 1200);
    return () => clearTimeout(timer);
  }, [target, conversationId, shownFor]);

  // Gone as soon as they send something else or the answer changes.
  const visible = Boolean(target && shownFor === target.id);
  useEffect(() => {
    if (step === "thanks" && visible) {
      const timer = setTimeout(() => closeIt(), 2500);
      return () => clearTimeout(timer);
    }
  }, [step, visible]);
  // Bring the card into view under the answer when it appears or changes step.
  useEffect(() => {
    if (visible) card.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [visible, step]);

  function closeIt() {
    setShownFor(null);
    setForced(null);
  }
  if (!target || !visible) return null;

  async function send(rating: "UP" | "DOWN", note?: string) {
    try {
      await fetch("/api/v1/sol/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: target!.id, threadId: conversationId, rating, comment: note || undefined }) });
    } catch {
      // Best effort: a failed rating never gets in the way of the chat.
    }
  }

  return (
    <div className="sol3-rate" ref={card} role="dialog" aria-label="Rate this conversation">
      <button type="button" className="sol3-rate__close plx-iconbtn" aria-label="Not now" onClick={() => closeIt()}>
        <X size={16} aria-hidden />
      </button>
      {step === "ask" ? (
        <>
          <p className="sol3-rate__title">How did that go?</p>
          <p className="plx-small sol3-rate__sub">Your rating helps SOL get better at this.</p>
          <div className="sol3-rate__row">
            <Button variant="secondary" size="sm" leftIcon={<ThumbsUp size={16} aria-hidden />} onClick={() => { void send("UP"); setStep("thanks"); }}>Good</Button>
            <Button variant="secondary" size="sm" leftIcon={<ThumbsDown size={16} aria-hidden />} onClick={() => { void send("DOWN"); setStep("expect"); }}>Not good</Button>
          </div>
        </>
      ) : step === "expect" ? (
        <>
          <p className="sol3-rate__title">What did you expect instead?</p>
          <textarea className="plx-input" rows={2} placeholder="A sentence is plenty (optional)" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 64, padding: 10, resize: "none" }} />
          <div className="sol3-rate__row">
            <Button variant="secondary" size="sm" onClick={() => closeIt()}>Skip</Button>
            <Button size="sm" onClick={() => { void send("DOWN", comment); setStep("thanks"); }}>Send</Button>
          </div>
        </>
      ) : (
        <p className="sol3-rate__title">Thank you. That helps.</p>
      )}
    </div>
  );
}
