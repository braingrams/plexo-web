"use client";

import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { PlexoBuilderRef, CommentTarget } from "@charisol/plexo-sdk";

import { useComments } from "./useComments";
import { CommentPanel } from "./CommentPanel";
import { MentionComposer } from "./MentionComposer";

type Pin = { id: string; x: number; y: number };

/**
 * Renders positioned pin markers for every top-level anchored comment, using
 * PlexoBuilderRef.getNodeRect (see plexo-sdk's playground.interfaces.ts) to resolve each
 * node's current on-screen position. Recomputed on scroll/resize plus a light interval,
 * since device-view toggles and drag-reorders inside the canvas don't fire either event.
 */
function useCommentPins(
  builderRef: RefObject<PlexoBuilderRef | null>,
  anchors: { id: string; anchorNodeId: string | null; anchorX: number | null; anchorY: number | null }[],
  active: boolean,
) {
  const [pins, setPins] = useState<Pin[]>([]);

  useEffect(() => {
    if (!active) {
      setPins([]);
      return;
    }

    function recompute() {
      const builder = builderRef.current;
      if (!builder) return;
      const next: Pin[] = [];
      for (const a of anchors) {
        if (!a.anchorNodeId) continue;
        const rect = builder.getNodeRect(a.anchorNodeId);
        if (!rect) continue;
        next.push({
          id: a.id,
          x: rect.left + rect.width * (a.anchorX ?? 0.5),
          y: rect.top + rect.height * (a.anchorY ?? 0.5),
        });
      }
      setPins(next);
    }

    recompute();
    const interval = setInterval(recompute, 400);
    window.addEventListener("resize", recompute);
    document.addEventListener("scroll", recompute, { capture: true, passive: true });
    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", recompute);
      document.removeEventListener("scroll", recompute, { capture: true });
    };
    // anchors is derived fresh each render from `comments`; stringify the bit that
    // actually affects positions so this effect doesn't re-subscribe on every comment
    // body edit/reply, only when the anchor set itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, JSON.stringify(anchors), builderRef]);

  return pins;
}

export function CommentLayer({
  builderRef,
  templateId,
  organizationId,
  currentUserId,
  currentUserRole,
  active,
  pendingPin,
  onConsumePendingPin,
  onClose,
  deepLinkCommentId,
}: {
  builderRef: RefObject<PlexoBuilderRef | null>;
  templateId: string;
  organizationId: string;
  currentUserId: string;
  currentUserRole: string;
  active: boolean;
  pendingPin: CommentTarget | null;
  onConsumePendingPin: () => void;
  onClose: () => void;
  deepLinkCommentId?: string | null;
}) {
  const { comments, create, resolve, remove } = useComments(templateId, organizationId);
  const [highlightedId, setHighlightedId] = useState<string | null>(deepLinkCommentId ?? null);

  const topLevelAnchors = useMemo(
    () =>
      comments
        .filter((c) => !c.parentId && !c.deleted && !c.resolved)
        .map((c) => ({ id: c.id, anchorNodeId: c.anchorNodeId, anchorX: c.anchorX, anchorY: c.anchorY })),
    [comments],
  );
  const pins = useCommentPins(builderRef, topLevelAnchors, active);

  useEffect(() => {
    if (!deepLinkCommentId) return;
    const el = document.getElementById(`comment-thread-${deepLinkCommentId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [deepLinkCommentId, comments.length]);

  if (!active) return null;

  return (
    <>
      {pins.map((pin, index) => (
        <button
          key={pin.id}
          onClick={() => {
            setHighlightedId(pin.id);
            document.getElementById(`comment-thread-${pin.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          title="View comment"
          style={{
            position: "fixed", left: pin.x - 12, top: pin.y - 12, width: 24, height: 24,
            borderRadius: "50% 50% 50% 0", transform: "rotate(45deg)",
            background: highlightedId === pin.id ? "#ec4899" : "var(--brand)",
            border: "2px solid #0b0f19", cursor: "pointer", zIndex: 70,
            display: "grid", placeItems: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <span style={{ transform: "rotate(-45deg)", fontSize: "0.6rem", fontWeight: 800, color: "#fff" }}>
            {index + 1}
          </span>
        </button>
      ))}

      {pendingPin && (
        <div
          style={{
            position: "fixed",
            left: Math.min(pendingPin.clientX, window.innerWidth - 300),
            top: Math.min(pendingPin.clientY, window.innerHeight - 200),
            width: 280, zIndex: 95, background: "rgba(13,15,26,0.98)",
            border: "1px solid rgba(139,92,246,0.4)", borderRadius: 12,
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)", padding: "0.75rem",
          }}
        >
          <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)", marginBottom: "0.5rem" }}>
            New comment on this {pendingPin.nodeType}
          </p>
          <MentionComposer
            placeholder="Leave a comment… use @ to mention a teammate"
            autoFocus
            onCancel={onConsumePendingPin}
            onSubmit={async (body) => {
              await create({
                body,
                anchorNodeId: pendingPin.nodeId,
                anchorNodeType: pendingPin.nodeType,
                anchorX: 0.5,
                anchorY: 0.5,
              });
              onConsumePendingPin();
            }}
          />
        </div>
      )}

      <CommentPanel
        comments={comments}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        highlightedId={highlightedId}
        onResolve={resolve}
        onRemove={remove}
        onReply={async (parentId, body) => {
          await create({ body, parentId });
        }}
        onClose={onClose}
      />
    </>
  );
}
