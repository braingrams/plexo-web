"use client";

import { FileText } from "lucide-react";
import { ASK_USER_QUESTION_TOOL_NAME, type ContentBlock, type SolMessage, type ToolUseBlock } from "../../sol/_components/types";
import { Markdown } from "./Markdown";
import { SolGlyph } from "./SolGlyph";
import { MessageTools } from "./MessageTools";
import { AnswerRecap, Step, StepList } from "./Steps";

const isText = (b: ContentBlock): b is { type: "text"; text: string } => (b as { type?: string }).type === "text" && typeof (b as { text?: unknown }).text === "string";
const isTool = (b: ContentBlock): b is ToolUseBlock => (b as { type?: string }).type === "tool_use";
const isMedia = (b: ContentBlock): b is { type: "image" | "document"; source?: { url?: string }; url?: string; filename?: string; description?: string } => ["image", "document"].includes((b as { type?: string }).type ?? "");

/** SOL's mark: the sun glyph in a lime square. */
function SolMark({ size }: { size?: number }) {
  return (
    <span className="sol3-mark" aria-hidden>
      <SolGlyph size={size ?? 18} />
    </span>
  );
}
export { SolMark };

function Attachment({ kind, url: stored, filename, description }: { kind: "image" | "document"; url?: string; filename?: string; description?: string }) {
  const name = filename || (stored ? stored.split("/").pop() : undefined) || (kind === "image" ? "Picture" : "Document");
  // Uploads are private: viewed through the owner-checked signed redirect.
  const url = stored ? `/api/v1/sol/attachments/view?url=${encodeURIComponent(stored)}` : undefined;
  const body = (
    <>
      {kind === "image" && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={description ?? name} />
      ) : (
        <span className="sol3-file__ico"><FileText size={22} aria-hidden /></span>
      )}
      <span className="sol3-file__t">
        <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{description ?? name}</span>
        <small>{description ? name : kind === "image" ? "Picture" : "Document"}</small>
      </span>
    </>
  );
  return url ? (
    <a className="sol3-file" href={url} target="_blank" rel="noreferrer" title={name}>{body}</a>
  ) : (
    <div className="sol3-file">{body}</div>
  );
}

/** One turn: your message as a soft bubble, SOL's as clean text with its mark, steps shown quietly between. */
export function Message({ message, conversationId, onConfirmToolCall, confirmBusy, resolvingConfirmation }: { message: SolMessage; conversationId: string; onConfirmToolCall?: (d: "confirmed" | "declined") => void; confirmBusy?: boolean; resolvingConfirmation?: boolean }) {
  const isUser = message.role === "user";
  const plain = message.content.filter(isText).map((b) => b.text).join("\n").trim();

  // Consecutive steps sit together as one quiet list.
  const rows: React.ReactNode[] = [];
  let run: ToolUseBlock[] = [];
  const flush = () => {
    if (run.length) rows.push(<StepList key={`steps-${rows.length}`} blocks={run} />);
    run = [];
  };
  message.content.forEach((block, i) => {
    if (isText(block)) {
      if (!block.text) return;
      flush();
      rows.push(isUser ? <div className="sol3-bubble" key={i}>{block.text}</div> : <Markdown key={i} text={block.text} />);
    } else if (isTool(block)) {
      const awaiting = block.status === "awaiting_confirmation";
      if (block.name === ASK_USER_QUESTION_TOOL_NAME) {
        // While it waits, the question lives above the chat box (AskCard) — never a dead copy here.
        if (awaiting) return;
        flush();
        rows.push(<AnswerRecap key={block.id || i} block={block} />);
        return;
      }
      if (awaiting) {
        flush();
        rows.push(<Step key={block.id || i} block={block} onConfirm={onConfirmToolCall} confirmBusy={confirmBusy} resolvingConfirmation={resolvingConfirmation} />);
      } else run.push(block);
    } else if (isMedia(block)) {
      flush();
      rows.push(<Attachment key={i} kind={block.type} url={block.source?.url ?? block.url} filename={block.filename} description={block.description} />);
    }
  });
  flush();

  if (isUser) {
    return (
      <div className="sol3-msg sol3-msg--user">
        <div className="sol3-msg__body">{rows}</div>
      </div>
    );
  }
  return (
    <div className="sol3-msg">
      <SolMark />
      <div className="sol3-msg__body">
        {rows}
        {!message.pending && plain ? <MessageTools key={`${message.id}-${message.feedback ?? ""}`} text={plain} messageId={message.id} conversationId={conversationId} initialFeedback={message.feedback} /> : null}
      </div>
    </div>
  );
}
