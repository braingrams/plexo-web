"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { activityMark, lastBlockShowsActivity, mergeToolResults } from "../../sol/_components/MessageList";
import type { ContentBlock, SolMessage } from "../../sol/_components/types";
import { Button } from "../ui/Button";
import { Message } from "./Message";

/** After a long quiet spell, say so: dots alone for minutes look frozen. */
function QuietNote({ activity }: { activity: string }) {
  const [quietFor, setQuietFor] = useState(0);
  useEffect(() => {
    setQuietFor(0);
    const started = Date.now();
    const timer = setInterval(() => setQuietFor(Date.now() - started), 5_000);
    return () => clearInterval(timer);
  }, [activity]);
  if (quietFor < 45_000) return null;
  return (
    <span role="status" className="sol3-quiet">
      {quietFor < 120_000 ? "Still working. This step is taking longer than usual." : "Still working. The AI service is slow right now. Nothing is lost and SOL will carry on."}
    </span>
  );
}

export function Messages({
  messages,
  conversationId,
  pendingBlocks,
  streaming,
  onConfirmToolCall,
  confirmBusy,
  below,
}: {
  messages: SolMessage[];
  conversationId: string;
  pendingBlocks: ContentBlock[] | null;
  streaming: boolean;
  onConfirmToolCall?: (decision: "confirmed" | "declined") => void;
  confirmBusy?: boolean;
  /** Rendered at the bottom of the conversation (the question from SOL, notices). */
  below?: React.ReactNode;
}) {
  const merged = mergeToolResults(messages);
  const scroller = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const lastCount = useRef(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      setScrolledUp(!near);
      if (near) setNewBelow(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const total = merged.length + (pendingBlocks?.length ?? 0);
    if (scrolledUp) {
      if (total !== lastCount.current) setNewBelow(true);
      lastCount.current = total;
      return;
    }
    lastCount.current = total;
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged.length, pendingBlocks, scrolledUp, below]);

  const pending: SolMessage | null = pendingBlocks ? { id: "__pending__", role: "assistant", content: pendingBlocks, createdAt: new Date().toISOString(), pending: true } : null;

  return (
    <>
      <div className="sol3-scroll" ref={scroller}>
        <div className="sol3-col">
          {merged.map((m) => (
            <Message key={m.id} message={m} conversationId={conversationId} onConfirmToolCall={onConfirmToolCall} confirmBusy={confirmBusy} />
          ))}
          {pending ? <Message message={pending} conversationId={conversationId} onConfirmToolCall={onConfirmToolCall} confirmBusy={confirmBusy} /> : null}
          {streaming && !lastBlockShowsActivity(pendingBlocks) ? (
            <div className="sol3-typing" aria-live="polite">
              <i /><i /><i />
              <span className="plx-sr-only">SOL is thinking</span>
              <QuietNote activity={activityMark(pendingBlocks)} />
            </div>
          ) : null}
          {below}
          <div ref={bottom} />
        </div>
      </div>
      {newBelow ? (
        <div className="sol3-newbelow">
          <Button size="sm" variant="strong" leftIcon={<ArrowDown size={16} aria-hidden />} onClick={() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); setNewBelow(false); }}>
            New message
          </Button>
        </div>
      ) : null}
    </>
  );
}
