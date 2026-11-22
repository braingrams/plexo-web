"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readCurrentSiteCookie } from "@/lib/dashboardV3/siteCookie";
import { pausingCall } from "../../../sol/_components/pausingCall";
import { useSolStream } from "../../../sol/_components/useSolStream";
import { ASK_USER_QUESTION_TOOL_NAME, type AskUserAnswer, type SolMessage } from "../../../sol/_components/types";
import type { StudioEngine } from "./types";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/**
 * A real SOL conversation (the same one Ask SOL shows), started from a prompt right where the
 * owner is: it streams SOL's steps, stops to ask its questions, and can be continued with a
 * follow-up. The conversation is saved in Ask SOL's list like any other.
 */
export function useStudioChat({ prompt, siteId }: { prompt: string; siteId?: string | null }): StudioEngine {
  const stream = useSolStream();
  const [messages, setMessages] = useState<SolMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [creditDismissed, setCreditDismissed] = useState(false);
  const conversationRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const lastTextRef = useRef(prompt);

  const send = useCallback(
    async (text: string) => {
      lastTextRef.current = text;
      setStartError(null);
      setCreditDismissed(false);
      setStarting(true);
      try {
        if (!conversationRef.current) {
          const res = await fetch("/api/v1/sol/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelTier: "MEDIUM" }) });
          const data = (await res.json().catch(() => null)) as { conversation?: { id: string } } | null;
          if (!res.ok || !data?.conversation?.id) throw new Error("couldn't start");
          conversationRef.current = data.conversation.id;
          setConversationId(data.conversation.id);
        }
        const site = { ...(siteId ? { siteId, siteChosen: true } : {}), siteHintId: readCurrentSiteCookie() };
        setMessages((prev) => [...prev, { id: `local-user-${newId()}`, role: "user", content: [{ type: "text", text }], createdAt: new Date().toISOString() }]);
        void stream.sendMessage(conversationRef.current, text, [], "MEDIUM", site);
      } catch {
        setStartError("We couldn't reach SOL just now. Check your connection and try again.");
      } finally {
        setStarting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteId],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void send(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A finished turn joins the conversation; a paused one waits for the owner's answer.
  useEffect(() => {
    if (stream.outcome === "done") {
      if (stream.blocks.length > 0) {
        setMessages((prev) => [...prev, { id: stream.finalMessageId || `local-${newId()}`, role: "assistant", content: stream.blocks, usage: stream.usage, createdAt: new Date().toISOString() }]);
      }
      stream.reset();
      setPendingId(null);
    } else if (stream.outcome === "awaiting_confirmation") {
      setPendingId(stream.awaitingMessageId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.outcome]);

  const awaiting = stream.outcome === "awaiting_confirmation" && pendingId !== null;
  const paused = awaiting ? pausingCall(stream.blocks) : undefined;
  const question = paused && paused.name === ASK_USER_QUESTION_TOOL_NAME ? paused : null;
  const streaming = stream.outcome === "streaming";
  const credit = creditDismissed ? null : stream.creditInfo;
  const error = startError ?? (stream.outcome === "credit_exhausted" ? "SOL needs more AI credits to carry on. Add some and try again." : stream.outcome === "error" ? stream.errorMessage || "SOL hit a snag. Please try again." : null);
  const finished = stream.outcome === "idle" && !starting && messages.some((m) => m.role === "assistant");

  const resume = (body: { answers: AskUserAnswer[] } | { decision: "confirmed" | "declined" }) => {
    const id = conversationRef.current;
    if (!id || !pendingId) return;
    void ("answers" in body ? stream.submitAnswers(id, pendingId, body.answers) : stream.confirmToolCall(id, pendingId, body.decision));
    setPendingId(null);
  };

  return {
    state: error ? "error" : question ? "asking" : finished ? "done" : "working",
    messages,
    pendingBlocks: stream.outcome === "idle" ? null : stream.blocks,
    question,
    error,
    creditInfo: credit,
    dismissCredit: () => setCreditDismissed(true),
    answer: (answers) => resume({ answers }),
    confirm: (decision) => resume({ decision }),
    confirmBusy: streaming && pendingId === null && stream.blocks.some((b) => (b as { status?: string }).status === "awaiting_confirmation"),
    retry: () => {
      // SOL had done some work: keep it on screen and ask it to carry on. Nothing happened yet: send the same message again.
      const worked = stream.blocks.length > 0 || messages.some((m) => m.role === "assistant");
      if (stream.blocks.length > 0) {
        setMessages((prev) => [...prev, { id: `local-${newId()}`, role: "assistant", content: stream.blocks, createdAt: new Date().toISOString() }]);
      } else if (!worked) {
        setMessages((prev) => (prev.at(-1)?.role === "user" ? prev.slice(0, -1) : prev));
      }
      stream.reset();
      void send(worked ? "Carry on where you stopped." : lastTextRef.current);
    },
    stop: () => stream.stop(),
    conversationId,
    followUp: (text) => void send(text),
  };
}
