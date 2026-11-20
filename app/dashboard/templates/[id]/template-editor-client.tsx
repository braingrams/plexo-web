"use client";

/**
 * Template editor client.
 *
 * PlexoBuilder is a browser-only component (drag-and-drop, ResizeObserver).
 * It must never be rendered on the server. This file is loaded exclusively
 * via the next/dynamic wrapper in template-editor-dynamic.tsx (ssr: false).
 */

import { SolOutOfCredits } from "../../_components/sol/SolTopUp";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { emailsListHref } from "@/lib/dashboardV3/emails";
import { editorMergeTags } from "@/lib/email/mergeTags";
import { useEditorBackHref, useEditorBeginner, useEditorColors, useEditorV3 } from "../../_components/EditorTheme";
import {
  PlexoBuilder,
  type PlexoBuilderRef,
  type TemplateJSON,
  type CommentTarget,
} from "@charisol/plexo-sdk";
import "@charisol/plexo-sdk/dist/plexo-sdk.css";
import { readAutosave, saveStatus, writeAutosave } from "@/lib/editor/saveModel";
import { saveAutosaveToAccount } from "@/lib/editor/autosavePref";
import { PublishBlockedPanel } from "./PublishBlockedPanel";
import { MultiPageSolDialog } from "../../_components/MultiPageSolDialog";
import { SitePlanNotice } from "../../_components/SitePlanNotice";
import { UpgradePrompt } from "../../_components/UpgradePrompt";
import { parsePlanGate, pendingPublishKey, publishReturnPath, readPendingPublish, serializePendingPublish, type PlanGate } from "@/lib/plan/planGate";
import { PagesPanel } from "./PagesPanel";
import { CommentLayer, type NodeRectSource, type PendingPin } from "./comments/CommentLayer";
import { V2TemplateEditor, type V2TemplateEditorHandle } from "./v2/V2TemplateEditor";
import { TryNewEditorBanner, TryNewEditorDialog } from "./v2/TryNewEditor";
import { BlockModeSwitch, ConvertToCodeDialog } from "./ConvertToCode";
import { EditModeHint } from "./EditModeHint";
import type { V2Design } from "@/lib/v2/design";
import { BuyDomainFlow } from "../../domains/domains-client";
import { Toggle } from "../../_components/Toggle";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";

type Props = {
  templateId: string;
  templateName: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  // Non-null when this page is a sub-page of another landing page — sub-pages
  // are reached through their site's shared domain, so they never get their
  // own PublishedDomain and shouldn't trigger the "publish this page" nudge.
  templateParentId: string | null;
  initialDesignJson: TemplateJSON;
  // The live/published designJson baseline — compared (via JSON.stringify) against the
  // draft after every save to decide if there are real unpublished changes, instead of
  // just trusting that a save happened.
  liveDesignJson: TemplateJSON;
  // Whether this template has draft edits (draftJson) that haven't been Published yet —
  // seeds the header's "Unpublished changes" indicator on load; kept in sync client-side
  // after every save/publish rather than re-fetched.
  hasUnpublishedChanges: boolean;
  subscriptionPlan: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: AiTier;
  unsplashKey?: string;
  pexelsKey?: string;
  pixabayKey?: string;
  currentUserId: string;
  currentUserRole: string;
  /** The owner's saved Autosave choice (undefined = never chosen: on). */
  initialAutosave?: boolean;
  organizationId: string;
  // True for a Template created via Blog Settings' "Design custom layout" — shows the
  // Blog block palette group in PlexoBuilder and an instructional banner here.
  isBlogLayout?: boolean;
  // True when this page's SITE (its root Template) has Commerce enabled — shows the
  // Commerce block palette group in PlexoBuilder. Resolved server-side in page.tsx by
  // walking up to the root, since Commerce is scoped per site, not per page.
  commerceEnabled?: boolean;
  // True when this site already has a MailDrip API key saved (CommerceSettings) — lets
  // form_container's 'maildrip' provider panel skip straight to "Create Opt-in Page"
  // instead of showing the Connect flow. Resolved server-side the same way as
  // commerceEnabled, for the same reason (MailDrip is a per-site concern, not per-page).
  maildripConnected?: boolean;
  // This page's site's root Template id — same walk as commerceEnabled, reused here to
  // link to /dashboard/templates/{root}/site-layout regardless of how deep the current
  // page sits in the site's page tree.
  rootTemplateId: string;
  // Which editor this page uses: "v1" is the classic builder (everything above), "v2" is the new
  // visual editor (lib/v2/design.ts). Decided on the server from the page's own format.
  designFormat?: "v1" | "v2";
  // v2 only: the page's working copy, ready for the new editor.
  initialV2Design?: V2Design | null;
  // v1 only: this page can move to the new editor (not an email, uploaded HTML or shared layout).
  canTryNewEditor?: boolean;
  // v2 only: this page was moved from the classic editor and can still go back.
  canGoBackToClassic?: boolean;
  templateSlug?: string | null;
  // This page can be turned into editable code (Design | Code | Text) — an ordinary block page, not an email or shared layout.
  canConvertToCode?: boolean;
  // Opened from "Edit the code" / "Edit the words" on a page that is still blocks: start by offering to turn it into code.
  initialConvertTo?: "code" | "text";
  // Site health link: scroll to this element once the editor is open and highlight it.
  focusNodeId?: string;
};

function IconArrowLeft() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}

function IconSave() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconComment() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconLayout() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconRocket() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function IconAutoSave() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function EditorHeaderLeft({
  isEmail,
  templateName,
  onBack,
  backLabel,
}: {
  isEmail: boolean;
  templateName: string;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.4rem 0.75rem",
          borderRadius: 8,
          border: "1px solid var(--ed-w-100)",
          background: "transparent",
          color: "var(--ed-t-600)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "0.8rem",
          fontWeight: 600,
          whiteSpace: "nowrap",
          transition: "background 0.15s, color 0.15s",
        }}
      >
        <IconArrowLeft />
        {backLabel}
      </button>

      <div
        style={{
          width: 1,
          height: 20,
          background: "var(--ed-w-100)",
          flexShrink: 0,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          minWidth: 0,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            padding: "0.2rem 0.55rem",
            borderRadius: 999,
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            background: isEmail
              ? "var(--brand-subtle)"
              : "color-mix(in srgb, var(--ed-lavender) 10%, transparent)",
            color: isEmail ? "var(--ed-accent-text)" : "var(--ed-lavender)",
            border: `1px solid ${isEmail ? "color-mix(in srgb, var(--brand) 25%, transparent)" : "color-mix(in srgb, var(--ed-lavender) 20%, transparent)"}`,
            flexShrink: 0,
          }}
        >
          {isEmail ? <IconMail /> : <IconLayout />}
          {isEmail ? "Email" : "Page"}
        </span>
        <h1
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: "0.95rem",
            fontWeight: 700,
            color: "var(--ed-text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {templateName}
        </h1>
      </div>
    </div>
  );
}

