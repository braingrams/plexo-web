"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { C } from "./ui";

// Where the SOL chat lives in the app editor. On most tabs it's docked beside the app. While
// Design or Code is open the app gets the whole width and the chat becomes a drawer that slides
// over the left edge — still one click away, and opened for the owner whenever SOL starts working.
// It is always the same element (placement is CSS only), so the conversation never remounts:
// scroll position, a half-typed message and a streaming answer all survive opening and closing.

/**
 * State for the drawer. `overlay` is true while the chat should be a drawer (Design or Code open).
 * Leaving those views closes it, and Esc closes it while it's open.
 */
export function useChatDrawer(overlay: boolean) {
  const [open, setOpen] = useState(false);
  // Something new arrived while the drawer was closed.
  const [unread, setUnread] = useState(false);
  const openRef = useRef(false);
  openRef.current = overlay && open;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;

  useEffect(() => {
    if (!overlay) setOpen(false);
  }, [overlay]);

  useEffect(() => {
    if (!overlay || !open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay, open]);

  const openDrawer = useCallback(() => {
    if (!overlayRef.current) return;
    setOpen(true);
    setUnread(false);
  }, []);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const toggleDrawer = useCallback(() => {
    if (openRef.current) setOpen(false);
    else openDrawer();
  }, [openDrawer]);
  /** Call when SOL finishes a turn: flags it if the owner isn't looking at the chat. */
  const noteArrival = useCallback(() => {
    if (overlayRef.current && !openRef.current) setUnread(true);
  }, []);

  return { open: overlay && open, unread, openDrawer, closeDrawer, toggleDrawer, noteArrival };
}

/** A small dot on a "Chat with SOL" button: pulsing while SOL works, still when there's an answer waiting. */
export function ChatDot({ working, unread }: { working: boolean; unread: boolean }) {
  if (!working && !unread) return null;
  return (
    <span
      aria-label={working ? "SOL is working" : "New message from SOL"}
      className={working ? "ed-dot ed-dot-working" : "ed-dot"}
      style={{ width: 8, height: 8, borderRadius: 99, background: working ? C.brand : C.success, flexShrink: 0 }}
    />
  );
}

export function ChatDock(props: { overlay: boolean; open: boolean; mobileActive: boolean; onClose: () => void; children: ReactNode }) {
  const { overlay, open } = props;
  return (
    <aside
      className={`ed-chat ${props.mobileActive ? "is-active" : ""} ${overlay ? "is-overlay" : ""} ${overlay && open ? "is-open" : ""}`}
      aria-label="Chat with SOL"
      data-placement={overlay ? (open ? "drawer-open" : "drawer-closed") : "docked"}
    >
      {overlay && (
        <div className="ed-chat-bar">
          <span>Chat with SOL</span>
          <button type="button" onClick={props.onClose} aria-label="Close chat" title="Close chat (Esc)">
            <X size={16} />
          </button>
        </div>
      )}
      {props.children}
      <style>{`
        .ed-chat { width: 420px; flex-shrink: 0; border-right: 1px solid ${C.border}; min-height: 0; display: flex; flex-direction: column; }
        .ed-chat-bar { display: flex; align-items: center; justify-content: space-between; padding: 0.55rem 0.8rem 0.55rem 1.2rem; border-bottom: 1px solid ${C.border}; font-size: 0.82rem; font-weight: 700; }
        .ed-chat-bar button { display: inline-flex; padding: 0.3rem; border-radius: 8px; border: none; background: transparent; color: ${C.muted}; cursor: pointer; }
        .ed-chat-bar button:hover { background: rgba(255,255,255,0.08); color: ${C.text}; }
        .ed-chat.is-overlay { position: absolute; top: 0; bottom: 0; left: 0; z-index: 40; width: min(420px, 92%); background: ${C.bg}; box-shadow: 18px 0 50px -18px rgba(0,0,0,0.65); transform: translateX(-104%); visibility: hidden; transition: transform 0.2s ease, visibility 0s linear 0.2s; }
        .ed-chat.is-overlay.is-open { transform: none; visibility: visible; transition: transform 0.2s ease; }
        .ed-dot-working { animation: ed-pulse 1.3s ease-in-out infinite; }
        @media (max-width: 900px) {
          .ed-chat.is-overlay { position: static !important; transform: none !important; visibility: visible !important; box-shadow: none !important; }
          .ed-chat-bar { display: none !important; }
        }
        @media (prefers-reduced-motion: reduce) { .ed-chat.is-overlay, .ed-dot-working { transition: none; animation: none; } }
      `}</style>
    </aside>
  );
}
