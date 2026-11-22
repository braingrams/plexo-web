"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Bell,
  CheckCheck,
  ChevronRight,
  ExternalLink,
  Heart,
  MessageSquare,
  Play,
  Settings,
  ShoppingBag,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Button, Modal, useToast } from "../ui";
import { playNotificationSound, SOUND_OPTIONS, type SoundChoice } from "@/lib/notifications/audioSynthesizer";
import type { AppNotification } from "@/app/api/v1/notifications/route";

const READ_STORAGE_KEY = "plx:readNotifications";

function getLocalReadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(READ_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveLocalReadIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage errors
  }
}

export function NotificationBell() {
  const router = useRouter();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [localRead, setLocalRead] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Settings
  const [inAppEnabled, setInAppEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundChoice, setSoundChoice] = useState<SoundChoice>("chime");

  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  const loadNotifications = async (isInitial = false) => {
    try {
      const res = await fetch("/api/v1/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      if (data.settings) {
        setInAppEnabled(data.settings.inAppNotifications ?? true);
        setSoundEnabled(data.settings.inAppSound ?? true);
        if (data.settings.soundChoice) setSoundChoice(data.settings.soundChoice);
      }

      // Check if new unread arrived to play sound
      const readSet = getLocalReadIds();
      const currentUnread = (data.notifications || []).filter((n: AppNotification) => !n.read && !readSet.has(n.id)).length;

      if (!isInitial && currentUnread > prevCountRef.current && data.settings?.inAppSound) {
        playNotificationSound(data.settings?.soundChoice || soundChoice);
      }
      prevCountRef.current = currentUnread;
    } catch {
      // Background poll failure is non-fatal
    }
  };

  useEffect(() => {
    setLocalRead(getLocalReadIds());
    void loadNotifications(true);

    // Periodic lightweight poll every 30 seconds
    const interval = setInterval(() => {
      void loadNotifications(false);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const effectiveNotifications = notifications.map((n) => ({
    ...n,
    read: n.read || localRead.has(n.id),
  }));

  const unreadCount = effectiveNotifications.filter((n) => !n.read).length;

  const markAsRead = async (id: string, link?: string) => {
    const next = new Set(localRead);
    next.add(id);
    setLocalRead(next);
    saveLocalReadIds(next);

    void fetch("/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", notificationId: id }),
    });

    if (link) {
      setOpen(false);
      router.push(link);
    }
  };

  const markAllAsRead = async () => {
    const next = new Set(localRead);
    notifications.forEach((n) => next.add(n.id));
    setLocalRead(next);
    saveLocalReadIds(next);

    await fetch("/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read_all" }),
    });

    show({ title: "All notifications marked as read", tone: "success" });
  };

  const saveSettings = async (inApp: boolean, sound: boolean, choice: SoundChoice) => {
    setSavingSettings(true);
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
      show({ title: "Notification settings saved", tone: "success" });
    } catch {
      show({ title: "Failed to save notification settings", tone: "danger" });
    } finally {
      setSavingSettings(false);
    }
  };

  const getIcon = (type: AppNotification["type"]) => {
    switch (type) {
      case "TRANSFER_OFFERED":
      case "TRANSFER_ACCEPTED":
        return <ArrowLeftRight size={16} aria-hidden />;
      case "ORDER_RECEIVED":
        return <ShoppingBag size={16} aria-hidden />;
      case "COMMENT_REPLY":
      case "MENTION":
        return <MessageSquare size={16} aria-hidden />;
      default:
        return <Bell size={16} aria-hidden />;
    }
  };

  const formatTime = (iso: string) => {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "Just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    } catch {
      return "";
    }
  };

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="plx-iconbtn"
        style={{ position: "relative" }}
      >
        <Bell size={19} aria-hidden />
        {unreadCount > 0 ? (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              borderRadius: 999,
              background: "var(--plx-brand)",
              color: "var(--plx-canvas)",
              fontSize: 10,
              fontWeight: 800,
              display: "grid",
              placeItems: "center",
              padding: "0 4px",
              lineHeight: 1,
              boxShadow: "0 0 0 2px var(--plx-surface)",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {/* Floating Dropdown Panel */}
      {open ? (
        <div
          role="dialog"
          aria-label="Notification center"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "min(380px, calc(100vw - 24px))",
            maxHeight: "min(560px, calc(100vh - 100px))",
            borderRadius: "var(--plx-radius-card-lg, 16px)",
            background: "var(--plx-surface)",
            border: "1px solid var(--plx-border)",
            boxShadow: "var(--plx-shadow-card)",
            display: "flex",
            flexDirection: "column",
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--plx-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--plx-tint)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 14, color: "var(--plx-heading)" }}>Notifications</b>
              {unreadCount > 0 ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 999,
                    background: "var(--plx-brand)",
                    color: "var(--plx-canvas)",
                  }}
                >
                  {unreadCount} new
                </span>
              ) : null}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  title="Mark all as read"
                  onClick={() => void markAllAsRead()}
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "var(--plx-muted)",
                    cursor: "pointer",
                    padding: 4,
                    display: "grid",
                    placeItems: "center",
                    borderRadius: 6,
                  }}
                >
                  <CheckCheck size={16} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                title="Notification and sound settings"
                onClick={() => {
                  setOpen(false);
                  setSettingsOpen(true);
                }}
                style={{
                  border: 0,
                  background: "transparent",
                  color: "var(--plx-muted)",
                  cursor: "pointer",
                  padding: 4,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 6,
                }}
              >
                <Settings size={16} aria-hidden />
              </button>
            </div>
          </div>

          {/* Notifications List */}
          <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
            {effectiveNotifications.length === 0 ? (
              <div style={{ padding: "36px 20px", textAlign: "center", color: "var(--plx-muted)" }}>
                <span
                  style={{
                    display: "inline-grid",
                    placeItems: "center",
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    background: "var(--plx-tint)",
                    color: "var(--plx-muted)",
                    marginBottom: 10,
                  }}
                >
                  <Bell size={20} aria-hidden />
                </span>
                <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "var(--plx-heading)" }}>
                  All caught up!
                </p>
                <span className="plx-small">No new notifications right now.</span>
              </div>
            ) : (
              effectiveNotifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => void markAsRead(item.id, item.link)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--plx-border)",
                    background: item.read ? "transparent" : "color-mix(in srgb, var(--plx-brand) 5%, transparent)",
                    cursor: "pointer",
                    transition: "background 0.15s ease",
                  }}
                >
                  {/* Icon */}
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: item.read ? "var(--plx-tint)" : "color-mix(in srgb, var(--plx-brand) 18%, transparent)",
                      color: item.read ? "var(--plx-muted)" : "var(--plx-deep)",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    {getIcon(item.type)}
                  </span>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                      <b
                        style={{
                          fontSize: 13,
                          fontWeight: item.read ? 600 : 700,
                          color: item.read ? "var(--plx-text)" : "var(--plx-heading)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.title}
                      </b>
                      <span style={{ fontSize: 10, color: "var(--plx-muted)", flexShrink: 0 }}>
                        {formatTime(item.createdAt)}
                      </span>
                    </div>

                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        lineHeight: 1.4,
                        color: "var(--plx-muted)",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {item.message}
                    </p>

                    {item.actionLabel && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--plx-deep)",
                          marginTop: 4,
                        }}
                      >
                        {item.actionLabel}
                        <ChevronRight size={12} aria-hidden />
                      </span>
                    )}
                  </div>

                  {/* Unread dot */}
                  {!item.read && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--plx-brand)",
                        flexShrink: 0,
                        marginTop: 6,
                      }}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid var(--plx-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--plx-surface)",
            }}
          >
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
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
              View all notifications
              <ChevronRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      ) : null}

      {/* Settings Modal */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Notification & Sound Settings"
        description="Choose how Plexo alerts you for orders, site transfers, comments and updates."
        footer={
          <Button variant="primary" onClick={() => setSettingsOpen(false)}>
            Done
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* In-app toggle */}
          <label className="plx-toggle" style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <b style={{ color: "var(--plx-heading)", fontSize: 13, display: "block" }}>In-app notification badge</b>
              <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
                Show unread counts and alerts in the bell menu
              </span>
            </div>
            <input
              type="checkbox"
              className="plx-switch"
              checked={inAppEnabled}
              onChange={(e) => void saveSettings(e.target.checked, soundEnabled, soundChoice)}
            />
          </label>

          {/* Sound toggle */}
          <label className="plx-toggle" style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <b style={{ color: "var(--plx-heading)", fontSize: 13, display: "block" }}>Active notification sound</b>
              <span className="plx-small" style={{ color: "var(--plx-muted)" }}>
                Play a sound when a new alert or activity occurs
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

          {/* Sound Selector */}
          {soundEnabled && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--plx-border)", paddingTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Volume2 size={16} style={{ color: "var(--plx-deep)" }} aria-hidden />
                <b style={{ fontSize: 13, color: "var(--plx-heading)" }}>Select notification sound</b>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                {SOUND_OPTIONS.map((opt) => {
                  const selected = soundChoice === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => {
                        void saveSettings(inAppEnabled, soundEnabled, opt.id);
                        playNotificationSound(opt.id);
                      }}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "var(--plx-radius-sm, 8px)",
                        border: selected ? "2px solid var(--plx-brand)" : "1px solid var(--plx-border)",
                        background: selected ? "var(--plx-tint)" : "var(--plx-surface)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            border: selected ? "5px solid var(--plx-brand)" : "2px solid var(--plx-border)",
                            background: "var(--plx-surface)",
                          }}
                        />
                        <div>
                          <b style={{ fontSize: 13, color: "var(--plx-heading)" }}>{opt.label}</b>
                          <span style={{ display: "block", fontSize: 11, color: "var(--plx-muted)" }}>{opt.desc}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        title={`Listen to ${opt.label}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          playNotificationSound(opt.id);
                        }}
                        style={{
                          border: "1px solid var(--plx-border)",
                          background: "var(--plx-surface)",
                          color: "var(--plx-text)",
                          padding: "4px 8px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Play size={11} aria-hidden />
                        Play
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
