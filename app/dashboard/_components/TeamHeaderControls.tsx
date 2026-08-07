"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { authClient } from "@/lib/auth-client";

/** Visual chrome shared by every header dropdown — positioning is applied separately
 * (see useAnchoredDropdown) since these are portaled to <body>, not absolutely
 * positioned relative to their trigger. */
function dropdownLookStyle(width: number): React.CSSProperties {
  return {
    width,
    background: "rgba(13,15,26,0.98)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 14,
    boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    padding: "0.5rem",
  };
}

/**
 * Positions a dropdown via a portal to document.body instead of `position: absolute`
 * inside the trigger. The classic sidebar clips overflow (`overflow: hidden`) and also
 * sets `backdrop-filter` on the sidebar itself, which creates a new containing block for
 * `position: fixed` descendants too — so nothing short of a portal actually escapes it;
 * a dropdown positioned relative to a sidebar trigger would get clipped at the sidebar's
 * own edge no matter which CSS position mode it used.
 *
 * `anchor` picks which side of the trigger the popup hangs from. "right" suits triggers
 * near the right edge of the screen with room to spare on their left (the modern shell's
 * top-right topbar). "left" suits Classic's sidebar triggers, which sit near the left
 * edge with a narrow sidebar and the whole rest of the viewport to their right.
 */
type DropdownCoords = { top?: number; bottom?: number; left?: number; right?: number };

function coordsEqual(a: DropdownCoords | null, b: DropdownCoords): boolean {
  return !!a && a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

function useAnchoredDropdown(anchor: "left" | "right") {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<DropdownCoords | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Decides above-vs-below using the popover's actual rendered height once it has one
  // (0 on the very first call, right when it opens, before anything's painted — that's
  // fine, it just means this defaults to "below" until the layout effect below remeasures
  // against real content).
  const computeCoords = useCallback((): DropdownCoords | null => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const horizontal = anchor === "left" ? { left: rect.left } : { right: window.innerWidth - rect.right };
    const popoverHeight = popoverRef.current?.getBoundingClientRect().height ?? 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = popoverHeight > 0 && spaceBelow < popoverHeight + 16 && spaceAbove > spaceBelow;
    return flipUp
      ? { bottom: window.innerHeight - rect.top + 10, ...horizontal }
      : { top: rect.bottom + 10, ...horizontal };
  }, [anchor]);

  useEffect(() => {
    if (!open) return;
    setCoords(computeCoords());
    function handle() {
      setCoords(computeCoords());
    }
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);
    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, computeCoords]);

  // Runs once the popover is actually in the DOM (after the effect above sets an initial
  // "below" guess) so it can remeasure against real content and flip above the trigger if
  // it doesn't fit — settles after one extra pass since the flip decision, and therefore
  // `coords`, stops changing once it's already correct.
  useLayoutEffect(() => {
    if (!open) return;
    const next = computeCoords();
    if (next) setCoords((prev) => (coordsEqual(prev, next) ? prev : next));
  }, [open, coords, computeCoords]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return { open, setOpen, triggerRef, popoverRef, coords };
}

/**
 * Shared org-list fetch/switch logic behind both the standalone OrgSwitcher pill (classic
 * shell's sidebar) and the modern shell's avatar-dropdown-embedded switcher — factored out so
 * the modern shell doesn't need a nested dropdown-inside-a-dropdown just to reuse this.
 */
export function useOrgList() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);

  function load() {
    if (loaded) return;
    authClient.organization.list().then((res: any) => {
      setLoaded(true);
      if (res?.error) {
        console.error("Failed to list organizations:", res.error);
        setOrgs([]);
        return;
      }
      const list = res?.data ?? [];
      setOrgs(Array.isArray(list) ? list.map((o: any) => ({ id: o.id, name: o.name })) : []);
    }).catch(() => {
      setLoaded(true);
      setOrgs([]);
    });
  }

  async function switchTo(organizationId: string) {
    const res: any = await authClient.organization.setActive({ organizationId });
    if (res?.error) {
      console.error("Failed to switch organizations:", res.error);
      return;
    }
    router.refresh();
  }

  return { orgs, loaded, load, switchTo };
}

