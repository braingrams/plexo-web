"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SolHeader } from "./SolHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { Greeting } from "./Greeting";
import { CreditExhaustedModal } from "./CreditExhaustedModal";
import { AskUserQuestionOverlay } from "./AskUserQuestionCard";
import { ArtifactCanvas, type ActiveArtifact } from "./ArtifactCanvas";
import { useSolStream } from "./useSolStream";
import { useSolSidebar } from "./SolSidebarContext";
import { registerSolReadinessTask, resolveSolReadinessTask } from "./solReadinessGate";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  SOL_LAST_CONVERSATION_COOKIE,
  type AskUserAnswer,
  type ChatAttachment,
  type ContentBlock,
  type ConversationSummary,
  type CreditInfo,
  type MediaBlock,
  type ModelTier,
  type SolMessage,
  type ToolUseBlock,
} from "./types";

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return (block as { type?: string }).type === "tool_use";
}

// Tool calls whose successful result is "a page now exists" — SOL's canvas auto-opens to
// show what was just built, the same moment the tool call itself finishes. The result
// shape these all share ({templateId, name, publishedUrl?}) is traced from
// lib/mcp/dispatchMcpTool.ts's own return values for each of these cases.
const CANVAS_TOOL_NAMES = new Set([
  "create_landing_page",
  "publish_landing_page",
  "create_raw_landing_page",
  "publish_raw_landing_page",
  "update_template",
  "update_raw_landing_page",
]);

function artifactFromResult(name: string, result: { templateId?: string; name?: string; publishedUrl?: string | null } | undefined): ActiveArtifact | null {
  if (!CANVAS_TOOL_NAMES.has(name) || !result?.templateId) return null;
  return { templateId: result.templateId, name: result.name ?? "Untitled page", publishedUrl: result.publishedUrl ?? null };
}

/** Live path: a completed `ToolUseBlock` in useSolStream's in-flight `blocks` array already
 * carries `status`/`result` (merged in client-side as the tool_call_result frame arrives —
 * see useSolStream.ts), so a canvas-worthy result can be read directly off the block. */
function extractArtifact(block: ToolUseBlock): ActiveArtifact | null {
  if (block.status !== "success") return null;
  return artifactFromResult(block.name, block.result as { templateId?: string; name?: string; publishedUrl?: string | null } | undefined);
}

/** History path: a PERSISTED `tool_use` block never carries `status`/`result` (those are a
 * client-only streaming concept) — the real result lives in the very next message's
 * `tool_result` block, matched by `tool_use_id` (see solAgent.ts's continueLoop: one
 * assistant message with tool_use blocks is always immediately followed by one "tool" role
 * message with all of their results). Scans oldest-to-newest messages so the LAST
 * successful page-building call wins, restoring the canvas when a conversation with an
 * earlier page-building turn is reopened, not just when one is built live. */
