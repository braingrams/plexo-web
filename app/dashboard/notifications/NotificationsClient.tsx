"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Bell,
  CheckCheck,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Play,
  Settings,
  ShoppingBag,
  Volume2,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from "../_v3/ui";
import { playNotificationSound, SOUND_OPTIONS, type SoundChoice } from "@/lib/notifications/audioSynthesizer";
import type { AppNotification } from "@/app/api/v1/notifications/route";

export function NotificationsClient() {
  const { show } = useToast();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [soundChoice, setSoundChoice] = useState<SoundChoice>("chime");

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/v1/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      if (data.settings) {
        setInAppEnabled(data.settings.inAppNotifications ?? true);
        setSoundEnabled(data.settings.inAppSound ?? true);
        if (data.settings.soundChoice) setSoundChoice(data.settings.soundChoice);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const markAsRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    void fetch("/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", notificationId: id }),
    });
  };

  const markAllAsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read_all" }),
    });
    show({ title: "All notifications marked as read", tone: "success" });
  };

  const saveSettings = async (inApp: boolean, sound: boolean, choice: SoundChoice) => {
    setInAppEnabled(inApp);
    setSoundEnabled(sound);
    setSoundChoice(choice);
    try {
      await fetch("/api/v1/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          settings: { inAppNotifications: inApp, inAppSound: sound, soundChoice: choice },
        }),
      });
      show({ title: "Preferences saved", tone: "success" });
    } catch {
      show({ title: "Failed to save preferences", tone: "danger" });
    }
  };

  const filtered = notifications.filter((n) => (filter === "unread" ? !n.read : true));
  const unreadCount = notifications.filter((n) => !n.read).length;

  const getIcon = (type: AppNotification["type"]) => {
    switch (type) {
      case "TRANSFER_OFFERED":
      case "TRANSFER_ACCEPTED":
        return <ArrowLeftRight size={18} aria-hidden />;
      case "ORDER_RECEIVED":
        return <ShoppingBag size={18} aria-hidden />;
      case "COMMENT_REPLY":
      case "MENTION":
        return <MessageSquare size={18} aria-hidden />;
      default:
        return <Bell size={18} aria-hidden />;
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px", display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="plx-h1" style={{ margin: 0 }}>Notification Center</h1>
          <p className="plx-hub__sub">
            Review alerts for site transfers, customer payments, comments and updates.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {unreadCount > 0 && (
            <Button variant="secondary" size="sm" leftIcon={<CheckCheck size={16} aria-hidden />} onClick={markAllAsRead}>
              Mark all as read
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--plx-border)", paddingBottom: 8 }}>
        <button
          type="button"
          onClick={() => setFilter("all")}
          style={{
            border: 0,
            background: filter === "all" ? "var(--plx-tint)" : "transparent",
            color: filter === "all" ? "var(--plx-heading)" : "var(--plx-muted)",
            fontWeight: filter === "all" ? 700 : 500,
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          All ({notifications.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter("unread")}
          style={{
            border: 0,
            background: filter === "unread" ? "var(--plx-tint)" : "transparent",
            color: filter === "unread" ? "var(--plx-heading)" : "var(--plx-muted)",
            fontWeight: filter === "unread" ? 700 : 500,
            padding: "6px 14px",
            borderRadius: 8,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Unread ({unreadCount})
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 24, alignItems: "start" }}>
        {/* Notifications Feed */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {loading ? (
            <Card padding="lg">
              <p className="plx-small" style={{ color: "var(--plx-muted)", margin: 0 }}>Loading notifications…</p>
            </Card>
          ) : filtered.length === 0 ? (
            <Card padding="lg">
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--plx-muted)" }}>
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "var(--plx-tint)",
                    color: "var(--plx-muted)",
                    marginBottom: 12,
                  }}
                >
                  <Bell size={22} aria-hidden />
                </span>
                <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: "var(--plx-heading)" }}>
                  No notifications
                </p>
                <span className="plx-small">
                  {filter === "unread" ? "You have no unread notifications." : "You have no notifications right now."}
                </span>
              </div>
            </Card>
          ) : (
            filtered.map((item) => (
              <Card key={item.id} padding="md">
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      background: item.read ? "var(--plx-tint)" : "color-mix(in srgb, var(--plx-brand) 18%, transparent)",
                      color: item.read ? "var(--plx-muted)" : "var(--plx-deep)",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    {getIcon(item.type)}
                  </span>

                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <b style={{ fontSize: 14, color: "var(--plx-heading)" }}>{item.title}</b>
                        {!item.read && <Badge tone="warning">New</Badge>}
                      </div>
                      <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
                        {formatTime(item.createdAt)}
                      </span>
                    </div>

                    <p style={{ margin: "2px 0 8px", fontSize: 13, color: "var(--plx-text)", lineHeight: 1.5 }}>
                      {item.message}
                    </p>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Link
                        href={item.link}
                        onClick={() => void markAsRead(item.id)}
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--plx-deep)",
                          textDecoration: "none",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        {item.actionLabel || "View"}
                        <ChevronRight size={14} aria-hidden />
                      </Link>

                      {!item.read && (
                        <button
                          type="button"
                          onClick={() => void markAsRead(item.id)}
                          style={{
                            border: 0,
                            background: "transparent",
                            fontSize: 11,
                            color: "var(--plx-muted)",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Sidebar: Notification & Sound Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card padding="md">
            <CardHeader title="Sound & alerts" description="Configure active sounds for real-time alerts." />
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 12 }}>
              <label className="plx-toggle" style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <b style={{ fontSize: 13, color: "var(--plx-heading)", display: "block" }}>Notification sounds</b>
                  <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
                    Play when an alert arrives
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="plx-switch"
                  checked={soundEnabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    void saveSettings(inAppEnabled, checked, soundChoice);
                    if (checked) playNotificationSound(soundChoice);
                  }}
                />
              </label>

              {soundEnabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--plx-border)", paddingTop: 14 }}>
                  <b style={{ fontSize: 12, color: "var(--plx-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Select tone (5 options)
                  </b>

                  {SOUND_OPTIONS.map((opt) => {
                    const active = soundChoice === opt.id;
                    return (
                      <div
                        key={opt.id}
                        onClick={() => {
                          void saveSettings(inAppEnabled, soundEnabled, opt.id);
                          playNotificationSound(opt.id);
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: active ? "2px solid var(--plx-brand)" : "1px solid var(--plx-border)",
                          background: active ? "var(--plx-tint)" : "var(--plx-surface)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: "50%",
                              border: active ? "4px solid var(--plx-brand)" : "2px solid var(--plx-border)",
                              background: "var(--plx-surface)",
                            }}
                          />
                          <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: "var(--plx-heading)" }}>
                            {opt.label}
                          </span>
                        </div>

                        <button
                          type="button"
                          title={`Test ${opt.label}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            playNotificationSound(opt.id);
                          }}
                          style={{
                            border: "1px solid var(--plx-border)",
                            background: "var(--plx-surface)",
                            color: "var(--plx-text)",
                            padding: "2px 8px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <Play size={10} aria-hidden />
                          Play
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
