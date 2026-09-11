"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatAttachment, ContentBlock, CreditInfo, ModelTier, ToolUseBlock } from "./types";

// The exact newline-delimited frame vocabulary lambda/sol-chat/index.ts's StreamFrame
// union streams — field names/casing copied verbatim from that file, not re-derived.
type StreamFrame =
  | { type: "tool_call_start"; id: string; name: string; label: string; args: unknown }
  | { type: "tool_call_awaiting_confirmation"; id: string; name: string; args: unknown }
  | { type: "tool_call_result"; id: string; name: string; status: "success" | "error" | "cancelled"; result?: unknown }
  | { type: "token"; text: string }
  | { type: "message_done"; messageId: string | null; usage: { inputTokens: number; outputTokens: number } }
  | { type: "credit_exhausted"; requiredCredits: number; availableCredits: number }
  | { type: "error"; message: string };

export type StreamOutcome = "idle" | "streaming" | "done" | "awaiting_confirmation" | "error" | "credit_exhausted";

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return (block as { type?: string }).type === "tool_use";
}

/**
 * Wraps the two SOL chat-turn endpoints (fresh message + confirm/decline resume) — both
 * stream the identical StreamFrame vocabulary as application/x-ndjson, one JSON object per
 * line. Exposes the live-building content-block array for the assistant bubble currently
 * streaming in, plus a terminal `outcome` the caller uses to decide what happens next
 * (commit the message, show the credit-exhausted modal, show an inline error, or wait for
 * the user to confirm/decline a pending tool call).
 */
export function useSolStream() {
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [outcome, setOutcome] = useState<StreamOutcome>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const [finalMessageId, setFinalMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const outcomeRef = useRef<StreamOutcome>("idle");

  const setOutcomeBoth = useCallback((next: StreamOutcome) => {
    outcomeRef.current = next;
    setOutcome(next);
  }, []);

  const reset = useCallback(() => {
    setBlocks([]);
    setOutcomeBoth("idle");
    setErrorMessage(null);
    setCreditInfo(null);
    setUsage(null);
    setFinalMessageId(null);
  }, [setOutcomeBoth]);

  const handleFrame = useCallback(
    (frame: StreamFrame) => {
      switch (frame.type) {
        case "tool_call_start": {
          setBlocks((prev) => [
            ...prev,
            { type: "tool_use", id: frame.id, name: frame.name, label: frame.label, input: frame.args, status: "running" } as ToolUseBlock,
          ]);
          break;
        }
        case "tool_call_awaiting_confirmation": {
          setBlocks((prev) => {
            const exists = prev.some((b) => isToolUseBlock(b) && b.id === frame.id);
            if (!exists) {
              return [...prev, { type: "tool_use", id: frame.id, name: frame.name, input: frame.args, status: "awaiting_confirmation" } as ToolUseBlock];
            }
            return prev.map((b) => (isToolUseBlock(b) && b.id === frame.id ? { ...b, status: "awaiting_confirmation" } : b));
          });
          break;
        }
        case "tool_call_result": {
          setBlocks((prev) =>
            prev.map((b) => (isToolUseBlock(b) && b.id === frame.id ? { ...b, status: frame.status, result: frame.result } : b)),
          );
          break;
        }
        case "token": {
          setBlocks((prev) => {
            const last = prev[prev.length - 1];
            if (last && (last as { type?: string }).type === "text") {
              const updated = { ...(last as { type: "text"; text: string }), text: (last as { text: string }).text + frame.text };
              return [...prev.slice(0, -1), updated];
            }
            return [...prev, { type: "text", text: frame.text }];
          });
          break;
        }
        case "message_done": {
          setUsage(frame.usage);
          setFinalMessageId(frame.messageId);
          setOutcomeBoth("done");
          break;
        }
        case "credit_exhausted": {
          setCreditInfo({ requiredCredits: frame.requiredCredits, availableCredits: frame.availableCredits });
          setOutcomeBoth("credit_exhausted");
          break;
        }
        case "error": {
          setErrorMessage(frame.message);
          setOutcomeBoth("error");
          break;
        }
      }
    },
    [setOutcomeBoth],
  );

  const runStream = useCallback(
    async (url: string, body: unknown) => {
      setOutcomeBoth("streaming");
      setErrorMessage(null);
      setCreditInfo(null);
      const controller = new AbortController();
      abortRef.current = controller;

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          setOutcomeBoth("done");
          return;
        }
        setErrorMessage("Couldn't reach SOL — check your connection and try again.");
        setOutcomeBoth("error");
        return;
      }

      if (res.status === 402) {
        const data = (await res.json().catch(() => ({}))) as Partial<CreditInfo>;
        setCreditInfo({ requiredCredits: data.requiredCredits ?? 0, availableCredits: data.availableCredits ?? 0 });
        setOutcomeBoth("credit_exhausted");
        return;
      }

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(data.error ?? `SOL couldn't process that (status ${res.status}).`);
        setOutcomeBoth("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastFrameType: string | null = null;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const frame = JSON.parse(trimmed) as StreamFrame;
              lastFrameType = frame.type;
              handleFrame(frame);
            } catch {
              // A malformed line shouldn't kill an otherwise-good stream.
            }
          }
        }
        const trailing = buffer.trim();
        if (trailing) {
          try {
            const frame = JSON.parse(trailing) as StreamFrame;
            lastFrameType = frame.type;
            handleFrame(frame);
          } catch {
            // ignore
          }
        }
      } catch {
        if (controller.signal.aborted) {
          setOutcomeBoth("done");
        } else {
          setErrorMessage("Connection lost while SOL was responding.");
          setOutcomeBoth("error");
        }
        return;
      }

      // The stream closed with no terminal frame of its own — only expected case is a
      // paused confirmation (settleTurn's pendingConfirmation branch just ends the stream,
      // it never sends a dedicated "frame" for the pause itself beyond the
      // tool_call_awaiting_confirmation frame already handled above).
      if (outcomeRef.current === "streaming") {
        setOutcomeBoth(lastFrameType === "tool_call_awaiting_confirmation" ? "awaiting_confirmation" : "done");
      }
    },
    [handleFrame, setOutcomeBoth],
  );

  const sendMessage = useCallback(
    (conversationId: string, text: string, attachments: ChatAttachment[], modelTier: ModelTier) => {
      reset();
      return runStream(`/api/v1/sol/chat/conversations/${conversationId}/messages`, { text, attachments, modelTier });
    },
    [reset, runStream],
  );

  const confirmToolCall = useCallback(
    (conversationId: string, messageId: string, decision: "confirmed" | "declined") => {
      // Deliberately does NOT reset() — this continues the same in-flight bubble (the
      // tool call block already rendered gets its status updated by the frames that
      // follow), it doesn't start a fresh one.
      return runStream(`/api/v1/sol/chat/conversations/${conversationId}/messages/${messageId}/confirm`, { decision });
    },
    [runStream],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { blocks, outcome, errorMessage, creditInfo, usage, finalMessageId, sendMessage, confirmToolCall, stop, reset };
}