function findLatestArtifactInMessages(messages: SolMessage[]): ActiveArtifact | null {
  let latest: ActiveArtifact | null = null;
  for (let i = 0; i < messages.length - 1; i++) {
    const blocks = messages[i].content;
    const nextBlocks = messages[i + 1].content;
    if (!Array.isArray(blocks) || !Array.isArray(nextBlocks)) continue;
    for (const block of blocks) {
      if (!isToolUseBlock(block) || !CANVAS_TOOL_NAMES.has(block.name)) continue;
      const resultBlock = nextBlocks.find(
        (b): b is { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean } =>
          (b as { type?: string })?.type === "tool_result" && (b as { tool_use_id?: string }).tool_use_id === block.id,
      );
      if (!resultBlock || resultBlock.is_error) continue;
      try {
        const parsed = typeof resultBlock.content === "string" ? JSON.parse(resultBlock.content) : resultBlock.content;
        const artifact = artifactFromResult(block.name, parsed as { templateId?: string; name?: string; publishedUrl?: string | null });
        if (artifact) latest = artifact;
      } catch {
        // Not JSON (or malformed) — not a canvas-worthy result, skip.
      }
    }
  }
  return latest;
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function draftStorageKey(conversationId: string): string {
  return `sol:draft:${conversationId}`;
}

export function SolChatView({
  conversation: initialConversation,
  initialMessages,
  userName,
}: {
  conversation: ConversationSummary | null;
  initialMessages: SolMessage[];
  userName: string | null;
}) {
  const { bumpRefresh, setActiveConversationIdOverride } = useSolSidebar();
  const [conversation, setConversation] = useState<ConversationSummary | null>(initialConversation);
  const [messages, setMessages] = useState<SolMessage[]>(initialMessages);
  const [modelTier, setModelTier] = useState<ModelTier>(initialConversation?.modelTier ?? "BASIC");
  const [pendingConfirmMessageId, setPendingConfirmMessageId] = useState<string | null>(null);
  const [creditInfo, setCreditInfo] = useState<CreditInfo | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [composerRestoreText, setComposerRestoreText] = useState<string | undefined>(undefined);
  const [creditsRefreshKey, setCreditsRefreshKey] = useState(0);
  const [creatingConversation, setCreatingConversation] = useState(false);
  // True for exactly the one render where a title just arrived live from the stream (see
  // the effect below) — SolHeader uses this to play a one-shot typing reveal instead of
  // just silently swapping the text, since this is the one case where the user is
  // actually looking at the header when the title changes (every other path — a manual
  // rename, a reload — either was the user's own action or happens before they're looking
  // at this specific text at all).
  const [titleJustGenerated, setTitleJustGenerated] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ActiveArtifact | null>(() => findLatestArtifactInMessages(initialMessages));

  const stream = useSolStream();
  const optimisticUserMessageIdRef = useRef<string | null>(null);
  const lastSentTextRef = useRef<string>("");
  // Tracks the conversation id whose CLIENT state (messages/stream) is already the more
  // current source of truth. ensureConversation sets this the instant it creates a
  // conversation, before it does anything else — belt-and-suspenders alongside that
  // function no longer triggering a real Next.js navigation at all (see its own comment):
  // if this component's props ever DO get re-applied with the same id (e.g. some future
  // caller re-introduces a router.replace, or Next revalidates this segment in the
  // background), the reset effect below can tell "our own conversation's props catching
  // up" apart from "a genuinely different conversation was opened" and skip the reset for
  // the former, instead of wiping the live messages/stream out from under an in-flight
  // send.
  //
  // Seeded with a sentinel that can never equal a real conversation id — NOT with
  // `initialConversation?.id` itself. Seeding it from the same prop it gets compared
  // against made the guard's condition trivially true on every ordinary first mount with
  // a real id already present (a normal navigation to an existing thread, or a plain page
  // reload) — not just the one case it was meant for — which silently skipped the WHOLE
  // reset effect below on that first render, including the history scan that detects an
  // already-pending confirmation/question. That's a real regression this was caught
  // causing: a reload landing on a conversation with a genuinely unresolved
  // ask_user_question pause showed no overlay and left the composer enabled, letting
  // another message get sent and produce the exact "tool_use without a tool_result"
  // history corruption the pending-detection code exists to prevent.
  const knownConversationIdRef = useRef<string | null>("__sol_uninitialized__");

  useEffect(() => {
    // Remembers "the last SOL conversation THIS BROWSER SESSION actually visited" — a
    // session cookie (no Max-Age, cleared when the browser closes) rather than a durable
    // one, since /dashboard/sol's own resume logic is explicitly session-scoped: come back
    // within the same session and it picks up where you left off, come back in a genuinely
    // new session and it starts fresh instead of always resurfacing however-old a
    // conversation (see app/dashboard/sol/page.tsx's own comment). Written here (not
    // server-side) because a Server Component page render can't set cookies itself.
    if (!conversation?.id) return;
    try {
      document.cookie = `${SOL_LAST_CONVERSATION_COOKIE}=${conversation.id}; path=/; SameSite=Lax`;
    } catch {
      // Best-effort — worst case this session just doesn't resume next time it opens SOL.
    }
  }, [conversation?.id]);

  useEffect(() => {
    // Marks "the actual SOL page has mounted" for the entrance overlay's readiness gate
    // (see solReadinessGate.ts) — resolved immediately, since mounting at all is the
    // signal here, not a fetch. Needed because ThreadSidebar's own "sidebar" task lives in
    // the SOL *layout*, which can mount (and its fetch resolve) before this *page*
    // component has mounted at all — without this, the gate could declare readiness while
    // the page itself was still just the loading boundary.
    registerSolReadinessTask("content");
    resolveSolReadinessTask("content");
  }, []);

  useEffect(() => {
    const incomingId = initialConversation?.id ?? null;
    if (incomingId !== null && incomingId === knownConversationIdRef.current) {
      // This is our OWN conversation's server props catching up after ensureConversation
      // created it (see the ref's own comment) — the live client state (the optimistic
      // message, the in-flight stream) is already more current than what just arrived, so
      // applying these props would only regress it. Nothing to do.
      return;
    }
    knownConversationIdRef.current = incomingId;

    setConversation(initialConversation);
    setMessages(initialMessages);
    setModelTier(initialConversation?.modelTier ?? "BASIC");
    setTitleJustGenerated(false);
    setActiveArtifact(findLatestArtifactInMessages(initialMessages));
    stream.reset();
    // A conversation can arrive here with an already-unresolved pause baked into its
    // history — the user left mid-confirmation/mid-question and came back (reload, a
    // different tab, clicking back into this thread from Recents). The live-pause path
    // (stream.outcome turning "awaiting_confirmation" and resolvePendingConfirmation
    // firing off the back of it) only ever covers a pause that's happening THIS session —
    // it never runs here, since `stream` was just reset to "idle" above. Scanning
    // initialMessages directly is what makes a genuinely still-pending message
    // interactive again after a reload, instead of just inert (or, before MessageList's
    // own mergeToolResults fix, actively mis-rendered as already answered).
    const pendingFromHistory = initialMessages.find((m) => m.confirmationState === "PENDING");
    setPendingConfirmMessageId(pendingFromHistory?.id ?? null);
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

  useEffect(() => {
    // Auto-opens/updates the canvas the moment a page-building tool call in the LIVE
    // stream succeeds — re-runs on every block mutation (a new tool call starting, an
    // existing one's status flipping to success), picking the most recent match each time.
    const toolBlocks = stream.blocks.filter(isToolUseBlock);
    for (let i = toolBlocks.length - 1; i >= 0; i--) {
      const artifact = extractArtifact(toolBlocks[i]);
      if (artifact) {
        setActiveArtifact(artifact);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.blocks]);

  useEffect(() => {
    if (!stream.generatedTitle) return;
    setConversation((prev) => (prev ? { ...prev, title: stream.generatedTitle } : prev));
    setTitleJustGenerated(true);
    bumpRefresh(); // so ThreadSidebar's Recents row picks up the new title too, not just this header
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.generatedTitle]);

  const rollbackOptimisticUserMessage = useCallback(() => {
    const id = optimisticUserMessageIdRef.current;
    if (id) {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      optimisticUserMessageIdRef.current = null;
    }
    setComposerRestoreText(lastSentTextRef.current);
  }, []);

  useEffect(() => {
    if (stream.outcome === "done") {
      commitAssistantMessage();
    } else if (stream.outcome === "awaiting_confirmation") {
      // `stream.awaitingMessageId` arrives in the SAME frame that flips this outcome (see
      // solAgent.ts's onToolCallAwaitingConfirmation and useSolStream's own handling of
      // it) — no separate fetch needed to learn which message is pending, and therefore no
      // async gap where Confirm/Submit could be clicked before this was actually known.
      // That gap used to be real: a fast click would silently no-op, because
      // handleConfirmToolCall/handleSubmitAnswers below both bail out when
      // pendingConfirmMessageId is still null.
      setPendingConfirmMessageId(stream.awaitingMessageId);
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
      knownConversationIdRef.current = data.conversation.id;
      setConversation(data.conversation);
      // Deliberately NOT router.replace/router.push here. A real Next.js navigation to
      // `/dashboard/sol/{id}` re-renders [conversationId]/page.tsx, a genuinely different
      // route file from this one (/dashboard/sol/page.tsx) — even with the
      // knownConversationIdRef guard above stopping THIS component from re-applying stale
      // props, the navigation itself was observed to still occasionally tear down and
      // remount the whole SolChatView subtree (Next's own route-segment reconciliation,
      // not React's — a `key` this codebase doesn't control), which resets every
      // useState — including `messages` — straight back to that fresh render's props
      // (an empty conversation, no messages yet). That's exactly the "sends, briefly shows
      // the bubble, then reverts to the blank Greeting screen" bug: the send was still
      // completing correctly the whole time, just against a component instance the user
      // could no longer see the effect of. A plain history update carries zero React
      // re-render at all — nothing here can tear anything down. It only costs the
      // sidebar's active-thread highlight, which doesn't come from the URL for free
      // anymore — restored explicitly via setActiveConversationIdOverride instead (see
      // SolSidebarContext/SolShell for the other half of this).
      window.history.replaceState(null, "", `/dashboard/sol/${data.conversation.id}`);
      setActiveConversationIdOverride(data.conversation.id);
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
    // Cleared immediately, not left to whenever the resumed turn eventually finishes —
    // `pendingQuestionBlock`'s "no live pause, fall back to the historical message" branch
    // was still finding THIS SAME message (local `messages` state doesn't get its
    // confirmationState corrected until a later refetch), so the overlay/card kept
    // rendering the just-answered question on top of the new turn already streaming in.
    setPendingConfirmMessageId(null);
  }

  function handleSubmitAnswers(answers: AskUserAnswer[]) {
    if (!conversation || !pendingConfirmMessageId) return;
    void stream.submitAnswers(conversation.id, pendingConfirmMessageId, answers);
    setPendingConfirmMessageId(null);
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
  // `stream.outcome === "awaiting_confirmation"` is checked directly here, not just
  // `pendingConfirmMessageId !== null` — the moment the stream actually pauses, this flips
  // true instantly, while `pendingConfirmMessageId` only gets set a beat later, once
  // resolvePendingConfirmation's own GET fetch resolves (a real, observed ~1s+ round trip
  // in this environment). Without this, there was a genuine window where neither
  // `streaming` nor `pendingConfirmMessageId !== null` were true yet, letting a fast
  // send slip a new message in while a confirmation/question was already pending — which
  // wedges an unrelated turn between a tool_use and its eventual tool_result, something
  // the Messages API hard-rejects with a 400 on the very next call (see solAgent.ts's
  // resumeAgentTurn for the defensive fix on that side too).
  const disabled = streaming || creatingConversation || pendingConfirmMessageId !== null || stream.outcome === "awaiting_confirmation";
  // A truly fresh, unstarted chat — nothing sent yet, nothing streaming. Gets the
  // ChatGPT/Claude.ai-style centered greeting + centered composer instead of the normal
  // message-list-plus-bottom-docked-composer layout; the moment the first message is sent
  // (which pushes an optimistic user message into `messages` immediately, before the
  // response even starts streaming), this flips to the normal layout and stays there for
  // the rest of the conversation.
  const isEmpty = messages.length === 0 && stream.outcome === "idle";

  // The one message currently pending an answer/confirmation, wherever its content
  // actually lives right now — the live in-flight stream (mid-session pause) or the
  // historical transcript (a pause that was already there when this conversation loaded,
  // e.g. a reload — see the reset effect above). `pendingConfirmMessageId` is the single
  // source of truth for WHICH message; this just finds its actual content wherever it is.
  const pendingToolUseBlock =
    stream.outcome === "awaiting_confirmation" && pendingConfirmMessageId === stream.awaitingMessageId
      ? stream.blocks.find(isToolUseBlock)
      : messages.find((m) => m.id === pendingConfirmMessageId)?.content.find(isToolUseBlock);
  const pendingQuestionBlock =
    pendingToolUseBlock && pendingToolUseBlock.name === ASK_USER_QUESTION_TOOL_NAME ? pendingToolUseBlock : null;

  const composer = (
    <>
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
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <SolHeader
        conversation={conversation}
        onRename={handleRename}
        creditsRefreshKey={creditsRefreshKey}
        titleJustGenerated={titleJustGenerated}
        onTitleRevealDone={() => setTitleJustGenerated(false)}
      />

      {isEmpty ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 1.25rem", gap: "1.75rem" }}>
          <Greeting name={userName} />
          <div style={{ width: "100%", maxWidth: 680 }}>{composer}</div>
        </div>
      ) : (
        <div className="sol-split-row" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row" }}>
          <div className="sol-split-chat" style={{ position: "relative", flex: activeArtifact ? "1 1 50%" : "1 1 100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <MessageList
              messages={messages}
              conversationId={conversation?.id ?? "pending"}
              pendingBlocks={stream.outcome === "idle" ? null : stream.blocks}
              streaming={streaming}
              onConfirmToolCall={handleConfirmToolCall}
              confirmBusy={streaming && pendingConfirmMessageId !== null}
            />
            <div style={{ padding: "0 1.25rem 1.25rem" }}>
              <div style={{ maxWidth: 760, margin: "0 auto" }}>{composer}</div>
            </div>
            {pendingQuestionBlock && (
              <AskUserQuestionOverlay
                block={pendingQuestionBlock}
                onSubmit={handleSubmitAnswers}
                busy={streaming && pendingConfirmMessageId !== null}
              />
            )}
          </div>
          {activeArtifact && (
            <div className="sol-split-canvas" style={{ flex: "1 1 50%", minWidth: 0, minHeight: 0 }}>
              <ArtifactCanvas artifact={activeArtifact} onClose={() => setActiveArtifact(null)} />
            </div>
          )}
          <style>{`
            /* Below this width, a 50/50 side-by-side split leaves neither the chat nor the
               canvas usable — stack the canvas below the chat instead, each getting a full-
               width half-height pane, matching the app's existing 767px mobile breakpoint
               (see globals.css's .dash-pill-nav rule) but a little wider since a chat
               column needs more room than a nav bar before it gets cramped. */
            @media (max-width: 900px) {
              .sol-split-row { flex-direction: column !important; }
              .sol-split-chat, .sol-split-canvas { flex: 1 1 50% !important; }
            }
          `}</style>
        </div>
      )}

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
