"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, FileText, Globe, PanelLeft, Pencil, ShoppingBag, Share2, X } from "lucide-react";
import type { ActiveArtifact } from "../../sol/_components/ArtifactCanvas";
import { useSolSidebar } from "../../sol/_components/SolSidebarContext";
import type { AskUserAnswer, ContentBlock, ConversationSummary, CreditInfo, SolMessage, ToolUseBlock } from "../../sol/_components/types";
import type { ComposerProps } from "../../sol/_components/useComposer";
import { Button } from "../ui/Button";
import { AskCard } from "./AskCard";
import { ArtifactChip, Canvas } from "./Canvas";
import { SolComposer } from "./Composer";
import { CreditModal } from "./CreditModal";
import { greetingFor, SUGGESTIONS } from "./logic";
import { SolMark } from "./Message";
import { Messages } from "./Messages";
import { ShareDialog } from "./ShareDialog";
import { useSolV3 } from "./SolV3Context";

const SUGGESTION_ICONS: Record<string, React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = { site: Globe, about: FileText, shop: ShoppingBag, change: Pencil };

export type SolChatFrameProps = {
  userName: string | null;
  conversation: ConversationSummary | null;
  messages: SolMessage[];
  pendingBlocks: ContentBlock[] | null;
  streaming: boolean;
  isEmpty: boolean;
  composer: ComposerProps;
  composerFocusKey?: number;
  inlineError: string | null;
  overdraftBalance: number | null;
  onConfirmToolCall: (d: "confirmed" | "declined") => void;
  confirmBusy: boolean;
  pendingQuestion: ToolUseBlock | null;
  onSubmitAnswers: (a: AskUserAnswer[]) => void;
  activeArtifact: ActiveArtifact | null;
  showArtifact: boolean;
  onOpenArtifact: () => void;
  onCloseArtifact: () => void;
  creditInfo: CreditInfo | null;
  onCloseCredit: () => void;
  returnTo: string;
  onRename: (title: string) => void;
  creditsRefreshKey: number;
  titleJustGenerated: boolean;
  onTitleRevealDone: () => void;
  onSuggestion: (prompt: string) => void;
};