/** Switches the owner between the simple editor and the full one (their dashboard view), after saving what they were doing. */
function ViewSwitch({ to, saveFirst }: { to: "beginner" | "pro"; saveFirst: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = to === "pro" ? "Switch to full editor" : "Switch to simple editor";
  async function go() {
    setBusy(true);
    setFailed(false);
    try {
      await saveFirst().catch(() => undefined);
      const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ experience: to }) });
      if (!res.ok) throw new Error("not saved");
      window.location.reload();
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }
  return (
    <button type="button" onClick={() => void go()} disabled={busy} title={to === "pro" ? "Every tool, for people who like to be in control. You can switch back any time." : "A simpler screen with fewer tools. You can switch back any time."}>
      {busy ? "Switching…" : failed ? "Try again" : label}
    </button>
  );
}

function EditorHeaderRight({
  saveMessage,
  saveError,
  subscriptionPlan,
  isSaving,
  onSave,
  hasUnpublishedChanges,
  isPublishing,
  publishMessage,
  publishError,
  onPublish,
  commentsOpen,
  onToggleComments,
  autoSaveEnabled,
  onToggleAutoSave,
  autoSaveNotification,
  savedAt,
  compact,
  beginner,
  v3,
  saveFirst,
  modeSwitch,
  manyPages,
}: {
  /** Design | Code | Text, for pages that can be turned into code. */
  modeSwitch?: React.ReactNode;
  /** "Ask SOL about several pages". */
  manyPages?: React.ReactNode;
  compact?: boolean;
  /** The simple screen has its own Save menu and status; only comments and problems are shown here, in the editor's own button style. */
  beginner?: boolean;
  /** On the new dashboard: show the switch between the simple and full editor. */
  v3?: boolean;
  saveFirst: () => Promise<void>;
  saveMessage: string | null;
  saveError: string | null;
  subscriptionPlan: string;
  isSaving: boolean;
  onSave: () => void;
  hasUnpublishedChanges: boolean;
  isPublishing: boolean;
  publishMessage: string | null;
  publishError: string | null;
  onPublish: () => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
  autoSaveEnabled: boolean;
  onToggleAutoSave: () => void;
  autoSaveNotification: string | null;
  /** When the page was last kept safe (ms), for the quiet "Saved 2 min ago". */
  savedAt: number | null;
}) {
  if (beginner) {
    const problem = publishError ?? saveError;
    return (
      <>
        {problem && <span role="alert" style={{ fontSize: "0.75rem", color: "var(--ed-danger)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={problem}>{problem}</span>}
        {modeSwitch}
        {manyPages}
        <ViewSwitch to="pro" saveFirst={saveFirst} />
        <button type="button" onClick={onToggleComments} aria-pressed={commentsOpen}>
          <IconComment />
          Comments
        </button>
      </>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.6rem",
        flexShrink: 0,
      }}
    >
      {modeSwitch}
      {manyPages}
      {v3 && <ViewSwitch to="beginner" saveFirst={saveFirst} />}
      <div
        style={{
          display: compact ? "none" : "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          fontSize: "0.8rem",
          fontWeight: 600,
          color: autoSaveEnabled ? "var(--ed-accent-text)" : "var(--ed-t-600)",
          whiteSpace: "nowrap",
        }}
        title={autoSaveEnabled ? "Autosave is on: your changes are kept safe as you work" : "Autosave is off: press Save to keep your changes"}
      >
        <IconAutoSave />
        Autosave
        <Toggle
          checked={autoSaveEnabled}
          onChange={onToggleAutoSave}
          label="Autosave"
        />
      </div>

      {!compact && (() => {
        const st = saveStatus({ saving: isSaving || isPublishing, error: saveError ?? publishError, dirty: false, autosave: autoSaveEnabled, savedAt, now: Date.now() });
        return (
          <span role="status" aria-live="polite" title={saveError ?? publishError ?? undefined} style={{ fontSize: "0.78rem", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", color: st.tone === "error" ? "var(--ed-danger)" : st.tone === "saved" ? "var(--ed-success)" : "var(--ed-t-600)" }}>
            {st.text}
          </span>
        );
      })()}

      {autoSaveNotification && (
        <span
          style={{
            fontSize: "0.78rem",
            color: autoSaveEnabled ? "var(--ed-success)" : "var(--ed-t-600)",
            whiteSpace: "nowrap",
          }}
        >
          {autoSaveNotification}
        </span>
      )}

      <button
        type="button"
        onClick={onToggleComments}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.45rem 0.8rem",
          borderRadius: 9,
          border: commentsOpen
            ? "1px solid var(--brand)"
            : "1px solid var(--ed-w-100)",
          background: commentsOpen ? "var(--brand-subtle)" : "transparent",
          color: commentsOpen ? "var(--ed-accent-text)" : "var(--ed-t-600)",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: "0.8rem",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        <IconComment />
        Comments
      </button>

      {saveMessage && (
        <span
          style={{
            fontSize: "0.78rem",
            color: "var(--ed-success)",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
          }}
        >
          <IconCheck /> {saveMessage}
        </span>
      )}
      {saveError && (
        <span
          style={{
            fontSize: "0.78rem",
            color: "var(--ed-danger)",
            whiteSpace: "nowrap",
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {saveError}
        </span>
      )}

      {publishMessage && (
        <span
          style={{
            fontSize: "0.78rem",
            color: "var(--ed-success)",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
          }}
        >
          <IconCheck /> {publishMessage}
        </span>
      )}
      {publishError && (
        <span
          style={{
            fontSize: "0.78rem",
            color: "var(--ed-danger)",
            whiteSpace: "nowrap",
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {publishError}
        </span>
      )}

      {/* {hasUnpublishedChanges && !publishMessage && (
        <span
          title="Your draft has changes that aren't live yet"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--ed-warning)",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--ed-warning)",
            }}
          />
          Unpublished changes
        </span>
      )} */}

      <span
        style={{
          display: "none",
          padding: "0.2rem 0.6rem",
          borderRadius: 999,
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          background: "var(--ed-w-060)",
          color: "var(--ed-t-450)",
          border: "1px solid var(--ed-w-080)",
        }}
        className="sm:inline-flex"
      >
        {subscriptionPlan}
      </span>

      <button
        id="editor-save-btn"
        type="button"
        onClick={onSave}
        disabled={isSaving || isPublishing}
        title="Save your work. You can keep it as a draft or put it live."
        style={{
          display: compact ? "none" : "inline-flex",
          alignItems: "center",
          gap: "0.45rem",
          padding: "0.5rem 1rem",
          borderRadius: 9,
          border: "1px solid var(--ed-w-120)",
          cursor: isSaving ? "not-allowed" : "pointer",
          fontSize: "0.85rem",
          fontWeight: 700,
          background: "transparent",
          color: "var(--ed-t-850)",
          opacity: isSaving ? 0.7 : 1,
          fontFamily: "inherit",
          transition: "opacity 0.15s",
        }}
      >
        {isSaving ? (
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: "50%",
              border: "2px solid var(--ed-w-300)",
              borderTopColor: "var(--ed-text)",
              animation: "spin 0.65s linear infinite",
              flexShrink: 0,
            }}
          />
        ) : (
          <IconSave />
        )}
        {isSaving || isPublishing ? "Saving…" : "Save"}
      </button>

    </div>
  );
}

/** What "Save" means: keep it as a draft and leave, or put it live now. Big, plain choices. */
function SaveChoiceDialog({ busy, canPublish, error, onDraft, onPublish, onClose }: { busy: "draft" | "publish" | null; canPublish: boolean; error: string | null; onDraft: () => void; onPublish: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const choice: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, width: "100%", minHeight: 64, padding: "0.9rem 1.1rem", borderRadius: 14, textAlign: "left", cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 };
  return (
    <div role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()} style={{ position: "fixed", inset: 0, background: "var(--ed-scrim)", zIndex: 100, display: "grid", placeItems: "center", backdropFilter: "blur(8px)" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="save-choice-title" style={{ background: "var(--ed-panel)", border: "1px solid var(--ed-w-080)", borderRadius: 18, width: "min(92vw, 460px)", padding: "1.5rem", boxShadow: "0 20px 50px rgba(0,0,0,0.5)", display: "grid", gap: "0.85rem" }}>
        <h2 id="save-choice-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, color: "var(--ed-text)", fontFamily: "var(--font-heading)" }}>What would you like to do?</h2>
        <button type="button" disabled={Boolean(busy)} onClick={onDraft} style={{ ...choice, border: "1px solid var(--ed-w-120)", background: "transparent", color: "var(--ed-t-850)" }}>
          <strong style={{ fontSize: "0.95rem" }}>{busy === "draft" ? "Saving…" : "Save as draft and close"}</strong>
          <span style={{ fontSize: "0.8rem", opacity: 0.75 }}>Keep your work private for now and go back to your site.</span>
        </button>
        {canPublish && (
          <button type="button" disabled={Boolean(busy)} onClick={onPublish} style={{ ...choice, border: "none", background: "var(--ed-cta)", color: "var(--ed-on-brand)" }}>
            <strong style={{ fontSize: "0.95rem" }}>{busy === "publish" ? "Publishing…" : "Publish now"}</strong>
            <span style={{ fontSize: "0.8rem", opacity: 0.85 }}>Put this page on the internet so visitors see it.</span>
          </button>
        )}
        {error && <p role="alert" style={{ margin: 0, fontSize: "0.82rem", color: "var(--ed-danger)" }}>{error}</p>}
        <button type="button" disabled={Boolean(busy)} onClick={onClose} style={{ minHeight: 44, background: "transparent", border: "none", color: "var(--ed-t-600)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>
          Keep editing
        </button>
      </div>
    </div>
  );
}

export function TemplateEditorClient({
  templateId,
  templateName,
  templateKind,
  templateParentId,
  initialDesignJson,
  liveDesignJson,
  hasUnpublishedChanges: initialHasUnpublishedChanges,
  subscriptionPlan,
  useAi,
  aiProvider,
  aiTier,
  unsplashKey,
  pexelsKey,
  pixabayKey,
  currentUserId,
  currentUserRole,
  initialAutosave,
  organizationId,
  isBlogLayout,
  commerceEnabled,
  maildripConnected,
  rootTemplateId,
  designFormat = "v1",
  initialV2Design = null,
  canTryNewEditor = false,
  canGoBackToClassic = false,
  templateSlug = null,
  canConvertToCode = false,
  initialConvertTo,
  focusNodeId,
}: Props) {
  const router = useRouter();
  const v3 = useEditorV3();
  const beginner = useEditorBeginner();
  const backToSiteHref = useEditorBackHref(rootTemplateId);
  const editorColors = useEditorColors();
  const isV2 = designFormat === "v2" && !!initialV2Design;
  // Counted once per opening of the editor, for the admin's simple-vs-full usage page (the server works out which view they are on).
  useEffect(() => {
    if (!v3 || !isV2) return;
    void fetch("/api/experience/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "open" }), keepalive: true }).catch(() => undefined);
  }, [v3, isV2]);
  const v2Ref = useRef<V2TemplateEditorHandle>(null);
  const [tryOpen, setTryOpen] = useState(false);
  // "code" / "text": the dialog that explains turning this page into code is open, for that view.
  const [convertTo, setConvertTo] = useState<"code" | "text" | null>(canConvertToCode ? (initialConvertTo ?? null) : null);
  const searchParams = useSearchParams();
  const builderRef = useRef<PlexoBuilderRef>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The builder's SOL actions ran out of AI credits → SOL's top-up card over the editor.
  const [solOutOfCredits, setSolOutOfCredits] = useState(false);
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(
    initialHasUnpublishedChanges,
  );
  const [autoSaveNotification, setAutoSaveNotification] = useState<
    string | null
  >(null);
  // Autosave: on unless the owner turned it off; the choice is theirs, remembered for every page on this device.
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => (typeof initialAutosave === "boolean" ? initialAutosave : typeof window === "undefined" ? true : readAutosave(window.localStorage, templateId)));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [manyPagesOpen, setManyPagesOpen] = useState(false);
  const manyPagesChanged = useRef(false);
  const [reloading, setReloading] = useState(false);
  const [saveBusy, setSaveBusy] = useState<"draft" | "publish" | null>(null);
  // "Publish now" with no web address yet asks for one first; the page goes live as soon as it is set.
  const publishAfterAddress = useRef(false);
  // The new editor's "Publish now" waits for this until the page is really live (the owner may be choosing an address meanwhile).
  const pendingPublish = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  // Whether the site has its web address yet (only changes the wording of "Publish now"); null = not known.
  const [hasAddress, setHasAddress] = useState<boolean | null>(templateKind === "LANDING_PAGE" && templateParentId ? true : null);
  useEffect(() => {
    if (templateKind !== "LANDING_PAGE" || templateParentId || isBlogLayout) return;
    let cancelled = false;
    fetch(`/api/v1/domains?templateId=${templateId}`)
      .then((r) => r.json())
      .then((d: { domains?: unknown[] }) => !cancelled && Array.isArray(d.domains) && setHasAddress(d.domains.length > 0))
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [templateId, templateKind, templateParentId, isBlogLayout]);
  function closePublishModal(): void {
    publishAfterAddress.current = false;
    setShowPublishModal(false);
    pendingPublish.current?.reject(new Error("Your page wasn't put live. Choose a web address when you're ready and press Publish now again."));
    pendingPublish.current = null;
  }
  // Keeps "Saved 2 min ago" honest while nothing else changes.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  // Baseline for the "is the draft actually different from what's live" check below —
  // a plain string compare is far cheaper than deep-diffing the design tree on every
  // autosave tick. Updated after every successful publish.
  const liveDesignJsonRef = useRef(JSON.stringify(liveDesignJson));
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [modalDomainType, setModalDomainType] = useState<
    "SUBDOMAIN" | "CUSTOM" | "BUY"
  >("SUBDOMAIN");
  const [modalSubdomainPrefix, setModalSubdomainPrefix] = useState("");
  const [modalCustomDomain, setModalCustomDomain] = useState("");
  const [modalIsSubmitting, setModalIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  // Set when the plan stops the publish: the modal then explains it and offers Upgrade / Publish and replace / Skip.
  const [modalGate, setModalGate] = useState<(PlanGate & { liveSiteNames?: string[]; canReplace?: boolean }) | null>(null);
  // Same idea for the header Publish button (e.g. a second page on Free).
  const [publishGate, setPublishGate] = useState<PlanGate | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);
  const [baseDomain, setBaseDomain] = useState("plexo.charisol.io");
  // The actual CloudFront routing endpoint a CUSTOM domain's CNAME must target — distinct
  // from baseDomain (the free-subdomain wildcard base, e.g. "plexopages.com") above. This
  // modal used to show baseDomain here instead, which pointed customers at the wrong
  // CNAME target entirely; see handleModalPublish's own comment on the rest of the fix.
  const [routingEndpoint, setRoutingEndpoint] = useState<string | null>(null);
  const [modalCertValidation, setModalCertValidation] = useState<{
    name: string;
    value: string;
  } | null>(null);
  // Deep-linked from a mention/reply notification email (?comment=<id>) — opens the
  // panel straight to that thread. See lib/mail/templates.ts's buildMentionEmail.
  const [commentsOpen, setCommentsOpen] = useState(() =>
    searchParams.has("comment"),
  );
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);

  const isEmail = templateKind === "EMAIL";
  // An email has no site page to go back to: Back returns to the emails list.
  const exitHref = isEmail ? emailsListHref(v3) : backToSiteHref;
  // Viewer/Commenter roles get a read-only canvas (enforced for real server-side by
  // every mutating route's requirePermission check — this is UX support only, see
  // plexo-sdk's readOnly prop docs).
  const isReadOnlyRole =
    currentUserRole === "viewer" || currentUserRole === "commenter";

  /** Exports and persists the current canvas without any of the save button's UI side effects — used when switching pages so the outgoing page's edits aren't lost. */
  async function flushSave(): Promise<{ json: TemplateJSON; html: string }> {
    if (isV2) {
      // The new editor saves its own page (same autosave route); there is no client-side HTML.
      if (!v2Ref.current) return { json: initialDesignJson, html: "" };
      const saved = await v2Ref.current.flush();
      setSavedAt(Date.now());
      setHasUnpublishedChanges(true);
      return { json: saved as unknown as TemplateJSON, html: "" };
    }
    if (!builderRef.current) return { json: initialDesignJson, html: "" };
    const mode = isEmail ? "email" : "landing_page";
    const exported = await builderRef.current.exportDesign(mode);
    const response = await fetch(`/api/templates/update/${templateId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        designJson: exported.json,
        compiledHtml: exported.html,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(payload.error ?? "Unable to save template.");
    }
    setSavedAt(Date.now());
    setHasUnpublishedChanges(
      JSON.stringify(exported.json) !== liveDesignJsonRef.current,
    );
    return exported;
  }

  /** Quiet background autosave (PlexoBuilder's own autoSave/autoSaveDuration timer) — persists
   * the same way flushSave/handleSave do, but skips the UI side effects that make sense for an
   * explicit click and not a silent tick: no saveMessage toast, no router.refresh(), and no
   * publish-modal nudge. A persistently-failing autosave still surfaces via saveError so it
   * doesn't fail silently forever. */
  function handleAutoSave(data: { json: TemplateJSON; html: string }): void {
    fetch(`/api/templates/update/${templateId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designJson: data.json, compiledHtml: data.html }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? "Unable to save template.");
        }
        setSaveError(null);
        setSavedAt(Date.now());
        setHasUnpublishedChanges(
          JSON.stringify(data.json) !== liveDesignJsonRef.current,
        );
        // setSaveMessage("Draft saved.");
        // setTimeout(() => setSaveMessage(null), 3000);
      })
      .catch((err) => {
        console.warn("Autosave failed:", err);
        setSaveError(err instanceof Error ? err.message : "Autosave failed.");
      });
  }

  /** Backs form_container's 'maildrip' provider "Connect MailDrip" flow (see
   * plexo-sdk's FormContainerPropertiesAccordion / MaildripConnectPanel) — a real
   * login-or-create-account modal inside the builder itself, never a redirect to
   * app.maildrip.io. Every action is relayed to our own backend, which is the only place
   * a password can be forwarded to MailDrip's API and the resulting API key decrypted/
   * encrypted for storage; see app/api/v1/maildrip/[templateId]/connect's own comment for
   * the full register/login/verify/resend state machine. */
  async function handleMaildripAuth(
    input:
      | { action: "register"; email: string; password: string; name: string }
      | { action: "login"; email: string; password: string }
      | { action: "verify"; email: string; code: string; password: string }
      | { action: "resend"; email: string },
  ): Promise<
    | { status: "connected" }
    | { status: "verify_required"; email: string }
    | { status: "sent" }
    | { error: string }
  > {
    try {
      const response = await fetch(
        `/api/v1/maildrip/${rootTemplateId}/connect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          error:
            typeof payload.error === "string"
              ? payload.error
              : "MailDrip request failed.",
        };
      }
      return payload;
    } catch {
      return { error: "Could not reach the server. Please try again." };
    }
  }

  /** Backs form_container's 'maildrip' provider "Create MailDrip Opt-in Page" action (see
   * plexo-sdk's FormContainerPropertiesAccordion) — brokers the call to the site's own
   * MailDrip account through our own backend, which is the only place the site's
   * encrypted MailDrip API key can be decrypted. */
  async function handleCreateMaildripOptInPage(
    title: string,
  ): Promise<{ pageId: string; editUrl: string } | { error: string }> {
    try {
      const response = await fetch(
        `/api/v1/maildrip/${rootTemplateId}/opt-in-pages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof payload.error === "string"
            ? payload.error
            : "Could not create the MailDrip opt-in page.";
        return {
          error: payload.needsMaildripKey
            ? `${message} (Commerce → Settings → MailDrip)`
            : message,
        };
      }
      return { pageId: payload.pageId, editUrl: payload.editUrl };
    } catch {
      return { error: "Could not reach the server. Please try again." };
    }
  }

  async function handleNavigateToPage(pageId: string): Promise<void> {
    if (pageId === templateId) return;
    try {
      await flushSave();
    } catch (err) {
      console.error("Failed to save before switching pages:", err);
    }
    router.push(`/dashboard/templates/${pageId}`);
  }

  function handleToggleAutoSave(): void {
    const newState = !autoSaveEnabled;
    setAutoSaveEnabled(newState);
    writeAutosave(window.localStorage, newState);
    void saveAutosaveToAccount(newState).catch(() => undefined);
    setAutoSaveNotification(newState ? "Autosave on" : "Autosave off");
    setTimeout(() => setAutoSaveNotification(null), 3000);
  }

  async function handleSave(): Promise<boolean> {
    if (!(isV2 ? v2Ref.current : builderRef.current)) {
      setSaveError("Builder is not ready yet.");
      return false;
    }
    setSaveError(null);
    setSaveMessage(null);
    setIsSaving(true);
    try {
      await flushSave();
      setSaveMessage("Draft saved.");
      setTimeout(() => setSaveMessage(null), 3000);
      return true;
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Unable to save template.",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  /** Publish: snapshots the current draft as a new immutable version and makes it the
   * live site (POST /api/templates/:id/publish — lib/templateVersions.ts). Flushes the
   * canvas's own latest edits into the draft first, same as switching pages does, so
   * Publish always goes live with whatever is on the canvas right now, not a stale
   * previously-autosaved draft. */
  async function handlePublish(opts?: { addressChecked?: boolean }): Promise<void> {
    // Coming back from checkout the editor may still be opening: give it a moment before calling it a failure.
    for (let waited = 0; !(isV2 ? v2Ref.current : builderRef.current) && waited < 10_000; waited += 100) await new Promise((r) => setTimeout(r, 100));
    if (!(isV2 ? v2Ref.current : builderRef.current)) {
      setPublishError("The editor is still opening. Try again in a moment.");
      throw new Error("The editor is still opening. Try again in a moment.");
    }
    setPublishError(null);
    setPublishGate(null);
    setPublishMessage(null);
    // No web address yet? Ask for it first (the same window as always), then go live straight after.
    let addressAsked = false;
    if (!opts?.addressChecked && templateKind === "LANDING_PAGE" && !templateParentId && !isBlogLayout) {
      try {
        const checkData = (await (await fetch(`/api/v1/domains?templateId=${templateId}`)).json()) as { domains?: unknown[]; baseDomain?: string; routingEndpoint?: string };
        if (checkData.domains && checkData.domains.length === 0) {
          if (checkData.baseDomain) setBaseDomain(checkData.baseDomain);
          if (checkData.routingEndpoint) setRoutingEndpoint(checkData.routingEndpoint);
          publishAfterAddress.current = true;
          setShowPublishModal(true);
          setHasAddress(false);
          // Saved as a draft meanwhile, so nothing is lost while they choose.
          await flushSave().catch(() => undefined);
          addressAsked = true;
        }
      } catch {
        // Couldn't check: publish as before.
      }
      // The window takes over; this call finishes when the page is live (resolved by the window) or the owner backs out (rejected).
      if (addressAsked) {
        pendingPublish.current?.reject(new Error("Publishing was restarted."));
        return new Promise<void>((resolve, reject) => { pendingPublish.current = { resolve, reject }; });
      }
    }
    setIsPublishing(true);
    try {
      const exported = await flushSave();
      const response = await fetch(`/api/templates/${templateId}/publish`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        const gate = parsePlanGate(payload);
        if (gate) setPublishGate(gate);
        throw new Error(gate ? "This page can't go live on your plan yet." : (payload.error ?? "Unable to publish template."));
      }
      liveDesignJsonRef.current = JSON.stringify(exported.json);
      setHasUnpublishedChanges(false);
      setHasAddress(true);
      setPublishMessage("Published — now live.");
      if (v3 && isV2) void fetch("/api/experience/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "publish" }), keepalive: true }).catch(() => undefined);
      setTimeout(() => setPublishMessage(null), 3000);
      router.refresh();

    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : "Unable to publish template.",
      );
      // The new editor's Save menu shows "couldn't publish" from this; the message above stays in the header too.
      throw error;
    } finally {
      setIsPublishing(false);
    }
  }

  // SUBDOMAIN/CUSTOM only — BUY has its own submission flow entirely (BuyDomainFlow calls
  // POST /api/v1/domains/purchase directly, not this handler).
  function handleModalPublish(e: React.FormEvent) {
    e.preventDefault();
    void submitModalPublish({});
  }

  /** Remember what the owner was publishing, so coming back from checkout finishes it. */
  function rememberPendingPublish(): void {
    const domain = modalDomainType === "SUBDOMAIN" ? modalSubdomainPrefix : modalCustomDomain;
    if (modalDomainType === "BUY" || !domain.trim()) return;
    try {
      localStorage.setItem(pendingPublishKey(templateId), serializePendingPublish({ templateId, domainType: modalDomainType, domain }));
    } catch {
      // Private mode etc.: they just press Publish again on the way back.
    }
  }

  async function submitModalPublish(opts: { replaceLive?: boolean; override?: { domainType: "SUBDOMAIN" | "CUSTOM"; domain: string } }) {
    setModalError(null);
    setModalSuccess(null);
    setModalCertValidation(null);
    setModalGate(null);

    const domainType = opts.override?.domainType ?? modalDomainType;
    const inputDomain = opts.override?.domain ?? (modalDomainType === "SUBDOMAIN" ? modalSubdomainPrefix : modalCustomDomain);
    if (domainType === "BUY") return;
    if (!inputDomain.trim()) {
      setModalError("Please enter a domain name.");
      return;
    }

    setModalIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          type: domainType,
          domain: inputDomain,
          ...(opts.replaceLive ? { replaceLive: true } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const gate = parsePlanGate(data);
        if (gate) {
          setModalGate({ ...gate, liveSiteNames: Array.isArray(data.liveSiteNames) ? data.liveSiteNames : undefined, canReplace: data.canReplaceLiveSite === true && domainType === "SUBDOMAIN" });
          return;
        }
        throw new Error(data.error ?? "Failed to publish domain.");
      }
      try {
        localStorage.removeItem(pendingPublishKey(templateId));
      } catch {
        // ignore
      }

      // Update local storage key domain mapping config to sync immediately
      try {
        const key = `plexo-published-domain-${templateId}`;
        localStorage.setItem(
          key,
          JSON.stringify({ domain: data.domain.domain, type: domainType }),
        );
      } catch (err) {
        console.warn(err);
      }

      // A CUSTOM domain isn't actually live yet — it needs the cert-validation CNAME
      // added too (app/api/internal/certificate-attachment finishes the rest
      // automatically once that record propagates). Surface it here instead of
      // closing the modal on a false "published!" — this was the modal's own real
      // gap: it never showed this record at all, so a customer using THIS flow (as
      // opposed to the fuller Domains dashboard drawer, which always has) had no way
      // to find out what to add.
      if (
        domainType === "CUSTOM" &&
        data.domain?.certificateValidationName &&
        data.domain?.certificateValidationValue
      ) {
        setModalCertValidation({
          name: data.domain.certificateValidationName,
          value: data.domain.certificateValidationValue,
        });
        setModalSuccess(
          "Domain added — add the DNS records below, then this finishes automatically.",
        );
      } else {
        setModalSuccess("Your web address is set. Publishing your page…");
        setHasAddress(true);
        if (publishAfterAddress.current) {
          publishAfterAddress.current = false;
          const waiting = pendingPublish.current;
          pendingPublish.current = null;
          try {
            await handlePublish({ addressChecked: true });
            waiting?.resolve();
            setModalSuccess("Your page is live!");
          } catch (e) {
            waiting?.reject(e instanceof Error ? e : new Error("Unable to publish."));
            setModalSuccess(null);
            setModalError(e instanceof Error ? e.message : "Unable to publish.");
            return; // stay on the window so the reason is visible
          }
        }
        setTimeout(() => {
          setShowPublishModal(false);
          setModalSuccess(null);
          setModalSubdomainPrefix("");
          setModalCustomDomain("");
        }, 2000);
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setModalIsSubmitting(false);
    }
  }

  // Back from checkout with a publish that was waiting on the upgrade: open the publish window and
  // finish it, so the owner never has to find their way back (?resume=publish, see lib/plan/planGate.ts).
  useEffect(() => {
    if (searchParams.get("resume") !== "publish") return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(pendingPublishKey(templateId));
    } catch {
      // ignore
    }
    const pending = readPendingPublish(raw, templateId);
    router.replace(`/dashboard/templates/${templateId}`);
    if (!pending) return;
    setShowPublishModal(true);
    setModalDomainType(pending.domainType);
    if (pending.domainType === "SUBDOMAIN") setModalSubdomainPrefix(pending.domain);
    else setModalCustomDomain(pending.domain);
    void fetch(`/api/v1/domains?templateId=${templateId}`).then((r) => r.json()).then((d: { baseDomain?: string; routingEndpoint?: string }) => {
      if (d.baseDomain) setBaseDomain(d.baseDomain);
      if (d.routingEndpoint) setRoutingEndpoint(d.routingEndpoint);
    }).catch(() => undefined);
    publishAfterAddress.current = true; // back from checkout: set the address and go live, no further clicks
    void submitModalPublish({ override: { domainType: pending.domainType, domain: pending.domain } });
    // Runs once on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headerRightNode = (
    <EditorHeaderRight
      modeSwitch={canConvertToCode && !isReadOnlyRole ? <BlockModeSwitch onPick={setConvertTo} /> : undefined}
      manyPages={templateKind === "LANDING_PAGE" && !isBlogLayout && !isReadOnlyRole && !(isV2 && !beginner) ? (
        <button type="button" onClick={() => setManyPagesOpen(true)} title="Ask SOL to change several pages in one go" style={isV2 ? undefined : { display: "inline-flex", alignItems: "center", gap: "0.4rem", minHeight: 40, padding: "0 0.8rem", borderRadius: 9, border: "1px solid var(--ed-w-100)", background: "transparent", color: "var(--ed-t-600)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          SOL on several pages
        </button>
      ) : undefined}
      compact={isV2}
      beginner={beginner && isV2}
      v3={v3 && isV2}
      saveFirst={() => handleSave().then(() => undefined)}
      saveMessage={saveMessage}
      saveError={saveError}
      subscriptionPlan={subscriptionPlan}
      isSaving={isSaving}
      onSave={() => setSaveDialogOpen(true)}
      hasUnpublishedChanges={hasUnpublishedChanges}
      isPublishing={isPublishing}
      publishMessage={publishMessage}
      publishError={publishError}
      onPublish={() => void handlePublish().catch(() => undefined)}
      commentsOpen={commentsOpen}
      onToggleComments={() => {
        setCommentsOpen((v) => !v);
        setPendingPin(null);
      }}
      autoSaveEnabled={autoSaveEnabled}
      onToggleAutoSave={handleToggleAutoSave}
      autoSaveNotification={autoSaveNotification}
      savedAt={savedAt}
    />
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {templateKind === "LANDING_PAGE" && !isBlogLayout && !isV2 && (
        <PagesPanel
          templateId={templateId}
          subscriptionPlan={subscriptionPlan}
          onNavigate={(pageId) => void handleNavigateToPage(pageId)}
        />
      )}
      {!isV2 && canTryNewEditor && !isReadOnlyRole && (
        <TryNewEditorBanner templateId={templateId} onTry={() => setTryOpen(true)} />
      )}
      {canConvertToCode && !isReadOnlyRole && <EditModeHint pageKey={templateId} blocks />}
      {convertTo && (
        <ConvertToCodeDialog
          templateId={templateId}
          templateName={templateName}
          target={convertTo}
          saveFirst={flushSave}
          onClose={() => setConvertTo(null)}
        />
      )}
      {tryOpen && (
        <TryNewEditorDialog
          templateId={templateId}
          templateName={templateName}
          slug={templateSlug}
          isHome={!templateParentId}
          getLatestDesign={async () => (await flushSave()).json}
          onClose={() => setTryOpen(false)}
        />
      )}
      {templateKind === "LANDING_PAGE" && !isBlogLayout && (
        <SitePlanNotice templateId={templateId} refreshKey={isPublishing} />
      )}
      {isBlogLayout && (
        <div
          style={{
            padding: "0.6rem 1rem",
            background: "color-mix(in srgb, var(--brand) 10%, transparent)",
            borderBottom: "1px solid color-mix(in srgb, var(--brand) 25%, transparent)",
            color: "var(--ed-lavender)",
            fontSize: "0.78rem",
            textAlign: "center",
          }}
        >
          Designing a custom blog layout — drag in the &quot;Blog&quot; blocks
          from the panel (Post Title, Post Content, Featured Image, Post Date,
          Post Author, Categories, Comments
          {"; or Post List for a listing layout"}) wherever you want your real
          content to appear. This template needs at least one{" "}
          <strong>Post Content</strong> (or <strong>Post List</strong>) block to
          go live.
        </div>
      )}
      {solOutOfCredits && (
        <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 60, width: "min(380px, calc(100vw - 32px))" }}>
          <SolOutOfCredits onDismiss={() => setSolOutOfCredits(false)} onToppedUp={() => setSolOutOfCredits(false)} />
        </div>
      )}
      <div style={{ flex: 1, overflow: "hidden", background: "var(--ed-bg)" }}>
        {isV2 && initialV2Design ? (
          <V2TemplateEditor
            ref={v2Ref}
            templateId={templateId}
            templateName={templateName}
            rootTemplateId={rootTemplateId}
            initialDesign={initialV2Design}
            focusNodeId={focusNodeId}
            readOnly={isReadOnlyRole}
            commentMode={commentsOpen}
            onRequestComment={(target) => {
              setPendingPin(target);
              setCommentsOpen(true);
            }}
            stockKeys={{ unsplash: unsplashKey, pexels: pexelsKey, pixabay: pixabayKey }}
            kind={templateKind}
            headerRight={headerRightNode}
            beginner={beginner}
            onPublish={() => handlePublish()}
            hasAddress={hasAddress ?? undefined}
            initialAutosave={initialAutosave}
            onAskSolManyPages={templateKind === "LANDING_PAGE" && !isBlogLayout ? () => setManyPagesOpen(true) : undefined}
            savePaused={isPublishing || manyPagesOpen || reloading}
            onBack={() => router.push(exitHref)}
            onOutOfCredits={() => setSolOutOfCredits(true)}
            onSaved={() => {
              setSaveError(null);
              setSavedAt(Date.now());
              setHasUnpublishedChanges(true);
            }}
            canGoBack={canGoBackToClassic}
          />
        ) : (
        <PlexoBuilder
          ref={builderRef}
          apiKey="workspace-internal"
          // From a Site health link: the classic editor selects and scrolls to the element (SDK 2.0.34+; older versions ignore it).
          {...(focusNodeId ? { focusNodeId } : {})}
          onAiCreditsExhausted={() => setSolOutOfCredits(true)}
          mode={isEmail ? "email" : "landing_page"}
          mergeTags={isEmail ? editorMergeTags() : undefined}
          isBlogLayout={isBlogLayout}
          commerceEnabled={commerceEnabled}
          maildripConnected={maildripConnected}
          onMaildripAuth={isEmail ? undefined : handleMaildripAuth}
          initialTemplate={initialDesignJson}
          backgroundColor={v3 ? editorColors?.surface : "#0b1526"}
          themeBgColor={v3 ? editorColors?.accent : "var(--brand)"}
          themeFgColor={v3 ? editorColors?.onAccent : "#ffffff"}
          textColor={v3 ? editorColors?.text : "#ecfeff"}
          showSaveButton={false}
          autoSave={autoSaveEnabled}
          autoSaveDuration={6000}
          onSave={handleAutoSave}
          onCreateMaildripOptInPage={
            isEmail ? undefined : handleCreateMaildripOptInPage
          }
          useAi={useAi}
          aiProvider={aiProvider}
          aiTier={aiTier}
          allowPublishLandingPage={
            templateKind === "LANDING_PAGE" && !isBlogLayout
          }
          templateId={templateId}
          unsplashKey={unsplashKey}
          pexelsKey={pexelsKey}
          pixabayKey={pixabayKey}
          readOnly={isReadOnlyRole}
          // commentMode only gates the separate "click anywhere on the canvas" behavior.
          // onRequestComment is always live so the selected-element toolbar's own Comment
          // button (see plexo-sdk's SortableElement.tsx) works regardless of whether the
          // Comments panel toggle is on — clicking it opens the panel automatically.
          commentMode={commentsOpen}
          onRequestComment={(target) => {
            setPendingPin(target);
            setCommentsOpen(true);
          }}
          headerLeftContent={
            <EditorHeaderLeft
              isEmail={isEmail}
              templateName={templateName}
              backLabel={isEmail ? "Emails" : v3 ? "My site" : "Details"}
              onBack={() => {
                // The Detail page is server-rendered fresh on every navigation, so a
                // just-saved edit is never stale there the way the old flat Templates
                // list needed a forced refresh to avoid.
                router.push(exitHref);
              }}
            />
          }
          headerRightContent={headerRightNode}
          {...({ __internalPlan: subscriptionPlan } as any)}
        />
        )}

        <CommentLayer
          builderRef={(isV2 ? v2Ref : builderRef) as React.RefObject<NodeRectSource | null>}
          templateId={templateId}
          organizationId={organizationId}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          active={commentsOpen}
          pendingPin={pendingPin}
          onConsumePendingPin={() => setPendingPin(null)}
          onClose={() => setCommentsOpen(false)}
          deepLinkCommentId={searchParams.get("comment")}
        />
      </div>

      {manyPagesOpen && (
        <MultiPageSolDialog
          siteId={rootTemplateId ?? templateId}
          currentPageId={templateId}
          beforeRun={() => flushSave()}
          onChanged={() => { manyPagesChanged.current = true; }}
          onClose={() => {
            setManyPagesOpen(false);
            // SOL changed pages behind the open canvas: reload so what's on screen is what was saved (and autosave can't overwrite it).
            if (manyPagesChanged.current) {
              setReloading(true); // keeps the editor's Autosave paused until the page has reloaded
              window.location.reload();
            }
          }}
        />
      )}
      {saveDialogOpen && (
        <SaveChoiceDialog
          busy={saveBusy}
          canPublish={!isReadOnlyRole}
          error={saveError ?? publishError}
          onClose={() => setSaveDialogOpen(false)}
          onDraft={() => {
            setSaveBusy("draft");
            void handleSave().then((ok) => { if (ok) { setSaveDialogOpen(false); router.push(exitHref); } }).finally(() => setSaveBusy(null));
          }}
          onPublish={() => {
            setSaveBusy("publish");
            handlePublish()
              .then(() => setSaveDialogOpen(false))
              .catch(() => {
                // No web address yet: the address window is now open, so step aside for it.
                if (publishAfterAddress.current) setSaveDialogOpen(false);
              })
              .finally(() => setSaveBusy(null));
          }}
        />
      )}
      {publishGate && (
        <div style={{ position: "fixed", inset: 0, background: "var(--ed-scrim)", zIndex: 100, display: "grid", placeItems: "center", padding: "1rem" }}>
          <div style={{ background: "var(--ed-panel)", border: "1px solid var(--ed-w-080)", borderRadius: 16, width: "100%", maxWidth: 460, padding: "1.5rem", boxShadow: "0 20px 50px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "var(--ed-text)", fontFamily: "var(--font-heading)" }}>This page can&apos;t go live yet</h2>
            <UpgradePrompt message={publishGate.message} requiredPlan={publishGate.requiredPlan} returnTo={`/dashboard/templates/${templateId}`} />
            <button type="button" className="btn-secondary" style={{ padding: "0.55rem" }} onClick={() => setPublishGate(null)}>Skip for now</button>
          </div>
        </div>
      )}

      {/* ── Publish Modal Popup ──────────────────── */}
      {showPublishModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "var(--ed-scrim)",
            zIndex: 100,
            display: "grid",
            placeItems: "center",
            backdropFilter: "blur(8px)",
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <div
            style={{
              background: "var(--ed-panel)",
              border: "1px solid var(--ed-w-080)",
              borderRadius: 16,
              width: "90%",
              maxWidth: 480,
              maxHeight: "85vh",
              overflowY: "auto",
              padding: "1.75rem",
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1.25rem",
              }}
            >
              <h2
                style={{
                  fontSize: "1.2rem",
                  fontWeight: 800,
                  color: "var(--ed-text)",
                  fontFamily: "var(--font-heading)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                <IconRocket /> Publish Landing Page
              </h2>
              <button
                onClick={closePublishModal}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ed-t-400)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <IconClose />
              </button>
            </div>

            <p
              style={{
                fontSize: "0.82rem",
                color: "var(--ed-t-600)",
                lineHeight: 1.5,
                marginBottom: "1.25rem",
              }}
            >
              Your changes have been saved! Would you like to publish this
              landing page to a subdomain or custom domain?
            </p>

            <div
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              {/* Type Switch */}
              <div
                style={{
                  display: "flex",
                  background: "var(--ed-w-040)",
                  padding: 3,
                  borderRadius: 8,
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => setModalDomainType("SUBDOMAIN")}
                  style={{
                    flex: 1,
                    padding: "0.35rem",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 6,
                    background:
                      modalDomainType === "SUBDOMAIN"
                        ? "var(--brand)"
                        : "transparent",
                    color:
                      modalDomainType === "SUBDOMAIN"
                        ? "var(--ed-on-brand)"
                        : "var(--ed-t-550)",
                    transition: "all 0.15s",
                  }}
                >
                  Subdomain
                </button>
                <button
                  type="button"
                  onClick={() => setModalDomainType("CUSTOM")}
                  style={{
                    flex: 1,
                    padding: "0.35rem",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 6,
                    background:
                      modalDomainType === "CUSTOM"
                        ? "var(--brand)"
                        : "transparent",
                    color:
                      modalDomainType === "CUSTOM"
                        ? "var(--ed-on-brand)"
                        : "var(--ed-t-550)",
                    transition: "all 0.15s",
                  }}
                >
                  Custom Domain
                </button>
                <button
                  type="button"
                  onClick={() => setModalDomainType("BUY")}
                  style={{
                    flex: 1,
                    padding: "0.35rem",
                    fontSize: "0.78rem",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 6,
                    whiteSpace: "nowrap",
                    background:
                      modalDomainType === "BUY"
                        ? "var(--brand)"
                        : "transparent",
                    color:
                      modalDomainType === "BUY"
                        ? "var(--ed-on-brand)"
                        : "var(--ed-t-550)",
                    transition: "all 0.15s",
                  }}
                >
                  Buy a Domain
                </button>
              </div>

              {modalDomainType === "BUY" ? (
                <BuyDomainFlow
                  templateId={templateId}
                  resumedPurchase={null}
                  onPurchased={() => setShowPublishModal(false)}
                />
              ) : (
                <form
                  onSubmit={handleModalPublish}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "1rem",
                  }}
                >
                  {/* Inputs */}
                  {modalDomainType === "SUBDOMAIN" ? (
                    <div>
                      <label
                        htmlFor="modal-subdomain"
                        style={{
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          color: "var(--ed-t-650)",
                        }}
                      >
                        Configure Subdomain
                      </label>
                      <div style={{ display: "flex", marginTop: "0.35rem" }}>
                        <input
                          id="modal-subdomain"
                          type="text"
                          placeholder="my-landing-page"
                          value={modalSubdomainPrefix}
                          onChange={(e) =>
                            setModalSubdomainPrefix(
                              e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9-]/g, ""),
                            )
                          }
                          className="field-input"
                          style={{
                            borderTopRightRadius: 0,
                            borderBottomRightRadius: 0,
                            flex: 1,
                          }}
                        />
                        <span
                          style={{
                            background: "var(--ed-w-040)",
                            border: "1px solid var(--ed-w-080)",
                            borderLeft: "none",
                            borderTopRightRadius: 8,
                            borderBottomRightRadius: 8,
                            display: "flex",
                            alignItems: "center",
                            padding: "0 0.65rem",
                            fontSize: "0.75rem",
                            color: "var(--ed-t-450)",
                            fontWeight: 550,
                          }}
                        >
                          .
                          {baseDomain === "localhost"
                            ? "localhost"
                            : baseDomain}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label
                        htmlFor="modal-custom"
                        style={{
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          color: "var(--ed-t-650)",
                        }}
                      >
                        Custom Domain Name
                      </label>
                      <input
                        id="modal-custom"
                        type="text"
                        placeholder="landing.mybrand.com"
                        value={modalCustomDomain}
                        onChange={(e) =>
                          setModalCustomDomain(
                            e.target.value.toLowerCase().trim(),
                          )
                        }
                        className="field-input"
                        style={{ marginTop: "0.35rem" }}
                      />
                      <div
                        style={{
                          marginTop: "0.6rem",
                          padding: "0.6rem",
                          background: "color-mix(in srgb, var(--brand) 4%, transparent)",
                          border: "1px solid color-mix(in srgb, var(--brand) 12%, transparent)",
                          borderRadius: 8,
                          fontSize: "0.72rem",
                          color: "var(--ed-t-650)",
                          lineHeight: 1.35,
                        }}
                      >
                        Configure a CNAME record mapping your domain to{" "}
                        <code style={{ color: "var(--ed-accent-text)" }}>
                          {routingEndpoint ?? "connecting…"}
                        </code>
                        .
                      </div>
                      {modalCertValidation && (
                        <div
                          style={{
                            marginTop: "0.5rem",
                            padding: "0.6rem",
                            background: "color-mix(in srgb, var(--ed-success) 5%, transparent)",
                            border: "1px solid color-mix(in srgb, var(--ed-success) 20%, transparent)",
                            borderRadius: 8,
                            fontSize: "0.72rem",
                            color: "var(--ed-t-650)",
                            lineHeight: 1.35,
                          }}
                        >
                          Also add this certificate-validation CNAME — it proves
                          you own the domain:
                          <div
                            style={{
                              fontFamily: "monospace",
                              fontSize: "0.68rem",
                              color: "var(--ed-success)",
                              marginTop: "0.3rem",
                              wordBreak: "break-all",
                            }}
                          >
                            {modalCertValidation.name} &rarr;{" "}
                            {modalCertValidation.value}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {modalError && (
                    <p
                      style={{
                        fontSize: "0.78rem",
                        color: "var(--ed-danger)",
                        margin: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                      }}
                    >
                      <IconWarning /> {modalError}
                    </p>
                  )}

                  {modalSuccess && (
                    <p
                      style={{
                        fontSize: "0.78rem",
                        color: "var(--ed-success)",
                        margin: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                      }}
                    >
                      <IconCheck /> {modalSuccess}
                    </p>
                  )}

                  {modalGate ? (
                    <PublishBlockedPanel
                      gate={modalGate}
                      returnTo={publishReturnPath(templateId)}
                      busy={modalIsSubmitting}
                      onBeforeUpgrade={rememberPendingPublish}
                      onReplace={() => void submitModalPublish({ replaceLive: true })}
                      onUseFreeAddress={() => {
                        setModalGate(null);
                        setModalDomainType("SUBDOMAIN");
                      }}
                      onSkip={() => {
                        setModalGate(null);
                        closePublishModal();
                      }}
                    />
                  ) : (
                  <div
                    style={{
                      display: "flex",
                      gap: "0.6rem",
                      marginTop: "0.5rem",
                    }}
                  >
                    <button
                      type="button"
                      onClick={closePublishModal}
                      className="btn-secondary"
                      style={{ flex: 1, padding: "0.6rem" }}
                    >
                      Skip for now
                    </button>
                    <button
                      type="submit"
                      disabled={modalIsSubmitting}
                      className="btn-primary"
                      style={{
                        flex: 1,
                        padding: "0.6rem",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "0.4rem",
                      }}
                    >
                      {modalIsSubmitting && (
                        <span
                          className="spinner"
                          style={{ width: 11, height: 11 }}
                        />
                      )}
                      {modalIsSubmitting ? "Publishing…" : "Publish Live"}
                    </button>
                  </div>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


