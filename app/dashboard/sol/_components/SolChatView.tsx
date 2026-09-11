"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SolHeader } from "./SolHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { CreditExhaustedModal } from "./CreditExhaustedModal";
import { useSolStream } from "./useSolStream";
import { useSolSidebar } from "./SolSidebarContext";
import type { ChatAttachment, ConversationSummary, CreditInfo, MediaBlock, ModelTier, SolMessage } from "./types";

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function draftStorageKey(conversationId: string): string {
  return `sol:draft:${conversationId}`;
}

export function SolChatView({
  conversation: initialConversation,
  initialMessages,
}: {
  conversation: ConversationSummary | null;
  initialMessages: SolMessage[];
}) {
  const router = useRouter();
  const { bumpRefresh } = useSolSidebar();
  const [conversation, setConversation] = useState<ConversationSummary | null>(initialConversation);
  const [messages, setMessages] = useState<SolMessage[]>(initialMessages);
  const [modelTier, setModelTier] = useState<ModelTier>(initialConversation?.modelTier ?? "BASIC");
  const [pendingConfirmMessageId, setPendingConfirmMessageId] = useState<string | null>(null);
  const [resolvingConfirmation, setResolvingConfirmation] = useState(false);
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [composerRestoreText, setComposerRestoreText] = useState<string | undefined>(undefined);
  const [creditsRefreshKey, setCreditsRefreshKey] = useState(0);
  const [creatingConversation, setCreatingConversation] = useState(false);

  const stream = useSolStream();
  const optimisticUserMessageIdRef = useRef<string | null>(null);
  const lastSentTextRef = useRef<string>("");

  useEffect(() => {
    setConversation(initialConversation);
    setMessages(initialMessages);
    setModelTier(initialConversation?.modelTier ?? "BASIC");
    stream.reset();
    setPendingConfirmMessageId(null);
    setInlineError(null);

    // A credit top-up round-trip lands back on this exact conversation (see
    // CreditExhaustedModal's returnTo) via a full navigation through Stripe/the billing
    // page — this restores whatever draft text was in flight when the modal opened.
    if (initialConversation) {
      try {
        const saved = sessionStorage.getItem(draftStorageKey(initialConversation.id));
        if (saved) {
          sessionStorage.removeItem(draftStorageKey(initialConversation.id));
          setComposerRestoreText(saved);
        }
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversation?.id]);

  const commitAssistantMessage = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      {
        id: stream.finalMessageId || `local-${randomId()}`,
        role: "assistant",
        content: stream.blocks,
        usage: stream.usage,
        createdAt: new Date().toISOString(),
      },
    ]);
    stream.reset();
    setPendingConfirmMessageId(null);
    setCreditsRefreshKey((v) => v + 1);
    bumpRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.finalMessageId, stream.blocks, stream.usage]);

  const rollbackOptimisticUserMessage = useCallback(() => {
    const id = optimisticUserMessageIdRef.current;
    if (id) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      optimisticUserMessageIdRef.current = null;
    }
    setComposerRestoreText(lastSentTextRef.current);
  }, []);

  const resolvePendingConfirmation = useCallback(async () => {
    if (!conversation) return;
    setResolvingConfirmation(true);
    try {
      const res = await fetch(`/api/v1/sol/conversations/${conversation.id}/messages?order=desc&limit=1`);
      if (res.ok) {
        const data = (await res.json()) as { messages: SolMessage[] };
        const pending = data.messages.find((m) => m.confirmationState === "PENDING");
        if (pending) setPendingConfirmMessageId(pending.id);
      }
    } finally {
      setResolvingConfirmation(false);
    }
  }, [conversation]);

  useEffect(() => {
    if (stream.outcome === "done") {
      commitAssistantMessage();
    } else if (stream.outcome === "awaiting_confirmation") {
      void resolvePendingConfirmation();
    } else if (stream.outcome === "credit_exhausted") {
      rollbackOptimisticUserMessage();
      setCreditInfo(stream.creditInfo);
      // The top-up checkout's return_url always round-trips through the billing settings
      // page before forwarding back here (see CreditExhaustedModal's own comment) — a full
      // navigation away and back, which would otherwise lose the in-progress draft. Stashed
      // here and restored by the initialConversation effect above once we land back.
      if (conversation) {
        try {
          sessionStorage.setItem(draftStorageKey(conversation.id), lastSentTextRef.current);
        } catch {
          // ignore
        }
      }
    } else if (stream.outcome === "error") {
      rollbackOptimisticUserMessage();
      setInlineError(stream.errorMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.outcome]);

  async function ensureConversation(): Promise<ConversationSummary> {
    if (conversation) return conversation;
    setCreatingConversation(true);
    try {
      const res = await fetch("/api/v1/sol/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelTier }),
      });
      const data = (await res.json()) as { conversation: ConversationSummary };
      setConversation(data.conversation);
      router.replace(`/dashboard/sol/${data.conversation.id}`);
      bumpRefresh();
      return data.conversation;
    } finally {
      setCreatingConversation(false);
    }
  }

  async function handleSend(text: string, attachments: ChatAttachment[]) {
    setInlineError(null);
    setComposerRestoreText(undefined);
    const target = await ensureConversation();

    const mediaBlocks: MediaBlock[] = attachments.map((a) => ({ type: a.type === "pdf" ? "document" : a.type, url: a.url, filename: a.filename }));
    const optimisticId = `local-user-${randomId()}`;
    optimisticUserMessageIdRef.current = optimisticId;
    lastSentTextRef.current = text;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: "user", content: [{ type: "text", text }, ...mediaBlocks], createdAt: new Date().toISOString() },
    ]);

    void stream.sendMessage(target.id, text, attachments, modelTier);
  }

  function handleConfirmToolCall(decision: "confirmed" | "declined") {
    if (!conversation || !pendingConfirmMessageId) return;
    void stream.confirmToolCall(conversation.id, pendingConfirmMessageId, decision);
  }

  async function handleRename(title: string) {
    if (!conversation) return;
    setConversation((prev) => (prev ? { ...prev, title } : prev));
    const res = await fetch(`/api/v1/sol/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) bumpRefresh();
  }

  function handleModelTierChange(tier: ModelTier) {
    // The conversation row's own modelTier (set once at creation) is just its default —
    // there's no PATCH support for changing it after the fact (see
    // app/api/v1/sol/conversations/[id]/route.ts, title/status only). Each chat-turn POST
    // already carries its own `modelTier`, so switching tiers mid-conversation just
    // changes which tier the NEXT message uses, tracked here in local state only.
    setModelTier(tier);
    setConversation((prev) => (prev ? { ...prev, modelTier: tier } : prev));
  }

  function handleCloseCreditModal() {
    setCreditInfo(null);
  }

  function handleStop() {
    stream.stop();
  }

  const streaming = stream.outcome === "streaming";
  const disabled = streaming || creatingConversation || pendingConfirmMessageId !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <SolHeader conversation={conversation} onRename={handleRename} onModelTierChange={handleModelTierChange} creditsRefreshKey={creditsRefreshKey} />

      <MessageList
        messages={messages}
        conversationId={conversation?.id ?? "pending"}
        pendingBlocks={stream.outcome === "idle" ? null : stream.blocks}
        streaming={streaming}
        onConfirmToolCall={handleConfirmToolCall}
        confirmBusy={streaming && pendingConfirmMessageId !== null}
        resolvingConfirmation={resolvingConfirmation}
      />

      <div style={{ padding: "0 1.25rem 1.25rem" }}>
        {inlineError && (
          <div style={{ marginBottom: "0.6rem", padding: "0.55rem 0.85rem", borderRadius: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", fontSize: "0.78rem" }}>
            {inlineError}
          </div>
        )}
        <Composer
          streaming={streaming}
          disabled={disabled}
          modelTier={modelTier}
          onModelTierChange={handleModelTierChange}
          onSend={(text, attachments) => void handleSend(text, attachments)}
          onStop={handleStop}
          initialText={composerRestoreText}
        />
      </div>

      {creditInfo && (
        <CreditExhaustedModal
          creditInfo={creditInfo}
          returnTo={conversation ? `/dashboard/sol/${conversation.id}` : "/dashboard/sol"}
          onClose={handleCloseCreditModal}
        />
      )}
    </div>
  );
}
