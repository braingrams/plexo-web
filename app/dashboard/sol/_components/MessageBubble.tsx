"use client";

import { useState } from "react";
import { Check, Copy, Sparkles, User as UserIcon } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ToolCallCard } from "./ToolCallCard";
import { FileReadCard } from "./FileReadCard";
import { FeedbackControls } from "./FeedbackControls";
import { ExportMenu } from "./ExportMenu";
import type { ContentBlock, SolMessage, ToolUseBlock } from "./types";

function isText(block: ContentBlock): block is { type: "text"; text: string } {
  return (block as { type?: string }).type === "text" && typeof (block as { text?: unknown }).text === "string";
}
function isToolUse(block: ContentBlock): block is ToolUseBlock {
  return (block as { type?: string }).type === "tool_use";
}
function isMedia(block: ContentBlock): block is { type: "image" | "document"; source?: { url?: string }; url?: string; filename?: string } {
  const t = (block as { type?: string }).type;
  return t === "image" || t === "document";
}

function extractPlainText(content: ContentBlock[]): string {
  return content
    .filter(isText)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy response"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      style={{ background: "none", border: "none", color: copied ? "#34d399" : "rgba(240,242,255,0.45)", cursor: "pointer", padding: "0.3rem", borderRadius: 7, display: "inline-flex" }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export function MessageBubble({
  message,
  conversationId,
  onConfirmToolCall,
  confirmBusy,
  resolvingConfirmation,
}: {
  message: SolMessage;
  conversationId: string;
  onConfirmToolCall?: (decision: "confirmed" | "declined") => void;
  confirmBusy?: boolean;
  resolvingConfirmation?: boolean;
}) {
  const isUser = message.role === "user";
  const plainText = extractPlainText(message.content);

  return (
    <div style={{ display: "flex", gap: "0.75rem", flexDirection: isUser ? "row-reverse" : "row", alignItems: "flex-start" }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          background: isUser ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg,#a855f7,#6d28d9)",
          boxShadow: isUser ? "none" : "0 0 16px rgba(168,85,247,0.35)",
        }}
      >
        {isUser ? <UserIcon size={14} color="rgba(240,242,255,0.6)" /> : <Sparkles size={14} color="#fff" />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "min(720px, 78%)", alignItems: isUser ? "flex-end" : "flex-start" }}>
        {message.content.map((block, i) => {
          if (isText(block)) {
            if (!block.text) return null;
            return isUser ? (
              <div
                key={i}
                style={{
                  background: "linear-gradient(135deg, rgba(139,92,246,0.18), rgba(109,40,217,0.14))",
                  border: "1px solid rgba(168,85,247,0.25)",
                  borderRadius: "16px 16px 4px 16px",
                  padding: "0.65rem 0.95rem",
                  color: "#f0f2ff",
                  fontSize: "0.9rem",
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {block.text}
              </div>
            ) : (
              <div
                key={i}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "4px 16px 16px 16px",
                  padding: "0.75rem 1rem",
                  width: "100%",
                }}
              >
                <MarkdownRenderer text={block.text} />
              </div>
            );
          }
          if (isToolUse(block)) {
            const isLastAwaiting = block.status === "awaiting_confirmation";
            return (
              <ToolCallCard
                key={block.id || i}
                block={block}
                onConfirm={isLastAwaiting ? onConfirmToolCall : undefined}
                confirmBusy={confirmBusy}
                resolvingConfirmation={resolvingConfirmation}
              />
            );
          }
          if (isMedia(block)) {
            const url = block.source?.url ?? block.url;
            return <FileReadCard key={i} kind={block.type} url={url} filename={block.filename} />;
          }
          return null;
        })}

        {!isUser && !message.pending && plainText && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", paddingLeft: "0.1rem" }}>
            <CopyButton text={plainText} />
            <FeedbackControls messageId={message.id} conversationId={conversationId} initialFeedback={message.feedback} />
            <ExportMenu conversationId={conversationId} messageId={message.id} label="Export this message" align="left" />
          </div>
        )}
      </div>
    </div>
  );
}