/** The credit balance as a quiet pill, with a way to add more. */
export function CreditsPill({ refreshKey }: { refreshKey?: number }) {
  const [credits, setCredits] = useState<number | null>(null);
  useEffect(() => {
    let off = false;
    fetch("/api/v1/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !off && d?.user && setCredits(d.user.totalCredits ?? null))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [refreshKey]);
  if (credits === null) return null;
  return (
    <Link href="/dashboard/settings/subscription" className="sol3-credits" data-low={credits < 50} title="Your AI credits. Tap to add more.">
      <b>{credits.toLocaleString()}</b> <span className="sol3-credits__word">credits</span>
      {credits < 50 ? <span className="sol3-credits__top">· Add more</span> : null}
    </Link>
  );
}

function Header({ conversation, onRename, refreshKey, titleJustGenerated, onTitleRevealDone, onShare }: { conversation: ConversationSummary | null; onRename: (t: string) => void; refreshKey: number; titleJustGenerated: boolean; onTitleRevealDone: () => void; onShare: () => void }) {
  const { openMobileSidebar } = useSolSidebar();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation?.title ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(conversation?.title ?? ""), [conversation?.id, conversation?.title]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const full = conversation?.title ?? "";
  const [typed, setTyped] = useState(titleJustGenerated ? 0 : full.length);
  useEffect(() => {
    if (!titleJustGenerated || !full) return;
    setTyped(0);
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= full.length) {
        window.clearInterval(timer);
        onTitleRevealDone();
      }
    }, 28);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleJustGenerated, full]);
  const shown = titleJustGenerated ? full.slice(0, typed) : full;

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== conversation?.title) onRename(t);
  };
  return (
    <header className="sol3-head">
      <button type="button" className="plx-iconbtn sol3-head__panel" aria-label="Your conversations" title="Your conversations" onClick={openMobileSidebar}>
        <PanelLeft size={21} aria-hidden />
      </button>
      <div className="sol3-head__title">
        {editing ? (
          <>
            <input
              ref={input}
              className="sol3-title-input"
              aria-label="Conversation name"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(conversation?.title ?? "");
                  setEditing(false);
                }
              }}
            />
            <button type="button" className="plx-iconbtn" aria-label="Save name" onClick={commit}><Check size={19} aria-hidden /></button>
            <button type="button" className="plx-iconbtn" aria-label="Cancel" onClick={() => { setDraft(conversation?.title ?? ""); setEditing(false); }}><X size={19} aria-hidden /></button>
          </>
        ) : (
          <button type="button" className="sol3-title-btn" disabled={!conversation} onClick={() => conversation && setEditing(true)} title={conversation ? "Rename" : undefined}>
            <span>
              {shown || "New chat"}
              {titleJustGenerated && typed < full.length ? <span className="sol3-caret" /> : null}
            </span>
            {conversation ? <Pencil size={15} aria-hidden className="sol3-title-pen" /> : null}
          </button>
        )}
      </div>
      <div className="sol3-head__right">
        <CreditsPill refreshKey={refreshKey} />
        {conversation ? (
          <Button size="sm" variant="secondary" leftIcon={<Share2 size={17} aria-hidden />} onClick={onShare}>
            Share
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function SiteChip() {
  const v3 = useSolV3();
  if (!v3?.site) return null;
  return (
    <div className="sol3-chip">
      <span>Working on:</span>
      <b>{v3.site.name}</b>
      <button type="button" aria-label={`Stop working on ${v3.site.name}`} title="Not this site" onClick={() => v3.setSite(null)}>
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}

function Empty({ userName, composer, props }: { userName: string | null; composer: React.ReactNode; props: SolChatFrameProps }) {
  const first = userName?.trim().split(/\s+/)[0];
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  return (
    <div className="sol3-empty">
      <div className="sol3-empty__in">
        <div className="sol3-empty__hero">
          <span className="sol3-empty__mark" aria-hidden>
            <SolMark size={30} />
          </span>
          <h1>
            {hour === null ? "Hello" : greetingFor(hour)}
            {first ? `, ${first}` : ""}
          </h1>
          <p>What would you like to make today?</p>
        </div>
        <div className="sol3-empty__composer">
          <SiteChip />
          {props.inlineError ? <p className="sol3-error" role="alert">{props.inlineError}</p> : null}
          {composer}
        </div>
        <div className="sol3-sugg" role="list" aria-label="Ideas to start with">
          {SUGGESTIONS.map((s) => {
            const Icon = SUGGESTION_ICONS[s.id] ?? Globe;
            return (
              <button key={s.id} type="button" role="listitem" className="sol3-sg" onClick={() => props.onSuggestion(s.prompt)}>
                <span className="sol3-sg__ico"><Icon size={16} aria-hidden /></span>
                <b>{s.title}</b>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** SOL's whole chat screen in the new look. The conversation logic stays in SolChatView; this only draws it. */
export function SolChatFrame(props: SolChatFrameProps) {
  const [sharing, setSharing] = useState(false);
  const composerEl = <SolComposer {...props.composer} autoFocus />;

  return (
    <>
      <Header conversation={props.conversation} onRename={props.onRename} refreshKey={props.creditsRefreshKey} titleJustGenerated={props.titleJustGenerated} onTitleRevealDone={props.onTitleRevealDone} onShare={() => setSharing(true)} />
      {props.isEmpty ? (
        <Empty userName={props.userName} composer={composerEl} props={props} />
      ) : (
        <div className="sol3-split">
          <div className="sol3-split__chat">
            <Messages
              messages={props.messages}
              conversationId={props.conversation?.id ?? "pending"}
              pendingBlocks={props.pendingBlocks}
              streaming={props.streaming}
              onConfirmToolCall={props.onConfirmToolCall}
              confirmBusy={props.confirmBusy}
              below={props.pendingQuestion ? <AskCard key={props.pendingQuestion.id} block={props.pendingQuestion} onSubmit={props.onSubmitAnswers} busy={props.confirmBusy} /> : null}
            />
            <div className="sol3-dock">
              <div className="sol3-dock__in">
                {props.activeArtifact && !props.showArtifact ? <ArtifactChip artifact={props.activeArtifact} onOpen={props.onOpenArtifact} /> : null}
                {props.inlineError ? <p className="sol3-error" role="alert">{props.inlineError}</p> : null}
                {props.overdraftBalance !== null ? (
                  <p className="sol3-notice" role="status">
                    <b>Your credits ran out partway through.</b> We let SOL finish the step it was on so your work isn&apos;t left half-done. Your balance is now {props.overdraftBalance.toLocaleString()}. It comes off your next monthly credits or top-up. <Link href="/dashboard/settings/subscription">Add credits</Link>
                  </p>
                ) : null}
                <SiteChip />
                {composerEl}
              </div>
            </div>
          </div>
          {props.activeArtifact && props.showArtifact ? (
            <div className="sol3-split__canvas">
              <Canvas artifact={props.activeArtifact} onClose={props.onCloseArtifact} />
            </div>
          ) : null}
        </div>
      )}
      {props.creditInfo ? <CreditModal creditInfo={props.creditInfo} returnTo={props.returnTo} onClose={props.onCloseCredit} /> : null}
      <ShareDialog conversationId={sharing ? (props.conversation?.id ?? null) : null} onClose={() => setSharing(false)} />
    </>
  );
}