export function OrgSwitcher({ organizationName, anchor = "right" }: { organizationName: string; anchor?: "left" | "right" }) {
  const { orgs, loaded, load, switchTo: switchToOrg } = useOrgList();
  const { open, setOpen, triggerRef, popoverRef, coords } = useAnchoredDropdown(anchor);

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function switchTo(organizationId: string) {
    await switchToOrg(organizationId);
    setOpen(false);
  }

  return (
    <div ref={triggerRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: "0.4rem",
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 999, padding: "0.35rem 0.75rem", cursor: "pointer",
          color: "#f0f2ff", fontSize: "0.78rem", fontWeight: 600,
          maxWidth: 160, overflow: "hidden",
        }}
      >
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{organizationName}</span>
        <span style={{ opacity: 0.5, fontSize: "0.65rem" }}>▾</span>
      </button>

      {open && coords && createPortal(
        <div ref={popoverRef} style={{ position: "fixed", zIndex: 1000, ...coords, ...dropdownLookStyle(280) }}>
          <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.4)", padding: "0.4rem 0.6rem" }}>
            Switch organization
          </p>
          {!loaded && (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", padding: "0.4rem 0.6rem" }}>Loading…</p>
          )}
          {orgs.map((org) => (
            <button
              key={org.id}
              onClick={() => switchTo(org.id)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "0.55rem 0.6rem", borderRadius: 10, border: "none",
                background: org.name === organizationName ? "var(--brand-subtle)" : "transparent",
                color: "#f0f2ff", fontSize: "0.82rem", cursor: "pointer",
              }}
            >
              {org.name}
            </button>
          ))}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", margin: "0.4rem 0" }} />
          <Link
            href="/dashboard/settings/team"
            onClick={() => setOpen(false)}
            style={{
              display: "block", padding: "0.55rem 0.6rem", borderRadius: 10,
              color: "var(--brand)", fontSize: "0.82rem", textDecoration: "none", fontWeight: 600,
            }}
          >
            Manage team →
          </Link>
        </div>,
        document.body,
      )}
    </div>
  );
}

type NotificationItem = {
  id: string;
  type: string;
  actorName: string | null;
  commentId: string | null;
  templateId: string | null;
  readAt: string | null;
  createdAt: string;
};

const NOTIFICATION_LABEL: Record<string, string> = {
  MENTION: "mentioned you in a comment",
  COMMENT_REPLY: "replied to a comment",
  COMMENT_RESOLVED: "resolved a comment",
  INVITE_ACCEPTED: "accepted your invite",
};

export function NotificationBell({ anchor = "right" }: { anchor?: "left" | "right" } = {}) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const { open, setOpen, triggerRef, popoverRef, coords } = useAnchoredDropdown(anchor);

  async function load() {
    const res = await fetch("/api/v1/notifications").then((r) => r.json()).catch(() => null);
    if (res) {
      setItems(res.notifications ?? []);
      setUnreadCount(res.unreadCount ?? 0);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  async function handleOpen(item: NotificationItem) {
    setOpen(false);
    if (!item.readAt) {
      fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      }).catch(() => {});
    }
    if (item.templateId) {
      const suffix = item.commentId ? `?comment=${item.commentId}` : "";
      router.push(`/dashboard/templates/${item.templateId}${suffix}`);
    }
  }

  async function markAllRead() {
    await fetch("/api/v1/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    }).catch(() => {});
    load();
  }

  return (
    <div ref={triggerRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        style={{
          position: "relative", background: "none", border: "none", cursor: "pointer",
          color: "#f0f2ff", padding: "0.4rem", borderRadius: 8, display: "flex", alignItems: "center",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 2, right: 2, minWidth: 15, height: 15, borderRadius: 999,
            background: "#ef4444", color: "#fff", fontSize: "0.6rem", fontWeight: 700,
            display: "grid", placeItems: "center", padding: "0 3px",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && coords && createPortal(
        <div
          ref={popoverRef}
          style={{ position: "fixed", zIndex: 1000, maxHeight: 360, overflowY: "auto", ...coords, ...dropdownLookStyle(320) }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.3rem 0.6rem 0.5rem" }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f0f2ff" }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{ background: "none", border: "none", color: "var(--brand)", fontSize: "0.72rem", cursor: "pointer" }}
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 && (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.4)", padding: "0.8rem 0.6rem", textAlign: "center" }}>
              You're all caught up.
            </p>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => handleOpen(item)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "0.6rem", borderRadius: 10, border: "none", marginBottom: 2,
                background: item.readAt ? "transparent" : "rgba(139,92,246,0.08)",
                color: "#f0f2ff", fontSize: "0.8rem", cursor: "pointer",
              }}
            >
              <strong>{item.actorName ?? "Someone"}</strong>{" "}
              <span style={{ color: "rgba(240,242,255,0.6)" }}>
                {NOTIFICATION_LABEL[item.type] ?? "sent you a notification"}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
