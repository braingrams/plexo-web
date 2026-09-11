"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import type { ContentBlock, SolMessage, ToolUseBlock } from "./types";

function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return (block as { type?: string }).type === "tool_use";
}
function isToolResult(block: ContentBlock): block is { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean } {
  return (block as { type?: string }).type === "tool_result";
}

/**
 * SolMessage rows persist role:"tool" messages carrying tool_result blocks separately from
 * the role:"assistant" message that made the matching tool_use call (mirrors the
 * Anthropic Messages API's own turn shape). For a single readable card per tool call —
 * the same one the live stream already renders (tool_call_start + tool_call_result merged
 * onto one block, see useSolStream) — this folds every tool-role message's results back
 * onto the tool_use block they answer, then drops the now-empty tool-role rows from the
 * render list so history reads identically to a freshly-streamed turn.
 */
function mergeToolResults(messages: SolMessage[]): SolMessage[] {
  const resultsByToolUseId = new Map<string, { content: unknown; isError?: boolean }>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const block of message.content) {
      if (isToolResult(block)) {
        resultsByToolUseId.set(block.tool_use_id, { content: block.content, isError: (block as { is_error?: boolean }).is_error });
      }
    }
  }

  return messages
    .filter((m) => m.role !== "tool")
    .map((message) => {
      if (message.role !== "assistant") return message;
      let changed = false;
      const content = message.content.map((block) => {
        if (!isToolUse(block)) return block;
        const result = resultsByToolUseId.get(block.id);
        if (!result) return block.status ? block : { ...block, status: "success" as const };
        changed = true;
        return { ...block, status: (result.isError ? "error" : "success") as ToolUseBlock["status"], result: result.content };
      });
      return changed ? { ...message, content } : message;
    });
}

export function MessageList({
  messages,
  conversationId,
  pendingBlocks,
  streaming,
  onConfirmToolCall,
  confirmBusy,
  resolvingConfirmation,
}: {
  messages: SolMessage[];
  conversationId: string;
  pendingBlocks: ContentBlock[] | null;
  streaming: boolean;
  onConfirmToolCall?: (decision: "confirmed" | "declined") => void;
  confirmBusy?: boolean;
  resolvingConfirmation?: boolean;
}) {
  const merged = mergeToolResults(messages);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const lastCountRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onScroll() {
      const node = containerRef.current;
      if (!node) return;
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      const nearBottom = distanceFromBottom < 120;
      setUserScrolledUp(!nearBottom);
      if (nearBottom) setHasNewBelow(false);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const totalBlocks = merged.length + (pendingBlocks?.length ?? 0);
    if (userScrolledUp) {
      if (totalBlocks !== lastCountRef.current) setHasNewBelow(true);
      lastCountRef.current = totalBlocks;
      return;
    }
    lastCountRef.current = totalBlocks;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged.length, pendingBlocks, userScrolledUp]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setHasNewBelow(false);
  }

  const pendingMessage: SolMessage | null = pendingBlocks
    ? { id: "__pending__", role: "assistant", content: pendingBlocks, createdAt: new Date().toISOString(), pending: true }
    : null;

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", padding: "1.5rem 1.5rem 0.5rem", display: "flex", flexDirection: "column", gap: "1.35rem" }}>
        {merged.length === 0 && !pendingMessage && (
          <div style={{ margin: "auto", textAlign: "center", color: "rgba(240,242,255,0.35)", fontSize: "0.85rem" }}>
            Say hello to start the conversation.
          </div>
        )}
        {merged.map((message) => (
          <MessageBubble key={message.id} message={message} conversationId={conversationId} />
        ))}
        {pendingMessage && (
          <MessageBubble
            message={pendingMessage}
            conversationId={conversationId}
            onConfirmToolCall={onConfirmToolCall}
            confirmBusy={confirmBusy}
            resolvingConfirmation={resolvingConfirmation}
          />
        )}
        {streaming && !pendingBlocks?.length && (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", paddingLeft: "2.6rem" }}>
            <span className="sol-typing-dot" style={{ animationDelay: "0ms" }} />
            <span className="sol-typing-dot" style={{ animationDelay: "150ms" }} />
            <span className="sol-typing-dot" style={{ animationDelay: "300ms" }} />
            <style>{`
              .sol-typing-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(196,181,253,0.7); display: inline-block; animation: sol-typing-bounce 1.1s infinite ease-in-out; }
              @keyframes sol-typing-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.5; } 40% { transform: translateY(-4px); opacity: 1; } }
            `}</style>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {hasNewBelow && (
        <button
          type="button"
          onClick={scrollToBottom}
          style={{
            position: "absolute",
            bottom: "0.85rem",
            left: "50%",
            transform: "translateX(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            padding: "0.4rem 0.85rem",
            borderRadius: 999,
            background: "rgba(20,10,32,0.92)",
            border: "1px solid rgba(168,85,247,0.35)",
            color: "#e9d5ff",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 10px 30px -6px rgba(0,0,0,0.5)",
            fontFamily: "inherit",
          }}
        >
          <ArrowDown size={13} />
          New message
        </button>
      )}
    </div>
  );
}
