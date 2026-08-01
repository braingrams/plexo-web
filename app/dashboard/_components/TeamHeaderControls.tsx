"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { authClient } from "@/lib/auth-client";

const DROPDOWN_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 0.6rem)",
  right: 0,
  width: 280,
  background: "rgba(13,15,26,0.98)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 14,
  boxShadow: "0 24px 60px -12px rgba(0,0,0,0.6)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  padding: "0.5rem",
  zIndex: 60,
};

function useOutsideClick(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

export function OrgSwitcher({ organizationName }: { organizationName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[] | null>(null);
  const ref = useOutsideClick(() => setOpen(false));

  useEffect(() => {
    if (!open || orgs) return;
    authClient.organization.list().then((res: any) => {
      if (res?.error) {
        console.error("Failed to list organizations:", res.error);
        setOrgs([]);
        return;
      }
      const list = res?.data ?? [];
      setOrgs(Array.isArray(list) ? list.map((o: any) => ({ id: o.id, name: o.name })) : []);
    }).catch(() => setOrgs([]));
  }, [open, orgs]);

  async function switchTo(organizationId: string) {
    const res: any = await authClient.organization.setActive({ organizationId });
    if (res?.error) {
      console.error("Failed to switch organizations:", res.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
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

      {open && (
        <div style={DROPDOWN_STYLE}>
          <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.4)", padding: "0.4rem 0.6rem" }}>
            Switch organization
          </p>
          {orgs === null && (
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", padding: "0.4rem 0.6rem" }}>Loading…</p>
          )}
          {orgs?.map((org) => (
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
        </div>
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

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const ref = useOutsideClick(() => setOpen(false));

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
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
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

      {open && (
        <div style={{ ...DROPDOWN_STYLE, width: 320, maxHeight: 360, overflowY: "auto" }}>
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
        </div>
      )}
    </div>
  );
}
